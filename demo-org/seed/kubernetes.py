"""Workloads (Kubernetes, k3s): namespaces for each product, the service
accounts workloads and AI agents run as, Roles and bindings, and a
read-only service account for WonderID.

Planted here: a forgotten CronJob account bound to cluster-admin, the CI
deployer with edit across the whole cluster, and FinanceBot able to read
secrets in the billing namespace."""
from __future__ import annotations

import base64
import os
import tempfile
import time

import yaml

from common import DOMAIN, Http, connection, log
from company import Person

RBAC = "rbac.authorization.k8s.io"
NAMESPACES = ["delivery", "billing", "agents", "platform"]
ACCOUNTS = {  # namespace/name: owner annotation
    "delivery/routing-api": "team:delivery",
    "billing/billing-api": "team:billing",
    "agents/financebot": "hermes@planetexpress.example",
    "agents/dispatch-assistant": "leela@planetexpress.example",
    "platform/ci-deployer": "team:platform",
    "default/legacy-cron": "",
}
ROLES = {  # namespace/name: rules
    "delivery/route-editor": [{"apiGroups": [""], "resources": ["configmaps"], "verbs": ["get", "list", "update"]}],
    "billing/secret-reader": [{"apiGroups": [""], "resources": ["secrets"], "verbs": ["get", "list"]}],
    "billing/app-runner": [{"apiGroups": ["", "apps"], "resources": ["pods", "deployments"], "verbs": ["get", "list", "watch"]}],
    "agents/agent-runtime": [{"apiGroups": [""], "resources": ["configmaps", "pods"], "verbs": ["get", "list"]}],
}
ROLE_BINDINGS = [  # (namespace, binding, role kind, role, subject namespace/name)
    ("delivery", "routing-api-editor", "Role", "route-editor", "delivery/routing-api"),
    ("billing", "billing-api-runner", "Role", "app-runner", "billing/billing-api"),
    ("billing", "billing-api-secrets", "Role", "secret-reader", "billing/billing-api"),
    ("billing", "financebot-secrets", "Role", "secret-reader", "agents/financebot"),
    ("agents", "financebot-runtime", "Role", "agent-runtime", "agents/financebot"),
    ("agents", "dispatch-runtime", "Role", "agent-runtime", "agents/dispatch-assistant"),
    ("delivery", "dispatch-view", "ClusterRole", "view", "agents/dispatch-assistant"),
]
CLUSTER_BINDINGS = [("ci-deployer-edit", "edit", "platform/ci-deployer"), ("legacy-cron-admin", "cluster-admin", "default/legacy-cron")]
READER_RULES = [
    {"apiGroups": [""], "resources": ["serviceaccounts", "namespaces"], "verbs": ["get", "list"]},
    {"apiGroups": [RBAC], "resources": ["roles", "rolebindings", "clusterroles", "clusterrolebindings"], "verbs": ["get", "list"]},
]


def seed(people: list[Person]) -> None:
    log("Workloads (Kubernetes)")
    cfg = yaml.safe_load(open("/generated/kube/kubeconfig.yaml"))
    user = cfg["users"][0]["user"]
    tmp = tempfile.mkdtemp()

    def write(name: str, b64: str) -> str:
        path = os.path.join(tmp, name)
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        os.chmod(path, 0o600)
        return path

    k = Http("https://k3s:6443")
    k.verify = write("ca.crt", cfg["clusters"][0]["cluster"]["certificate-authority-data"])
    k.cert = (write("client.crt", user["client-certificate-data"]), write("client.key", user["client-key-data"]))

    def apply(obj: dict) -> None:
        kind, meta = obj["kind"], obj["metadata"]
        ns = meta.get("namespace")
        group = "/api/v1" if obj["apiVersion"] == "v1" else f"/apis/{obj['apiVersion']}"
        plural = {"Namespace": "namespaces", "ServiceAccount": "serviceaccounts", "Secret": "secrets", "Role": "roles", "RoleBinding": "rolebindings",
                  "ClusterRole": "clusterroles", "ClusterRoleBinding": "clusterrolebindings"}[kind]
        path = f"{group}/namespaces/{ns}/{plural}/{meta['name']}" if ns else f"{group}/{plural}/{meta['name']}"
        k.patch(path, ok=(200, 201), retries=20, params={"fieldManager": "planet-express-seed", "force": "true"},
                headers={"Content-Type": "application/apply-patch+yaml"}, json=obj)

    def sa_subject(ref: str) -> dict:
        ns, name = ref.split("/")
        return {"kind": "ServiceAccount", "name": name, "namespace": ns}

    for ns in [*NAMESPACES, "wonderid"]:
        apply({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": ns}})
    for ref, owner in ACCOUNTS.items():
        ns, name = ref.split("/")
        annotations = {"owner": owner} if owner else {}
        apply({"apiVersion": "v1", "kind": "ServiceAccount", "metadata": {"name": name, "namespace": ns, "annotations": annotations}})
    for ref, rules in ROLES.items():
        ns, name = ref.split("/")
        apply({"apiVersion": f"{RBAC}/v1", "kind": "Role", "metadata": {"name": name, "namespace": ns}, "rules": rules})
    for ns, binding, kind, role, subject in ROLE_BINDINGS:
        apply({"apiVersion": f"{RBAC}/v1", "kind": "RoleBinding", "metadata": {"name": binding, "namespace": ns},
               "roleRef": {"apiGroup": RBAC, "kind": kind, "name": role}, "subjects": [sa_subject(subject)]})
    for binding, role, subject in CLUSTER_BINDINGS:
        apply({"apiVersion": f"{RBAC}/v1", "kind": "ClusterRoleBinding", "metadata": {"name": binding},
               "roleRef": {"apiGroup": RBAC, "kind": "ClusterRole", "name": role}, "subjects": [sa_subject(subject)]})

    # WonderID: a read-only ClusterRole and a long-lived token for its service account.
    apply({"apiVersion": "v1", "kind": "ServiceAccount", "metadata": {"name": "wonderid-reader", "namespace": "wonderid"}})
    apply({"apiVersion": f"{RBAC}/v1", "kind": "ClusterRole", "metadata": {"name": "wonderid-reader"}, "rules": READER_RULES})
    apply({"apiVersion": f"{RBAC}/v1", "kind": "ClusterRoleBinding", "metadata": {"name": "wonderid-reader"},
           "roleRef": {"apiGroup": RBAC, "kind": "ClusterRole", "name": "wonderid-reader"}, "subjects": [sa_subject("wonderid/wonderid-reader")]})
    apply({"apiVersion": "v1", "kind": "Secret", "type": "kubernetes.io/service-account-token",
           "metadata": {"name": "wonderid-reader-token", "namespace": "wonderid", "annotations": {"kubernetes.io/service-account.name": "wonderid-reader"}}})
    token = ""
    for _ in range(30):
        data = k.get("/api/v1/namespaces/wonderid/secrets/wonderid-reader-token", ok=(200,)).json().get("data") or {}
        if data.get("token"):
            token = base64.b64decode(data["token"]).decode()
            break
        time.sleep(2)
    if not token:
        raise RuntimeError("Kubernetes did not issue the reader's token")

    log(f"  {len(NAMESPACES)} namespaces, {len(ACCOUNTS)} service accounts, {len(ROLES)} roles, {len(ROLE_BINDINGS) + len(CLUSTER_BINDINGS)} bindings")
    connection("Workloads (Kubernetes)", "kubernetes", {"baseUrl": f"https://k8s.{DOMAIN}"}, {"token": token},
               "Service accounts, Roles and ClusterRoles, and the bindings that give service accounts those roles.")
