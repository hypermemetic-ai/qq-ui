#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { renderSessionContent } from "../src/render.mjs";

const architectId = "session-7a220000-0000-4000-8000-000000000001";
const childId = "session-7a220000-0000-4000-8000-000000000002";
const paths = {
  switchSession: "/qq/sessions/open",
  createSession: "/qq/project/alpha/sessions",
};
const baseSnapshot = {
  id: architectId,
  project: "alpha",
  alias: "arch",
  events: [],
  agentStatus: "idle",
  children: [],
  conversation: { nodes: [], pending: [] },
};
const architect = {
  sessionId: architectId,
  alias: "arch",
  label: "architect",
  parentSessionId: "",
  depth: 0,
  activity: "idle",
  workflow: "architect",
  phase: "work",
  phaseStartedAt: 1_788_000_000_000,
};
const child = {
  sessionId: childId,
  alias: "runner",
  label: "implementation",
  parentSessionId: architectId,
  depth: 1,
  activity: "working",
  workflow: "implementation",
  phase: "work",
  phaseStartedAt: 1_788_000_030_000,
};

function contentFor(rows) {
  return renderSessionContent({
    ...baseSnapshot,
    dashboard: {
      schema: "qq.dashboard/v1",
      projects: [{
        key: "p:alpha:",
        name: "alpha",
        label: "Alpha",
        folder: "",
        folderLabel: "",
        sessions: rows,
      }],
    },
  }, paths);
}

function stripFor(html, id) {
  return html.match(new RegExp(`<li class="live-tracker-row[^"]*"><a class="live-tracker-session[^"]*"[^>]*data-session-id="${id}"[\\s\\S]*?<\\/a><\\/li>`))?.[0] ?? "";
}

// Delegated child-only work belongs on the child. The architect remains visibly idle
// and may not borrow the parent's semantic work-phase clock.
const childOnly = contentFor([architect, child]);
const childOnlyArchitect = stripFor(childOnly, architectId);
const childOnlyChild = stripFor(childOnly, childId);
assert.match(childOnlyArchitect, /data-activity="idle"[^>]*>idle</,
  "delegated child work leaves the architect's own idle state visible");
assert.doesNotMatch(childOnlyArchitect, />work<|>working<|data-phase-started-at=/,
  "an idle architect does not duplicate delegated work state or elapsed time");
assert.match(childOnlyChild, /class="live-tracker-phase"[^>]*>implementation</,
  "the child status space contains its authoritative workflow role");
assert.doesNotMatch(childOnlyChild, /data-activity="working"[^>]*>working</,
  "authoritative child workflow metadata replaces generic working text");
assert.match(childOnlyChild, new RegExp(`data-phase-started-at="${child.phaseStartedAt}"`),
  "the child row owns its active-work clock");
assert.equal((childOnly.match(/data-phase-started-at=/g) ?? []).length, 1,
  "child-only work emits exactly one elapsed-time source");

// Architect-only and truly concurrent work use each row's own source.
const architectOnly = contentFor([
  { ...architect, activity: "working", phase: "planning" },
  { ...child, activity: "idle" },
]);
assert.match(stripFor(architectOnly, architectId), new RegExp(`data-phase-started-at="${architect.phaseStartedAt}"`),
  "architect-only work emits the architect's own clock");
const architectOnlyChild = stripFor(architectOnly, childId);
assert.match(architectOnlyChild, /data-activity="idle"[^>]*>idle</,
  "an idle child keeps its meaningful own state instead of a stale workflow role");
assert.doesNotMatch(architectOnlyChild, /data-phase-started-at=/,
  "an idle child never emits elapsed time");

const concurrent = contentFor([{ ...architect, activity: "working" }, child]);
assert.match(stripFor(concurrent, architectId), new RegExp(`data-phase-started-at="${architect.phaseStartedAt}"`),
  "a genuinely working architect keeps its own clock during concurrency");
assert.match(stripFor(concurrent, childId), new RegExp(`data-phase-started-at="${child.phaseStartedAt}"`),
  "a concurrently working child keeps its distinct clock");
assert.equal((concurrent.match(/data-phase-started-at=/g) ?? []).length, 2,
  "true concurrency emits one timer per working row");
const noAliasChild = { ...child, alias: "", label: "mini-research", workflow: "mini-research" };
const noAliasStrip = stripFor(contentFor([architect, noAliasChild]), childId);
assert.doesNotMatch(noAliasStrip, /<span class="live-tracker-phase"[^>]*>mini-research</,
  "a no-alias child's role is not duplicated beside the same identity");
assert.match(noAliasStrip, /class="live-tracker-elapsed"[^>]*data-solo="true"/,
  "a no-alias child marks its standalone timer to avoid a leading separator");

// A child without workflow metadata keeps a truthful generic fallback and never
// turns its descriptive label into fabricated phase metadata.
const fallbackChild = { ...child, label: "helper", workflow: null, phase: "none", phaseStartedAt: null };
const fallbackStrip = stripFor(contentFor([architect, fallbackChild]), childId);
assert.match(fallbackStrip, /data-activity="working"[^>]*>working</,
  "missing child workflow metadata falls back to its own activity");
assert.doesNotMatch(fallbackStrip, /class="live-tracker-phase"[^>]*>helper</,
  "descriptive labels are not fabricated into workflow phases");

for (const role of ["qa", "mini-research", "mini-docs"]) {
  const roleStrip = stripFor(contentFor([architect, { ...child, label: role, workflow: role }]), childId);
  assert.match(roleStrip, new RegExp(`class="live-tracker-phase"[^>]*>${role}<`),
    `${role} occupies child status space`);
  assert.doesNotMatch(roleStrip, /data-activity="working"[^>]*>working</,
    `${role} is not accompanied by redundant generic activity text`);
}

// Boundary formatting is completed, single-unit time only.
const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const elapsedSource = browser.match(/  const formatLiveTrackerElapsed = [\s\S]*?(?=  let liveTrackerElapsedTimer)/)?.[0] ?? "";
assert.notEqual(elapsedSource, "", "elapsed formatter and threshold scheduler remain independently provable");
const elapsed = runInNewContext(`(() => {\n${elapsedSource}\nreturn { formatLiveTrackerElapsed, nextLiveTrackerElapsedUpdate };\n})()`);
assert.deepEqual([
  elapsed.formatLiveTrackerElapsed(0),
  elapsed.formatLiveTrackerElapsed(59_999),
  elapsed.formatLiveTrackerElapsed(60_000),
  elapsed.formatLiveTrackerElapsed(3_599_999),
  elapsed.formatLiveTrackerElapsed(3_600_000),
  elapsed.formatLiveTrackerElapsed(12_345_678),
], ["", "", "1m", "59m", "1h", "3h"],
"elapsed metadata uses floored completed minutes/hours and never seconds or compound units");
assert.deepEqual([
  elapsed.nextLiveTrackerElapsedUpdate(59_999),
  elapsed.nextLiveTrackerElapsedUpdate(60_000),
  elapsed.nextLiveTrackerElapsedUpdate(3_599_999),
  elapsed.nextLiveTrackerElapsedUpdate(3_600_000),
], [1, 60_000, 1, 3_600_000],
"the scheduler wakes exactly at minute/hour display thresholds without one-second polling");

const elapsedRuntimeSource = browser.match(/  const formatLiveTrackerElapsed = [\s\S]*?(?=  const confirmingClose)/)?.[0] ?? "";
assert.notEqual(elapsedRuntimeSource, "", "the live elapsed updater remains executable in isolation");
const elapsedRuntime = runInNewContext(`(() => {
const startedAt = 1_788_000_000_000;
let now = startedAt + 59_999;
let callback = null;
let delay = null;
let timerId = 0;
const time = { dataset: { phaseStartedAt: String(startedAt) }, textContent: "stale", hidden: false };
const document = { querySelectorAll: () => [time] };
const Date = { now: () => now };
const clearTimeout = () => {};
const setTimeout = (next, milliseconds) => {
  callback = next;
  delay = milliseconds;
  timerId += 1;
  return timerId;
};
${elapsedRuntimeSource}
const snapshot = () => ({ text: time.textContent, hidden: time.hidden, delay });
syncLiveTrackerElapsed();
const beforeMinute = snapshot();
now += 1;
callback();
const atMinute = snapshot();
now = startedAt + 3_599_999;
syncLiveTrackerElapsed();
const beforeHour = snapshot();
now += 1;
callback();
const atHour = snapshot();
return { beforeMinute, atMinute, beforeHour, atHour };
})()`);
assert.deepEqual({
  beforeMinute: { ...elapsedRuntime.beforeMinute },
  atMinute: { ...elapsedRuntime.atMinute },
  beforeHour: { ...elapsedRuntime.beforeHour },
  atHour: { ...elapsedRuntime.atHour },
}, {
  beforeMinute: { text: "", hidden: true, delay: 1 },
  atMinute: { text: "1m", hidden: false, delay: 60_000 },
  beforeHour: { text: "59m", hidden: false, delay: 1 },
  atHour: { text: "1h", hidden: false, delay: 3_600_000 },
}, "the rendered timer updates itself across minute and hour thresholds without reload or rapid polling");
assert.doesNotMatch(browser, /setInterval\(syncLiveTrackerElapsed,\s*1000\)/,
  "elapsed metadata is not needlessly refreshed every second");
assert.match(browser, /time\.hidden = !formatted/,
  "sub-minute elapsed values leave no separator or empty metadata artifact");
assert.match(browser, /id === "session-chrome"[\s\S]*?syncLiveTrackerElapsed\(\)/,
  "dynamic chrome replacement restarts elapsed threshold scheduling");

console.log("prove-strip-metadata: pass");
