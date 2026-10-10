/**
 * How a stored secret is shown on a connection's page: never the value,
 * never blank (owner decision, 2026-10-10). Enough to tell which key is
 * saved (its last four characters, when it is long enough for that to give
 * nothing away) and nothing more.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (v.length >= 12) return `••••••••${v.slice(-4)}`;
  return "••••••••";
}
