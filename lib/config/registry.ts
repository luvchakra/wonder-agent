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

export type ConfigSection = "sessions" | "access" | "agents" | "risk" | "certifications" | "sod";

export const SECTIONS: { key: ConfigSection; title: string; description: string }[] = [
  { key: "sessions", title: "Sessions", description: "How long a signed-in session lasts. Applies to every member, on their next page." },
  { key: "access", title: "Access", description: "How accounts are judged." },
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
export type ChoiceSetting = Base & { type: "choice"; options: readonly number[]; default: number; unit: string };
export type ConfigSetting = IntSetting | ChoiceSetting;

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
export type TenantConfig = Record<ConfigKey, number>;

const BY_KEY = new Map<string, ConfigSetting>(CONFIG_SETTINGS.map((s) => [s.key, s]));
export const settingFor = (key: string): ConfigSetting | undefined => BY_KEY.get(key);

export const DEFAULT_CONFIG = Object.fromEntries(CONFIG_SETTINGS.map((s) => [s.key, s.default])) as TenantConfig;

/** A value the setting accepts, or null. Integers only; choices from the list. */
export function acceptValue(setting: ConfigSetting, raw: unknown): number | null {
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
    if (v !== null) out[s.key] = v;
  }
  return out;
}

export type ConfigChange = { key: ConfigKey; from: number; to: number };
export type PlanResult = { ok: true; next: TenantConfig; changes: ConfigChange[] } | { ok: false; errors: Record<string, string> };

const describe = (s: ConfigSetting) => (s.type === "choice" ? `one of ${s.options.join(", ")} ${s.unit}` : `a whole number from ${s.min} to ${s.max}`);

/**
 * Checks a submitted change against the current values: every value must be
 * valid, and every changed setting must be one the member may change. Fields
 * left out keep their value. Nothing is partly applied: any error refuses all.
 */
export function planConfigChange(current: TenantConfig, input: Record<string, unknown>, permissions: readonly string[]): PlanResult {
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
    if (v === current[k]) continue;
    if (!s.permission.some((p) => permissions.includes(p))) {
      errors[key] = "You can't change this setting.";
      continue;
    }
    next[k] = v;
    changes.push({ key: k, from: current[k], to: v });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, next, changes };
}

/** Whether a member may see the page (and so every setting, read-only where they can't change it). */
export const canViewConfig = (permissions: readonly string[]) => permissions.includes("tenant.settings") || permissions.includes("tenant.security.manage");
