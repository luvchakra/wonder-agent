"""File sharing (Nextcloud): office staff, department groups, an external
auditors group, and WonderID's reader.

Planted here: a leaver still enabled, an external auditor whose engagement
ended still in the auditors group, and a contractor in the admin group.
Nextcloud has no read-only administrator role, so the reader is an
administrator with an app password (WonderID only ever reads with it)."""
from __future__ import annotations

from common import DOMAIN, ENV, Http, connection, log, password, remember, save_state, state
from company import Person, by_flag

OFFICE = ("Executive", "Finance", "People", "Engineering", "IT & Security", "Customer Support", "Sales")


def seed(people: list[Person]) -> None:
    log("File sharing (Nextcloud)")
    n = Http("http://nextcloud/ocs/v1.php/cloud")
    n.auth = ("admin", ENV["NEXTCLOUD_ADMIN_PASSWORD"])
    n.headers.update({"OCS-APIRequest": "true", "Accept": "application/json"})

    def ocs(method: str, path: str, **kw):
        r = n.request(method, path, ok=(200,), retries=10, **kw)
        meta = r.json()["ocs"]["meta"]
        if meta["statuscode"] not in (100, 200):
            raise RuntimeError(f"Nextcloud {method} {path}: {meta['statuscode']} {meta.get('message')}")
        return r.json()["ocs"]["data"]

    users = set(ocs("GET", "/users", params={"limit": 2000})["users"])
    groups = set(ocs("GET", "/groups")["groups"])
    for g in [*OFFICE, "auditors", "admin"]:
        if g not in groups:
            ocs("POST", "/groups", data={"groupid": g})

    def ensure(uid: str, name: str, email: str, group_list: list[str], enabled: bool) -> None:
        if uid not in users:
            ocs("POST", "/users", data={"userid": uid, "password": password() + "!a1", "displayName": name, "email": email, "groups[]": group_list})
            users.add(uid)
        else:
            for g in group_list:
                ocs("POST", f"/users/{uid}/groups", data={"groupid": g})
        ocs("PUT", f"/users/{uid}/{'enable' if enabled else 'disable'}")

    office = [p for p in people if p.kind != "partner" and p.department in OFFICE]
    for p in office:
        ensure(p.username, p.name, p.email, [p.department], p.active or "leaver_still_active" in p.flags)
    auditors = [p for p in people if p.partner_org == "Hale & Partners LLP"]
    for p in auditors:
        ensure(p.username, f"{p.name} ({p.partner_org})", p.email, ["auditors"], True)  # nobody disables them at the end
    for p in by_flag(people, "contractor_expired_admin"):
        ensure(p.username, p.name, p.email, ["admin"], True)

    # The reader's account password is random and never handed out; only a
    # revocable app password is. (Nextcloud invalidates app passwords when
    # the account password changes, so it is set once, when one is minted.)
    def app_password() -> str:
        login = password() + "!a1"
        if "wonderid-reader" not in users:
            ocs("POST", "/users", data={"userid": "wonderid-reader", "password": login, "displayName": "WonderID reader", "groups[]": ["admin"]})
            users.add("wonderid-reader")
        else:
            ocs("PUT", "/users/wonderid-reader", data={"key": "password", "value": login})
        r = Http("http://nextcloud").get("/ocs/v2.php/core/getapppassword", ok=(200,), auth=("wonderid-reader", login),
                                         headers={"OCS-APIRequest": "true", "Accept": "application/json"})
        return r.json()["ocs"]["data"]["apppassword"]

    secret = remember("nextcloud_reader_app_password", app_password)
    check = Http("http://nextcloud").get("/ocs/v2.php/cloud/user", auth=("wonderid-reader", secret), headers={"OCS-APIRequest": "true", "Accept": "application/json"})
    if check.status_code != 200:
        data = state()
        data.pop("nextcloud_reader_app_password", None)
        save_state(data)
        secret = remember("nextcloud_reader_app_password", app_password)

    log(f"  {len(office)} staff, {len(auditors)} auditors, {len(OFFICE) + 2} groups")
    connection("File sharing (Nextcloud)", "nextcloud", {"baseUrl": f"https://files.{DOMAIN}"}, {"username": "wonderid-reader", "appPassword": secret},
               "Accounts, groups (admin flagged) and group membership. Nextcloud has no read-only administrator, so the reader is an admin with an app password.")
