import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac/requirePermission";
import { ApiError } from "@/lib/shared/types/foundation";
import { listAssignableRoles } from "@/lib/rbac/roles";
import { getAccessHistory, getUserDetail, listUserSessions } from "@/lib/users/users";
import { ACCOUNT_TYPE_LABEL, AUTH_METHOD_LABEL, STATUS_LABEL, roleLabel } from "@/lib/users/userRules";
import { getIdentityForUser } from "@/modules/agent-identity/service";
import { Badge, Card, CardBody, CardHeader, EmptyState, TableContainer, Td, Th, Thead, Tr } from "@/modules/ui";
import { cn } from "@/lib/utils";
import { RemoveRoleButton } from "../../roles/RemoveRoleButton";
import { STATUS_TONE, formatDate, initials, relativeTime } from "../labels";
import { AssignRoleForm, EditNameForm, RevokeSessionsForm, StatusActions } from "./UserActions";

// FOUNDATION-P0-23 — User detail (spec §23–25, 32–34; mockup 9): who they
// are and their membership state; the roles they hold, who granted them
// and when; the permissions those roles give them, with provenance; what
// has happened to their access; and their live sessions. Actions follow
// the actor's permissions; the service and database decide.

export const metadata = { title: "User" };

const TABS = [
  { key: "roles", label: "Roles & groups" },
  { key: "permissions", label: "Effective permissions" },
  { key: "history", label: "Access history" },
  { key: "sessions", label: "Sessions" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const HISTORY_LABEL: Record<string, string> = {
  "user.invited": "Invited",
  "user.created": "Added",
  "user.invitation_accepted": "Accepted the invitation",
  "user.suspended": "Suspended",
  "user.reactivated": "Reactivated",
  "user.deactivated": "Deactivated",
  "user.removed": "Removed",
  "user.updated": "Details changed",
  "user.sessions_revoked": "Sessions revoked",
  "role.assigned": "Role assigned",
  "role.removed": "Role removed",
  "group.member_added": "Added to a group",
  "group.member_removed": "Removed from a group",
};

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string; created?: string; email?: string; profile?: string }>;
}) {
  let ctx;
  try {
    ctx = await requirePermission("users.view");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect("/sign-in");
    if (err instanceof ApiError && err.status === 403) redirect("/settings");
    throw err;
  }
  const [{ userId }, sp] = await Promise.all([params, searchParams]);
  // Assigning roles: roles.assign, or the legacy role.manage (FOUNDATION-P0-24/25).
  const canAssign = ctx.permissions.includes("roles.assign") || ctx.permissions.includes("role.manage");
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "roles") as TabKey;
  const [user, identity, history, sessions, assignable] = await Promise.all([
    getUserDetail(ctx.tenantId!, userId),
    getIdentityForUser(ctx.tenantId!, userId).catch(() => null),
    tab === "history" ? getAccessHistory(ctx.tenantId!, userId) : Promise.resolve(null),
    tab === "sessions" ? listUserSessions(ctx.tenantId!, userId).catch(() => null) : Promise.resolve(null),
    canAssign ? listAssignableRoles(ctx.tenantId!) : Promise.resolve([]),
  ]);
  if (!user) notFound();

  const self = user.userId === ctx.userId;
  const name = user.displayName || user.email;
  const can = (p: string) => ctx.permissions.includes(p);
  const removed = user.status === "removed";
  const unassigned = assignable.filter((r) => !user.roles.some((a) => a.role === r.name));

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/settings/users" className="hover:text-foreground">
          Users
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-foreground">{name}</span>
      </nav>

      {sp.created ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {sp.created === "invited" ? `${name} was invited.` : `${name} was added.`}{" "}
          {sp.email === "sent"
            ? "An email with a link to set their password is on its way."
            : "No email was sent (email delivery isn't set up) — they can set a password with “Forgot password” on the sign-in page."}
          {sp.profile === "skipped" ? " Job title and department weren't saved: editing identities needs identity management." : null}
          {sp.profile === "failed" ? " Job title and department couldn't be saved; edit them on their identity." : null}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardBody className="space-y-4 p-5">
            <div className="flex flex-col items-center text-center">
              <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
                {initials(name)}
              </span>
              {user.displayName ? (
                <>
                  <h1 className="mt-3 break-words text-lg font-semibold text-foreground">{user.displayName}</h1>
                  <p className="break-all text-sm text-muted-foreground">{user.email}</p>
                </>
              ) : (
                // No name on the account: the address is the name, shown once.
                <h1 className="mt-3 break-all text-base font-semibold text-foreground">{user.email}</h1>
              )}
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                <Badge tone={STATUS_TONE[user.status]}>{STATUS_LABEL[user.status]}</Badge>
                {self ? <Badge tone="info">You</Badge> : null}
              </div>
            </div>
            {user.statusReason && user.status !== "active" ? (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Reason:</span> {user.statusReason}
              </p>
            ) : null}
            <dl className="space-y-2.5 text-sm">
              <Fact label="Job title" value={identity?.title ?? "—"} />
              <Fact label="Department" value={identity?.department ?? "—"} />
              <Fact label="Account type" value={ACCOUNT_TYPE_LABEL[user.accountType]} />
              <Fact label="Sign-in" value={user.authMethod ? AUTH_METHOD_LABEL[user.authMethod] : "Organization default"} />
              <Fact label="Added" value={`${formatDate(user.invitedAt ?? user.joinedAt)}${user.invitedBy ? ` by ${user.invitedBy.name}` : ""}`} />
              <Fact label="Last active" value={relativeTime(user.lastSignInAt)} />
            </dl>
            {identity ? (
              <Link href={`/identities/${identity.id}`} className="block text-sm text-primary hover:underline">
                View their identity
              </Link>
            ) : null}
            {can("users.update") && !removed ? <EditNameForm userId={user.userId} name={user.displayName ?? ""} /> : null}
            {!removed && !self && (can("users.suspend") || can("users.remove")) ? (
              <StatusActions userId={user.userId} name={name} status={user.status} canSuspend={can("users.suspend")} canRemove={can("users.remove")} />
            ) : null}
            {self ? <p className="text-xs text-muted-foreground">Another administrator manages your own membership and roles.</p> : null}
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-4">
          <nav aria-label="User sections" className="flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={`/settings/users/${user.userId}${t.key === "roles" ? "" : `?tab=${t.key}`}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
                  t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          {tab === "roles" ? (
            <Card>
              <CardHeader
                title={`Assigned roles (${user.roles.length})`}
                description={user.status === "active" ? undefined : "Held, but not in effect while the membership isn't active."}
              />
              <CardBody className="space-y-4">
                {user.roles.length === 0 ? (
                  <EmptyState title="No roles" description="Without a role they have no access in this organization." />
                ) : (
                  <TableContainer>
                    <Thead>
                      <tr>
                        <Th>Role</Th>
                        <Th>Type</Th>
                        <Th hideBelow="xl">Assigned</Th>
                        <Th hideBelow="lg">Assigned by</Th>
                        {canAssign && !self ? <Th className="text-right">Remove</Th> : null}
                      </tr>
                    </Thead>
                    <tbody>
                      {user.roles.map((r) => (
                        <Tr key={r.role}>
                          <Td>
                            <span className="font-medium text-foreground">{r.displayName || roleLabel(r.role)}</span>
                            {r.active ? null : (
                              <Badge tone="warning" className="ml-2">
                                Inactive
                              </Badge>
                            )}
                            {r.description ? <span className="block text-xs text-muted-foreground">{r.description}</span> : null}
                          </Td>
                          <Td>
                            <Badge>{r.custom ? "Custom" : "System"}</Badge>
                          </Td>
                          <Td hideBelow="xl" className="whitespace-nowrap">
                            {formatDate(r.grantedAt)}
                          </Td>
                          <Td hideBelow="lg">{r.grantedBy?.name ?? "—"}</Td>
                          {canAssign && !self ? (
                            <Td className="text-right">
                              <RemoveRoleButton userId={user.userId} role={r.role} />
                            </Td>
                          ) : null}
                        </Tr>
                      ))}
                    </tbody>
                  </TableContainer>
                )}
                {canAssign && !self && !removed ? (
                  <AssignRoleForm userId={user.userId} roles={unassigned.map((r) => ({ name: r.name, label: r.displayName }))} />
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {tab === "roles" ? (
            <Card>
              <CardHeader title={`Groups (${user.groups.length})`} description="Roles a group carries apply to every member of the group." />
              <CardBody>
                {user.groups.length === 0 ? (
                  <EmptyState title="Not in any group" description="Add people to groups on the Groups page to give them roles together." />
                ) : (
                  <TableContainer>
                    <Thead>
                      <tr>
                        <Th>Group</Th>
                        <Th>Roles it gives</Th>
                      </tr>
                    </Thead>
                    <tbody>
                      {user.groups.map((g) => (
                        <Tr key={g.id}>
                          <Td>
                            {can("groups.view") ? (
                              <Link href={`/settings/groups/${g.id}`} className="font-medium text-foreground hover:text-primary">
                                {g.name}
                              </Link>
                            ) : (
                              <span className="font-medium text-foreground">{g.name}</span>
                            )}
                            {g.status === "active" ? null : (
                              <Badge tone="warning" className="ml-2">
                                Inactive
                              </Badge>
                            )}
                          </Td>
                          <Td>
                            {g.roles.length ? (
                              <span className="flex flex-wrap gap-1">
                                {g.roles.map((r) => (
                                  <Badge key={r.id} tone={r.status === "active" ? "neutral" : "warning"}>
                                    {r.displayName}
                                  </Badge>
                                ))}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">No roles</span>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </TableContainer>
                )}
              </CardBody>
            </Card>
          ) : null}

          {tab === "permissions" ? (
            <Card>
              <CardHeader
                title={`Effective permissions (${user.permissions.length})`}
                description="What their roles let them do in this organization, and which roles grant each permission."
              />
              <CardBody>
                {user.status !== "active" ? (
                  <EmptyState title="No effective permissions" description={`A ${STATUS_LABEL[user.status].toLowerCase()} member can't use any permission in this organization.`} />
                ) : user.permissions.length === 0 ? (
                  <EmptyState title="No permissions" description="They hold no role that grants a permission." />
                ) : (
                  <TableContainer>
                    <Thead>
                      <tr>
                        <Th>Permission</Th>
                        <Th>Granted through</Th>
                      </tr>
                    </Thead>
                    <tbody>
                      {user.permissions.map((p) => (
                        <Tr key={p.permission}>
                          <Td>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{p.permission}</code>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {p.roles.map((r) => (
                                <Badge key={r} tone="accent">
                                  {roleLabel(r)}
                                </Badge>
                              ))}
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </TableContainer>
                )}
              </CardBody>
            </Card>
          ) : null}

          {tab === "history" ? (
            <Card>
              <CardHeader title="Access history" description="Changes to their membership and roles in this organization, newest first, including refused attempts." />
              <CardBody>
                {!history?.length ? (
                  <EmptyState title="Nothing recorded yet" />
                ) : (
                  <ol className="space-y-3">
                    {history.map((e) => (
                      <li key={e.id} className="flex gap-3 text-sm">
                        <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", e.outcome === "failure" ? "bg-destructive" : "bg-primary")} />
                        <div className="min-w-0">
                          <p className="text-foreground">
                            <span className="font-medium">{HISTORY_LABEL[e.action] ?? e.action}</span>
                            {typeof e.detail.role === "string" ? ` — ${roleLabel(e.detail.role)}` : ""}
                            {typeof e.detail.group === "string" ? ` — ${e.detail.group}` : ""}
                            {e.outcome === "failure" ? (
                              <span className="text-destructive"> (refused{typeof e.detail.refused === "string" ? `: ${e.detail.refused}` : ""})</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {e.actor} · {new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                            {typeof e.detail.reason === "string" && e.detail.reason ? ` · “${e.detail.reason}”` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          ) : null}

          {tab === "sessions" ? (
            <Card>
              <CardHeader title="Sessions" description="Where they are signed in. Ending sessions signs them out everywhere." />
              <CardBody className="space-y-4">
                {sessions === null ? (
                  <p role="alert" className="text-sm text-destructive">
                    Sessions couldn&apos;t be loaded. Nothing was changed.
                  </p>
                ) : sessions.length === 0 ? (
                  <EmptyState title="No active sessions" />
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {sessions.map((s) => (
                      <li key={s.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                        <span className="min-w-0 text-foreground">{describeAgent(s.userAgent)}</span>
                        <span className="text-xs text-muted-foreground">
                          Signed in {formatDate(s.createdAt)} · active {relativeTime(s.lastActiveAt)}
                          {s.aal === "aal2" ? " · MFA" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {can("users.suspend") && !self && sessions?.length ? <RevokeSessionsForm userId={user.userId} /> : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right text-foreground">{value}</dd>
    </div>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown browser";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : null;
  return os ? `${browser} on ${os}` : browser;
}
