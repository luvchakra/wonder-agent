"""Business database (PostgreSQL): finance, delivery, HR and customer data,
group roles that carry table privileges, application service logins,
DBAs and analysts, and a read-only login for WonderID.

Planted here: FinanceBot's login can read customer data it has no purpose
for, a shared legacy superuser nobody owns, a leaver's login still valid,
and an expired contractor's login still holding write access."""
from __future__ import annotations

import psycopg
from psycopg import sql

from common import DOMAIN, ENV, connection, log, password
from company import Person, by_flag

SCHEMAS = {
    "finance": ["invoices", "payments", "suppliers", "ledger"],
    "delivery": ["shipments", "routes", "vehicles"],
    "hr": ["salaries", "reviews"],
    "customers": ["accounts", "contacts", "orders"],
}
# group role: (comment, [(privileges, schema)])
GROUPS = {
    "finance_read": ("Read finance data", [("SELECT", "finance")]),
    "finance_write": ("Post invoices and suppliers", [("SELECT, INSERT, UPDATE", "finance")]),
    "payments_approver": ("Approve payments", [("SELECT, UPDATE", "finance")]),
    "delivery_read": ("Read delivery data", [("SELECT", "delivery")]),
    "delivery_write": ("Plan routes and shipments", [("SELECT, INSERT, UPDATE, DELETE", "delivery")]),
    "hr_confidential": ("Salaries and reviews", [("SELECT", "hr")]),
    "customers_read": ("Customer records", [("SELECT", "customers")]),
    "reporting_ro": ("Reporting across finance and delivery", [("SELECT", "finance"), ("SELECT", "delivery")]),
}
SERVICES = {  # login: (comment, groups)
    "billing_svc": ("service: billing-service", ["finance_write"]),
    "routing_svc": ("service: delivery-routing", ["delivery_write"]),
    "financebot_svc": ("ai-agent: financebot", ["reporting_ro", "customers_read"]),
    "dispatch_assistant_svc": ("ai-agent: dispatch-assistant", ["delivery_read"]),
}


def seed(people: list[Person]) -> None:
    log("Business database (PostgreSQL)")
    dsn = f"host=corpdb dbname=delivery user=postgres password={ENV['CORPDB_PASSWORD']} sslmode=verify-full sslrootcert=/certs/ca.crt"
    with psycopg.connect(dsn, autocommit=True) as db:
        roles = {r[0] for r in db.execute("SELECT rolname FROM pg_roles").fetchall()}

        def role(name: str, login: bool, comment: str, extra: str = "") -> None:
            ident = sql.Identifier(name)
            if name not in roles:
                db.execute(sql.SQL("CREATE ROLE {} " + ("LOGIN" if login else "NOLOGIN") + " " + extra).format(ident))
                roles.add(name)
            elif extra:
                db.execute(sql.SQL("ALTER ROLE {} " + extra).format(ident))
            if login:
                db.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(ident, sql.Literal(password())))
            db.execute(sql.SQL("COMMENT ON ROLE {} IS {}").format(ident, sql.Literal(comment)))

        def member(login: str, group: str) -> None:
            db.execute(sql.SQL("GRANT {} TO {}").format(sql.Identifier(group), sql.Identifier(login)))

        for schema, tables in SCHEMAS.items():
            db.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
            for t in tables:
                db.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {}.{} (id bigserial PRIMARY KEY, created_at timestamptz DEFAULT now(), data jsonb)").format(sql.Identifier(schema), sql.Identifier(t)))
        for group, (comment, privs) in GROUPS.items():
            role(group, False, comment)
            for priv, schema in privs:
                db.execute(sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(group)))
                db.execute(sql.SQL("GRANT " + priv + " ON ALL TABLES IN SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(group)))
        role("db_admins", False, "Database administrators", "CREATEROLE CREATEDB")

        for login, (comment, groups) in SERVICES.items():
            role(login, True, comment)
            for g in groups:
                member(login, g)

        def person(p: Person, groups: list[str], valid_until: str | None = None) -> None:
            login = p.username.replace(".", "_")
            role(login, True, f"person: {p.email}", f"VALID UNTIL '{valid_until}'" if valid_until else "VALID UNTIL 'infinity'")
            for g in groups:
                member(login, g)

        humans = 0
        for p in people:
            if p.kind == "partner":
                continue
            groups: list[str] = []
            if p.department == "IT & Security" and p.title in ("Systems Administrator", "Head of IT & Security"):
                groups = ["db_admins"]
            elif p.title in ("Data Engineer",):
                groups = ["reporting_ro", "delivery_read"]
            elif p.title in ("Financial Analyst", "Treasury Analyst"):
                groups = ["finance_read"]
            elif p.title in ("Payroll Specialist",):
                groups = ["hr_confidential"]
            if "sod" in p.flags:
                groups = ["finance_write", "payments_approver"]
            if not groups:
                continue
            if not p.active and "leaver_still_active" not in p.flags:
                continue
            person(p, groups)
            humans += 1
        for p in by_flag(people, "leaver_still_active")[:1]:
            person(p, ["reporting_ro"])
        for p in by_flag(people, "contractor_expired_admin"):
            person(p, ["delivery_write", "finance_write"], valid_until=p.end.isoformat() if p.end else None)

        # A shared superuser from the early days.
        role("pe_legacy", True, "shared: legacy admin login (owner unknown)", "SUPERUSER")

        role("wonderid_reader", True, "WonderID: read-only catalog reader")
        db.execute(sql.SQL("ALTER ROLE wonderid_reader PASSWORD {}").format(sql.Literal(ENV["CORPDB_READER_PASSWORD"])))
        db.execute("REVOKE ALL ON SCHEMA public FROM wonderid_reader")

    log(f"  {len(GROUPS) + 1} group roles, {len(SERVICES)} service logins, {humans} people")
    connection("Business database (PostgreSQL)", "postgresql",
               {"url": f"postgres://db.{DOMAIN}:5432/delivery", "caCertificate": open("/certs/ca.crt").read()},
               {"username": "wonderid_reader", "password": ENV["CORPDB_READER_PASSWORD"]},
               "Login roles, group roles with the table privileges they carry, and role membership. Signed by the Planet Express internal CA.")
