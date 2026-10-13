/**
 * Global Configuration (owner request, 2026-10-10; the first slice of
 * PLATFORM-P0-13's Configuration Studio and FOUNDATION-P0-27's session
 * timeouts): the organization-wide settings that change how WonderID
 * behaves for one organization.
 *
 * Rules for every setting here:
 * - it is read by code that runs today, so changing it changes behaviour
 *   (a setting that did nothing would be a false promise, §19.2);
 * - it has a safe default equal to the behaviour before it existed, and
 *   bounds; an unreadable or out-of-range stored value falls back to the
 *   default, never to something looser;
 * - session settings can only tighten the global limits enforced in
 *   proxy.ts (30 minutes idle, 12 hours in all).
 *
 * Pure (no I/O), shared by the page, the service and proxy.ts.
 */

export type ConfigSection = "sessions" | "members" | "access" | "imports" | "agents" | "risk" | "certifications" | "sod";

export const SECTIONS: { key: ConfigSection; title: string; description: string }[] = [
  { key: "sessions", title: "Sign-in and sessions", description: "How members sign in and how long a session lasts. Applies to every member, on their next page." },
  { key: "members", title: "Members", description: "Invitations to join the organization." },
  { key: "access", title: "Access", description: "How accounts are judged." },
  { key: "imports", title: "Connections", description: "How a connection's sync treats records gone from the source, and how many changes it may make." },
  { key: "agents", title: "AI agents and runtime", description: "Discovery and runtime alerts." },
  { key: "risk", title: "Risk", description: "When an agent's own credentials count as a risk." },
  { key: "certifications", title: "Certifications", description: "Defaults for new certification campaigns." },
  { key: "sod", title: "Separation of duties", description: "What the Control Center reports." },
];

type Base = {
  key: string;
  section: ConfigSection;
  label: string;
  /** One line, shown under the field. */
  help: string;
  /** Any one of these permissions lets a member change it. */
  permission: string[];
};
export type IntSetting = Base & { type: "int"; min: number; max: number; default: number; unit: string };
/** `labels` names each option where a number alone would not say what it means (an on/off choice). */
export type ChoiceSetting = Base & { type: "choice"; options: readonly number[]; labels?: Readonly<Record<number, string>>; default: number; unit: string };
/** WID-H05: a list of host names; an entry "*.example.com" also admits its subdomains. Empty: no limit. */
export type HostsSetting = Base & { type: "hosts"; default: readonly string[]; maxEntries: number; unit: string };
export type ConfigSetting = IntSetting | ChoiceSetting | HostsSetting;

const SECURITY = ["tenant.security.manage"];
const SETTINGS = ["tenant.settings"];

/** Global limits proxy.ts enforces for everyone; an organization can only shorten them. */
export const GLOBAL_IDLE_MINUTES = 30;
export const GLOBAL_SESSION_HOURS = 12;

export const CONFIG_SETTINGS = [
  {
    key: "session.idleMinutes",
    section: "sessions",
    label: "Sign out after inactivity",
    help: `A member who does nothing for this long is signed out. At most ${GLOBAL_IDLE_MINUTES} minutes.`,
    permission: SECURITY,
    type: "int",
    min: 5,
    max: GLOBAL_IDLE_MINUTES,
    default: GLOBAL_IDLE_MINUTES,
    unit: "minutes",
  },
  {
    key: "session.maxHours",
    section: "sessions",
    label: "Longest session",
    help: `A member signs in again after this long, active or not. At most ${GLOBAL_SESSION_HOURS} hours.`,
    permission: SECURITY,
    type: "int",
    min: 1,
    max: GLOBAL_SESSION_HOURS,
    default: GLOBAL_SESSION_HOURS,
    unit: "hours",
  },
  {
    // FOUNDATION-P0-27: read by getTenantContext() (lib/tenant/mfaRequired.ts) and, in the
    // database, by current_tenant_ids() (migration 0152). Turning it on needs an MFA session
    // (planConfigChange), so the administrator who does it can still get in.
    key: "security.mfaRequired",
    section: "sessions",
    label: "Multi-factor authentication",
    help: "When required, every member verifies with an authenticator app before seeing anything. Automation credentials are exempt.",
    permission: SECURITY,
    type: "choice",
    options: [0, 1],
    labels: { 0: "Not required", 1: "Required" },
    default: 0,
    unit: "",
  },
  {
    key: "access.dormantDays",
    section: "access",
    label: "Dormant account after",
    help: "An account not used for this long is dormant. The Accounts page starts from this.",
    permission: SETTINGS,
    type: "choice",
    options: [30, 60, 90, 180, 365],
    default: 90,
    unit: "days",
  },
  {
    // FOUNDATION-P0-32: read by acceptInvitation() and listMyInvitations() (lib/users/users.ts).
    // Before, an invitation never expired; 30 days is the longest a pending invitation now stays usable by default.
    key: "users.invitationExpiryDays",
    section: "members",
    label: "Invitations expire after",
    help: "An invitation not accepted within this long can no longer be used; an administrator can send it again.",
    permission: SECURITY,
    type: "int",
    min: 1,
    max: 90,
    default: 30,
    unit: "days",
  },
  {
    // ACCESS-P0-29: read by openFulfilmentTask() (modules/access-governance/fulfilmentTasks.ts).
    key: "access.fulfilmentSlaDays",
    section: "access",
    label: "Fulfil approved access within",
    help: "Giving access is due this long after approval; removing it, within a day at most. Overdue tasks remind their owner daily.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 30,
    default: 3,
    unit: "days",
  },
  {
    // ACCESS-P0-32: read by remindExpiringAccess() (modules/access-governance/accessExpiry.ts).
    key: "access.expiryReminderDays",
    section: "access",
    label: "Remind before access ends",
    help: "Time-bound access reminds the requester and the person it is for this long before its end date, once, with the way to extend it.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 30,
    default: 7,
    unit: "days",
  },
  {
    key: "agents.duplicateMatchPercent",
    section: "agents",
    label: "Possible duplicate at",
    help: "A new agent this similar to an existing one waits in Duplicate Review instead of being registered.",
    permission: SETTINGS,
    type: "int",
    min: 50,
    max: 95,
    default: 60,
    unit: "% match",
  },
  {
    key: "runtime.unregisteredWindowDays",
    section: "agents",
    label: "Show unregistered agent activity from the last",
    help: "Activity from agents WonderID does not know, on Risk Overview and Agent Discovery.",
    permission: SETTINGS,
    type: "int",
    min: 7,
    max: 365,
    default: 90,
    unit: "days",
  },
  {
    key: "runtime.alertThrottleMinutes",
    section: "agents",
    label: "Runtime alerts, at most one per agent every",
    help: "Later decisions in the window are listed on the Runtime page without a new notification.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 240,
    default: 15,
    unit: "minutes",
  },
  {
    key: "risk.keyRotationDays",
    section: "risk",
    label: "Agent key overdue for rotation after",
    help: "An active Runtime Gateway key with no expiry, older than this, is a credential risk.",
    permission: SETTINGS,
    type: "int",
    min: 30,
    max: 365,
    default: 90,
    unit: "days",
  },
  {
    key: "risk.maxActiveKeysPerAgent",
    section: "risk",
    label: "Most active keys per agent",
    help: "More active Runtime Gateway keys than this is a credential risk.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 10,
    default: 3,
    unit: "keys",
  },
  {
    key: "certification.highRiskScore",
    section: "certifications",
    label: "High-risk agent from risk score",
    help: "A high-risk agent campaign reviews agents scored at least this, unless the campaign says otherwise.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 100,
    default: 50,
    unit: "points",
  },
  {
    // INTEGRATION-P0-18: read by runSyncJob() (modules/integrations/syncJobs.ts).
    key: "integration.massMissingPercent",
    section: "imports",
    label: "Hold a sync for review when more than this share is gone",
    help: "A full sync that finds more than this share of a kind gone from the source (of 20 or more) waits for a person before marking them.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 100,
    default: 20,
    unit: "%",
  },
  {
    // QA-P0-26: read by executeConnectorWrite() (modules/integrations/connectorWrites.ts).
    key: "integration.maxWritesPerHour",
    section: "imports",
    label: "Most changes a connection may make in an hour",
    help: "Beyond this, a connection's further changes are refused and go to a person, until the hour has passed.",
    permission: SETTINGS,
    type: "int",
    min: 1,
    max: 10000,
    default: 100,
    unit: "changes",
  },
  {
    // WID-H05: read by the Connector Gateway (modules/integrations/gateway/gateway.ts), for every driver and redirect.
    key: "integration.allowedHosts",
    section: "imports",
    label: "Connections may reach only these hosts",
    help: "One host per line; *.example.com covers its subdomains. Empty: any public host. Private and internal addresses are always refused.",
    permission: SECURITY,
    type: "hosts",
    default: [] as readonly string[],
    maxEntries: 50,
    unit: "",
  },
  {
    key: "sod.conflictWindowDays",
    section: "sod",
    label: "Count SoD conflicts from the last",
    help: "The period the Control Center's SoD conflicts card covers.",
    permission: SETTINGS,
    type: "int",
    min: 7,
    max: 365,
    default: 30,
    unit: "days",
  },
] as const satisfies readonly ConfigSetting[];

export type ConfigKey = (typeof CONFIG_SETTINGS)[number]["key"];
type ValueOf<S> = S extends { type: "hosts" } ? readonly string[] : number;
export type TenantConfig = { [S in (typeof CONFIG_SETTINGS)[number] as S["key"]]: ValueOf<S> };
export type ConfigValue = number | readonly string[];

const BY_KEY = new Map<string, ConfigSetting>(CONFIG_SETTINGS.map((s) => [s.key, s]));
export const settingFor = (key: string): ConfigSetting | undefined => BY_KEY.get(key);

export const DEFAULT_CONFIG = Object.fromEntries(CONFIG_SETTINGS.map((s) => [s.key, s.default])) as TenantConfig;

const HOST_PATTERN = /^(\*\.)?(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * WID-H05: host names from a list or from text (one per line, or separated
 * by commas or spaces): lower-cased, without a trailing dot, sorted and
 * without repeats. Null when one is not a host name, or when there are too
 * many. A port, scheme or path is not accepted: the list names hosts only.
 */
export function acceptHosts(raw: unknown, maxEntries: number): string[] | null {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : null;
  if (!parts) return null;
  const hosts = new Set<string>();
  for (const p of parts) {
    if (typeof p !== "string") return null;
    const h = p.trim().toLowerCase().replace(/\.$/, "");
    if (!h) continue;
    if (!HOST_PATTERN.test(h)) return null;
    hosts.add(h);
  }
  return hosts.size > maxEntries ? null : [...hosts].sort();
}

const sameValue = (a: ConfigValue, b: ConfigValue) => JSON.stringify(a) === JSON.stringify(b);

/** A value the setting accepts, or null. Integers only; choices from the list; host names for a host list. */
export function acceptValue(setting: ConfigSetting, raw: unknown): ConfigValue | null {
  if (setting.type === "hosts") return acceptHosts(raw, setting.maxEntries);
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d{1,6}\s*$/.test(raw) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n)) return null;
  if (setting.type === "choice") return (setting.options as readonly number[]).includes(n) ? n : null;
  return n >= setting.min && n <= setting.max ? n : null;
}

/** The stored values, each checked; anything missing, unknown or invalid is its default. */
export function resolveConfig(stored: unknown): TenantConfig {
  const out = { ...DEFAULT_CONFIG };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const s of CONFIG_SETTINGS) {
    const v = acceptValue(s, (stored as Record<string, unknown>)[s.key]);
    if (v !== null) (out as Record<string, ConfigValue>)[s.key] = v;
  }
  return out;
}

export type ConfigChange = { key: ConfigKey; from: ConfigValue; to: ConfigValue };

/** A value as people read it: a host list joined, "any public host" when empty; a choice by its label when it has one. */
export function formatConfigValue(v: ConfigValue, key?: string): string {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "any public host";
  const s = key ? settingFor(key) : undefined;
  return (s?.type === "choice" && s.labels?.[v as number]) || String(v);
}

/** The label of a choice's option, or the number itself. */
export const optionLabel = (s: ConfigSetting, v: number): string => (s.type === "choice" && s.labels?.[v]) || String(v);
export type PlanResult = { ok: true; next: TenantConfig; changes: ConfigChange[] } | { ok: false; errors: Record<string, string> };

const describe = (s: ConfigSetting) =>
  s.type === "choice" ? `one of ${s.options.map((o) => optionLabel(s, o)).join(", ")} ${s.unit}`.trim() : s.type === "hosts" ? `host names (at most ${s.maxEntries}), such as api.example.com or *.example.com` : `a whole number from ${s.min} to ${s.max}`;

/** FOUNDATION-P0-27: the refusal when MFA would be required from a session that has not used it. */
export const MFA_ENABLE_NEEDS_AAL2 = "Verify this session with your authenticator app first (open /verify-mfa), then save again. That way you can still get in once it is required.";

/**
 * Checks a submitted change against the current values: every value must be
 * valid, and every changed setting must be one the member may change. Fields
 * left out keep their value. Nothing is partly applied: any error refuses all.
 * Requiring MFA needs the saving session itself to be an MFA (aal2) session.
 */
export function planConfigChange(current: TenantConfig, input: Record<string, unknown>, permissions: readonly string[], actor: { aal?: "aal1" | "aal2" | null } = {}): PlanResult {
  const errors: Record<string, string> = {};
  const next = { ...current };
  const changes: ConfigChange[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const s = settingFor(key);
    if (!s) {
      errors[key] = "Not a setting.";
      continue;
    }
    const v = acceptValue(s, raw);
    if (v === null) {
      errors[key] = `Enter ${describe(s)}.`;
      continue;
    }
    const k = s.key as ConfigKey;
    if (sameValue(v, current[k])) continue;
    if (!s.permission.some((p) => permissions.includes(p))) {
      errors[key] = "You can't change this setting.";
      continue;
    }
    if (k === "security.mfaRequired" && v === 1 && actor.aal !== "aal2") {
      errors[key] = MFA_ENABLE_NEEDS_AAL2;
      continue;
    }
    (next as Record<string, ConfigValue>)[k] = v;
    changes.push({ key: k, from: current[k], to: v });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, next, changes };
}

/** Whether a member may see the page (and so every setting, read-only where they can't change it). */
export const canViewConfig = (permissions: readonly string[]) => permissions.includes("tenant.settings") || permissions.includes("tenant.security.manage");
