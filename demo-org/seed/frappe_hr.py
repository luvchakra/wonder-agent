"""Frappe HR (system of record for people) and ERPNext (finance app users and roles)."""
from __future__ import annotations

import json
import random

from common import DOMAIN, ENV, Http, connection, log, password, remember
from company import EMAIL_DOMAIN, Person, by_flag

B = "http://frappe-frontend:8080"
DEPT_NAMES = {"Executive": "Executive", "Finance": "Finance", "People": "People", "Delivery Operations": "Delivery Operations",
              "Engineering": "Engineering", "IT & Security": "IT & Security", "Customer Support": "Customer Support", "Sales": "Sales"}
READER_ROLE = "WonderID Reader"
READER_DOCTYPES = ["Employee", "Department", "Designation", "Company", "User", "Role", "Has Role", "Branch", "Employment Type"]


def session() -> Http:
    s = Http(B)
    s.post("/api/method/login", data={"usr": "Administrator", "pwd": ENV["FRAPPE_ADMIN_PASSWORD"]}, ok=(200,))
    return s


def get_all(s: Http, doctype: str, fields=("name",), filters=None) -> list[dict]:
    params = {"fields": json.dumps(list(fields)), "limit_page_length": 0}
    if filters:
        params["filters"] = json.dumps(filters)
    return s.get(f"/api/resource/{doctype}", params=params, ok=(200,)).json()["data"]


def ensure(s: Http, doctype: str, name: str, doc: dict) -> None:
    r = s.get(f"/api/resource/{doctype}/{name}")
    if r.status_code == 200:
        return
    s.post(f"/api/resource/{doctype}", json=doc, ok=(200,))


def setup_company(s: Http) -> None:
    done = s.get("/api/method/frappe.client.get_value", params={"doctype": "System Settings", "fieldname": "setup_complete"}, ok=(200,)).json()
    if str(done["message"]["setup_complete"]) == "1":
        return
    args = {"language": "English", "country": "United States", "timezone": "America/New_York", "currency": "USD",
            "full_name": "Hermes Conrad", "email": f"hermes.setup@{EMAIL_DOMAIN}", "password": password(),
            "company_name": "Planet Express", "company_abbr": "PE", "chart_of_accounts": "Standard",
            "fy_start_date": "2026-01-01", "fy_end_date": "2026-12-31", "setup_demo": 0}
    s.post("/api/method/frappe.desk.page.setup_wizard.setup_wizard.setup_complete", data={"args": json.dumps(args)}, ok=(200,), timeout=900)
    log("  Frappe: company set up")


def seed(people: list[Person]) -> dict[str, str]:
    log("Frappe HR + ERPNext")
    s = session()
    setup_company(s)
    rnd = random.Random(int(ENV.get("SEED", "42")))

    for d in DEPT_NAMES.values():
        ensure(s, "Department", f"{d} - PE", {"department_name": d, "company": "Planet Express", "parent_department": "All Departments"})
    for t in sorted({p.title for p in people if p.kind != "partner"}):
        ensure(s, "Designation", t, {"designation_name": t})
    for b in sorted({p.location for p in people if p.kind != "partner"}):
        ensure(s, "Branch", b, {"branch": b})

    existing = {e["employee_number"]: e["name"] for e in get_all(s, "Employee", ("name", "employee_number")) if e.get("employee_number")}
    created = 0
    # Managers first, so reports_to always points at an existing record.
    order = sorted([p for p in people if p.kind != "partner"], key=lambda p: (p.manager_id is not None, p.title.find("Manager") < 0))
    pending = list(order)
    for _ in range(6):
        retry = []
        for p in pending:
            if p.emp_id in existing:
                continue
            if p.manager_id and p.manager_id not in existing:
                retry.append(p)
                continue
            doc = {
                "naming_series": "HR-EMP-", "employee_number": p.emp_id, "first_name": p.first, "last_name": p.last,
                "gender": rnd.choice(["Male", "Female", "Other"]), "date_of_birth": f"{rnd.randint(1960, 2003)}-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}",
                "date_of_joining": p.start.isoformat(), "company": "Planet Express", "department": f"{DEPT_NAMES[p.department]} - PE",
                "designation": p.title, "branch": p.location, "employment_type": "Contract" if p.kind == "contractor" else "Full-time",
                "company_email": p.email, "prefered_contact_email": "Company Email", "status": "Active",
                "reports_to": existing.get(p.manager_id) if p.manager_id else None,
            }
            if p.end and p.kind == "contractor":
                doc["contract_end_date"] = p.end.isoformat()
            r = s.post("/api/resource/Employee", json=doc, ok=(200,)).json()["data"]
            existing[p.emp_id] = r["name"]
            created += 1
        pending = retry
        if not pending:
            break
    # Leavers: status Left with a relieving date.
    for p in people:
        if p.kind != "partner" and p.status == "Left" and p.emp_id in existing:
            s.put(f"/api/resource/Employee/{existing[p.emp_id]}", json={"status": "Left", "relieving_date": p.end.isoformat()}, ok=(200,))
    log(f"  employees: {created} created, {len(existing)} in total")

    # ERPNext users for Finance and People (+ planted scenarios).
    users = {u["name"] for u in get_all(s, "User")}

    def roles_for(p: Person) -> list[str]:
        if "sod" in p.flags:
            return ["Accounts Manager", "Purchase Manager", "Employee"]
        if "mover" in p.flags:
            return ["Purchase Manager", "Employee"]  # kept after moving to Sales
        if p.department == "Finance":
            if "Chief" in p.title or "Manager" in p.title:
                return ["Accounts Manager", "Accounts User", "Employee"]
            if p.title == "Purchasing Officer":
                return ["Purchase User", "Employee"]
            return ["Accounts User", "Employee"]
        if p.department == "People":
            return ["HR Manager", "HR User", "Employee"] if ("Head" in p.title or "Manager" in p.title) else ["HR User", "Employee"]
        return []

    made = 0
    for p in people:
        roles = roles_for(p)
        if not roles or p.kind == "partner":
            continue
        if p.email not in users:
            s.post("/api/resource/User", json={"email": p.email, "first_name": p.first, "last_name": p.last, "send_welcome_email": 0,
                                               "enabled": 0 if "leaver_clean" in p.flags else 1, "user_type": "System User",
                                               "roles": [{"role": r} for r in roles]}, ok=(200,))
            made += 1
            if p.emp_id in existing:
                s.put(f"/api/resource/Employee/{existing[p.emp_id]}", json={"user_id": p.email}, ok=(200,))
    # Orphaned account: nobody in HR.
    orphan = f"temp.accountant@{EMAIL_DOMAIN}"
    if orphan not in users:
        s.post("/api/resource/User", json={"email": orphan, "first_name": "Temp", "last_name": "Accountant", "send_welcome_email": 0,
                                           "enabled": 1, "roles": [{"role": "Accounts User"}]}, ok=(200,))
    log(f"  ERPNext users: {made} created")

    # Least-privilege reader for WonderID: read-only on the doctypes the connectors use.
    ensure(s, "Role", READER_ROLE, {"role_name": READER_ROLE, "desk_access": 0})
    perms = get_all(s, "Custom DocPerm", ("parent", "role", "permlevel"), [["role", "=", READER_ROLE]])
    have = {(x["parent"], int(x["permlevel"])) for x in perms}
    # User keeps roles and user type at permission level 1.
    wanted = [(dt, 0) for dt in READER_DOCTYPES] + [("User", 1)]
    for dt, level in wanted:
        if (dt, level) not in have:
            s.post("/api/resource/Custom DocPerm", json={"parent": dt, "parenttype": "DocType", "parentfield": "permissions", "role": READER_ROLE, "permlevel": level, "read": 1}, ok=(200,))
    reader = f"wonderid-reader@{EMAIL_DOMAIN}"
    if reader not in users:
        s.post("/api/resource/User", json={"email": reader, "first_name": "WonderID", "last_name": "Reader", "send_welcome_email": 0,
                                           "enabled": 1, "user_type": "System User", "roles": [{"role": READER_ROLE}]}, ok=(200,))

    def api_keys() -> str:
        r = s.post("/api/method/frappe.core.doctype.user.user.generate_keys", data={"user": reader}, ok=(200,)).json()["message"]
        key = s.get(f"/api/resource/User/{reader}", ok=(200,)).json()["data"]["api_key"]
        return json.dumps({"apiKey": key, "apiSecret": r["api_secret"]})

    keys = json.loads(remember("frappe_reader_keys", api_keys))
    url = f"https://hr.{DOMAIN}"
    connection("Frappe HR (HR system of record)", "frappe-hr", {"baseUrl": url, "company": "Planet Express"}, keys,
               "Employees, managers, departments and leavers. Use it as the authoritative identity source.")
    connection("ERPNext (finance)", "erpnext", {"baseUrl": url}, keys, "Application users and their roles (segregation of duties).")
    return existing
