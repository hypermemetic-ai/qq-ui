#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createConsoleHandler, validatedDashboardSnapshot } from "../src/http-app.mjs";
import { regionFingerprints, renderSessionContent } from "../src/render.mjs";

const rootId = "session-7a110000-0000-4000-8000-000000000001";
const childId = "session-7a110000-0000-4000-8000-000000000002";
const siblingId = "session-7a110000-0000-4000-8000-000000000003";
const phaseStartedAt = 1_788_000_000_000;
const legacyRows = [
  { id: rootId, project: "alpha", alias: "legacy-root", createdAt: 10 },
  { id: siblingId, project: "alpha", alias: "legacy-peer", createdAt: 20 },
];
const rawSnapshot = {
  id: rootId,
  project: "alpha",
  alias: "legacy-root",
  events: [],
  agentStatus: "idle",
  children: [],
  conversation: { nodes: [], pending: [] },
};
const validDashboard = {
  schema: "qq.dashboard/v1",
  generatedAt: phaseStartedAt + 5_000,
  projects: [{
    key: "p:alpha:",
    name: "alpha",
    label: "Alpha",
    folder: "",
    folderLabel: "",
    sessions: [{
      sessionId: rootId,
      alias: "opal",
      label: "architect",
      parentSessionId: "",
      depth: 0,
      activity: "working",
      idleForMs: null,
      workflow: "architect",
      phase: "planning",
      phaseStartedAt,
    }, {
      sessionId: childId,
      alias: "runner",
      label: "implementation",
      parentSessionId: rootId,
      depth: 1,
      activity: "working",
      idleForMs: null,
      workflow: "implementation",
      phase: "work",
      phaseStartedAt: phaseStartedAt + 1_000,
    }],
  }, {
    key: "p:beta:client",
    name: "beta",
    label: "Beta",
    folder: "client",
    folderLabel: "Client",
    sessions: [{
      sessionId: siblingId,
      alias: "birch",
      label: "qa",
      parentSessionId: "",
      depth: 0,
      activity: "idle",
      idleForMs: 500,
      workflow: null,
      phase: "none",
      phaseStartedAt: null,
    }],
  }],
  usage: { generatedAt: phaseStartedAt, providers: [] },
};
const paths = {
  canonical: `/qq/session/${rootId}`,
  projectsBase: "/qq/project",
  projectsSession: "/qq/projects",
  createSession: "/qq/project/alpha/sessions",
  switchSession: "/qq/sessions/open",
  close: `/qq/session/${rootId}/close`,
  events: `/qq/session/${rootId}/events`,
  prompt: `/qq/session/${rootId}/prompt`,
  interrupt: `/qq/session/${rootId}/interrupt`,
};

function backend() {
  return {
    read: async () => structuredClone(rawSnapshot),
    list: async () => structuredClone(legacyRows),
    create: async () => structuredClone(rawSnapshot),
    prompt: async () => structuredClone(rawSnapshot),
    interrupt: async () => structuredClone(rawSnapshot),
    close: async () => ({ id: null }),
  };
}

async function pageFor(dashboardFor) {
  const handler = createConsoleHandler(backend(), { dashboardFor });
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/qq/session/${rootId}`);
    assert.equal(response.status, 200);
    return await response.text();
  } finally {
    handler.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

function assertUnavailable(html, context) {
  assert.match(html, /class="session-traversal live-tracker live-tracker-unavailable"/, `${context}: tracker shell remains available`);
  assert.match(html, />live tracking unavailable</, `${context}: tracker failure is explicit`);
  assert.doesNotMatch(html, /class="session-token(?: |")/, `${context}: legacy picker is never restored`);
  assert.match(html, /class="new-session"/, `${context}: session creation remains available`);
}

assertUnavailable(await pageFor(undefined), "missing optional service");
assertUnavailable(await pageFor(() => { throw new Error("provider unavailable"); }), "thrown snapshot");
assertUnavailable(await pageFor(() => ({ ...validDashboard, schema: "qq.dashboard/v2" })), "unsupported schema");
assertUnavailable(await pageFor(() => ({
  ...validDashboard,
  projects: [{ ...validDashboard.projects[0], sessions: [{ ...validDashboard.projects[0].sessions[0], activity: "busy" }] }],
})), "malformed row");
assertUnavailable(await pageFor(() => ({
  ...validDashboard,
  projects: [{
    ...validDashboard.projects[0],
    sessions: [{ ...validDashboard.projects[0].sessions[0], workflow: "", phase: "none", phaseStartedAt: null }],
  }],
})), "malformed workflow row");
const emptyTracker = await pageFor(() => ({ ...validDashboard, projects: [] }));
assert.match(emptyTracker, /class="session-traversal live-tracker live-tracker-empty"/, "valid empty data keeps the tracker shell");
assert.match(emptyTracker, />no live sessions</, "valid empty data has an explicit empty state");
assert.doesNotMatch(emptyTracker, /class="session-token(?: |")/, "empty tracker never restores legacy tokens");

const usageFailure = { ...validDashboard };
Object.defineProperty(usageFailure, "usage", {
  enumerable: true,
  get() { throw new Error("provider usage cache unavailable"); },
});
const isolatedDashboard = validatedDashboardSnapshot(usageFailure);
assert.deepEqual(Object.keys(isolatedDashboard), ["schema", "projects"],
  "generatedAt and provider usage never cross the UI sheet boundary");
assert.equal("idleForMs" in isolatedDashboard.projects[1].sessions[0], false,
  "refresh-only idle duration is validated but omitted from the semantic sheet");
const html = await pageFor(() => usageFailure);
assert.match(html, /class="session-traversal live-tracker"/, "valid tracking survives provider-usage failure");
assert.doesNotMatch(html, /class="session-token(?: |")/, "live tracker is the only session picker");
assert.match(html, /class="live-tracker-project-name">Alpha</, "projects are grouped under a human project label");
assert.match(html, /class="session-id">opal<\/p>/, "current-session chrome also prefers the dashboard alias");
assert.match(html, /class="live-tracker-folder">Client</, "folder groups keep their human folder label");
const alphaGroup = html.match(/<section class="live-tracker-project"[^>]*>[\s\S]*?Alpha[\s\S]*?<\/section>/)?.[0] ?? "";
assert.match(alphaGroup, new RegExp(`data-session-id="${rootId}"[\\s\\S]*?<span class="live-tracker-face">opal</span>`),
  "root uses its alias as the primary face");
assert.match(alphaGroup, new RegExp(`data-session-id="${childId}"[^>]*data-depth="1"[\\s\\S]*?<span class="live-tracker-face">runner</span>`),
  "a child inherited into the root project remains visibly nested and alias-first");
assert.match(alphaGroup, /data-activity="working"[^>]*>working</, "activity is visible");
assert.match(alphaGroup, /data-phase="planning"[^>]*>planning</, "workflow phase is visible");
assert.match(alphaGroup, new RegExp(`<time class="live-tracker-elapsed" data-phase-started-at="${phaseStartedAt}"></time>`),
  "valid absolute phase start is emitted for browser elapsed ticking");
for (const trackerAnchor of html.matchAll(/<a class="live-tracker-session[^"]*"[^>]*>/g)) {
  assert.doesNotMatch(trackerAnchor[0], /\btitle=/, "tracker rows never add title text");
}
assert.doesNotMatch(html, new RegExp(`(?:title|aria-label)="[^"]*(?:${rootId}|${childId}|${siblingId})`, "i"),
  "physical UUIDs never enter tracker titles or aria labels");
const visibleText = html
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ");
assert.doesNotMatch(visibleText, new RegExp(`${rootId}|${childId}|${siblingId}`, "i"),
  "physical UUIDs are absent from visible text");
for (const id of [rootId, childId, siblingId]) {
  assert.match(html, new RegExp(`class="live-tracker-session[^"]*"[^>]*href="/qq/sessions/open\\?session=${encodeURIComponent(id)}"[^>]*data-session-id="${id}"`),
    "each tracker row uses the existing opaque session jump route and identity data");
}
assert.match(html, /class="new-session" action="\/qq\/project\/alpha\/sessions"/,
  "tracker mode preserves the current project new-session action");
assert.match(html, /id="session-chrome"[^>]*sse-swap="chrome"[\s\S]*?class="session-traversal live-tracker"/,
  "the tracker belongs to the existing SSE-owned chrome region");

const invalidTimestamp = structuredClone(validDashboard);
invalidTimestamp.projects[0].sessions[0].phaseStartedAt = null;
const noTimer = renderSessionContent({ ...rawSnapshot, sessions: legacyRows, dashboard: invalidTimestamp }, paths);
const rootWithoutTimer = noTimer.match(new RegExp(`<a class="live-tracker-session[^"]*"[^>]*data-session-id="${rootId}"[\\s\\S]*?<\\/a>`))?.[0] ?? "";
assert.doesNotMatch(rootWithoutTimer, /data-phase-started-at=/,
  "null phase starts do not fabricate elapsed timer markup");

const fpBase = regionFingerprints({ ...rawSnapshot, sessions: legacyRows, dashboard: validDashboard }).chrome;
const fpGeneratedTick = regionFingerprints({
  ...rawSnapshot,
  sessions: legacyRows,
  dashboard: { ...validDashboard, generatedAt: validDashboard.generatedAt + 1_000 },
}).chrome;
assert.equal(fpGeneratedTick, fpBase, "wall-clock generatedAt refreshes do not churn the chrome fingerprint");
const changedPhase = structuredClone(validDashboard);
changedPhase.projects[0].sessions[0].phase = "plan";
assert.notEqual(regionFingerprints({ ...rawSnapshot, sessions: legacyRows, dashboard: changedPhase }).chrome, fpBase,
  "semantic tracker phase changes invalidate the chrome fingerprint");

const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
assert.match(browser, /LIVE_SESSION_PICKER\s*=\s*[^;]*\.live-tracker-session\[data-session-id\]/,
  "tracker links have an explicit live-switch picker selector");
assert.match(browser, /const syncLiveTrackerElapsed = \(\) => \{[\s\S]*?Date\.now\(\)[\s\S]*?data(?:set)?[.\[]phaseStartedAt/,
  "browser elapsed display derives from the absolute phase start");
assert.match(browser, /setInterval\(syncLiveTrackerElapsed,\s*1000\)/,
  "browser ticks tracker elapsed once per second without server rerenders");
assert.match(browser, /if \(event\.defaultPrevented \|\| modifiedClick\(event\)\) return;[\s\S]*?chairGo\(url\.href, link\)/,
  "normal tracker clicks use chairGo while modified clicks retain native href behavior");
assert.match(browser, /if \(!nav \|\| nav\.classList\.contains\("live-tracker"\)\) return;/,
  "project selection cannot replace the tracker with legacy session tokens");
const pickerSource = browser.match(/const selectOverlaySession = \(link\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(pickerSource, /const tracker = link\.matches\("\.live-tracker-session"\)[\s\S]*?const canonical = tracker[\s\S]*?\? link\.href/,
  "tracker switching keeps its authoritative session-open href rather than constructing a project route");
assert.match(pickerSource, /const projectItem = tracker[\s\S]*?\? null/,
  "cross-project tracker selection does not assign identity to the previously highlighted project");
assert.match(pickerSource, /liveSwitchOrNavigate\([\s\S]*?link\.href\)/,
  "normal tracker clicks navigate by href when live switching is unavailable");

const plugin = readFileSync(new URL("../src/plugin.mjs", import.meta.url), "utf8");
assert.match(plugin, /const dashboardOf = \(\) => ctx\.get\?\.\("qq-dashboard", false\) \?\? null;/,
  "plugin resolves the optional dashboard service through a replacement-safe closure");
assert.match(plugin, /dashboardFor:\s*\(\) => dashboardOf\(\)\?\.snapshot\?\.\(\)/,
  "the handler reads the current dashboard service rather than a frozen instance");

console.log("prove-dashboard-live-tracker: pass");
