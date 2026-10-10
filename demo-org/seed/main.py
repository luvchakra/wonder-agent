"""Seeds Planet Express: every system, in dependency order. Idempotent."""
import sys

import common
import company

STEPS = ["frappe_hr", "ldap_dir", "keycloak", "gitea", "mattermost", "nextcloud", "corpdb", "openbao", "kubernetes"]


def main() -> None:
    only = sys.argv[1:] or STEPS
    people = company.build()
    common.log(f"Planet Express: {len(people)} people ({sum(p.kind == 'employee' for p in people)} employees, "
               f"{sum(p.kind == 'contractor' for p in people)} contractors, {sum(p.kind == 'partner' for p in people)} partners)")
    for step in STEPS:
        if step not in only:
            continue
        module = __import__(step)
        module.seed(people)
    common.write_connections()
    common.log("Seed complete. Connection details: generated/wonderid-connections.md")


if __name__ == "__main__":
    main()
