"""Source control (Gitea): engineers, IT and some business users, the
planet-express organization with its teams and repositories, and the bot
accounts automation and the code-review agent use.

Planted here: an engineer who left but can still sign in, an expired
contractor still in Owners, and a personal token that automation uses."""
from __future__ import annotations

from common import DOMAIN, ENV, Http, connection, log, password, remember
from company import EMAIL_DOMAIN, Person, by_flag

ORG = "planet-express"
TEAMS = {  # name: (permission, description)
    "engineering": ("write", "Application engineers"),
    "platform": ("admin", "Platform and infrastructure engineers"),
    "finance-tools": ("read", "Finance analysts reading reporting code"),
    "delivery-ops": ("read", "Route planners"),
}
UNITS = ["repo.code", "repo.issues", "repo.pulls", "repo.releases", "repo.wiki", "repo.actions", "repo.packages", "repo.projects"]
REPOS = ["delivery-routing", "billing-service", "infra-terraform", "financebot", "website", "hr-scripts"]
BOTS = {"ci-bot": "Builds and deploys", "code-reviewer": "AI code-review agent", "deploy-bot": "Legacy deploy automation"}


def seed(people: list[Person]) -> None:
    log("Source control (Gitea)")
    g = Http("http://gitea:3000/api/v1")
    g.auth = ("pe-admin", ENV["GITEA_ADMIN_PASSWORD"])
    g.get("/version", ok=(200,), retries=30)

    def git_user(p: Person) -> bool:
        if p.kind == "partner":
            return False
        if p.department in ("Engineering", "IT & Security"):
            return True
        return p.title in ("Route Planner", "Financial Analyst") or p.username in ("amy", "professor")

    users = {u["login"] for u in g.get("/admin/users", params={"limit": 1000}, ok=(200,)).json()}

    def ensure_user(login: str, email: str, full_name: str, active: bool) -> None:
        if login not in users:
            g.post("/admin/users", ok=(201,), json={"username": login, "email": email, "full_name": full_name, "password": password(),
                                                     "must_change_password": False, "send_notify": False, "source_id": 0, "login_name": login})
            users.add(login)
        g.patch(f"/admin/users/{login}", ok=(200,), json={"login_name": login, "source_id": 0, "prohibit_login": not active, "active": True})

    members = [p for p in people if git_user(p)]
    for p in members:
        ensure_user(p.username, p.email, p.name, p.active or "leaver_still_active" in p.flags)
    for bot, desc in BOTS.items():
        ensure_user(bot, f"{bot}@{EMAIL_DOMAIN}", desc, True)

    if g.get(f"/orgs/{ORG}").status_code == 404:
        g.post("/orgs", ok=(201,), json={"username": ORG, "full_name": "Planet Express", "visibility": "private"})
    teams = {t["name"]: t["id"] for t in g.get(f"/orgs/{ORG}/teams", params={"limit": 50}, ok=(200,)).json()}
    for name, (perm, desc) in TEAMS.items():
        if name not in teams:
            r = g.post(f"/orgs/{ORG}/teams", ok=(201,), json={"name": name, "description": desc, "permission": perm, "units": UNITS,
                                                                "includes_all_repositories": True, "can_create_org_repo": perm == "admin"})
            teams[name] = r.json()["id"]
    repos = {r["name"] for r in g.get(f"/orgs/{ORG}/repos", params={"limit": 50}, ok=(200,)).json()}
    for name in REPOS:
        if name not in repos:
            g.post(f"/orgs/{ORG}/repos", ok=(201,), json={"name": name, "private": True, "auto_init": True, "default_branch": "main"})

    def add(team: str, login: str) -> None:
        g.put(f"/teams/{teams[team]}/members/{login}", ok=(204,))

    for p in members:
        if not (p.active or "leaver_still_active" in p.flags):
            continue
        if p.department == "IT & Security" or "Platform" in p.title or p.username == "amy":
            add("platform", p.username)
        elif p.department == "Engineering":
            add("engineering", p.username)
        elif p.title == "Financial Analyst":
            add("finance-tools", p.username)
        elif p.title == "Route Planner":
            add("delivery-ops", p.username)
    for p in by_flag(people, "contractor_expired_admin"):
        add("Owners", p.username)
    add("Owners", "amy")
    add("engineering", "code-reviewer")
    add("platform", "ci-bot")
    add("Owners", "deploy-bot")  # nobody remembers why

    # A personal token that a pipeline uses (the "token_owner" scenario).
    for p in by_flag(people, "token_owner"):
        g.patch(f"/admin/users/{p.username}", ok=(200,), json={"login_name": p.username, "source_id": 0, "password": ENV["GITEA_ADMIN_PASSWORD"]})
        u = Http("http://gitea:3000/api/v1")
        u.auth = (p.username, ENV["GITEA_ADMIN_PASSWORD"])
        if not any(t["name"] == "ci-deploy" for t in u.get(f"/users/{p.username}/tokens", ok=(200,)).json()):
            u.post(f"/users/{p.username}/tokens", ok=(201,), json={"name": "ci-deploy", "scopes": ["write:repository", "write:organization"]})
        g.patch(f"/admin/users/{p.username}", ok=(200,), json={"login_name": p.username, "source_id": 0, "password": password()})

    # WonderID's read-only token.
    def make_token() -> str:
        for t in g.get("/users/pe-admin/tokens", ok=(200,)).json():
            if t["name"] == "wonderid-reader":
                g.delete(f"/users/pe-admin/tokens/{t['id']}", ok=(204,))
        r = g.post("/users/pe-admin/tokens", ok=(201,), json={"name": "wonderid-reader", "scopes": ["read:admin", "read:organization", "read:repository", "read:user"]})
        return r.json()["sha1"]

    token = remember("gitea_reader_token", make_token)
    if Http("http://gitea:3000/api/v1").get("/user", headers={"Authorization": f"token {token}"}).status_code != 200:
        from common import save_state, state
        data = state()
        data.pop("gitea_reader_token", None)
        save_state(data)
        token = remember("gitea_reader_token", make_token)

    log(f"  {len(members)} people, {len(BOTS)} bots, {len(TEAMS) + 1} teams, {len(REPOS)} repositories")
    connection("Source control (Gitea)", "gitea", {"baseUrl": f"https://git.{DOMAIN}", "organization": ORG},
               {"token": token}, "Accounts (people and bots), organization teams, and team membership.")
