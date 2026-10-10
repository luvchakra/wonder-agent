"""The legacy Planet Express directory (OpenLDAP): the original seven, plus
legacy accounts for some current staff, people who have left, and two
accounts nobody owns. Every password the image shipped with is replaced."""
from __future__ import annotations

import ssl

from ldap3 import ALL, MODIFY_ADD, MODIFY_REPLACE, Connection, Server, Tls

from common import DOMAIN, ENV, connection, log, password
from company import EMAIL_DOMAIN, Person, by_flag

BASE = "dc=planetexpress,dc=com"
FOUNDER_CN = {"professor": "Hubert J. Farnsworth", "fry": "Philip J. Fry", "zoidberg": "John A. Zoidberg", "hermes": "Hermes Conrad",
              "leela": "Turanga Leela", "bender": "Bender Bending Rodríguez", "amy": "Amy Wong+sn=Kroker"}


def conn() -> Connection:
    tls = Tls(ca_certs_file="/certs/ca.crt", validate=ssl.CERT_REQUIRED, version=ssl.PROTOCOL_TLS_CLIENT)
    server = Server("openldap", port=10636, use_ssl=True, tls=tls, get_info=ALL)
    return Connection(server, user=f"cn=admin,{BASE}", password=ENV["LDAP_ADMIN_PASSWORD"], auto_bind=True)


def must(c: Connection, ok: bool, what: str) -> None:
    if not ok:
        raise RuntimeError(f"LDAP {what} failed: {c.result.get('description')} {c.result.get('message')}")


def exists(c: Connection, dn: str) -> bool:
    return c.search(dn, "(objectClass=*)", search_scope="BASE")


def add_person(c: Connection, p: Person, legacy_note: str) -> str:
    dn = f"cn={p.name},ou=people,{BASE}"
    if not exists(c, dn):
        must(c, c.add(dn, ["inetOrgPerson"], {"cn": p.name, "sn": p.last, "givenName": p.first, "uid": p.username, "mail": p.email,
                                               "employeeType": legacy_note, "userPassword": password()}), f"add {dn}")
    return dn


def seed(people: list[Person]) -> None:
    log("Legacy directory (OpenLDAP)")
    c = conn()
    # Replace every password the image shipped with (they equal the uid).
    rotated = 0
    c.search(f"ou=people,{BASE}", "(objectClass=inetOrgPerson)", attributes=["uid"])
    for entry in c.entries:
        c.modify(entry.entry_dn, {"userPassword": [(MODIFY_REPLACE, [password()])]})
        rotated += 1

    if not exists(c, f"ou=services,{BASE}"):
        must(c, c.add(f"ou=services,{BASE}", ["organizationalUnit"], {"ou": "services"}), "add ou=services")
    reader = f"cn=wonderid-reader,ou=services,{BASE}"
    if not exists(c, reader):
        c.add(reader, ["organizationalRole", "simpleSecurityObject"], {"cn": "wonderid-reader", "userPassword": ENV["LDAP_READER_PASSWORD"],
                                                                      "description": "WonderID: read-only directory reader"})
    else:
        c.modify(reader, {"userPassword": [(MODIFY_REPLACE, [ENV["LDAP_READER_PASSWORD"]])]})

    # Legacy accounts: some current staff, everyone who left, two nobody owns.
    current = [p for p in people if p.kind == "employee" and p.username not in FOUNDER_CN and p.department in ("Finance", "Delivery Operations") and p.active][:12]
    leavers = by_flag(people, "leaver_clean") + by_flag(people, "leaver_still_active")
    added = [add_person(c, p, "Legacy account") for p in current + leavers]
    for orphan in [Person("X-1", "Calculon", "Unit", "calculon", "", "", ""), Person("X-2", "Hattie", "McDoogal", "hattie.mcdoogal", "", "", "")]:
        added.append(add_person(c, orphan, "Legacy account (owner unknown)"))

    group = f"cn=legacy_finance,ou=people,{BASE}"
    members = list(dict.fromkeys([f"cn={FOUNDER_CN['hermes']},ou=people,{BASE}"] + added[:4] + added[-2:]))
    if not exists(c, group):
        must(c, c.add(group, ["groupOfNames"], {"cn": "legacy_finance", "description": "Old payroll share (legacy)", "member": members}), "add legacy_finance")
    log(f"  {rotated} passwords replaced, {len(added)} legacy accounts, groups admin_staff, ship_crew, legacy_finance")

    connection("Legacy directory (OpenLDAP)", "ldap-directory",
               {"url": f"ldaps://ldap.{DOMAIN}:636", "baseDn": BASE, "caCertificate": open("/certs/ca.crt").read()},
               {"bindDn": reader, "password": ENV["LDAP_READER_PASSWORD"]},
               "Accounts and groups in the company's original directory. Signed by the Planet Express internal CA (included as caCertificate).")
