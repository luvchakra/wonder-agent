"""Team chat (Mattermost): everyone on staff, department teams, the bots the
AI agents post as, and a non-admin reader account for WonderID.

Planted here: a leaver whose chat account is still active, and the bot of
an agent whose owner has left."""
from __future__ import annotations

from common import DOMAIN, ENV, Http, connection, log, password, remember, save_state, state
from company import EMAIL_DOMAIN, Person

# Team Edition refuses more than about 250 users; radio-only roles stay off chat.
NO_CHAT = ("Cargo Handler", "Fleet Technician")
TEAMS = {"planet-express": "Planet Express", "engineering": "Engineering", "finance": "Finance", "dispatch": "Dispatch"}
TEAM_OF = {"Engineering": "engineering", "IT & Security": "engineering", "Finance": "finance", "Delivery Operations": "dispatch"}
BOTS = {"dispatch-assistant": "Posts route plans", "financebot": "Posts month-end reports", "people-helper": "Answers HR policy questions"}


def seed(people: list[Person]) -> None:
    log("Team chat (Mattermost)")
    m = Http("http://mattermost:8065/api/v4")
    r = m.post("/users/login", ok=(200,), retries=30, json={"login_id": "pe-admin", "password": ENV["MATTERMOST_ADMIN_PASSWORD"]})
    m.headers["Authorization"] = f"Bearer {r.headers['Token']}"

    def all_users() -> dict[str, dict]:
        out: dict[str, dict] = {}
        page = 0
        while True:
            batch = m.get("/users", ok=(200,), params={"page": page, "per_page": 200}).json()
            out.update({u["username"]: u for u in batch})
            if len(batch) < 200:
                return out
            page += 1

    users = all_users()
    teams = {t["name"]: t["id"] for t in m.get("/teams", ok=(200,), params={"per_page": 200}).json()}
    for name, display in TEAMS.items():
        if name not in teams:
            teams[name] = m.post("/teams", ok=(201,), json={"name": name, "display_name": display, "type": "I"}).json()["id"]

    staff = [p for p in people if p.kind != "partner" and p.title not in NO_CHAT]
    for p in staff:
        if p.username not in users:
            users[p.username] = m.post("/users", ok=(201,), json={"username": p.username, "email": p.email, "first_name": p.first,
                                                                  "last_name": p.last, "password": password() + "!a1"}).json()
    members: dict[str, list[str]] = {t: [] for t in TEAMS}
    for p in staff:
        uid = users[p.username]["id"]
        if p.active or "leaver_still_active" in p.flags:
            members["planet-express"].append(uid)
            if p.department in TEAM_OF:
                members[TEAM_OF[p.department]].append(uid)
        elif users[p.username].get("delete_at", 0) == 0:
            m.delete(f"/users/{uid}", ok=(200,))  # deactivate a proper leaver
    for team, ids in members.items():
        for i in range(0, len(ids), 100):
            m.post(f"/teams/{teams[team]}/members/batch", ok=(201,), json=[{"team_id": teams[team], "user_id": u} for u in ids[i:i + 100]])

    bots = {b["username"]: b["user_id"] for b in m.get("/bots", ok=(200,), params={"per_page": 200, "include_deleted": "true"}).json()}
    for name, desc in BOTS.items():
        if name not in bots:
            bots[name] = m.post("/bots", ok=(201,), json={"username": name, "display_name": name, "description": desc}).json()["user_id"]
        m.post(f"/teams/{teams['planet-express']}/members", ok=(201,), json={"team_id": teams["planet-express"], "user_id": bots[name]})

    # WonderID reads as an ordinary member of every team, with a personal token.
    if "wonderid-reader" not in users:
        users["wonderid-reader"] = m.post("/users", ok=(201,), json={"username": "wonderid-reader", "email": f"wonderid-reader@{EMAIL_DOMAIN}",
                                                                     "first_name": "WonderID", "last_name": "Reader", "password": password() + "!a1"}).json()
    reader = users["wonderid-reader"]["id"]
    m.put(f"/users/{reader}/roles", ok=(200,), json={"roles": "system_user system_user_access_token"})
    for team_id in teams.values():
        m.post(f"/teams/{team_id}/members", ok=(201,), json={"team_id": team_id, "user_id": reader})

    def make_token() -> str:
        return m.post(f"/users/{reader}/tokens", ok=(200,), json={"description": "WonderID read-only"}).json()["token"]

    token = remember("mattermost_reader_token", make_token)
    if Http("http://mattermost:8065/api/v4").get("/users/me", headers={"Authorization": f"Bearer {token}"}).status_code != 200:
        data = state()
        data.pop("mattermost_reader_token", None)
        save_state(data)
        token = remember("mattermost_reader_token", make_token)

    log(f"  {len(staff)} people, {len(TEAMS)} teams, {len(BOTS)} bots")
    connection("Team chat (Mattermost)", "mattermost", {"baseUrl": f"https://chat.{DOMAIN}"}, {"token": token},
               "Accounts (people and bots) and team membership. The reader is an ordinary user in every team, not an administrator.")
