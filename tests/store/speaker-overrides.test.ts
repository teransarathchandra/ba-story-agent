import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript } from "../../src/store/transcripts.js";
import {
  setSpeakerRoleOverrides,
  getSpeakerRoleOverrides,
  listDetectedSpeakers,
} from "../../src/store/speaker-overrides.js";

function seed(text: string) {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "salon scheduling" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  const { transcript, segments } = createTranscript(db, { sessionId: s.id, text });
  freezeTranscript(db, transcript.id);
  return { db, projectId: p.id, sessionId: s.id, transcript, segments };
}

describe("setSpeakerRoleOverrides / getSpeakerRoleOverrides", () => {
  it("round-trips a single override", () => {
    const { db, sessionId } = seed("Maya: hi\n\nSarah: hi back");
    setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "ba"]]));
    const result = getSpeakerRoleOverrides(db, sessionId);
    expect(result.get("Maya")).toBe("ba");
  });

  it("round-trips multiple overrides in one call", () => {
    const { db, sessionId } = seed("Maya: hi\n\nSarah: hi back\n\nKevin: hey");
    setSpeakerRoleOverrides(db, sessionId, new Map([
      ["Maya", "ba"], ["Sarah", "client"], ["Kevin", "other"],
    ]));
    const result = getSpeakerRoleOverrides(db, sessionId);
    expect(result.get("Maya")).toBe("ba");
    expect(result.get("Sarah")).toBe("client");
    expect(result.get("Kevin")).toBe("other");
  });

  it("upserts — re-setting a label's role overwrites the prior value, not a duplicate row", () => {
    const { db, sessionId } = seed("Maya: hi");
    setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "client"]]));
    setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "ba"]]));
    const result = getSpeakerRoleOverrides(db, sessionId);
    expect(result.size).toBe(1);
    expect(result.get("Maya")).toBe("ba");
  });

  it("returns an empty Map when no overrides exist for the session", () => {
    const { db, sessionId } = seed("Maya: hi");
    const result = getSpeakerRoleOverrides(db, sessionId);
    expect(result.size).toBe(0);
  });

  it("scopes overrides to their own session — does not leak across sessions", () => {
    const { db, projectId, sessionId } = seed("Maya: hi");
    const otherSession = createSession(db, { projectId, title: "Other" });
    setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "ba"]]));
    const otherResult = getSpeakerRoleOverrides(db, otherSession.id);
    expect(otherResult.size).toBe(0);
  });

  it("rejects an invalid role value", () => {
    const { db, sessionId } = seed("Maya: hi");
    expect(() =>
      setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "not-a-real-role" as never]])),
    ).toThrow();
  });
});

describe("listDetectedSpeakers", () => {
  it("returns each distinct labeled speaker in first-appearance order, unconfirmed by default", () => {
    const { db, sessionId } = seed(
      "Maya: hi everyone\n\nSarah: hello\n\nMaya: how are staff schedules handled\n\nKevin: usually 9 to 6",
    );
    const result = listDetectedSpeakers(db, sessionId);
    expect(result.map((sp) => sp.label)).toEqual(["Maya", "Sarah", "Kevin"]);
    expect(result.every((sp) => sp.confirmedRole === null)).toBe(true);
  });

  it("reflects a confirmed override in confirmedRole", () => {
    const { db, sessionId } = seed("Maya: hi\n\nSarah: hello");
    setSpeakerRoleOverrides(db, sessionId, new Map([["Maya", "ba"]]));
    const result = listDetectedSpeakers(db, sessionId);
    const maya = result.find((sp) => sp.label === "Maya");
    const sarah = result.find((sp) => sp.label === "Sarah");
    expect(maya?.confirmedRole).toBe("ba");
    expect(sarah?.confirmedRole).toBeNull();
  });

  it("returns an empty array for a transcript with zero labeled segments", () => {
    const { db, sessionId } = seed("just plain text with no speaker prefixes at all here");
    const result = listDetectedSpeakers(db, sessionId);
    expect(result).toEqual([]);
  });

  it("returns an empty array when the session has no frozen transcript", () => {
    const db = openDb(":memory:");
    const p = createProject(db, { name: "P", domain: "salon scheduling" });
    const s = createSession(db, { projectId: p.id, title: "S" });
    const result = listDetectedSpeakers(db, s.id);
    expect(result).toEqual([]);
  });

  it("uses only the latest frozen transcript version, not stale earlier versions", () => {
    const { db, sessionId } = seed("Maya: original text");
    // A second, later transcript version for the same session (simulates the
    // state amendTranscript produces, without invoking the full amendment flow).
    const { transcript: v2 } = createTranscript(db, { sessionId, text: "Sarah: amended text" });
    freezeTranscript(db, v2.id);
    const result = listDetectedSpeakers(db, sessionId);
    expect(result.map((sp) => sp.label)).toEqual(["Sarah"]);
  });
});
