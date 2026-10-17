#!/usr/bin/env node
/**
 * Generates docs/WonderID/ROADMAP-STORIES.md: every roadmap story with its
 * progress, and at the top what was completed recently, what is next and what
 * is blocked. Run by `npm run roadmap` in every merge (CLAUDE.md §19.6).
 *
 * Nothing here is typed by hand, so the page cannot drift from the sources:
 * - story status: the module Progress Trackers (docs/plan/NN-*-BACKLOG.md),
 *   the source of truth; for a phase story not in a backlog yet (†) or one a
 *   phase finishes ("(finish)", "(rest)"…), the live phase doc
 *   (docs/WonderID/progress/PROGRESS.md);
 * - phases and story order: docs/WonderID/run-order/RUN-ORDER.md;
 * - open decisions and owner actions: the live phase doc;
 * - recently completed: git history of the Progress Trackers (rows that
 *   became Done), plus any uncommitted change.
 *
 * Node built-ins only.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_DIR = join(ROOT, "docs", "plan");
const RUN_ORDER = join(ROOT, "docs", "WonderID", "run-order", "RUN-ORDER.md");
const LIVE = join(ROOT, "docs", "WonderID", "progress", "PROGRESS.md");
const OUT = join(ROOT, "docs", "WonderID", "ROADMAP-STORIES.md");
const REPO = "https://github.com/luvchakra/wonder-agent";
const RECENT = 10;
const UPCOMING = 10;

const ID_RE = /^([A-Z]+-P\d-\d+(?:\.\d+)?)/;
const cells = (line) => line.trim().split("|").slice(1, -1).map((c) => c.trim());
const isRow = (line) => line.trim().startsWith("|") && !/^\|\s*-/.test(line.trim());
const isSeparator = (line) => /^\|\s*-/.test(line.trim());

/** Done, Partial, In progress, Deferred, Blocked or Not started, from a status cell. */
function normalize(raw) {
  const head = raw.replace(/[*_`]/g, "").split("—")[0].trim().toLowerCase();
  if (head.startsWith("done")) return "Done";
  if (head.includes("deferred")) return "Deferred";
  if (head.startsWith("partial")) return "Partial";
  if (head.startsWith("in progress")) return "In progress";
  if (head.startsWith("blocked")) return "Blocked";
  return "Not started";
}
const PROGRESS = { Done: 100, Partial: 50, "In progress": 50, Deferred: 0, Blocked: 0, "Not started": 0 };
const ICON = { Done: "✅", Partial: "🔶", "In progress": "🔶", Deferred: "⏸️", Blocked: "⛔", "Not started": "⬜" };

// --- Module backlogs ---------------------------------------------------------
const modules = readdirSync(PLAN_DIR)
  .filter((f) => /^\d\d-.*-BACKLOG\.md$/.test(f))
  .sort()
  .map((file) => {
    const lines = readFileSync(join(PLAN_DIR, file), "utf8").split("\n");
    const agent = (lines.find((l) => /^\*\*Agent name:\*\*/.test(l)) ?? "").replace(/^\*\*Agent name:\*\*\s*/, "").replace(/`/g, "").trim() || file;
    const stories = [];
    let inTracker = false;
    for (const line of lines) {
      if (/^##\s+Progress Tracker/i.test(line)) {
        inTracker = true;
        continue;
      }
      if (inTracker && /^##\s+/.test(line)) break;
      if (!inTracker || !isRow(line)) continue;
      const [id, title, status] = cells(line);
      if (!id || !ID_RE.test(id) || status === undefined) continue;
      stories.push({ id, title, raw: status, status: normalize(status) });
    }
    return { file, agent, stories };
  });
const tracker = new Map(modules.flatMap((m) => m.stories.map((s) => [s.id, s])));

// --- Live phase doc: statuses, decisions, owner actions -----------------------
const liveLines = readFileSync(LIVE, "utf8").split("\n");
const live = new Map();
const decisions = new Map();
const ownerActions = [];
const priorityRules = [];
{
  let header = null;
  let section = "";
  for (const line of liveLines) {
    if (/^##\s+/.test(line)) {
      section = line.replace(/^##\s+/, "").trim();
      header = null;
      continue;
    }
    if (isSeparator(line)) continue;
    if (!isRow(line)) {
      header = null;
      continue;
    }
    const c = cells(line);
    if (!header) {
      header = c.map((h) => h.toLowerCase());
      continue;
    }
    if (section === "Decisions") decisions.set(c[0], c[2] ?? "");
    else if (section === "Priorities") priorityRules.push({ tokens: c[0].split(",").map((t) => t.replace(/`/g, "").trim()), priority: c[1], why: c[2] ?? "" });
    else if (section.startsWith("Owner actions")) {
      if (!/^done/i.test(c[1] ?? "")) ownerActions.push(c[0]);
    } else {
      const id = (c[0].match(ID_RE) ?? [])[1];
      const si = header.indexOf("status");
      const ni = header.indexOf("notes");
      const qualifier = /\((finish|rest|runtime part|extended)\)/.exec(c[0])?.[0] ?? "";
      if (id && si >= 0) live.set(id + qualifier, { status: normalize(c[si] ?? ""), notes: ni >= 0 ? (c[ni] ?? "") : "" });
      // A plan item with no story id (e.g. "Full Playwright suite") is matched by its name.
      else if (!id && si >= 0 && c[0]) live.set(`name:${c[0].trim()}`, { status: normalize(c[si] ?? ""), notes: ni >= 0 ? (c[ni] ?? "") : "" });
    }
  }
}
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
for (const r of priorityRules) if (!(r.priority in PRIORITY_RANK)) throw new Error(`progress/PROGRESS.md Priorities: unknown priority "${r.priority}"`);

/** The first Priorities row that matches the story (id, phase key or null for the product base, status). */
function priorityOf(story) {
  const matches = (token) => {
    const unfinished = /\(unfinished\)$/.test(token);
    const t = token.replace(/\s*\(unfinished\)$/, "");
    if (unfinished && story.status === "Done") return false;
    if (/^F\d+$/.test(t)) return story.phase === t;
    if (t === "Deferred") return story.status === "Deferred";
    if (t === "Product base") return story.phase === null;
    if (t.endsWith("-*")) return !!story.id && story.id.startsWith(t.slice(0, -1));
    return story.id === t;
  };
  return priorityRules.find((r) => r.tokens.some(matches))?.priority ?? "Medium";
}
const openDecision = (d) => decisions.has(d) && !/^approved/i.test(decisions.get(d));

// --- Phases from the run order -------------------------------------------------
const phases = [];
{
  let current = null;
  let header = null;
  for (const line of readFileSync(RUN_ORDER, "utf8").split("\n")) {
    const h = line.match(/^## Phase (F\d+): (.+)$/);
    if (h) {
      current = { key: h[1], name: h[2].trim(), stories: [] };
      phases.push(current);
      header = null;
      continue;
    }
    if (/^##\s+/.test(line)) current = null;
    if (isSeparator(line)) continue;
    if (!current || !isRow(line)) {
      header = null;
      continue;
    }
    const c = cells(line);
    if (!header) {
      header = c.map((x) => x.toLowerCase());
      continue;
    }
    const label = c[0];
    const id = (label.match(ID_RE) ?? [])[1] ?? null;
    const qualifier = /\((finish|rest|runtime part|extended)\)/.exec(label)?.[0] ?? "";
    const notes = header.indexOf("notes") >= 0 ? (c[header.indexOf("notes")] ?? "") : "";
    current.stories.push({ id, label: label.replace(/\s*†\s*$/, " †"), title: c[1] ?? "", module: c[header.indexOf("module")] ?? "", qualifier, notes });
  }
}

/** A phase story's status: the backlog row, unless the phase finishes a story the backlog already closed. */
function phaseStatus(s) {
  if (!s.id) {
    const byName = live.get(`name:${s.label.replace(/\s*†\s*$/, "").trim()}`);
    return { status: byName?.status ?? "Not started", notes: byName?.notes ?? "" };
  }
  const fromLive = live.get(s.id + s.qualifier) ?? live.get(s.id);
  if (s.qualifier) return { status: fromLive?.status ?? "Not started", notes: fromLive?.notes ?? "" };
  const row = tracker.get(s.id);
  if (row) return { status: row.status, notes: fromLive?.notes ?? "" };
  return { status: fromLive?.status ?? "Not started", notes: fromLive?.notes ?? "" };
}

/** Why a story cannot start: an open decision it needs, or a deferral recorded in its backlog row. */
function blocker(s, notes) {
  for (const text of [s.notes, notes]) {
    const m = /^Needs (D\d+)\.?$/.exec((text ?? "").trim());
    if (m && openDecision(m[1])) return `waits on decision ${m[1]} (${decisionTitle(m[1])})`;
  }
  return null;
}
function decisionTitle(d) {
  const row = liveLines.find((l) => l.startsWith(`| ${d} |`));
  return row ? cells(row)[1] : "open";
}

const phaseIds = new Set();
for (const p of phases) {
  for (const s of p.stories) {
    const st = phaseStatus(s);
    s.status = st.status;
    s.block = s.status === "Done" ? null : blocker(s, st.notes);
    if (s.block) s.status = s.status === "Not started" ? "Blocked" : s.status;
    if (s.id && !s.qualifier) phaseIds.add(s.id);
  }
  p.progress = Math.round(p.stories.reduce((n, s) => n + PROGRESS[s.status], 0) / p.stories.length);
  for (const s of p.stories) s.priority = priorityOf({ id: s.id, phase: p.key, status: s.status });
}

// --- Recently completed: tracker rows that became Done -------------------------
function recentDone() {
  let log;
  try {
    const committed = execFileSync("git", ["log", "-p", "--no-color", "--format=@@C %h %s", "-n", "300", "HEAD", "--", "docs/plan/"], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const pending = execFileSync("git", ["diff", "--no-color", "HEAD", "--", "docs/plan/"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    log = (pending.trim() ? `@@C (this change) This pull request\n${pending}\n` : "") + committed;
  } catch {
    return null;
  }
  const out = [];
  const seen = new Set();
  for (const chunk of log.split(/^@@C /m).slice(1)) {
    const [head, ...rest] = chunk.split("\n");
    const pr = /\(#(\d+)\)\s*$/.exec(head)?.[1] ?? null;
    const removed = new Map();
    const added = [];
    for (const line of rest) {
      const m = /^([+-])(\| [A-Z]+-P\d-\d+(?:\.\d+)? \|.*)$/.exec(line);
      if (!m) continue;
      const [id, title, status] = cells(m[2]);
      if (m[1] === "-") removed.set(id, normalize(status ?? ""));
      else added.push({ id, title, status: normalize(status ?? "") });
    }
    for (const a of added) {
      if (a.status !== "Done" || removed.get(a.id) === "Done" || seen.has(a.id)) continue;
      // Still Done today (a later change may have reopened it).
      if (tracker.get(a.id)?.status !== "Done") continue;
      seen.add(a.id);
      out.push({ id: a.id, title: tracker.get(a.id).title, pr, pending: head.startsWith("(this change)") });
    }
    if (out.length >= RECENT) break;
  }
  return out;
}

// --- Write ---------------------------------------------------------------------
const allPhase = phases.flatMap((p) => p.stories);
const others = modules.map((m) => ({ ...m, stories: m.stories.filter((s) => !phaseIds.has(s.id)).map((s) => ({ ...s, priority: priorityOf({ id: s.id, phase: null, status: s.status }) })) }));
const allStories = [...allPhase, ...others.flatMap((m) => m.stories)];
const overall = Math.round(allStories.reduce((n, s) => n + PROGRESS[s.status], 0) / allStories.length);
const count = (list, st) => list.filter((s) => s.status === st).length;
const bar = (p, w = 10) => "█".repeat(Math.round((p / 100) * w)) + "░".repeat(w - Math.round((p / 100) * w));
const cell = (t) => t.replace(/\|/g, "\\|");

const recent = recentDone();
// Unfinished, not blocked: higher priority first, then work already under way, then plan order (phases, then the product base).
const ordered = [
  ...phases.flatMap((p) => p.stories.map((st) => ({ ...st, where: p.key }))),
  ...others.flatMap((m) => m.stories.map((st) => ({ ...st, label: st.id, where: m.agent.replace(/ Agent$/, "") }))),
].map((st, i) => ({ ...st, order: i }));
const open = ordered.filter((st) => st.status !== "Done" && st.status !== "Blocked" && st.status !== "Deferred");
const started = (st) => (st.status === "Not started" ? 1 : 0);
const upcoming = [...open].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || started(a) - started(b) || a.order - b.order).slice(0, UPCOMING);
const lowLater = ordered.filter((st) => st.status !== "Done" && st.priority === "Low");
const blocked = [
  ...allPhase.filter((s) => s.block).map((s) => ({ label: s.label, title: s.title, why: `${s.block} · ${s.priority}` })),
  ...modules.flatMap((m) =>
    m.stories
      .filter((s) => s.status === "Deferred" || /\(blocked:/i.test(s.raw))
      .map((s) => ({ label: s.id, title: s.title, why: `${s.status === "Deferred" ? "deferred in its backlog" : `partly blocked: ${/\(blocked:\s*([^)]*)\)/i.exec(s.raw)?.[1] ?? ""}`} · ${priorityOf({ id: s.id, phase: phaseIds.has(s.id) ? "F" : null, status: s.status })}` })),
  ),
];

const o = [];
o.push("# WonderID roadmap stories", "");
o.push("Every roadmap story and how far along it is. **Generated by `npm run roadmap`; never edit by hand.** It reads the module backlogs (`docs/plan/`), the [phase plan](run-order/RUN-ORDER.md), the [live phase status](progress/PROGRESS.md) and git history, and is regenerated in every merge. The short version is [ROADMAP-PROGRESS.md](ROADMAP-PROGRESS.md).", "");
o.push(`✅ done 100% · 🔶 partly done or in progress 50% · ⬜ not started 0% · ⛔ blocked · ⏸️ deferred · priority High, Medium or Low`, "");
o.push(`**Overall: ${overall}%** \`${bar(overall)}\` · ${count(allStories, "Done")} of ${allStories.length} stories done, ${count(allStories, "Partial") + count(allStories, "In progress")} partly done`, "");
const openAll = allStories.filter((st) => st.status !== "Done");
o.push(`Unfinished by priority: **High ${openAll.filter((st) => st.priority === "High").length}** · Medium ${openAll.filter((st) => st.priority === "Medium").length} · Low ${openAll.filter((st) => st.priority === "Low").length}. Priorities come from the [priorities table](progress/PROGRESS.md#priorities).`, "");
o.push("Every story counts equally here, so the many finished product-base stories weigh heavily; [ROADMAP-PROGRESS.md](ROADMAP-PROGRESS.md) counts capabilities instead.", "");

o.push("## Completed recently", "");
if (recent === null) o.push("Unavailable: git history could not be read.", "");
else if (recent.length === 0) o.push("None recorded yet.", "");
else {
  for (const r of recent) o.push(`- ✅ **${r.id}** ${r.title}${r.pending ? " · this change" : r.pr ? ` · [#${r.pr}](${REPO}/pull/${r.pr})` : ""}`);
  o.push("");
}

o.push("## Up next", "");
if (upcoming.length === 0) o.push("Nothing left that is not blocked.", "");
for (const s of upcoming) o.push(`- ${ICON[s.status]} **${s.label}** ${s.title} · ${s.priority} · ${s.where}${s.status !== "Not started" ? ` · ${s.status.toLowerCase()}` : ""}`);
o.push("");
const unfinishedIntegration = lowLater.filter((st) => st.id?.startsWith("INTEGRATION-")).length;
o.push(`Later: ${lowLater.length} unfinished stories are low priority${unfinishedIntegration ? `, including all ${unfinishedIntegration} unfinished INTEGRATION stories (implemented later, owner decision)` : ""}.`, "");

o.push("## Blocked", "");
if (blocked.length === 0 && ownerActions.length === 0) o.push("Nothing blocked.", "");
for (const b of blocked) o.push(`- ⛔ **${b.label}** ${b.title}: ${b.why}`);
for (const a of ownerActions) o.push(`- ⛔ Owner action: ${a}`);
o.push("");

o.push("## Phases", "");
o.push("| Phase | Stories | Done | Progress |", "|---|---|---|---|");
for (const p of phases) o.push(`| [${p.key} ${p.name}](#${(p.key + "-" + p.name).toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")}) | ${p.stories.length} | ${count(p.stories, "Done")} | \`${bar(p.progress)}\` ${p.progress}% |`);
const baseDone = others.flatMap((m) => m.stories);
const baseProgress = Math.round(baseDone.reduce((n, s) => n + PROGRESS[s.status], 0) / baseDone.length);
o.push(`| [Product base, by module](#product-base-by-module) | ${baseDone.length} | ${count(baseDone, "Done")} | \`${bar(baseProgress)}\` ${baseProgress}% |`, "");

for (const p of phases) {
  o.push(`### ${p.key} ${p.name}`, "");
  o.push(`${p.progress}% · ${count(p.stories, "Done")} of ${p.stories.length} done`, "");
  o.push("| | Story | Title | Module | Priority | Progress |", "|---|---|---|---|---|---|");
  for (const s of p.stories) o.push(`| ${ICON[s.status]} | ${cell(s.label)} | ${cell(s.title)}${s.block ? ` (${s.block})` : ""} | ${cell(s.module)} | ${s.priority} | ${PROGRESS[s.status]}% |`);
  o.push("");
}

o.push("## Product base, by module", "");
o.push("The stories the platform was built on before the phase plan, from each module's backlog.", "");
for (const m of others) {
  if (m.stories.length === 0) continue;
  const p = Math.round(m.stories.reduce((n, s) => n + PROGRESS[s.status], 0) / m.stories.length);
  o.push(`<details><summary><b>${m.agent}</b> · ${p}% · ${count(m.stories, "Done")} of ${m.stories.length} done</summary>`, "");
  o.push("| | Story | Title | Priority | Progress |", "|---|---|---|---|---|");
  for (const s of m.stories) o.push(`| ${ICON[s.status]} | ${s.id} | ${cell(s.title)} | ${s.priority} | ${PROGRESS[s.status]}% |`);
  o.push("", "</details>", "");
}

writeFileSync(OUT, o.join("\n"));
console.log(`Roadmap stories: overall ${overall}%, ${allStories.length} stories, ${recent?.length ?? 0} recent, ${upcoming.length} up next, ${blocked.length + ownerActions.length} blocked.`);
