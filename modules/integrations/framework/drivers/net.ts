import "server-only";

import dns from "node:dns/promises";
import { isBlockedAddress, isIpLiteral, outboundPolicyFromEnv, OutboundBlockedError, type OutboundPolicy } from "../../outboundPolicy";

/**
 * The SSRF guard for drivers that open their own TCP connections (LDAP,
 * PostgreSQL): the same rule guardedFetch applies to HTTP. The host is
 * resolved once, every address is checked, and the driver connects to the
 * vetted address while TLS still verifies the certificate against the
 * host name, so a DNS change between check and connect cannot redirect it.
 */
export async function resolveSafeHost(hostname: string, policy: OutboundPolicy = outboundPolicyFromEnv()): Promise<string> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIpLiteral(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addresses.length === 0) throw new OutboundBlockedError(`${hostname} does not resolve`);
  for (const a of addresses) {
    if (isBlockedAddress(a.address, policy)) throw new OutboundBlockedError(`${hostname} resolves to a private or reserved address`);
  }
  return addresses[0].address;
}
