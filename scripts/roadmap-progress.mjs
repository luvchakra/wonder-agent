#!/usr/bin/env node
// Recomputes docs/WonderID/ROADMAP-PROGRESS.md from its own item marks
// (✅ done, 🔶 partly done = half, ⬜ not started): each phase's percentage,
// the phase table and the overall figure. Change a mark, run
// `npm run roadmap`, commit both in the same pull request (CLAUDE.md §19.6).
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../docs/WonderID/ROADMAP-PROGRESS.md", import.meta.url);
const WEIGHT = { "✅": 1, "🔶": 0.5, "⬜": 0 };

// Python's round(): halves go to the even neighbour, so the figures match the first generation.
const round = (x) => {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
};
const pct = (marks) => round((100 * marks.reduce((s, m) => s + WEIGHT[m], 0)) / marks.length);
const bar = (p) => "█".repeat(round(p / 10)) + "░".repeat(10 - round(p / 10));
const anchor = (n, name) => `${n}-${name.toLowerCase().replace(/,/g, "").replace(/ /g, "-")}`;

const lines = readFileSync(FILE, "utf8").split("\n");
const phases = [];
for (const line of lines) {
  const h = line.match(/^## (\d+)\. (.+?)(?: — \d+%)?$/);
  if (h) phases.push({ n: Number(h[1]), name: h[2], marks: [] });
  const item = line.match(/^- (✅|🔶|⬜) /u);
  if (item && phases.length) phases.at(-1).marks.push(item[1]);
}
if (phases.length === 0 || phases.some((p) => p.marks.length === 0)) throw new Error("ROADMAP-PROGRESS.md: every phase needs at least one ✅/🔶/⬜ item");

const total = pct(phases.flatMap((p) => p.marks));
const out = lines
  .filter((l) => !/^\| \d+ \| \[/.test(l))
  .map((l) => {
    if (/^\*\*Overall: \d+%\*\*/.test(l)) return `**Overall: ${total}%** \`${bar(total)}\``;
    const h = l.match(/^## (\d+)\. (.+?)(?: — \d+%)?$/);
    if (h) return `## ${h[1]}. ${h[2]} — ${pct(phases.find((p) => p.n === Number(h[1])).marks)}%`;
    return l;
  });
const tableHead = out.indexOf("|---|---|---|");
if (tableHead < 0) throw new Error("ROADMAP-PROGRESS.md: phase table header not found");
out.splice(tableHead + 1, 0, ...phases.map((p) => `| ${p.n} | [${p.name}](#${anchor(p.n, p.name)}) | \`${bar(pct(p.marks))}\` ${pct(p.marks)}% |`));
writeFileSync(FILE, out.join("\n"));
console.log(`Roadmap: overall ${total}%, ${phases.length} phases.`);
