// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let membership: { status: string } | null = null;
const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: membership, error: null }) };
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ from: () => q }) }));
const audits: Record<string, unknown>[] = [];
vi.mock("@/lib/audit/writeAudit", () => ({ writeAudit: vi.fn(async (e: Record<string, unknown>) => void audits.push(e)) }));

import { refuseNonMemberOnTenantAddress } from "./tenantAddressGate";

const signOut = vi.fn(async () => ({ error: null }));
const supabase = { auth: { signOut } } as never;
const onAddress = (status = "active") => ({ target: { kind: "subdomain" as const, label: "acme" }, tenant: { tenantId: "t1", name: "Acme", slug: "acme", status } });

beforeEach(() => {
  membership = null;
  audits.length = 0;
  signOut.mockClear();
});

describe("refuseNonMemberOnTenantAddress (password and social sign-in on an organization's address)", () => {
  it("lets an active or invited member through, and does nothing off an organization's address", async () => {
    membership = { status: "active" };
    expect(await refuseNonMemberOnTenantAddress(supabase, onAddress(), "u1")).toBeNull();
    membership = { status: "invited" };
    expect(await refuseNonMemberOnTenantAddress(supabase, onAddress(), "u1")).toBeNull();
    expect(await refuseNonMemberOnTenantAddress(supabase, { target: { kind: "base" }, tenant: null }, "u1")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("ends only this new session of a non-member and audits the refusal", async () => {
    expect(await refuseNonMemberOnTenantAddress(supabase, onAddress(), "u1")).toBe("This account is not an active member of Acme.");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(audits).toEqual([expect.objectContaining({ action: "auth.sign_in_refused", tenantId: "t1", outcome: "failure", metadata: { reason: "not a member" } })]);
    membership = { status: "suspended" };
    expect(await refuseNonMemberOnTenantAddress(supabase, onAddress(), "u1")).toContain("not an active member");
  });

  it("refuses a suspended organization or an address that names none", async () => {
    expect(await refuseNonMemberOnTenantAddress(supabase, onAddress("suspended"), "u1")).toContain("suspended");
    expect(await refuseNonMemberOnTenantAddress(supabase, { target: { kind: "subdomain", label: "nope" }, tenant: null }, "u1")).toBe("No organization is at this address.");
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
