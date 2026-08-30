#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createConsoleHandler, validatedDashboardSnapshot } from "../src/http-app.mjs";
import { regionFingerprints, renderProjectRail, renderSessionContent } from "../src/render.mjs";

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
assert.doesNotMatch(html, /class="live-tracker-(?:heading|count)"/,
  "the right pane stays visually quiet without ornamental headings or counts");
assert.match(html, /class="live-tracker-project-name">Alpha</,
  "each filtered list keeps an accessible human project label");
assert.match(html, /class="session-id">opal<\/p>/, "current-session chrome also prefers the dashboard alias");
assert.match(html, /class="live-tracker-folder">Client</, "folder groups keep their human folder label");
const alphaGroup = html.match(/<section class="live-tracker-project"[^>]*>[\s\S]*?Alpha[\s\S]*?<\/section>/)?.[0] ?? "";
assert.match(alphaGroup, /data-project="alpha" data-folder=""[^>]*data-current="true"/,
  "the selected session's project is the initial right-pane filter");
assert.doesNotMatch(alphaGroup.match(/^<section[^>]*>/)?.[0] ?? "", / hidden(?:>| )/,
  "the selected project session list is visible");
const betaGroup = html.match(/<section class="live-tracker-project"[^>]*data-project="beta"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
assert.match(betaGroup.match(/^<section[^>]*>/)?.[0] ?? "", /data-folder="client"[^>]*data-current="false"[^>]* hidden>/,
  "other projects stay in the DOM but start filtered out");
assert.match(alphaGroup, new RegExp(`data-session-id="${rootId}"[\\s\\S]*?<span class="live-tracker-face">opal</span>`),
  "root uses its alias as the primary face");
assert.match(alphaGroup, new RegExp(`class="live-tracker-row live-tracker-depth-1 live-tracker-child-strip"[\\s\\S]*?data-session-id="${childId}"[^>]*data-depth="1"[\\s\\S]*?<span class="live-tracker-face">runner</span>`),
  "a direct child is an alias-first compact execution strip beneath its architect");
assert.match(alphaGroup, /<ol class="live-tracker-sessions live-tracker-sessions-hierarchical">/,
  "a project containing direct children opts into stacked hierarchy flow");
const architectPosition = alphaGroup.indexOf(`data-session-id="${rootId}"`);
const childPosition = alphaGroup.indexOf(`data-session-id="${childId}"`);
assert.ok(architectPosition >= 0 && childPosition > architectPosition,
  "the direct child is ordered beneath its owning architect");
const childStrip = alphaGroup.match(new RegExp(`<li class="live-tracker-row live-tracker-depth-1 live-tracker-child-strip"><a class="live-tracker-session"[^>]*data-session-id="${childId}"[\\s\\S]*?<\\/a><\\/li>`))?.[0] ?? "";
assert.match(childStrip, new RegExp(`^<li[\\s\\S]*?<a[^>]*href="/qq/sessions/open\\?session=${encodeURIComponent(childId)}"[\\s\\S]*?<\\/a><\\/li>$`),
  "the whole compact strip remains one focusable session link");
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
const connectorRail = renderProjectRail({
  ...rawSnapshot,
  sessions: legacyRows,
  activeProjects: legacyRows,
  dashboard: validDashboard,
}, paths);
assert.match(connectorRail, /<svg id="session-connectors" class="session-connectors" aria-hidden="true" focusable="false" hidden><\/svg>/,
  "the no-JS surface includes an inert, assistive-technology-hidden connector layer");
assert.doesNotMatch(connectorRail, /<svg[^>]*session-connectors[^>]*>[\s\S]*?<path/,
  "decorative connectors degrade to an empty hidden layer without browser geometry");

const secondChildId = "session-7a110000-0000-4000-8000-000000000004";
const stackedDashboard = structuredClone(validDashboard);
stackedDashboard.projects[0].sessions.push({
  ...stackedDashboard.projects[0].sessions[1],
  sessionId: secondChildId,
  alias: "reviewer",
});
const stackedContent = renderSessionContent({
  ...rawSnapshot,
  sessions: legacyRows,
  dashboard: stackedDashboard,
}, paths);
const stackedGroup = stackedContent.match(/<section class="live-tracker-project"[^>]*data-project="alpha"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
assert.equal([...stackedGroup.matchAll(/class="live-tracker-row live-tracker-depth-1 live-tracker-child-strip"/g)].length, 2,
  "multiple real direct children render as separate compact strips without overflow controls");
assert.ok(stackedGroup.indexOf(`data-session-id="${secondChildId}"`) > stackedGroup.indexOf(`data-session-id="${childId}"`),
  "multiple direct-child strips retain their server order beneath the architect");

const denseIds = Array.from({ length: 16 }, (_, index) =>
  `session-7a110000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`);
const denseDashboard = structuredClone(validDashboard);
denseDashboard.projects[0].sessions = denseIds.map((sessionId, index) => ({
  ...denseDashboard.projects[0].sessions[0],
  sessionId,
  alias: `dense-${index + 1}`,
  parentSessionId: "",
  depth: 0,
  phaseStartedAt: null,
}));
const denseContent = renderSessionContent({
  ...rawSnapshot,
  sessions: legacyRows,
  dashboard: denseDashboard,
}, paths);
const denseGroup = denseContent.match(/<section class="live-tracker-project"[^>]*data-project="alpha"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? "";
for (const sessionId of denseIds) {
  assert.match(denseGroup, new RegExp(`href="/qq/sessions/open\\?session=${encodeURIComponent(sessionId)}"[^>]*data-session-id="${sessionId}"`),
    "an overflowing project retains every operable session link");
}

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
const projectFilterSource = browser.match(/const filterLiveTrackerProject = \(item\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(projectFilterSource, /liveTrackerGroups\(tracker\)\.find[\s\S]*?showLiveTrackerProject\(group, \{ item \}\)/,
  "left project selection filters the dashboard-backed session group");
const overviewSource = browser.match(/const showLiveTrackerOverview = \(\{ remember = true \} = \{\}\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(overviewSource, /for \(const group of liveTrackerGroups\(tracker\)\)[\s\S]*?group\.hidden = false/,
  "overview reveals every server-ordered project group");
assert.match(overviewSource, /tracker\.dataset\.overview = "true"[\s\S]*?All project sessions/,
  "overview has explicit state and accessible all-project identity");
assert.match(overviewSource, /preserveOverviewCreateState\(tracker\)/,
  "overview does not expose a create action without a filtered project");
const emptySpaceSource = browser.match(/const clearProjectFilterFromEmptySpace = \(target\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(emptySpaceSource, /target\.closest\("\.active-projects, \.session-traversal"\)/,
  "empty-space clearing is limited to the two session chooser surfaces");
assert.match(emptySpaceSource, /target\.closest\(CHOOSER_INTERACTIVE\)/,
  "projects, sessions, forms, menus, and controls are excluded from empty-space clearing");
const connectorSource = browser.match(/const paintSessionConnectors = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(connectorSource, /for \(const group of liveTrackerGroups\(tracker\)\)[\s\S]*?createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "path"\)/,
  "connector geometry creates at most one path for each project group");
assert.match(connectorSource, /projectItem\?\.closest\("\.active-projects"\)[\s\S]*?connectorOverflowClientRect\(projectOverflow\)[\s\S]*?connectorOverflowClientRect\(tracker\)/,
  "connector endpoints are clipped to the project and session overflow clients");
const connectorGeometrySource = browser.match(/  const connectorOverflowClientRect = [\s\S]*?(?=  const connectorProjectItem)/)?.[0] ?? "";
assert.notEqual(connectorGeometrySource, "", "connector clipping helpers remain independently provable");
const geometry = runInNewContext(`(() => {
${connectorGeometrySource}
return { connectorOverflowClientRect, intersectConnectorRect };
})()`, { document: { documentElement: { clientWidth: 1024, clientHeight: 768 } } });
const overflowClient = geometry.connectorOverflowClientRect({
  clientLeft: 2,
  clientTop: 3,
  clientWidth: 100,
  clientHeight: 80,
  getBoundingClientRect: () => ({ left: 10, top: 20 }),
});
assert.deepEqual({ ...overflowClient }, { left: 12, top: 23, right: 112, bottom: 103 },
  "overflow clipping uses the content client box rather than border or rail padding");
const clippedEndpoint = geometry.intersectConnectorRect(
  { left: 5, top: 5, right: 80, bottom: 40 },
  overflowClient,
);
assert.deepEqual({ ...clippedEndpoint }, { left: 12, top: 23, right: 80, bottom: 40, width: 68, height: 17 },
  "a partially clipped endpoint is centered within only its visible scroll-client slice");
assert.equal(geometry.intersectConnectorRect(
  { left: 20, top: 1, right: 90, bottom: 22 },
  overflowClient,
), null, "a viewport-visible row clipped above its overflow client paints no connector");
assert.match(connectorSource, /projectRect\.top \+ projectRect\.height \/ 2[\s\S]*?groupRect\.top \+ groupRect\.height \/ 2/,
  "both ends use deliberate vertical centering after clipping");
assert.match(connectorSource, /`M \${startX} \${startY} H \${elbowX} V \${endY} H \${endX}`/,
  "each project uses one restrained orthogonal connector");
assert.match(browser, /new ResizeObserver\(scheduleSessionConnectors\)/,
  "connectors track project and session count geometry changes");
assert.match(browser, /addEventListener\("(?:resize|scroll)"[^\n]*scheduleSessionConnectors/,
  "connectors are rescheduled for viewport and scrolling changes");
const projectPickerSource = browser.match(/const selectOverlayProject = \(item\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(projectPickerSource, /if \(filterLiveTrackerProject\(projectItem\)\) return true;\s+const sessions/,
  "a normal project filter returns before legacy session selection or navigation");
assert.match(browser, /const filterOnlyProject = link\.matches[\s\S]*?const closesMobileRail = picker && !filterOnlyProject/,
  "filter-only project clicks keep the mobile two-pane chooser open");
assert.match(browser, /id === "session-chrome"[\s\S]*?syncLiveTrackerProjectFilter\(\)/,
  "SSE chrome refreshes preserve the chosen project filter");
const filterSyncSource = browser.match(/const syncLiveTrackerProjectFilter = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(filterSyncSource, /liveTrackerProjectFilter === LIVE_TRACKER_OVERVIEW[\s\S]*?showLiveTrackerOverview\(\{ remember: false \}\)/,
  "SSE chrome refreshes also preserve the all-project overview");
const railSyncSource = browser.match(/const syncRailAfterSwitch = \(meta\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(railSyncSource, /liveTrackerProjectFilter !== LIVE_TRACKER_OVERVIEW[\s\S]*?liveTrackerProjectFilter = projectIdentity\(\{ project, folder \}\)/,
  "selecting a session updates navigation without collapsing an active all-project overview");
const pickerSource = browser.match(/const selectOverlaySession = \(link\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(pickerSource, /const tracker = link\.matches\("\.live-tracker-session"\)[\s\S]*?const canonical = tracker[\s\S]*?\? link\.href/,
  "tracker switching keeps its authoritative session-open href rather than constructing a project route");
assert.match(pickerSource, /const projectItem = tracker[\s\S]*?\? null/,
  "cross-project tracker selection does not assign identity to the previously highlighted project");
assert.match(pickerSource, /liveSwitchOrNavigate\([\s\S]*?link\.href\)/,
  "normal tracker clicks navigate by href when live switching is unavailable");

const css = readFileSync(new URL("../assets/console.css", import.meta.url), "utf8");
assert.match(css, /\.live-tracker-project\[hidden\][\s\S]*?display:\s*none\s*!important/,
  "filtered project groups cannot be revived by the tracker flex layout");
assert.match(css, /\.nav-mode \.project-rail \{[^}]*width:\s*50%/,
  "the project pane retains its original half-width");
assert.match(css, /\.nav-mode \.session-traversal \{[^}]*width:\s*50%/,
  "the session pane retains its original half-width");
assert.doesNotMatch(css, /\.nav-mode \.project-rail \{[^}]*width:\s*42%|\.nav-mode \.session-traversal \{[^}]*width:\s*58%/,
  "the visual correction removes the ornamental pane proportions");
assert.doesNotMatch(css, /\.live-tracker-session-current\s*\{[^}]*box-shadow/,
  "current sessions keep the original understated treatment without an inset bar");
const connectorStyle = css.match(/\.session-connectors path \{([^}]*)\}/)?.[1] ?? "";
assert.match(connectorStyle, /fill:\s*none/,
  "connectors are unfilled lines rather than decorative shapes");
assert.match(connectorStyle, /stroke-width:\s*\.(?:[0-9]+)/,
  "connectors remain thinner than one CSS pixel");
assert.doesNotMatch(connectorStyle, /background|gradient|border|box-shadow/i,
  "connector styling adds no cards, gradients, borders, or backgrounds");
const overviewStyle = css.match(/\.live-tracker\[data-overview="true"\] \{([^}]*)\}/)?.[1] ?? "";
assert.match(overviewStyle, /flex-direction:\s*column/,
  "overview preserves project order in a simple vertical flow");
assert.doesNotMatch(overviewStyle, /background|gradient|border|box-shadow/i,
  "overview grouping adds spacing only, not ornamental chrome");
assert.match(css, /\.session-connectors\s*\{[^}]*pointer-events:\s*none/,
  "decorative connector geometry can never steal chooser taps");
const overviewSessionsStyle = css.match(/\.live-tracker\[data-overview="true"\] \.live-tracker-sessions \{([^}]*)\}/)?.[1] ?? "";
assert.match(overviewSessionsStyle, /width:\s*100%[\s\S]*?flex-direction:\s*column[\s\S]*?align-items:\s*stretch/,
  "overview stacks wide project session sets vertically so every link stays reachable");
const hierarchyStyle = css.match(/\.live-tracker-sessions-hierarchical \{([^}]*)\}/)?.[1] ?? "";
assert.match(hierarchyStyle, /flex-direction:\s*column[\s\S]*?align-items:\s*stretch/,
  "architects and any number of direct children stack in ownership order");
const childStripStyle = css.match(/\.live-tracker-child-strip \.live-tracker-session \{([^}]*)\}/)?.[1] ?? "";
assert.match(childStripStyle, /min-height:\s*1\.65rem[\s\S]*?flex-direction:\s*row/,
  "direct children collapse to compact one-line execution strips");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session::before \{[^}]*border-bottom:\s*\.625px solid[^}]*border-left:\s*\.625px solid/,
  "each direct child has one thin orthogonal relationship branch");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-workflow,[\s\S]*?\.live-tracker-child-strip \.live-tracker-elapsed \{ display:\s*none; \}/,
  "child strips retain identity, role, and activity without gratuitous workflow timing metadata");
assert.doesNotMatch(childStripStyle, /background|gradient|box-shadow/i,
  "child hierarchy is expressed without cards or decorative surfaces");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-face \{[^}]*font-size:\s*\.68rem/,
  "child identity typography remains smaller and quieter than its architect");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session:focus-visible \{[^}]*outline:\s*1px solid/,
  "the reduced child strip retains a visible keyboard focus indicator");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session-current \{[^}]*background:\s*transparent/,
  "the compact active state stays understated and card-free");
assert.match(browser, /\.new-session:not\(\[hidden\]\)/,
  "overview's hidden project-specific create action cannot be invoked by shortcut");

const plugin = readFileSync(new URL("../src/plugin.mjs", import.meta.url), "utf8");
assert.match(plugin, /const dashboardOf = \(\) => ctx\.get\?\.\("qq-dashboard", false\) \?\? null;/,
  "plugin resolves the optional dashboard service through a replacement-safe closure");
assert.match(plugin, /dashboardFor:\s*\(\) => dashboardOf\(\)\?\.snapshot\?\.\(\)/,
  "the handler reads the current dashboard service rather than a frozen instance");

console.log("prove-dashboard-live-tracker: pass");
