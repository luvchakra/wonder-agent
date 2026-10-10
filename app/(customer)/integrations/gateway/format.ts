/** Display helpers for the Connector Gateway's traffic figures. */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** The last 24 hours, as the window every traffic view uses. */
export function last24Hours(): Date {
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}
