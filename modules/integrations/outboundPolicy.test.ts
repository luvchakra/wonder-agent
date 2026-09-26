import { describe, expect, it } from "vitest";
import { OutboundBlockedError, checkOutboundUrl, isBlockedAddress, isPrivateAddress, outboundPolicyFromEnv } from "./outboundPolicy";

const strict = { allowPrivateNetworks: false };
const dev = { allowPrivateNetworks: true };
const blocked = (u: string, p = strict) => {
  try {
    checkOutboundUrl(u, p);
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(OutboundBlockedError);
    return (e as Error).message;
  }
};

describe("isPrivateAddress", () => {
  it("recognizes loopback, private, link-local, CGNAT, reserved and multicast IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("recognizes IPv6 loopback, unique-local, link-local and mapped private IPv4", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "ff02::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("checkOutboundUrl", () => {
  it("allows public https addresses", () => {
    expect(checkOutboundUrl("https://api.example.com/v1/users", strict).hostname).toBe("api.example.com");
    expect(checkOutboundUrl("https://8.8.8.8/x", strict).hostname).toBe("8.8.8.8");
  });

  it("refuses other protocols, credentials in the address, and unparseable input", () => {
    expect(blocked("http://api.example.com")).toMatch(/https/);
    expect(blocked("file:///etc/passwd")).toMatch(/https/);
    expect(blocked("gopher://example.com")).toMatch(/https/);
    expect(blocked("https://user:pass@example.com")).toMatch(/credentials/);
    expect(blocked("not a url")).toMatch(/valid URL/);
  });

  it("refuses internal names and private literals, in every spelling", () => {
    for (const u of [
      "https://localhost/",
      "https://app.localhost/",
      "https://printer.local/",
      "https://db.internal/",
      "https://127.0.0.1/",
      "https://10.0.0.5:8443/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://[fd00::1]/",
      "https://2130706433/",
      "https://0x7f000001/",
      "https://127.1/",
    ]) {
      expect(blocked(u), u).not.toBeNull();
    }
  });

  it("always refuses cloud metadata, even where private networks are allowed", () => {
    expect(blocked("http://169.254.169.254/latest/meta-data", dev)).toMatch(/metadata/);
    expect(blocked("http://metadata.google.internal/computeMetadata/v1", dev)).toMatch(/metadata/);
    expect(blocked("http://[fd00:ec2::254]/", dev)).toMatch(/metadata/);
    expect(blocked("http://[::ffff:169.254.169.254]/", dev)).toMatch(/metadata/);
  });

  it("allows loopback over http only when the platform enables private networks", () => {
    expect(checkOutboundUrl("http://127.0.0.1:4555/mcp", dev).port).toBe("4555");
    expect(blocked("http://127.0.0.1:4555/mcp")).not.toBeNull();
  });
});

describe("connect-time checks and the platform switch", () => {
  it("blocks resolved private addresses unless allowed, and metadata always", () => {
    expect(isBlockedAddress("10.0.0.1", strict)).toBe(true);
    expect(isBlockedAddress("10.0.0.1", dev)).toBe(false);
    expect(isBlockedAddress("169.254.169.254", dev)).toBe(true);
    expect(isBlockedAddress("93.184.216.34", strict)).toBe(false);
  });

  it("is off unless exactly 'true'", () => {
    expect(outboundPolicyFromEnv({})).toEqual({ allowPrivateNetworks: false });
    expect(outboundPolicyFromEnv({ OUTBOUND_ALLOW_PRIVATE_NETWORKS: "1" })).toEqual({ allowPrivateNetworks: false });
    expect(outboundPolicyFromEnv({ OUTBOUND_ALLOW_PRIVATE_NETWORKS: "true" })).toEqual({ allowPrivateNetworks: true });
  });
});
