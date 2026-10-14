import { describe, expect, it } from "vitest";
import { entitlementDeleteRefusal, typeDeleteRefusal, validateEntitlementEdit } from "./entitlementEditRules";

describe("entitlement edit rules", () => {
  it("takes only what is given, as columns", () => {
    expect(validateEntitlementEdit({ displayName: " Finance reader ", riskLevel: "high", certifiable: false, status: "inactive" }, { fromConnector: false })).toEqual({
      set: { display_name: "Finance reader", risk_level: "high", certifiable: false, status: "inactive" },
    });
    expect(validateEntitlementEdit({ description: "", entitlementType: "Role" }, { fromConnector: false })).toEqual({ set: { description: null }, typeName: "Role" });
  });

  it("refuses bad values, an empty change, and renaming a connector's entitlement", () => {
    expect(validateEntitlementEdit({ riskLevel: "extreme" }, { fromConnector: false })).toHaveProperty("error");
    expect(validateEntitlementEdit({ status: "deleted" }, { fromConnector: false })).toHaveProperty("error");
    expect(validateEntitlementEdit({ requestable: "yes" }, { fromConnector: false })).toHaveProperty("error");
    expect(validateEntitlementEdit({}, { fromConnector: false })).toEqual({ error: "Nothing to change" });
    expect(validateEntitlementEdit({ name: "New" }, { fromConnector: true })).toHaveProperty("error");
    expect(validateEntitlementEdit({ name: "New" }, { fromConnector: false })).toEqual({ set: { name: "New" } });
  });

  it("deletes only what was never granted and is not from a connector", () => {
    expect(entitlementDeleteRefusal({ fromConnector: false, grants: 0 })).toBeNull();
    expect(entitlementDeleteRefusal({ fromConnector: true, grants: 0 })?.code).toBe("FROM_CONNECTOR");
    expect(entitlementDeleteRefusal({ fromConnector: false, grants: 2 })?.code).toBe("IN_USE");
    expect(typeDeleteRefusal({ entitlements: 0 })).toBeNull();
    expect(typeDeleteRefusal({ entitlements: 1 })?.code).toBe("IN_USE");
  });
});
