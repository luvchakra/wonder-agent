#!/usr/bin/env bash
# Creates Planet Express on Google Cloud, from Cloud Shell, in one command:
#
#   cd demo-org && DEMO_DOMAIN=demo.example.com ACME_EMAIL=you@example.com ./gcp/create-vm.sh
#
# What it makes (all named planet-express-*):
#   - one e2-standard-4 VM (4 vCPU, 16 GB, 60 GB disk, Ubuntu 24.04) with
#     Docker, in asia-southeast1 unless REGION/ZONE say otherwise;
#   - a static IP, so DNS never changes;
#   - firewall rules for HTTPS (80/443) and the directory and database
#     (636 LDAPS, 5432 PostgreSQL over TLS), the ports WonderID connects to;
#   - a schedule that starts the VM at 08:00 and stops it at 20:00 IST, so
#     free credits last (STOP_AT=never keeps it running).
# Then it copies this kit to the VM and builds the company (about 20 minutes
# the first time). Re-running it is safe: anything that exists is kept.
#
# Afterwards, point *.DEMO_DOMAIN at the printed IP (one wildcard A record).
# No secret leaves the VM: passwords and connection details are generated
# there, in /opt/planet-express/.env and generated/.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEMO_DOMAIN:?Set DEMO_DOMAIN, for example DEMO_DOMAIN=demo.example.com}"
: "${ACME_EMAIL:?Set ACME_EMAIL, the address certificate expiry notices go to}"
PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
: "${PROJECT:?Set PROJECT or run gcloud config set project <id>}"
REGION="${REGION:-asia-southeast1}"
ZONE="${ZONE:-${REGION}-b}"
MACHINE="${MACHINE:-e2-standard-4}"
START_AT="${START_AT:-0 8 * * *}"
STOP_AT="${STOP_AT:-0 20 * * *}"
TIMEZONE="${TIMEZONE:-Asia/Kolkata}"
# Who may reach LDAPS and PostgreSQL. WonderID runs on Vercel, whose outbound
# addresses are not fixed, so the default is anywhere; both require TLS and
# a strong random password. Narrow it if your WonderID has fixed egress.
DIRECT_SOURCES="${DIRECT_SOURCES:-0.0.0.0/0}"
VM=planet-express
g() { gcloud --project "$PROJECT" "$@"; }

echo "Project $PROJECT, zone $ZONE, domain $DEMO_DOMAIN"
g services enable compute.googleapis.com >/dev/null

if ! g compute addresses describe "$VM-ip" --region "$REGION" >/dev/null 2>&1; then
  g compute addresses create "$VM-ip" --region "$REGION" >/dev/null
fi
IP=$(g compute addresses describe "$VM-ip" --region "$REGION" --format='value(address)')

rule() { # name, ports, sources
  g compute firewall-rules describe "$1" >/dev/null 2>&1 ||
    g compute firewall-rules create "$1" --network default --direction INGRESS --target-tags "$VM" --allow "$2" --source-ranges "$3" >/dev/null
}
rule "$VM-https" tcp:80,tcp:443 0.0.0.0/0
rule "$VM-direct" tcp:636,tcp:5432 "$DIRECT_SOURCES"

POLICY_FLAG=()
if [ "$STOP_AT" != "never" ]; then
  if ! g compute resource-policies describe "$VM-hours" --region "$REGION" >/dev/null 2>&1; then
    # The Compute Engine service agent starts and stops the VM on schedule.
    NUMBER=$(g projects describe "$PROJECT" --format='value(projectNumber)')
    g projects add-iam-policy-binding "$PROJECT" --condition=None --quiet \
      --member "serviceAccount:service-${NUMBER}@compute-system.iam.gserviceaccount.com" --role roles/compute.instanceAdmin.v1 >/dev/null
    g compute resource-policies create instance-schedule "$VM-hours" --region "$REGION" \
      --vm-start-schedule "$START_AT" --vm-stop-schedule "$STOP_AT" --timezone "$TIMEZONE" >/dev/null
  fi
  POLICY_FLAG=(--resource-policies "$VM-hours")
fi

if ! g compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  g compute instances create "$VM" --zone "$ZONE" --machine-type "$MACHINE" \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 60GB --boot-disk-type pd-balanced \
    --address "$IP" --tags "$VM" "${POLICY_FLAG[@]}" \
    --metadata-from-file startup-script=gcp/startup.sh >/dev/null
  echo "VM created"
fi

echo "Waiting for the VM to install Docker…"
for _ in $(seq 1 60); do
  if g compute ssh "$VM" --zone "$ZONE" --quiet --command "command -v docker >/dev/null && docker compose version >/dev/null" 2>/dev/null; then break; fi
  sleep 10
done

echo "Copying the kit…"
tar --exclude=./.env --exclude=./certs --exclude=./generated -czf - . |
  g compute ssh "$VM" --zone "$ZONE" --quiet --command "sudo mkdir -p /opt/planet-express && sudo tar -xzf - -C /opt/planet-express"

echo "Building Planet Express (the first run takes about 20 minutes)…"
g compute ssh "$VM" --zone "$ZONE" --quiet --command \
  "cd /opt/planet-express && sudo DEMO_DOMAIN='$DEMO_DOMAIN' ACME_EMAIL='$ACME_EMAIL' ./scripts/up.sh"

cat <<DONE

Planet Express is running on $IP.

1. DNS: add one record, *.$DEMO_DOMAIN  A  $IP
   (hr, sso, git, chat, files, vault, s3, k8s, ldap and db live under it).
   HTTPS certificates are issued automatically once it resolves.
2. Connection details for WonderID (they contain live credentials; read
   them over SSH, never copy them anywhere public):
   gcloud compute ssh $VM --zone $ZONE --command 'sudo cat /opt/planet-express/generated/wonderid-connections.md'
3. The VM runs 08:00-20:00 ($TIMEZONE). Start it outside those hours with:
   gcloud compute instances start $VM --zone $ZONE
DONE
