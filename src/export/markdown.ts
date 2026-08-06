// src/export/markdown.ts
import type { ExportSnapshot } from "./snapshot.js";
import type { Publisher } from "./json.js";

export function formatTimestamp(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export const markdownPublisher: Publisher = {
  name: "markdown",
  publish(s: ExportSnapshot): string {
    const out: string[] = [];

    out.push(`# ${s.project.name} — Requirements Baseline`);
    const sessionList = s.provenance.sessions.map((x) => x.title).join(", ") || "(no sessions)";
    out.push(
      `Sessions: ${sessionList} · Generated ${shortDate(s.generatedAt)} · ` +
        `Regulatory context: ${s.project.regulatoryContext}`,
    );
    const hashes = s.provenance.sessions.map((x) => x.transcriptHash.slice(0, 8)).join(", ");
    out.push(`Transcript hashes: ${hashes || "—"} · Model: ${s.provenance.llmModel}`);
    out.push("");

    // 1. Confirmed requirements
    out.push("## 1. Confirmed Requirements");
    out.push("");
    if (s.requirements.length === 0) {
      out.push("_No confirmed requirements. Nothing here has been approved yet._");
      out.push("");
    }
    for (const r of s.requirements) {
      const pending = r.status !== "finalized" ? " `[NOT YET APPROVED]`" : "";
      out.push(`### ${r.key} — ${r.statement}${pending}`);
      out.push(`**Status:** ${r.status} · **Origin:** ${r.origin}`);
      for (const e of r.evidence) {
        out.push(
          `**Source:** ${e.sessionTitle} @ ${formatTimestamp(e.startMs)} — *"${e.quote}"*` +
            (e.matchMode === "fuzzy" ? " _(matched with disfluencies removed)_" : ""),
        );
      }
      out.push("");
    }

    // 2. Stories
    out.push("## 2. User Stories");
    out.push("");
    if (s.stories.length === 0) {
      out.push("_No user stories yet._");
      out.push("");
    }
    for (const st of s.stories) {
      out.push(`### ${st.key} — ${st.iWant}`);
      out.push(`As a ${st.asA}, I want ${st.iWant}, so that ${st.soThat}.`);
      out.push(`**Implements:** ${st.implements.join(", ") || "—"}`);
      out.push("");
      out.push("Acceptance criteria:");
      for (const ac of st.acceptanceCriteria) {
        if (ac.source === "client-stated") {
          out.push(`- \`[client-stated]\` ${ac.gherkin}`);
        } else {
          const link = ac.linkedQuestionKey ? ` → see **${ac.linkedQuestionKey}**` : "";
          out.push(`- \`[DERIVED — UNCONFIRMED]\` ${ac.gherkin}${link}`);
        }
      }
      out.push("");
    }

    // 3. Assumptions
    out.push("## 3. Assumptions — NOT client-confirmed");
    out.push("");
    if (s.assumptions.length === 0) {
      out.push("_No assumptions recorded._");
      out.push("");
    }
    s.assumptions.forEach((a, i) => {
      out.push(`### ASM-${String(i + 1).padStart(3, "0")} — ${a.statement}`);
      out.push(`**Basis:** ${a.sessionTitle} — *"${a.quote}"* (hedged)`);
      out.push("**Verification:** none recorded");
      out.push("");
    });

    // 4. Open questions
    out.push("## 4. Open Questions");
    out.push("");
    if (s.openQuestions.length === 0) {
      out.push("_No open questions._");
    } else {
      out.push("| ID | Question | Category | Raised | Status |");
      out.push("|----|----------|----------|--------|--------|");
      for (const q of s.openQuestions) {
        const text = q.text.replace(/\|/g, "\\|");
        out.push(`| ${q.key} | ${text} | ${q.category} | ${q.raisedIn} | ${q.status} |`);
      }
    }
    out.push("");

    // 5. Recommendations
    out.push("## 5. Recommendations — tool-generated, not client requirements");
    out.push("");
    if (s.recommendations.length === 0) {
      out.push("_No recommendations._");
      out.push("");
    }
    for (const r of s.recommendations) {
      out.push(`### ${r.key} \`[${r.category}]\` ${r.text}`);
      out.push(`**Rationale:** ${r.rationale}`);
      out.push(`**Status:** ${r.status}`);
      out.push("");
    }

    // Appendix A — the honesty artifact.
    out.push(`## Appendix A — Quarantined extractions (n=${s.quarantined.length})`);
    out.push("");
    out.push(
      "Statements produced during analysis that could not be matched to any " +
        "transcript text. Excluded from every section above. Listed for transparency.",
    );
    out.push("");
    for (const q of s.quarantined) {
      out.push(`- ${q.sessionTitle}: *"${q.quote}"*`);
    }
    if (s.quarantined.length > 0) out.push("");

    // Appendix B — the compliance artifact.
    out.push("## Appendix B — Provenance");
    out.push("");
    out.push(`**Engine version:** ${s.provenance.engineVersion}`);
    out.push(`**LLM model:** ${s.provenance.llmModel}`);
    out.push("");
    if (s.provenance.sessions.length > 0) {
      out.push("| Session | Date | Words | Transcript SHA-256 |");
      out.push("|---------|------|-------|--------------------|");
      for (const x of s.provenance.sessions) {
        out.push(`| ${x.title} | ${shortDate(x.occurredAt)} | ${x.wordCount} | \`${x.transcriptHash}\` |`);
      }
      out.push("");
    }
    const e = s.provenance.egress;
    out.push(
      `**Egress:** ${e.requests} requests, ${e.promptTokens.toLocaleString("en-US")} prompt tokens sent, ` +
        `${e.completionTokens.toLocaleString("en-US")} completion tokens received.`,
    );
    out.push("");
    out.push("_Audio never left this machine. Only the frozen transcript text above was sent._");
    out.push("");

    return out.join("\n");
  },
};
