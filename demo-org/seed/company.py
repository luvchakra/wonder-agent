"""The Planet Express workforce: deterministic (same SEED, same company).

Founders come from the Planet Express LDAP directory; everyone else is
generated with Faker. Planted scenarios (see SCENARIOS) are flags on the
people they apply to, so every system seeds the same story.
"""
from __future__ import annotations

import datetime as dt
import os
import random
from dataclasses import dataclass, field

from faker import Faker

EMAIL_DOMAIN = "planetexpress.example"  # reserved: can never reach a real inbox
TODAY = dt.date.today()


@dataclass
class Person:
    emp_id: str
    first: str
    last: str
    username: str
    department: str
    title: str
    location: str
    kind: str = "employee"  # employee | contractor | partner
    manager_id: str | None = None
    start: dt.date = TODAY
    end: dt.date | None = None
    status: str = "Active"  # Active | Left
    partner_org: str | None = None
    sponsor_id: str | None = None
    flags: set[str] = field(default_factory=set)

    @property
    def name(self) -> str:
        return f"{self.first} {self.last}"

    @property
    def email(self) -> str:
        return f"{self.username}@{EMAIL_DOMAIN}"

    @property
    def active(self) -> bool:
        return self.status == "Active" and (self.end is None or self.end >= TODAY)


DEPARTMENTS = {
    "Executive": (3, ["Chief of Staff", "Executive Assistant"]),
    "Finance": (25, ["Accountant", "Senior Accountant", "Payables Specialist", "Financial Analyst", "Purchasing Officer", "Treasury Analyst"]),
    "People": (12, ["HR Generalist", "Recruiter", "Payroll Specialist", "People Partner"]),
    "Delivery Operations": (80, ["Delivery Associate", "Ship Pilot", "Dispatcher", "Route Planner", "Cargo Handler", "Fleet Technician"]),
    "Engineering": (55, ["Software Engineer", "Senior Software Engineer", "Data Engineer", "QA Engineer", "Platform Engineer"]),
    "IT & Security": (15, ["Systems Administrator", "Security Analyst", "Identity Engineer", "Help Desk Technician"]),
    "Customer Support": (25, ["Support Agent", "Support Specialist", "Customer Success Manager"]),
    "Sales": (15, ["Account Executive", "Sales Development Rep", "Partnerships Manager"]),
}
LOCATIONS = ["New New York", "New New York", "New New York", "Mars Vegas", "Remote"]

# (uid, first, last, department, title, manager uid)
FOUNDERS = [
    ("professor", "Hubert", "Farnsworth", "Executive", "Chief Executive Officer", None),
    ("hermes", "Hermes", "Conrad", "Finance", "Chief Financial Officer", "professor"),
    ("leela", "Turanga", "Leela", "Delivery Operations", "VP, Delivery Operations", "professor"),
    ("amy", "Amy", "Wong", "Engineering", "VP, Engineering", "professor"),
    ("zoidberg", "John", "Zoidberg", "People", "Head of People", "professor"),
    ("fry", "Philip", "Fry", "Delivery Operations", "Delivery Associate", "leela"),
    ("bender", "Bender", "Rodriguez", "Delivery Operations", "Delivery Robot", "leela"),
]

PARTNERS = [("Hale & Partners LLP", "External Auditor", 4), ("Ledgerline Consulting", "ERP Consultant", 3), ("Slurm Logistics", "Logistics Coordinator", 3)]

SCENARIOS = {
    "leaver_still_active": "Left in HR 30+ days ago but still enabled in the IdP and apps",
    "leaver_clean": "Left and properly disabled everywhere",
    "duplicate": "A second IdP account for the same person under an old email",
    "mover": "Moved from Finance to Sales; still holds Purchase Manager in ERPNext",
    "sod": "Can both create suppliers and approve payments in ERPNext",
    "contractor_expired_admin": "Contract ended last week; still in prod-admins",
    "partner_expired": "Partner access past its end date",
    "agent_owner_leaver": "Owns an AI agent and has left the company",
    "token_owner": "Their personal Git token is used by automation",
}


def build() -> list[Person]:
    seed = int(os.environ.get("SEED", "42"))
    rnd = random.Random(seed)
    fake = Faker("en_US")
    Faker.seed(seed)
    people: list[Person] = []
    used: set[str] = set()

    def username(first: str, last: str) -> str:
        base = f"{first}.{last}".lower().replace("'", "").replace(" ", "")
        name, n = base, 2
        while name in used:
            name, n = f"{base}{n}", n + 1
        used.add(name)
        return name

    def joined(min_years=0.2, max_years=9.0) -> dt.date:
        return TODAY - dt.timedelta(days=int(rnd.uniform(min_years, max_years) * 365))

    counter = iter(range(1, 10_000))
    nid = lambda: f"PE-{next(counter):04d}"

    by_uid: dict[str, Person] = {}
    for uid, first, last, dept, title, mgr in FOUNDERS:
        used.add(uid)
        p = Person(nid(), first, last, uid, dept, title, "New New York", manager_id=None, start=TODAY - dt.timedelta(days=3650 + rnd.randint(0, 700)))
        by_uid[uid] = p
        people.append(p)
    for uid, *_rest, mgr in FOUNDERS:
        if mgr:
            by_uid[uid].manager_id = by_uid[mgr].emp_id
    ceo = by_uid["professor"]

    heads = {"Executive": ceo, "Finance": by_uid["hermes"], "Delivery Operations": by_uid["leela"], "Engineering": by_uid["amy"], "People": by_uid["zoidberg"]}
    for dept, title in [("IT & Security", "Head of IT & Security"), ("Customer Support", "Head of Customer Support"), ("Sales", "Head of Sales")]:
        p = Person(nid(), fake.first_name(), fake.last_name(), "", dept, title, "New New York", manager_id=ceo.emp_id, start=joined(3, 9))
        p.username = username(p.first, p.last)
        heads[dept] = p
        people.append(p)

    for dept, (size, titles) in DEPARTMENTS.items():
        head = heads[dept]
        existing = sum(1 for p in people if p.department == dept)
        managers: list[Person] = []
        n_managers = max(1, size // 12) if dept != "Executive" else 0
        for _ in range(n_managers):
            p = Person(nid(), fake.first_name(), fake.last_name(), "", dept, f"{dept} Manager", rnd.choice(LOCATIONS), manager_id=head.emp_id, start=joined(1, 8))
            p.username = username(p.first, p.last)
            managers.append(p)
            people.append(p)
        for _ in range(max(0, size - existing - n_managers)):
            mgr = rnd.choice(managers) if managers else head
            p = Person(nid(), fake.first_name(), fake.last_name(), "", dept, rnd.choice(titles), rnd.choice(LOCATIONS), manager_id=mgr.emp_id, start=joined())
            p.username = username(p.first, p.last)
            people.append(p)

    # Contractors: fixed end dates, sponsored by a manager.
    for i in range(20):
        dept = rnd.choice(["Engineering", "IT & Security", "Delivery Operations"])
        sponsor = heads[dept]
        p = Person(nid(), fake.first_name(), fake.last_name(), "", dept, "Contractor", "Remote", kind="contractor", manager_id=sponsor.emp_id, sponsor_id=sponsor.emp_id, start=joined(0.1, 1.5), end=TODAY + dt.timedelta(days=rnd.randint(20, 300)))
        p.username = username(p.first, p.last)
        people.append(p)

    # External partners: Keycloak only, sponsored by an employee.
    for org, title, n in PARTNERS:
        for _ in range(n):
            sponsor = by_uid["hermes"] if "Audit" in title or "ERP" in title else by_uid["leela"]
            p = Person(nid(), fake.first_name(), fake.last_name(), "", "Partners", title, "External", kind="partner", partner_org=org, sponsor_id=sponsor.emp_id, start=joined(0.1, 1), end=TODAY + dt.timedelta(days=rnd.randint(30, 200)))
            p.username = username(p.first, p.last)
            people.append(p)

    # ---- Planted scenarios ----
    staff = [p for p in people if p.kind == "employee" and p.username not in by_uid and "Head" not in p.title and "Manager" not in p.title]
    rnd.shuffle(staff)
    pick = iter(staff)

    def leave(p: Person, days_ago: int, flag: str):
        p.status, p.end = "Left", TODAY - dt.timedelta(days=days_ago)
        p.flags.add(flag)

    for days in (35, 52):
        leave(next(p for p in pick if p.department in ("Engineering", "Finance")), days, "leaver_still_active")
    for days in (40, 70, 95, 120):
        leave(next(pick), days, "leaver_clean")
    next(p for p in pick if p.department == "Engineering").flags.add("duplicate")
    mover = next(p for p in pick if p.department == "Finance")
    mover.flags.add("mover")
    mover.department, mover.title, mover.manager_id = "Sales", "Account Executive", heads["Sales"].emp_id
    next(p for p in pick if p.department == "Finance").flags.add("sod")
    owner = next(p for p in pick if p.department == "People")
    leave(owner, 21, "agent_owner_leaver")
    next(p for p in pick if p.department == "Engineering").flags.add("token_owner")

    contractor = next(p for p in people if p.kind == "contractor" and p.department in ("Engineering", "IT & Security"))
    contractor.end, contractor.flags = TODAY - dt.timedelta(days=7), {"contractor_expired_admin"}
    partner = next(p for p in people if p.kind == "partner" and p.partner_org == "Slurm Logistics")
    partner.end, partner.flags = TODAY - dt.timedelta(days=12), {"partner_expired"}
    return people


def by_flag(people: list[Person], flag: str) -> list[Person]:
    return [p for p in people if flag in p.flags]


def find(people: list[Person], username: str) -> Person:
    return next(p for p in people if p.username == username)
