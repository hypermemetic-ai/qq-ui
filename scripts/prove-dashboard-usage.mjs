#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatedDashboardSnapshot } from "../src/http-app.mjs";
import {
  regionFingerprints,
  renderSessionContent,
  renderUsageView,
  SSE_REGION_NAMES,
} from "../src/render.mjs";

const sessionId = "session-7c440000-0000-4000-8000-000000000001";
const observedAt = 1_788_000_000_000;
const resetAt = 1_788_600_000_000;
const project = {
  key: "p:alpha:", name: "alpha", label: "Alpha", folder: "", folderLabel: "",
  sessions: [{
    sessionId, alias: "opal", label: "architect", parentSessionId: "", depth: 0,
    activity: "working", idleForMs: null, workflow: "architect", phase: "planning",
    phaseStartedAt: observedAt,
  }],
};
const base = { schema: "qq.dashboard/v1", generatedAt: observedAt, projects: [project] };
const providers = [{
  id: "qwen", label: "Qwen", state: "estimated", observedAt,
  meters: [{ id: "five-hour", label: "5h", usedRatio: 0.5, resetAt: null, detail: "5000 / 10000 estimated" },
    { id: "weekly", label: "7d", usedRatio: 1.1, resetAt, detail: "44000 / 40000 estimated" }],
  private: "discard",
}, {
  id: "codex", label: "Codex", state: "ready", observedAt,
  meters: [{ id: "weekly", label: "7d", usedRatio: 0.25, resetAt, detail: "", extra: true }],
}, {
  id: "grok", label: "Grok", state: "unavailable", observedAt: null, meters: [],
}];
const candidate = {
  ...base,
  usage: { generatedAt: observedAt + 5_000, providers, unknown: "discard" },
  unknown: "discard",
};
const dashboard = validatedDashboardSnapshot(candidate);
assert.ok(dashboard, "dashboard fixture validates");
assert.equal(dashboard.schema, "qq.dashboard/v1", "public schema is not bumped");
assert.deepEqual(Object.keys(dashboard), ["schema", "projects", "usage"], "only known dashboard fields cross the boundary");
assert.deepEqual(Object.keys(dashboard.usage), ["generatedAt", "providers"], "only known usage fields cross the boundary");
assert.deepEqual(dashboard.usage.providers.map(({ label }) => label), ["Codex", "Grok", "Qwen"], "providers normalize by label");
assert.deepEqual(Object.keys(dashboard.usage.providers[0]), ["id", "label", "state", "observedAt", "meters"]);
assert.deepEqual(Object.keys(dashboard.usage.providers[0].meters[0]), ["id", "label", "usedRatio", "resetAt", "detail"]);
assert.equal(dashboard.usage.providers[2].meters[1].usedRatio, 1.1, "ratios above one are preserved");
assert.ok(Object.isFrozen(dashboard) && Object.isFrozen(dashboard.usage)
  && Object.isFrozen(dashboard.usage.providers) && Object.isFrozen(dashboard.usage.providers[0])
  && Object.isFrozen(dashboard.usage.providers[0].meters[0]), "the defensive copy is deeply frozen");
providers[1].label = "mutated";
providers[0].meters[1].detail = "mutated";
assert.equal(dashboard.usage.providers[0].label, "Codex");
assert.equal(dashboard.usage.providers[2].meters[1].detail, "44000 / 40000 estimated", "producer mutation cannot alter the validated sheet");

const absent = validatedDashboardSnapshot(base);
assert.ok(absent && !("usage" in absent), "absent usage remains absent");
const validEmpty = validatedDashboardSnapshot({ ...base, usage: { generatedAt: observedAt, providers: [] } });
assert.deepEqual(validEmpty.usage, { generatedAt: observedAt, providers: [] }, "valid empty usage remains distinct");
const throwingUsage = { ...base };
Object.defineProperty(throwingUsage, "usage", { enumerable: true, get() { throw new Error("cache path must stay private"); } });
assert.ok(validatedDashboardSnapshot(throwingUsage) && !("usage" in validatedDashboardSnapshot(throwingUsage)),
  "a throwing usage property is isolated from valid tracking");

const invalidUsageCases = [
  null,
  [],
  { generatedAt: "soon", providers: [] },
  { generatedAt: -1, providers: [] },
  { generatedAt: Number.NaN, providers: [] },
  { generatedAt: Number.MAX_SAFE_INTEGER, providers: [] },
  { generatedAt: observedAt, providers: null },
  { generatedAt: observedAt, providers: [null] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], id: 1 }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], label: "" }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], state: "fresh" }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], observedAt: Infinity }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], meters: {} }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[2], observedAt }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[2], meters: candidate.usage.providers[1].meters }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], meters: [{ ...candidate.usage.providers[1].meters[0], usedRatio: -0.1 }] }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], meters: [{ ...candidate.usage.providers[1].meters[0], usedRatio: Infinity }] }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], meters: [{ ...candidate.usage.providers[1].meters[0], resetAt: "later" }] }] },
  { generatedAt: observedAt, providers: [{ ...candidate.usage.providers[1], meters: [{ ...candidate.usage.providers[1].meters[0], detail: 25 }] }] },
];
for (const [index, usage] of invalidUsageCases.entries()) {
  const isolated = validatedDashboardSnapshot({ ...base, usage });
  assert.ok(isolated, `malformed usage ${index} does not suppress the tracker`);
  assert.equal("usage" in isolated, false, `malformed usage ${index} is discarded as a unit`);
  assert.equal(isolated.projects[0].sessions[0].alias, "opal");
}

const hostile = validatedDashboardSnapshot({ ...base, usage: {
  generatedAt: observedAt,
  providers: [{
    id: "private-provider-id", label: '<img src=x onerror="alert(1)">', state: "stale", observedAt,
    meters: [{ id: "private-meter-id", label: "7d<script>", usedRatio: 1.1, resetAt,
      detail: '<script>alert("detail")</script> 11000 / 10000' }],
  }],
} });
const hostileHtml = renderUsageView({ dashboard: hostile });
assert.doesNotMatch(hostileHtml, /<(?:script|img)\b/i, "hostile display strings cannot create markup");
assert.match(hostileHtml, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/, "hostile provider label is rendered as text");
assert.match(hostileHtml, /&lt;script&gt;alert\(&quot;detail&quot;\)&lt;\/script&gt;/, "hostile detail is rendered as text");
assert.doesNotMatch(hostileHtml, /private-provider-id|private-meter-id/, "provider and meter IDs are never exposed");
assert.match(hostileHtml, />110%<\//, "the numeric value is not clamped");
assert.match(hostileHtml, /aria-label="110% used"/, "assistive text preserves over-limit meaning");
assert.match(hostileHtml, /class="usage-meter-fill" style="width:100%"/, "only the visual bar is clamped");
assert.match(hostileHtml, /<time[^>]+datetime="2026-[^"]+"[^>]*>reset /, "known reset is a semantic readable time");
assert.match(hostileHtml, /observed <time[^>]+datetime=/, "observation semantics are visible");
assert.doesNotMatch(hostileHtml, /title=/, "usage never leaks implementation data through title text");
const extremeHtml = renderUsageView({ dashboard: validatedDashboardSnapshot({ ...base, usage: {
  generatedAt: observedAt,
  providers: [{ id: "edge", label: "Edge", state: "ready", observedAt,
    meters: [{ id: "tiny", label: "tiny", usedRatio: .000001, resetAt: null, detail: "" },
      { id: "huge", label: "huge", usedRatio: Number.MAX_VALUE, resetAt: null, detail: "" }] }],
} }) });
assert.match(extremeHtml, />0\.00010%<\//, "small finite truth is not rounded into fake zero");
assert.doesNotMatch(extremeHtml, /Infinity%/, "large finite truth remains numeric rather than overflowing display math");

const emptyHtml = renderUsageView({ dashboard: validEmpty });
assert.match(emptyHtml, /Usage is not available yet\./, "valid empty providers has a deliberate not-yet state");
assert.doesNotMatch(emptyHtml, /0%|usage-meter/, "valid empty providers never invents zero");
const absentHtml = renderUsageView({ dashboard: absent });
assert.match(absentHtml, /Usage data is unavailable\./, "absent or malformed service uses an unavailable fallback");
assert.doesNotMatch(absentHtml, /not available yet|0%|usage-meter/, "service absence is not represented as valid empty truth");
const unavailableHtml = renderUsageView({ dashboard: validatedDashboardSnapshot({ ...base, usage: {
  generatedAt: observedAt, providers: [{ id: "grok", label: "Grok", state: "unavailable", observedAt: null, meters: [] }],
} }) });
assert.match(unavailableHtml, /Grok[\s\S]*unavailable/);
assert.doesNotMatch(unavailableHtml, /0%|usage-meter|reset /, "unavailable provider has no fake meter or reset");
const usageHtml = renderUsageView({ dashboard });
assert.match(usageHtml, />5h<\/span>/);
assert.match(usageHtml, />7d<\/span>/);
assert.match(usageHtml, />estimated<\/span>/);
assert.match(usageHtml, />ready<\/span>/);
assert.match(usageHtml, />unavailable<\/span>/);
assert.match(usageHtml, />25%<\//);
assert.match(usageHtml, />110%<\//);
assert.match(usageHtml, /5000 \/ 10000 estimated/);
assert.equal((usageHtml.match(/>reset /g) ?? []).length, 2, "only known resets are shown");

const paths = {
  canonical: `/qq/session/${sessionId}`,
  prompt: `/qq/session/${sessionId}/prompt`,
  workflow: `/qq/session/${sessionId}/workflow`,
};
const snapshot = {
  id: sessionId, project: "alpha", alias: "opal", events: [], agentStatus: "idle",
  conversation: { nodes: [], pending: [] }, children: [], sessionMode: "architect",
  workflows: ["architect", "iterate", "find", "base"], dashboard,
};
for (const dashboardCase of [absent, validatedDashboardSnapshot({ ...base, usage: invalidUsageCases[2] }), dashboard]) {
  const content = renderSessionContent({ ...snapshot, dashboard: dashboardCase }, paths);
  assert.match(content, /<details class="workflows-menu console-menu" data-mode="architect">/, "the existing control is generalized rather than duplicated");
  assert.match(content, /<summary aria-label="Console menu"[^>]*>architect<\/summary>/, "current workflow summary semantics remain intact");
  assert.match(content, /<a class="console-menu-choice usage-choice"[^>]*>usage<\/a>/, "usage is an exact lowercase general action");
  assert.match(content, /<form class="workflows-menu-list"[^>]*action="\/qq\/session\/[^"]+\/workflow" method="post"[\s\S]*name="workflow" value="architect"[\s\S]*name="workflow" value="iterate"[\s\S]*name="workflow" value="find"/, "workflow POST values and progressive form fallback remain exact");
  assert.doesNotMatch(content.match(/<a class="console-menu-choice usage-choice"[^>]*>/)?.[0] ?? "", /prompt|method=|type="submit"/, "usage is not a workflow submission");
  assert.match(content, /id="session-usage"[^>]*sse-swap="usage"/, "usage has an independent incremental region");
}
const usageOnlyMenu = renderSessionContent({ ...snapshot, workflows: undefined, dashboard: absent }, paths);
assert.match(usageOnlyMenu, /<summary aria-label="Console menu"[^>]*>architect<\/summary>/,
  "current workflow remains the summary when only the general action is available");
assert.match(usageOnlyMenu, />usage<\/a>/, "usage remains progressively available without a workflow catalog");
assert.doesNotMatch(usageOnlyMenu, /class="workflows-menu-list"/, "missing workflow catalog does not invent a submission");
assert.ok(SSE_REGION_NAMES.includes("usage"), "usage is an SSE region");

const fp = regionFingerprints(snapshot);
const generatedTick = structuredClone(dashboard);
generatedTick.usage.generatedAt += 30_000;
const generatedFp = regionFingerprints({ ...snapshot, dashboard: generatedTick });
assert.equal(generatedFp.usage, fp.usage, "usage generatedAt alone does not churn the view");
assert.equal(generatedFp.chrome, fp.chrome, "usage timestamps never churn general menu chrome");
const changedRatio = structuredClone(dashboard);
changedRatio.usage.providers[2].meters[1].usedRatio = 1.2;
const ratioFp = regionFingerprints({ ...snapshot, dashboard: changedRatio });
assert.notEqual(ratioFp.usage, fp.usage, "meaningful ratio changes refresh usage");
assert.equal(ratioFp.chrome, fp.chrome, "meaningful usage changes still leave menu chrome intact");
const changedObserved = structuredClone(dashboard);
changedObserved.usage.providers[0].observedAt += 1_000;
assert.notEqual(regionFingerprints({ ...snapshot, dashboard: changedObserved }).usage, fp.usage, "visible observations refresh usage");
const changedReset = structuredClone(dashboard);
changedReset.usage.providers[0].meters[0].resetAt += 1_000;
assert.notEqual(regionFingerprints({ ...snapshot, dashboard: changedReset }).usage, fp.usage, "visible resets refresh usage");
const changedDetail = structuredClone(dashboard);
changedDetail.usage.providers[2].meters[1].detail = "48000 / 40000 estimated";
assert.notEqual(regionFingerprints({ ...snapshot, dashboard: changedDetail }).usage, fp.usage, "visible detail refreshes usage");

const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
assert.match(browser, /consoleMenuChoices[\s\S]*?\.console-menu-choice[\s\S]*?\.workflows-choice/,
  "general menu keyboard traversal includes usage and workflows");
assert.match(browser, /showUsageView[\s\S]*?dataset\.consoleView = "usage"/,
  "usage selection is client view state, not a POST");
assert.match(browser, /usage-choice[\s\S]*?preventDefault[\s\S]*?showUsageView/,
  "enhanced usage activation preserves progressive anchor fallback");
assert.match(browser, /!target\?\.closest\("\.console-menu"\)[\s\S]*?closeConsoleMenu/,
  "outside click closes the general menu");
assert.doesNotMatch(browser, /fetch\([^\n]*usage|setInterval\([^\n]*usage|EventSource\([^\n]*usage/i,
  "usage adds no client polling or I/O");

console.log("dashboard usage validation, menu, rendering, and incremental proof passed");
