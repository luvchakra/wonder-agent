// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const audit = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/supabaseServer", () => ({ supabaseServiceRole: () => ({ rpc }) }));
vi.mock("./auditLog", () => ({ writePlatformAudit: (e: unknown) => audit(e) }));

import { getWonderappsDashboardAccess, setWonderappsDashboardAccess } from "./wonderappsAccess";

beforeEach(() => {
  rpc.mockReset();
  audit.mockReset();
});

describe("WonderApps dashboard access (owner decision, 2026-10-13)", () => {
  it("reads the state, and says unknown when it cannot", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await getWonderappsDashboardAccess()).toBe(true);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await getWonderappsDashboardAccess()).toBeNull();
  });

  it("turns it off and audits who did it, with the state before and after", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await setWonderappsDashboardAccess("admin-1", false)).toBe(false);
    expect(rpc).toHaveBeenLastCalledWith("set_wonderapps_dashboard_access", { p_enabled: false });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: "admin-1", action: "platform.wonderapps_dashboard_access_changed", oldValue: { enabled: true }, newValue: { enabled: false }, result: "success" }));
  });

  it("never reports a change the database did not make, and audits the failure", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(setWonderappsDashboardAccess("admin-1", true)).rejects.toThrow(/could not be changed/);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ result: "failure" }));
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: false, error: null });
    await expect(setWonderappsDashboardAccess("admin-1", true)).rejects.toThrow(/did not confirm/);
  });
});
