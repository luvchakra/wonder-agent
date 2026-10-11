import { describe, expect, it } from "vitest";
import { pipelineStatusOf, planPipeline, skipFrom, type ImportOutcome, type PipelineStep } from "./pipelineRules";

const SOURCES = [{ id: "s1", name: "Workday" }];
const APPS = [{ id: "a1", name: "SAP" }, { id: "a2", name: "Snowflake" }];
const ok: ImportOutcome = { mode: "full", status: "succeeded", kindsRead: ["identity", "account"], kindsFailed: [] };

describe("planPipeline", () => {
  it("promotes identities first, then reconciles each application's accounts", () => {
    expect(planPipeline(ok, SOURCES, APPS).map((s) => `${s.kind}:${s.targetId}:${s.status}`)).toEqual([
      "identities:s1:pending",
      "accounts:a1:pending",
      "accounts:a2:pending",
    ]);
  });

  it("reconciles entitlements and grants last, only for applications that take them from the connector", () => {
    const apps = [{ id: "a1", name: "SAP", entitlementsFromConnector: true }, { id: "a2", name: "Snowflake", entitlementsFromConnector: false }];
    const steps = planPipeline({ ...ok, kindsRead: ["identity", "account", "entitlement", "access_grant"] }, SOURCES, apps);
    expect(steps.map((s) => `${s.kind}:${s.targetId}`)).toEqual(["identities:s1", "accounts:a1", "accounts:a2", "access:a1"]);
  });

  it("plans only for the kinds the connection read", () => {
    expect(planPipeline({ ...ok, kindsRead: ["account"] }, SOURCES, APPS).map((s) => s.kind)).toEqual(["accounts", "accounts"]);
    expect(planPipeline({ ...ok, kindsRead: ["entitlement"] }, SOURCES, APPS)).toEqual([]);
  });

  it("never follows a partial or incremental run", () => {
    expect(planPipeline({ ...ok, mode: "partial" }, SOURCES, APPS)).toEqual([]);
    expect(planPipeline({ ...ok, mode: "incremental" }, SOURCES, APPS)).toEqual([]);
  });

  it("skips every step, with the reason, when the import or a kind's import failed", () => {
    const failed = planPipeline({ ...ok, status: "failed" }, SOURCES, APPS);
    expect(failed.every((s) => s.status === "skipped" && s.reason === "the import failed")).toBe(true);
    const kind = planPipeline({ ...ok, status: "partial", kindsFailed: ["identity"] }, SOURCES, APPS);
    expect(kind.every((s) => s.status === "skipped" && s.reason === "the import of identity failed")).toBe(true);
  });
});

describe("pipelineStatusOf", () => {
  const step = (status: PipelineStep["status"]): PipelineStep => ({ kind: "accounts", targetId: "a", name: "A", status });

  it("is none with nothing to do, running while a step is pending or running", () => {
    expect(pipelineStatusOf([], "succeeded")).toBe("none");
    expect(pipelineStatusOf([step("succeeded"), step("pending")], "succeeded")).toBe("running");
    expect(pipelineStatusOf([step("running")], "succeeded")).toBe("running");
  });

  it("never reports success when a step failed or did not run", () => {
    expect(pipelineStatusOf([step("succeeded"), step("failed")], "succeeded")).toBe("failed");
    expect(pipelineStatusOf([step("skipped")], "succeeded")).toBe("failed");
    expect(pipelineStatusOf([step("skipped"), step("skipped")], "failed")).toBe("failed");
    // A source paused since the plan: the rest ran, so partial, not failed and not succeeded.
    expect(pipelineStatusOf([step("skipped"), step("succeeded")], "succeeded")).toBe("partial");
  });

  it("is partial when a step or the import was partial, succeeded only when everything was", () => {
    expect(pipelineStatusOf([step("partial"), step("succeeded")], "succeeded")).toBe("partial");
    expect(pipelineStatusOf([step("succeeded")], "partial")).toBe("partial");
    expect(pipelineStatusOf([step("succeeded"), step("succeeded")], "succeeded")).toBe("succeeded");
  });

  it("skipFrom leaves earlier steps alone", () => {
    expect(skipFrom([step("succeeded"), step("pending"), step("pending")], 1, "x").map((s) => s.status)).toEqual(["succeeded", "skipped", "skipped"]);
  });
});
