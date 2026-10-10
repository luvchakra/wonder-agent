"""Workforce SSO (Keycloak): the planet-express realm with every current
person, department and access groups, realm roles, and the service-account
clients behind Planet Express's automation and AI agents.

Planted here: a leaver still enabled, a duplicate account under an old
email, an expired contractor still in prod-admins, an expired partner still
enabled, and an AI agent owned by someone who has left."""
from __future__ import annotations

from common import DOMAIN, ENV, Http, connection, log
from company import EMAIL_DOMAIN, Person, by_flag

REALM = "planet-express"
ACCESS_GROUPS = {
    "all-staff": "Every employee",
    "prod-admins": "Administrators of production systems",
    "finance-approvers": "Can approve payments",
    "contractors": "Contract staff",
    "partners": "External partner users",
}
REALM_ROLES = {
    "employee": "Planet Express employee",
    "contractor": "Contract staff",
    "partner": "External partner",
    "finance-approver": "Approves payments in ERPNext",
    "erp-api": "Calls the ERPNext API",
    "git-automation": "Pushes to Git repositories",
    "dispatch-api": "Reads and updates delivery routes",
}
# clientId: (owner username or scenario, purpose, realm roles, groups)
AGENTS = {
    "financebot": ("hermes", "Prepares month-end financial reports", ["erp-api", "finance-approver"], []),
    "dispatch-assistant": ("leela", "Plans delivery routes", ["dispatch-api"], []),
    "code-reviewer": ("amy", "Reviews pull requests", ["git-automation"], ["prod-admins"]),
    "people-helper": ("@agent_owner_leaver", "Answers HR policy questions", ["employee"], []),
    "slurm-integration": ("@partner_expired", "Partner logistics feed", ["dispatch-api"], []),
}
READER_ROLES = ["view-users", "query-users", "view-realm", "view-clients", "query-groups"]


class Admin:
    def __init__(self) -> None:
        self.h = Http("http://keycloak:8080")
        self.token()

    def token(self) -> None:
        r = self.h.post("/realms/master/protocol/openid-connect/token", retries=40, ok=(200,),
                        data={"grant_type": "password", "client_id": "admin-cli", "username": "admin", "password": ENV["KEYCLOAK_ADMIN_PASSWORD"]})
        self.h.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    def call(self, method: str, path: str, ok=(200, 201, 204), **kw):
        r = self.h.request(method, f"/admin/realms{path}", **kw)
        if r.status_code == 401:
            self.token()
            r = self.h.request(method, f"/admin/realms{path}", **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"Keycloak {method} {path} -> {r.status_code}: {r.text[:300]}")
        return r

    def get(self, path: str, **params):
        return self.call("GET", path, params=params).json()


def seed(people: list[Person]) -> None:
    log("Workforce SSO (Keycloak)")
    kc = Admin()
    if kc.call("GET", f"/{REALM}", ok=(200, 404)).status_code == 404:
        kc.call("POST", "", json={"realm": REALM, "enabled": True, "displayName": "Planet Express", "loginWithEmailAllowed": True,
                                  "bruteForceProtected": True, "passwordPolicy": "length(14)"})
    R = f"/{REALM}"
    # User profile: allow the HR attributes this realm records on each user.
    profile = kc.get(f"{R}/users/profile")
    names = {a["name"] for a in profile["attributes"]}
    for attr in ["employeeNumber", "department", "title", "employmentType", "organization", "endDate", "sponsor"]:
        if attr not in names:
            profile["attributes"].append({"name": attr, "displayName": attr, "permissions": {"view": ["admin"], "edit": ["admin"]}, "multivalued": False})
    kc.call("PUT", f"{R}/users/profile", json=profile)

    # Groups: one per department, plus access groups.
    departments = sorted({p.department for p in people})
    groups = {g["name"]: g["id"] for g in kc.get(f"{R}/groups", max=500)}
    for name in [*departments, *ACCESS_GROUPS]:
        if name not in groups:
            kc.call("POST", f"{R}/groups", json={"name": name, "attributes": {"description": [ACCESS_GROUPS.get(name, f"{name} department")]}})
    groups = {g["name"]: g["id"] for g in kc.get(f"{R}/groups", max=500)}

    roles = {r["name"] for r in kc.get(f"{R}/roles", max=500)}
    for name, desc in REALM_ROLES.items():
        if name not in roles:
            kc.call("POST", f"{R}/roles", json={"name": name, "description": desc})
    role_rep = {r["name"]: r for r in kc.get(f"{R}/roles", max=500)}

    existing = {u["username"]: u["id"] for u in kc.get(f"{R}/users", max=2000, briefRepresentation="true")}

    def ensure_user(username: str, p: Person, email: str, enabled: bool) -> str:
        attrs = {"employeeNumber": [p.emp_id], "department": [p.department], "title": [p.title], "employmentType": [p.kind]}
        if p.end:
            attrs["endDate"] = [p.end.isoformat()]
        if p.partner_org:
            attrs["organization"] = [p.partner_org]
        if p.sponsor_id:
            attrs["sponsor"] = [p.sponsor_id]
        body = {"username": username, "email": email, "firstName": p.first, "lastName": p.last, "enabled": enabled, "emailVerified": True, "attributes": attrs}
        if username in existing:
            kc.call("PUT", f"{R}/users/{existing[username]}", json=body)
        else:
            r = kc.call("POST", f"{R}/users", json=body)
            existing[username] = r.headers["Location"].rsplit("/", 1)[-1]
        return existing[username]

    def join(uid: str, group: str) -> None:
        kc.call("PUT", f"{R}/users/{uid}/groups/{groups[group]}")

    def grant(uid: str, *names: str) -> None:
        kc.call("POST", f"{R}/users/{uid}/role-mappings/realm", json=[role_rep[n] for n in names])

    count = 0
    for p in people:
        # Clean leavers were removed properly: disabled, out of every group.
        still_enabled = p.active or "leaver_still_active" in p.flags or p.kind == "partner"
        uid = ensure_user(p.username, p, p.email, enabled=still_enabled)
        count += 1
        if not still_enabled:
            continue
        join(uid, p.department if p.kind != "partner" else "partners")
        if p.kind == "employee":
            join(uid, "all-staff")
            grant(uid, "employee")
        elif p.kind == "contractor":
            join(uid, "contractors")
            grant(uid, "contractor")
        else:
            grant(uid, "partner")
        if p.department == "IT & Security" and ("Administrator" in p.title or "Head" in p.title or "Identity" in p.title):
            join(uid, "prod-admins")
        if p.department == "Finance" and ("Senior" in p.title or "Chief" in p.title or "Manager" in p.title) or "sod" in p.flags:
            join(uid, "finance-approvers")
            grant(uid, "finance-approver")
        if p.kind == "contractor" and p.department in ("Engineering", "IT & Security") and ("contractor_expired_admin" in p.flags or count % 4 == 0):
            join(uid, "prod-admins")
    for p in by_flag(people, "mover"):
        join(existing[p.username], "finance-approvers")  # never removed when they moved to Sales
    for p in by_flag(people, "duplicate"):
        old = f"{p.first[0]}{p.last}".lower()
        uid = ensure_user(old, p, f"{old}@old.{EMAIL_DOMAIN}", enabled=True)
        join(uid, "all-staff")
        join(uid, "prod-admins")

    # Service-account clients: WonderID's reader and the AI agents.
    clients = {c["clientId"]: c["id"] for c in kc.get(f"{R}/clients", max=500)}
    rm = clients["realm-management"]
    rm_roles = {r["name"]: r for r in kc.get(f"{R}/clients/{rm}/roles")}

    def ensure_client(client_id: str, description: str, attributes: dict[str, str]) -> tuple[str, str]:
        body = {"clientId": client_id, "name": client_id, "description": description, "enabled": True, "publicClient": False,
                "serviceAccountsEnabled": True, "standardFlowEnabled": False, "directAccessGrantsEnabled": False, "attributes": attributes}
        if client_id in clients:
            kc.call("PUT", f"{R}/clients/{clients[client_id]}", json={**body, "id": clients[client_id]})
        else:
            r = kc.call("POST", f"{R}/clients", json=body)
            clients[client_id] = r.headers["Location"].rsplit("/", 1)[-1]
        sa = kc.get(f"{R}/clients/{clients[client_id]}/service-account-user")["id"]
        return clients[client_id], sa

    reader_id, reader_sa = ensure_client("wonderid-reader", "WonderID: read-only access to users, groups, roles and clients", {})
    kc.call("POST", f"{R}/users/{reader_sa}/role-mappings/clients/{rm}", json=[rm_roles[n] for n in READER_ROLES])
    reader_secret = kc.get(f"{R}/clients/{reader_id}/client-secret")["value"]

    for client_id, (owner, purpose, agent_roles, agent_groups) in AGENTS.items():
        if owner.startswith("@"):
            owner = by_flag(people, owner[1:])[0].username
        _, sa = ensure_client(client_id, purpose, {"owner": f"{owner}@{EMAIL_DOMAIN}", "purpose": purpose, "kind": "ai-agent"})
        grant(sa, *agent_roles)
        for g in agent_groups:
            join(sa, g)

    log(f"  realm {REALM}: {count} people, {len(groups)} groups, {len(REALM_ROLES)} roles, {len(AGENTS)} agent clients")
    connection("Workforce SSO (Keycloak)", "keycloak", {"baseUrl": f"https://sso.{DOMAIN}", "realm": REALM},
               {"clientId": "wonderid-reader", "clientSecret": reader_secret},
               "Accounts (people and service accounts), groups, realm roles, and who holds which.")
