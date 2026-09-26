"""WonderID feature test plan — content and HTML rendering.

Each section: (title, [(test, steps, expected), ...]). Steps stay on one line.
"""
import html

SECTIONS = [
    ("Access & sign-in", [
        ("Landing page", "Open the site signed out.", "Hero, features and Help load. Light/Dark/System toggle works."),
        ("Sign up", "Sign up with a new email; confirm from the email.", "Account created; lands in onboarding to create an organization."),
        ("Create organization", "Onboarding → enter organization name → Create.", "Home opens for the new organization; you are Tenant Administrator."),
        ("Sign in / out", "Sign out via the account menu, then sign in again.", "Lands on Home; protected pages redirect to sign-in when signed out."),
        ("Global sign-out", "Sign in on two browsers; sign out on one; reload the other.", "The other browser is signed out too."),
        ("Reset password", "Forgot password → email link → set a new password.", "Can sign in with the new password; old one fails."),
        ("Expired reset link", "Open /update-password without a reset link.", "Shows the expired-link state, not a bare form."),
        ("Rate limit", "Request password reset repeatedly for one email.", "After the limit, a rate-limit message appears."),
        ("MFA", "Sign-in Security → enroll TOTP → sign out → sign in.", "A 6-digit code is required; wrong code is refused."),
        ("Tenant address", "Open <slug>.<BASE_APP_HOST>/sign-in.", "Title reads “Sign in to your organization” with its logo."),
        ("Unknown tenant address", "Open a subdomain that does not exist.", "“Tenant not found” page; no other organization shown."),
        ("Organization switcher", "Member of two orgs: switch organization in the header.", "All data changes to the chosen organization only."),
    ]),
    ("Shell, search & help", [
        ("Sidebar", "Collapse/expand the sidebar; hover a group while collapsed.", "Flyout shows the group's pages; active page highlighted."),
        ("Mobile layout", "Open at phone width (390px).", "Bottom tab bar + menu drawer; no sideways scrolling."),
        ("Theme", "Switch Light, Dark and System in the account menu.", "Whole app, sidebar and logo follow the theme."),
        ("Global search", "Press the search shortcut; search an agent name.", "Results from this organization only; click opens it."),
        ("Help centre", "Account menu → Get Help.", "Guide sections, FAQ and contents links all work."),
        ("Help assistant", "Ask a question in Help; then ask something unrelated.", "Answers with a guide link; says so when the guide doesn't cover it."),
        ("Browser tab & icon", "Look at the tab title and favicon on any page.", "“<Org> · <Page> · WonderID” and the WonderID icon."),
    ]),
    ("Home", [
        ("Home dashboard", "Open Home.", "Real counts, risks and next actions; slow panels show loaders, then data."),
        ("Drill-down", "Click a KPI card or attention item.", "Opens the matching filtered list."),
    ]),
    ("Identities", [
        ("Overview", "Identities → Overview.", "Counts by type (people, external, machine, AI agents)."),
        ("All identities", "Identities → All Identities; filter and search.", "List filters in the database; pagination works."),
        ("Create identity", "Identities → New → create a person.", "Appears in People with its attributes."),
        ("Identity detail", "Open any identity.", "Profile, access, ownership and history tabs load."),
        ("External & machine", "Open External Identities and Machine Identities.", "Only that identity type is listed."),
        ("Lifecycle work", "Identities → Lifecycle Work; run a joiner/mover/leaver.", "Governed tasks created; leaver revokes access after approval."),
        ("Ownership transfer", "Leaver who owns agents → transfer ownership.", "New owner shown on each agent; audited."),
        ("Identity attributes", "Administration → Identity Attributes; add an attribute.", "Available on identity forms; source of truth shown."),
        ("Non-human identities", "Identities → Non-human Identities.", "Service accounts/keys listed with owner and expiry."),
    ]),
    ("AI agents", [
        ("Register agent", "AI Agents → Register Agent → name, type, purpose → Register.", "Agent detail opens in Draft/registered state."),
        ("Agent list", "AI Agents → All Agents; filter by status and risk.", "Filters apply; each row opens Agent 360."),
        ("Agent contract (SHOULD)", "Agent → Contract → set purpose, apps, data, actions → Save.", "Contract saved; completeness score updates."),
        ("Owners", "Agent → Owners → add a delegated owner.", "Owner listed; ownership review available."),
        ("Lifecycle", "Agent → change lifecycle (activate, suspend, retire) with a reason.", "State changes; history shows who, when, why."),
        ("API keys", "Agent → API keys → create; copy; revoke.", "Secret shown once only; revoked key stops working."),
        ("Discovery inbox", "AI Agents → Discovery Inbox → register or dismiss an item.", "Registered item becomes an agent; dismissed leaves the inbox."),
        ("Duplicate review", "AI Agents → Duplicate Review → merge or keep separate.", "Decision recorded; list updates."),
        ("Shadow AI", "Open a discovered unregistered agent.", "Marked Shadow AI with where it was seen."),
    ]),
    ("Runtime assurance", [
        ("Runtime activity", "AI Agents → Runtime Activity; open an agent's timeline.", "Events with tool, resource, action and decision."),
        ("SHOULD / CAN / DID", "Open an agent's runtime comparison.", "Three columns; mismatches highlighted."),
        ("Runtime gateway", "Call the gateway with an agent API key (observe mode).", "Decision returned and logged; repeat request id is not duplicated."),
        ("Enforcement flag", "Platform admin enables runtime enforcement for one tenant.", "That tenant's agent gets DENY; others still observe only."),
        ("Emergency controls", "Runtime → engage kill switch for an agent with a reason.", "Agent blocked immediately; lifting it restores; both audited."),
        ("Revoke all keys", "Runtime → revoke all API keys of an agent.", "Every key revoked; agent calls fail."),
    ]),
    ("Risk & security", [
        ("Risk overview", "Risk & Security → Risk Overview.", "Scores, findings by severity, top risky agents."),
        ("Finding detail", "Open a finding.", "Evidence, recommendation and status shown."),
        ("Rogue agents", "AI Agents → Rogue Agents; open one.", "Why it is rogue, with runtime and access evidence."),
        ("Investigations", "Risk → Investigations → open one from a finding; add notes; close.", "Timeline and status saved."),
        ("Central scenario", "FinanceBot touches CustomerDB (runtime event).", "CRITICAL finding; remove entitlement; re-evaluate; finding resolves."),
    ]),
    ("Applications", [
        ("Inventory", "Applications → Application Inventory; search.", "Catalog with owner, type and onboarding status."),
        ("Add application", "Applications → New → fill details → Save.", "Application detail opens."),
        ("Onboarding", "Application → Onboarding: configure → validate → simulate → approve → promote.", "Each step gated; failed validation stops it visibly."),
        ("Discovery", "Applications → Discovery; accept or ignore an unrecognized app.", "Accepted app joins the inventory."),
        ("Accounts", "Applications → Accounts; filter orphan and dormant.", "Accounts correlated to identities; orphans flagged."),
        ("Data sources", "Applications → Data Sources; add one; link to an application.", "Shown with sensitivity; feeds CAN."),
    ]),
    ("Access governance", [
        ("Request access", "Access Governance → Request Access → pick app/entitlement → submit.", "Request created with its approval chain."),
        ("Approve / reject", "Approver opens Access Requests → approve or reject with comment.", "Next stage or final state; requester notified."),
        ("Four-eyes", "Requester tries to approve own request.", "Refused."),
        ("Request policies", "Access Governance → Request Policies → set approval and expiry.", "New requests follow the policy."),
        ("SoD check", "Request an entitlement that conflicts with one held.", "SoD conflict shown before submit and on the request."),
        ("Access packages", "Access Packages → create a package; request it; approve.", "Assignment created; items provisioned or shown failed."),
        ("Package expiry", "Assign a package with an expiry date in the past (test data).", "Assignment expires; revocation work items created."),
    ]),
    ("Certifications & policies", [
        ("Campaign", "Certifications → create a campaign for agents' access.", "Reviewers see their items."),
        ("Decide", "Reviewer certifies one item, revokes another, with comments.", "Decisions saved; revoke creates remediation."),
        ("Evidence", "Open a completed campaign.", "Decisions and evidence exportable."),
        ("Policies", "Governance & Policies → create, publish a policy version.", "Version history kept; exceptions listed."),
    ]),
    ("Integrations", [
        ("Connectors", "Integrations → Connectors → add a REST/Saviynt connector → test.", "Credentials hidden; test result shown truthfully."),
        ("Read-only guard", "Try a write action on a read-only connector.", "Refused; nothing sent."),
        ("Sync jobs", "Run a sync; open Integrations → Sync Jobs.", "Job shows progress and final counts."),
        ("Identity sources", "Integrations → Identity Sources → add a source → run import.", "Run shows created/updated/conflicts."),
        ("Pending matches", "Integrations → Pending Matches → confirm or reject a match.", "Confirmed record linked to the identity."),
        ("MCP servers", "Integrations → MCP Servers.", "Servers, tools and resources inventory listed."),
    ]),
    ("Insights & audit", [
        ("Reports", "Insights → Reports → open a report; export CSV.", "Data matches the screens; export downloads."),
        ("Audit trail", "Insights → Audit Trail; filter by action and actor.", "Every sensitive action with actor, target, outcome, time."),
        ("Notifications", "Administration → Notifications; change preferences.", "Mandatory types can't be switched off."),
        ("Announcements", "Platform admin posts an announcement.", "Banner shows to customer users; dismissible."),
    ]),
    ("Users, groups & roles", [
        ("Users list", "Permissions → Users; search, filter by status, role, group.", "Filters apply; KPI cards count correctly."),
        ("Add user", "Users → Add user → details → roles → review → invite.", "Invited user listed; email sent (or told it wasn't)."),
        ("Accept invitation", "Invitee signs in and accepts.", "Lands in the organization as Active."),
        ("Suspend / reactivate", "User → Suspend with reason; later Reactivate.", "Their sessions end at once; access returns on reactivate."),
        ("Deactivate / remove", "User → Deactivate, then Remove.", "No access; roles and groups cleared; history kept."),
        ("Self-protection", "Try to change your own status or give yourself a role.", "Refused."),
        ("Last administrator", "Remove the only Tenant Administrator's role.", "Refused: organization must keep one."),
        ("Effective permissions", "User → Effective permissions tab.", "Each permission with the role (or group) that grants it."),
        ("Sessions", "User → Sessions → End sessions.", "User is signed out everywhere."),
        ("Groups", "Permissions → Groups → create; add a role; add a member.", "Member gets the role on next request; shown as “via group”."),
        ("Group removal", "Remove the member, or delete the group.", "Access from that group disappears."),
        ("Group escalation", "Add yourself to a group, or give roles to your own group.", "Refused."),
        ("System roles", "Permissions → WonderID Roles → open a system role.", "Read-only; per-module summary; Copy available."),
        ("Custom role", "Roles → New → name → permissions → review → Create.", "Role grants exactly those permissions when assigned."),
        ("No escalation", "Design a role with a permission you don't hold.", "That permission is disabled with the reason."),
        ("Role lifecycle", "Deactivate a custom role; try to delete one in use.", "Inactive grants nothing; in-use delete refused."),
        ("Permission catalog", "Permissions → Permission Catalog; filter by module and sensitivity.", "Every permission with resource, action and granting roles."),
    ]),
    ("Administration & settings", [
        ("Organization", "Administration → Organization; edit name and details.", "Saved; shown in header and titles."),
        ("Sign-in security", "Authentication → Sign-in Security; review MFA and sessions.", "Settings saved and applied."),
        ("Single sign-on", "Authentication → Single Sign-On → add SAML/OIDC connection.", "Connection saved; secrets never shown back."),
        ("AI assistance", "Administration → AI Assistance; set provider key.", "Key stored masked; AI features use it."),
        ("Read-only user", "Sign in as Read Only; open Settings pages.", "Admin pages redirect; no edit buttons."),
    ]),
    ("Platform administration (vendor only)", [
        ("Access boundary", "Customer admin opens /platform-admin.", "Refused; nothing revealed."),
        ("Tenants", "Platform admin → Tenants; create, suspend, view usage.", "Suspended tenant cannot sign in."),
        ("Feature flags", "Platform admin → Features; toggle a flag for one tenant.", "Only that tenant changes."),
        ("Branding & health", "Open Branding and Health.", "Brand assets shown; health checks green or explained."),
        ("Platform admins", "Platform admin → Admins; add/remove an admin.", "Change audited in the platform audit log."),
    ]),
    ("Security & tenant isolation", [
        ("Cross-tenant URL", "In tenant A open a tenant B record's URL.", "404 / not found; no data leaks."),
        ("Cross-tenant API", "Call a tenant B id through tenant A's API.", "404 or 403; never B's data."),
        ("Tampered tenant id", "Send a tenant_id in a request body.", "Ignored; server uses your organization."),
        ("Secrets", "View page source and network responses.", "No service keys, tokens or connector secrets."),
        ("Audit of refusals", "Trigger a refused sensitive action; open Audit Trail.", "Refusal recorded as failure with reason."),
    ]),
]


def render(build: str = "", generated: str = "") -> str:
    parts = []
    n = 0
    for i, (title, rows) in enumerate(SECTIONS, 1):
        body = []
        for test, steps, expected in rows:
            n += 1
            body.append(
                f"<tr><td class=num>{n}</td><td class=test>{html.escape(test)}</td><td>{html.escape(steps)}</td>"
                f"<td>{html.escape(expected)}</td><td class=pf><span class=box></span>P <span class=box></span>F</td></tr>"
            )
        parts.append(
            f"<section><h2>{i}. {html.escape(title)}</h2><table><colgroup><col class=c1><col class=c2><col class=c3><col class=c4><col class=c5></colgroup>"
            f"<thead><tr><th>#</th><th>Test</th><th>Steps</th><th>Expected result</th><th>Pass / Fail</th></tr></thead><tbody>{''.join(body)}</tbody></table></section>"
        )
    return f"""<!doctype html><html><head><meta charset=utf-8><title>WonderID — Feature Test Plan</title>
<style>
@page {{ size: A4; margin: 14mm 12mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{ font-family: Inter, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1d24; font-size: 9.2pt; margin: 0; }}
h1 {{ font-size: 20pt; margin: 0 0 2mm; letter-spacing: -0.01em; }}
h1 span {{ color: #2538ff; }}
.intro {{ color: #555b66; margin: 0 0 3mm; }}
.meta {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 0 0 5mm; color: #555b66; }}
.meta div {{ border-bottom: 1px solid #9aa0aa; padding-bottom: 1mm; }}
h2 {{ font-size: 12pt; margin: 5mm 0 2mm; break-after: avoid; }}
table {{ width: 100%; border-collapse: collapse; table-layout: fixed; }}
thead {{ display: table-header-group; }}
tr {{ break-inside: avoid; }}
th {{ background: #eceef2; text-align: left; font-weight: 600; }}
th, td {{ border: 1px solid #c9cdd4; padding: 1.6mm 2mm; vertical-align: top; }}
col.c1 {{ width: 7%; }} col.c2 {{ width: 18%; }} col.c3 {{ width: 36%; }} col.c4 {{ width: 27%; }} col.c5 {{ width: 12%; }}
td.num {{ color: #555b66; }}
td.test {{ font-weight: 600; }}
td.pf {{ white-space: nowrap; color: #555b66; font-size: 8pt; }}
.box {{ display: inline-block; width: 3mm; height: 3mm; border: 1px solid #555b66; border-radius: 0.5mm; vertical-align: -0.4mm; margin: 0 0.8mm 0 1.5mm; }}
.box:first-child {{ margin-left: 0; }}
</style></head><body>
<h1>WonderID <span>—</span> Feature Test Plan</h1>
<p class=intro>Follow the sections in order, as an administrator would. Use a test organization and test accounts. Mark each test Pass or Fail and note any issue. {n} tests.</p>
<div class=meta><div>Environment:</div><div>Build / commit: {html.escape(build)}</div><div>Tester:</div><div>Date:</div></div>
{''.join(parts)}
</body></html>"""


if __name__ == "__main__":
    import sys
    open(sys.argv[1], "w").write(render(sys.argv[2] if len(sys.argv) > 2 else ""))
    print(sum(len(r) for _, r in SECTIONS), "tests")
