#!/usr/bin/env node
/**
 * Regenerates docs/PROGRESS.md — the one high-level view of where the whole
 * product stands — from the per-module Progress Tracker tables in
 * docs/plan/NN-*-BACKLOG.md.
 *
 * Those tables stay the source of truth (CLAUDE.md §4 step 5 makes the owning
 * agent update its own row in the same commit that finishes a story); this
 * script only aggregates them, so the rollup can never drift from the
 * backlogs by being edited independently. Run it in that same commit:
 *
 *     npm run progress
 *
 * Dependency-free on purpose — Node built-ins only, no build step, so it
 * works in any checkout and in CI without an install.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_DIR = join(ROOT, "docs", "plan");
const OUT = join(ROOT, "docs", "PROGRESS.md");

/** Canonical statuses, in report order. Anything else is surfaced, not hidden. */
const STATUSES = ["Done", "Partial", "Deferred", "Not Started"];

function normalizeStatus(raw) {
  // Rows carry trailing context after an em dash ("Done — 2026-09-14: ...")
  // and some bold the status itself ("**Done** — ..."), so emphasis and
  // code markers are stripped before matching.
  const head = raw.split("—")[0].split(" - ")[0].replace(/[*_`]/g, "").trim();
  const match = STATUSES.find((s) => head.toLowerCase() === s.toLowerCase());
  if (match) return match;
  // Tolerate a bare "done"/"not started" with extra words but no dash.
  const loose = STATUSES.find((s) => head.toLowerCase().startsWith(s.toLowerCase()));
  return loose ?? "Other";
}

function parseBacklog(file) {
  const text = readFileSync(join(PLAN_DIR, file), "utf8");
  const lines = text.split("\n");

  const title = lines[0]?.replace(/^#\s*/, "").trim() ?? file;
  const field = (name) => {
    const re = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.+)$`);
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].replace(/`/g, "").trim();
    }
    return null;
  };

  const stories = [];
  let inTracker = false;
  for (const line of lines) {
    if (/^##\s+Progress Tracker/i.test(line)) {
      inTracker = true;
      continue;
    }
    // The tracker ends at the next H2 (or the --- that precedes it).
    if (inTracker && /^##\s+/.test(line)) break;
    if (!inTracker) continue;

    const row = line.trim();
    if (!row.startsWith("|")) continue;
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/^story$/i.test(cells[0])) continue; // header row
    if (/^-+$/.test(cells[0].replace(/:/g, ""))) continue; // separator row

    stories.push({ id: cells[0], title: cells[1], statusRaw: cells[2], status: normalizeStatus(cells[2]) });
  }

  // P1/P2 are prose bullet lists in every backlog, not tracked story rows —
  // counted only to show how much scope sits beyond P0, never as stories
  // with a status they don't have.
  const countBullets = (heading) => {
    const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\b`).test(l));
    if (start === -1) return 0;
    let n = 0;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) break;
      if (/^-\s+\S/.test(lines[i])) n++;
    }
    return n;
  };

  return {
    file,
    number: file.slice(0, 2),
    title,
    agent: field("Agent name") ?? title,
    module: field("Module") ?? "",
    moduleStatus: field("Status") ?? "",
    stories,
    p1: countBullets("P1"),
    p2: countBullets("P2"),
  };
}

function tally(stories) {
  const counts = Object.fromEntries([...STATUSES, "Other"].map((s) => [s, 0]));
  for (const s of stories) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return counts;
}

function bar(done, total, width = 18) {
  if (total === 0) return "—";
  const filled = Math.round((done / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(done, total) {
  return total === 0 ? "—" : `${Math.round((done / total) * 100)}%`;
}

const modules = readdirSync(PLAN_DIR)
  .filter((f) => /^\d\d-.*-BACKLOG\.md$/.test(f))
  .sort()
  .map(parseBacklog);

const all = modules.flatMap((m) => m.stories);
const overall = tally(all);
const totalP1 = modules.reduce((n, m) => n + m.p1, 0);
const totalP2 = modules.reduce((n, m) => n + m.p2, 0);

const out = [];
out.push("# WonderAgent — Progress Tracker");
out.push("");
out.push(
  "High-level status of every module, aggregated from the per-module Progress",
  "Tracker tables in [`docs/plan/`](plan/). **This file is generated — do not edit it",
  "by hand.** Update the owning module's backlog table, then regenerate:",
);
out.push("");
out.push("```bash");
out.push("npm run progress");
out.push("```");
out.push("");
out.push(
  `Generated ${new Date().toISOString().slice(0, 10)} from ${modules.length} module backlogs.`,
);
out.push("");
out.push("---");
out.push("");

out.push("## Overall");
out.push("");
out.push(`**${overall.Done} of ${all.length} tracked stories complete — ${pct(overall.Done, all.length)}**`);
out.push("");
out.push("```");
out.push(`${bar(overall.Done, all.length, 40)}  ${pct(overall.Done, all.length)}`);
out.push("```");
out.push("");
out.push("| Status | Stories |");
out.push("|---|---|");
for (const s of STATUSES) out.push(`| ${s} | ${overall[s]} |`);
if (overall.Other) out.push(`| _Unrecognized status_ | ${overall.Other} |`);
out.push(`| **Total tracked** | **${all.length}** |`);
out.push("");
out.push(
  `Beyond these, the backlogs list **${totalP1} P1** and **${totalP2} P2** forward-looking items.`,
  "Those are prose scope bullets rather than tracked stories, so they carry no status",
  "and are deliberately excluded from the counts above.",
);
out.push("");
out.push("---");
out.push("");

out.push("## By module");
out.push("");
out.push("| # | Agent | Done | Partial | Deferred | Not Started | Total | Progress |");
out.push("|---|---|---|---|---|---|---|---|");
for (const m of modules) {
  const c = tally(m.stories);
  const t = m.stories.length;
  out.push(
    `| ${m.number} | [${m.agent}](plan/${m.file}) | ${c.Done} | ${c.Partial} | ${c.Deferred} | ${c["Not Started"]} | ${t} | \`${bar(c.Done, t)}\` ${pct(c.Done, t)} |`,
  );
}
out.push("");
out.push("---");
out.push("");

out.push("## Story detail");
out.push("");
for (const m of modules) {
  const c = tally(m.stories);
  out.push(`### ${m.number} — ${m.agent}`);
  out.push("");
  if (m.module) out.push(`**Module:** ${m.module}  `);
  out.push(`**Backlog status:** ${m.moduleStatus || "—"}  `);
  out.push(
    `**Stories:** ${c.Done} done · ${c.Partial} partial · ${c.Deferred} deferred · ${c["Not Started"]} not started (${m.stories.length} tracked) · ${m.p1} P1 / ${m.p2} P2 ahead`,
  );
  out.push("");
  if (m.stories.length === 0) {
    out.push("_No Progress Tracker table found in this backlog._");
    out.push("");
    continue;
  }
  out.push("| Story | Title | Status |");
  out.push("|---|---|---|");
  for (const s of m.stories) out.push(`| ${s.id} | ${s.title} | ${s.statusRaw} |`);
  out.push("");
}

writeFileSync(OUT, out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n");

const unrecognized = all.filter((s) => s.status === "Other");
console.log(
  `docs/PROGRESS.md — ${modules.length} modules, ${all.length} stories, ${overall.Done} done (${pct(overall.Done, all.length)})`,
);
if (unrecognized.length) {
  console.warn(`  warning: ${unrecognized.length} row(s) with an unrecognized status:`);
  for (const s of unrecognized) console.warn(`    ${s.id}: "${s.statusRaw}"`);
}
