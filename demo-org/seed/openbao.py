"""Secrets manager (OpenBao): KV secrets, policies, AppRoles for services and
AI agents, userpass logins for administrators, and a read-only token for
WonderID.

Planted here: FinanceBot's AppRole also carries the payments-admin policy,
a legacy AppRole with full access that nobody owns, and an expired
contractor's login with the admin policy."""
from __future__ import annotations

import json

from common import DOMAIN, Http, connection, log, password, remember, save_state, state
from company import Person, by_flag

POLICIES = {
    "finance-read": 'path "secret/data/finance/*" { capabilities = ["read"] }',
    "payments-admin": 'path "secret/data/finance/payments/*" { capabilities = ["create", "update", "read", "delete"] }',
    "deploy": 'path "secret/data/deploy/*" { capabilities = ["read"] }\npath "secret/data/apps/*" { capabilities = ["read"] }',
    "dispatch": 'path "secret/data/delivery/*" { capabilities = ["read"] }',
    "ops-admin": 'path "secret/*" { capabilities = ["create", "update", "read", "delete", "list"] }\npath "sys/policies/acl/*" { capabilities = ["read", "list"] }',
    "admin-all": 'path "*" { capabilities = ["create", "update", "read", "delete", "list", "sudo"] }',
    "wonderid-reader": "\n".join(
        f'path "{p}" {{ capabilities = ["read", "list"] }}'
        for p in ["sys/policies/acl", "sys/policies/acl/*", "sys/auth", "auth/approle/role", "auth/approle/role/*", "auth/userpass/users", "auth/userpass/users/*"]
    ) + '\npath "auth/token/lookup-self" { capabilities = ["read"] }',
}
APPROLES = {  # name: (policies, description)
    "financebot": (["finance-read", "payments-admin"], "ai-agent: financebot"),
    "dispatch-assistant": (["dispatch"], "ai-agent: dispatch-assistant"),
    "ci-deploy": (["deploy"], "service: CI deployments"),
    "billing-service": (["finance-read"], "service: billing-service"),
    "legacy-sync": (["admin-all"], "unknown owner"),
}
SECRETS = ["finance/erp-api", "finance/payments/bank-sftp", "deploy/registry", "apps/billing-db", "delivery/maps-api"]


def seed(people: list[Person]) -> None:
    log("Secrets manager (OpenBao)")
    root = json.loads(open("/generated/bao-init.json").read())["root_token"]
    b = Http("http://openbao:8200/v1")
    b.headers["X-Vault-Token"] = root

    auths = b.get("/sys/auth", ok=(200,), retries=20).json()["data"]
    for mount, kind in (("approle/", "approle"), ("userpass/", "userpass")):
        if mount not in auths:
            b.post(f"/sys/auth/{kind}", ok=(204,), json={"type": kind})
    if "secret/" not in b.get("/sys/mounts", ok=(200,)).json()["data"]:
        b.post("/sys/mounts/secret", ok=(204,), json={"type": "kv", "options": {"version": "2"}})
    for path in SECRETS:
        b.post(f"/secret/data/{path}", ok=(200,), json={"data": {"value": password(32)}})
    for name, hcl in POLICIES.items():
        b.put(f"/sys/policies/acl/{name}", ok=(204,), json={"policy": hcl})
    for name, (pols, desc) in APPROLES.items():
        b.post(f"/auth/approle/role/{name}", ok=(204,), json={"token_policies": pols, "token_ttl": "1h", "secret_id_ttl": "0", "token_meta": {"description": desc}})

    admins = [p for p in people if p.department == "IT & Security" and p.title in ("Systems Administrator", "Head of IT & Security", "Identity Engineer") and p.active]
    engineers = [p for p in people if p.title == "Platform Engineer" and p.active][:4]
    for p in admins:
        b.post(f"/auth/userpass/users/{p.username}", ok=(204,), json={"password": password(), "token_policies": ["ops-admin"]})
    for p in engineers:
        b.post(f"/auth/userpass/users/{p.username}", ok=(204,), json={"password": password(), "token_policies": ["deploy"]})
    for p in by_flag(people, "contractor_expired_admin"):
        b.post(f"/auth/userpass/users/{p.username}", ok=(204,), json={"password": password(), "token_policies": ["admin-all"]})

    # Tokens may live a year, so WonderID's reader does not lapse between syncs.
    b.post("/sys/auth/token/tune", ok=(204,), json={"max_lease_ttl": "8760h"})

    def make_token() -> str:
        r = b.post("/auth/token/create-orphan", ok=(200,), json={"policies": ["wonderid-reader"], "ttl": "8760h", "renewable": True,
                                                                  "display_name": "wonderid-reader", "no_default_policy": True})
        return r.json()["auth"]["client_token"]

    token = remember("openbao_reader_token", make_token)
    check = Http("http://openbao:8200/v1").get("/auth/token/lookup-self", headers={"X-Vault-Token": token})
    if check.status_code != 200:
        data = state()
        data.pop("openbao_reader_token", None)
        save_state(data)
        token = remember("openbao_reader_token", make_token)

    log(f"  {len(POLICIES)} policies, {len(APPROLES)} AppRoles, {len(admins) + len(engineers) + 1} userpass logins")
    connection("Secrets manager (OpenBao)", "openbao", {"baseUrl": f"https://vault.{DOMAIN}"}, {"token": token},
               "AppRoles (services and AI agents), userpass logins, ACL policies, and which policies each holds.")
