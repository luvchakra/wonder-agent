import { describe, expect, it } from "vitest";
import { alreadyApplied, escapeDnValue, fillDn, planLdapWrite } from "./ldapWrite";
import { DefinitionConnector, type ConnectorDriverSession, type DriverFactory } from "./engine";
import { validateDefinition } from "./validate";
import { ldapDirectory } from "./definitions/ldap-directory";
import type { ConnectorDefinition, LdapWriteSpec } from "./types";

describe("LDAP changes (INTEGRATION-P0-22)", () => {
  it("escapes DN values so a name cannot add or change an RDN (RFC 4514)", () => {
    expect(escapeDnValue("Smith, John")).toBe("Smith\\, John");
    expect(escapeDnValue('a+b"c<d>e;f=g\\h')).toBe('a\\+b\\"c\\<d\\>e\\;f\\=g\\\\h');
    expect(escapeDnValue("#lead")).toBe("\\#lead");
    expect(escapeDnValue(" lead and trail ")).toBe("\\ lead and trail\\ ");
  });

  it("uses a DN WonderID read as it is, and escapes values filled into a DN template", () => {
    const scope = { settings: { baseDn: "dc=example,dc=com" }, target: { account: "uid=ana,ou=People,dc=example,dc=com", displayName: "Ana, Admin" } };
    expect(fillDn("{target.account}", scope)).toBe("uid=ana,ou=People,dc=example,dc=com");
    expect(fillDn("cn={target.displayName},ou=People,{settings.baseDn}", scope)).toBe("cn=Ana\\, Admin,ou=People,dc=example,dc=com");
  });

  it("plans a modify or an add from a declared change", () => {
    const target = { account: "uid=ana,ou=People,dc=x", entitlement: "cn=fin,ou=Groups,dc=x" };
    expect(planLdapWrite({ dn: "{target.entitlement}", modify: [{ operation: "delete", attribute: "member", values: ["{target.account}"] }] }, { settings: {}, target })).toEqual({
      kind: "modify",
      dn: "cn=fin,ou=Groups,dc=x",
      changes: [{ operation: "delete", attribute: "member", values: ["uid=ana,ou=People,dc=x"] }],
    });
    expect(planLdapWrite({ dn: "uid={target.username},ou=People,dc=x", add: { objectClass: ["inetOrgPerson"], uid: ["{target.username}"], mail: ["{target.email}"] } }, { settings: {}, target: { username: "bo", email: "bo@x.test" } })).toEqual({
      kind: "add",
      dn: "uid=bo,ou=People,dc=x",
      attributes: { objectClass: ["inetOrgPerson"], uid: ["bo"], mail: ["bo@x.test"] },
    });
  });

  it("an answer that says the change is already there counts as done, nothing else does", () => {
    const add = { kind: "modify" as const, dn: "x", changes: [{ operation: "add" as const, attribute: "member", values: ["y"] }] };
    const del = { kind: "modify" as const, dn: "x", changes: [{ operation: "delete" as const, attribute: "member", values: ["y"] }] };
    expect(alreadyApplied(20, add)).toBe(true);
    expect(alreadyApplied(16, del)).toBe(true);
    expect(alreadyApplied(16, add)).toBe(false);
    expect(alreadyApplied(50, del)).toBe(false);
    expect(alreadyApplied(68, { kind: "add", dn: "x", attributes: {} })).toBe(true);
  });

  it("validates LDAP changes: the built-in, and what a definition may not do", () => {
    const msgs = (d: unknown) => validateDefinition(d).issues.map((i) => `${i.path}: ${i.message}`).join("\n");
    expect(msgs(ldapDirectory)).toBe("");
    const withWrite = (write: unknown) => ({ ...ldapDirectory, write }) as unknown;
    expect(msgs(withWrite({ revoke_access: { request: { method: "DELETE", path: "/x/{target.account}/{target.entitlement}" } } }))).toMatch(/writes with \{ ldap \}/);
    expect(msgs(withWrite({ revoke_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "delete", attribute: "member", values: ["{settings.baseDn}"] }] } } }))).toMatch(/must use \{target.account\}/);
    expect(msgs(withWrite({ revoke_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "purge", attribute: "member;x", values: ["{target.account}"] }] } } }))).toMatch(/operation: must be add, delete or replace[\s\S]*attribute: must be an attribute name/);
    expect(msgs(withWrite({ grant_access: { ldap: { dn: "{target.entitlement}", add: { objectClass: ["top"] } } } }))).toMatch(/only create_account adds an entry/);
    expect(msgs(withWrite({ create_account: { ldap: { dn: "uid={target.username},{settings.baseDn}", add: { uid: ["{target.username}"] } } } }))).toMatch(/objectClass/);
    expect(msgs(withWrite({ revoke_access: { ldap: { dn: "{target.entitlement}", modify: [{ operation: "delete", attribute: "member", values: ["{secret.password}"] }] } } }))).toMatch(/secret/);
    expect(msgs({ ...(withWrite({}) as object), driver: "sql" })).toMatch(/only an http or ldap connector can write/);
  });

  it("the connector sends a declared LDAP change to the driver, filled for the target", async () => {
    const sent: { spec: LdapWriteSpec; target: unknown }[] = [];
    const ldap: DriverFactory = async () =>
      ({
        test: async () => undefined,
        fetch: async () => [],
        ldapWrite: async (spec, scope) => void sent.push({ spec, target: scope.target }),
      }) satisfies ConnectorDriverSession;
    const c = new DefinitionConnector({ ldap });
    await c.authenticate({ definition: { key: ldapDirectory.key, version: ldapDirectory.version, origin: "builtin" }, manifest: ldapDirectory as ConnectorDefinition, settings: { url: "ldaps://dir.example.test", baseDn: "dc=example,dc=test" } }, JSON.stringify({ bindDn: "cn=w", password: "p" }));
    await c.write("revoke_access", { account: "uid=ana,dc=example,dc=test", entitlement: "cn=fin,dc=example,dc=test" }, "key-1");
    expect(sent).toEqual([{ spec: ldapDirectory.write!.revoke_access!.ldap, target: { account: "uid=ana,dc=example,dc=test", entitlement: "cn=fin,dc=example,dc=test" } }]);
  });
});
