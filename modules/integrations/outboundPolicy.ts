/**
 * INTEGRATION-P0-11 / spec S8 — which outbound destinations a connector
 * may reach. Pure, so every rule is unit-tested (#9). Customer-supplied
 * URLs (generic REST, Saviynt, MCP base URLs, application discovery) all
 * pass through here before any request, and every resolved address passes
 * `isBlockedAddress` again at connect time (outboundFetch.ts), so a
 * hostname that resolves to an internal address is refused too.
 *
 * Private and loopback targets are allowed only when the platform sets
 * OUTBOUND_ALLOW_PRIVATE_NETWORKS=true (local development and the test
 * suite's stub servers); never per tenant. Cloud metadata endpoints are
 * refused even then.
 */

export class OutboundBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundBlockedError";
  }
}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata", "metadata.azure.com", "instance-data", "instance-data.ec2.internal"]);
const METADATA_ADDRESSES = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200", "fd00:ec2::254"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Range(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((b & mask) >>> 0);
}

/** Expands an IPv6 literal to 8 groups, or null. Handles an embedded IPv4 tail. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    s = s.slice(0, -v4[1].length) + `${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

export function isIpLiteral(host: string): boolean {
  return ipv4ToInt(host) !== null || ipv6Groups(host) !== null;
}

/** Is this address a metadata endpoint (always refused)? */
export function isMetadataAddress(ip: string): boolean {
  const g = ipv6Groups(ip);
  if (g) {
    const expanded = g.map((x) => x.toString(16)).join(":");
    if (expanded === "fd00:ec2:0:0:0:0:0:254") return true;
    // An IPv4-mapped address is its IPv4 form.
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return METADATA_ADDRESSES.has(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
    return false;
  }
  return METADATA_ADDRESSES.has(ip);
}

/** Is this address loopback, private, link-local, reserved or otherwise not the public internet? */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) return V4_BLOCKED.some(([base, bits]) => inV4Range(v4, base, bits));
  const g = ipv6Groups(ip);
  if (!g) return true; // unparseable: treat as unsafe
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible/NAT64 forms: judge the IPv4 part.
  const embedded = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(embedded(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(embedded(g[6], g[7]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

export type OutboundPolicy = { allowPrivateNetworks: boolean };

export function outboundPolicyFromEnv(env: Record<string, string | undefined> = process.env): OutboundPolicy {
  return { allowPrivateNetworks: env.OUTBOUND_ALLOW_PRIVATE_NETWORKS === "true" };
}

/**
 * Checks a URL before any request. Returns the parsed URL or throws
 * OutboundBlockedError with a reason safe to show (the host, never the
 * path, query or credentials).
 */
export function checkOutboundUrl(raw: string | URL, policy: OutboundPolicy): URL {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
  } catch {
    throw new OutboundBlockedError("The address is not a valid URL");
  }
  const allowHttp = policy.allowPrivateNetworks;
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new OutboundBlockedError(`Only https:// addresses are allowed (got ${url.protocol.replace(":", "")})`);
  }
  if (url.username || url.password) throw new OutboundBlockedError("Addresses must not contain credentials; store them as the integration's credential");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw new OutboundBlockedError("The address has no host");
  if (METADATA_HOSTS.has(host) || isMetadataAddress(host)) throw new OutboundBlockedError(`${host} is a cloud metadata endpoint`);
  if (!policy.allowPrivateNetworks) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
      throw new OutboundBlockedError(`${host} is not a public address`);
    }
    if (isIpLiteral(host) && isPrivateAddress(host)) throw new OutboundBlockedError(`${host} is not a public address`);
  }
  return url;
}

/** Whether a resolved address may be connected to. */
export function isBlockedAddress(ip: string, policy: OutboundPolicy): boolean {
  if (isMetadataAddress(ip)) return true;
  return !policy.allowPrivateNetworks && isPrivateAddress(ip);
}
