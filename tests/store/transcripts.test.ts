import { describe, it, expect } from "vitest";
import { openDb } from "../../src/store/db.js";
import { createProject, createSession } from "../../src/store/projects.js";
import { createTranscript, freezeTranscript, getFrozenTranscript, hashText } from "../../src/store/transcripts.js";

function seed() {
  const db = openDb(":memory:");
  const p = createProject(db, { name: "P", domain: "invoice approval for logistics operators" });
  const s = createSession(db, { projectId: p.id, title: "S" });
  return { db, projectId: p.id, sessionId: s.id };
}

describe("transcripts", () => {
  it("splits into segments with correct char offsets", () => {
    const { db, sessionId } = seed();
    const text = "Alice: hello there\n\nBob: goodbye now";
    const { segments } = createTranscript(db, { sessionId, text });
    expect(segments).toHaveLength(2);
    expect(text.slice(segments[0]!.charStart, segments[0]!.charEnd)).toBe("Alice: hello there");
    expect(text.slice(segments[1]!.charStart, segments[1]!.charEnd)).toBe("Bob: goodbye now");
  });

  it("hashes content deterministically", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
    expect(hashText("abc")).toHaveLength(64);
  });

  it("only returns a transcript once frozen", () => {
    const { db, sessionId } = seed();
    const { transcript } = createTranscript(db, { sessionId, text: "one\n\ntwo" });
    expect(getFrozenTranscript(db, sessionId)).toBeNull();
    freezeTranscript(db, transcript.id);
    const frozen = getFrozenTranscript(db, sessionId);
    expect(frozen?.transcript.frozenAt).not.toBeNull();
    expect(frozen?.segments).toHaveLength(2);
  });

  it("increments version for a second transcript on the same session", () => {
    const { db, sessionId } = seed();
    const a = createTranscript(db, { sessionId, text: "first" });
    const b = createTranscript(db, { sessionId, text: "second" });
    expect(a.transcript.version).toBe(1);
    expect(b.transcript.version).toBe(2);
  });

  it("parses a leading 'Name:' prefix into speakerLabel", () => {
    const { db, sessionId } = seed();
    const text = "Maya: Okay, thanks everyone.\n\nSarah: Yeah, sure.";
    const { segments } = createTranscript(db, { sessionId, text });
    expect(segments[0]?.speakerLabel).toBe("Maya");
    expect(segments[1]?.speakerLabel).toBe("Sarah");
  });

  it("leaves speakerLabel null when a segment has no speaker prefix", () => {
    const { db, sessionId } = seed();
    const text = "just a note with no speaker\n\nanother line here";
    const { segments } = createTranscript(db, { sessionId, text });
    expect(segments[0]?.speakerLabel).toBeNull();
    expect(segments[1]?.speakerLabel).toBeNull();
  });

  it("does not alter segment text or char offsets when parsing a speaker label", () => {
    const { db, sessionId } = seed();
    const text = "Maya: Okay, thanks everyone.\n\nSarah: Yeah, sure.";
    const { segments } = createTranscript(db, { sessionId, text });
    expect(text.slice(segments[0]!.charStart, segments[0]!.charEnd)).toBe("Maya: Okay, thanks everyone.");
    expect(segments[0]!.text).toBe("Maya: Okay, thanks everyone.");
  });
});
