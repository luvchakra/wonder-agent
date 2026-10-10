import { describe, expect, it } from "vitest";
import { provenanceText } from "./RecordProvenance";

const ada = { id: "u1", name: "Ada Lovelace" };
const bob = { id: "u2", name: "Bob Ross" };

describe("provenanceText", () => {
  it("names who created and who last changed a record, with the times", () => {
    expect(provenanceText({ createdAt: "2026-10-10T09:00:00Z", createdBy: ada, updatedAt: "2026-10-10T15:30:00Z", updatedBy: bob })).toEqual({
      created: "Created by Ada Lovelace on 10 Oct 2026, 09:00 UTC",
      updated: "Updated by Bob Ross on 10 Oct 2026, 15:30 UTC",
    });
  });

  it("shows the date alone when nobody is recorded, and never invents a name", () => {
    expect(provenanceText({ createdAt: "2026-10-10T09:00:00Z", createdBy: null, updatedAt: "2026-10-11T09:00:00Z", updatedBy: null })).toEqual({
      created: "Created on 10 Oct 2026, 09:00 UTC",
      updated: "Updated on 11 Oct 2026, 09:00 UTC",
    });
  });

  it("leaves out an update that is just the creation", () => {
    expect(provenanceText({ createdAt: "2026-10-10T09:00:00Z", createdBy: ada, updatedAt: "2026-10-10T09:00:00.400Z", updatedBy: ada }).updated).toBeNull();
  });

  it("is empty with nothing recorded", () => {
    expect(provenanceText({ createdAt: null, createdBy: null, updatedAt: null, updatedBy: null })).toEqual({ created: null, updated: null });
  });
});
