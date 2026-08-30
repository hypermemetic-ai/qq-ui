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
assert.match(connectorRail, /<nav class="active-projects"[^>]*aria-keyshortcuts="ArrowUp ArrowDown Enter Space"[^>]*tabindex="0">/,
  "the project chooser surface exposes a focused keyboard route to the all-project overview");

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
const chooserBehaviorSource = browser.match(/  const CHOOSER_INTERACTIVE = [\s\S]*?(?=  const sessionEventsUrl)/)?.[0] ?? "";
assert.notEqual(chooserBehaviorSource, "", "empty-space behavior remains independently provable");
assert.match(chooserBehaviorSource, /closest\?\.\("#project-rail, \.active-projects"\)/,
  "empty-space clearing includes the full left rail and its project-nav padding");
assert.match(chooserBehaviorSource, /closest\?\.\("#inactive-project-tree"\)[\s\S]*?return null/,
  "the whole inactive file-tree region is excluded before rail-surface classification");
assert.match(chooserBehaviorSource, /projectChooserAction\(target, surface\)/,
  "empty-space clearing classifies actionable descendants before changing views");
const chooserBehavior = runInNewContext(`(() => {
class Element {
  constructor(kind, parent = null, actionable = false) {
    this.kind = kind;
    this.parent = parent;
    this.actionable = actionable;
  }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (selector === "#project-rail, .active-projects") {
        if (node.kind === "rail" || node.kind === "nav") return node;
      } else if (selector === "#inactive-project-tree") {
        if (node.kind === "file-tree") return node;
      } else if (selector === ".active-projects li") {
        if (node.kind === "project-row") return node;
      } else if (node.actionable) {
        return node;
      }
    }
    return null;
  }
}
let overviewCount = 0;
const desktopChair = () => true;
const navMode = () => false;
const showLiveTrackerOverview = () => { overviewCount += 1; return true; };
${chooserBehaviorSource}
const rail = new Element("rail");
const nav = new Element("nav", rail, true);
const navPadding = new Element("padding", nav);
const projectRow = new Element("project-row", nav);
const projectRowGutter = new Element("project-row-gutter", projectRow);
const projectLink = new Element("project-link", projectRow, true);
const projectLabel = new Element("project-label", projectLink);
const closeButton = new Element("close", rail, true);
const closeMark = new Element("close-mark", closeButton);
const rightSession = new Element("session", null, true);
const sessionLabel = new Element("session-label", rightSession);
const menu = new Element("menu", rail, true);
const menuPadding = new Element("menu-padding", menu);
const fileTree = new Element("file-tree", rail);
const treeColumns = new Element("tree-columns", fileTree);
const treePadding = new Element("tree-padding", treeColumns);
const treeLoading = new Element("tree-loading", treeColumns);
const treeEmptyColumn = new Element("tree-empty-column", treeColumns);
const keyEvent = (target, key, extras = {}) => ({
  target,
  key,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  preventDefault() { this.defaultPrevented = true; },
  ...extras,
});
const result = {
  railPadding: clearProjectFilterFromEmptySpace(rail),
  navPadding: clearProjectFilterFromEmptySpace(navPadding),
  projectRow: clearProjectFilterFromEmptySpace(projectRowGutter),
  projectLink: clearProjectFilterFromEmptySpace(projectLabel),
  closeControl: clearProjectFilterFromEmptySpace(closeMark),
  sessionStrip: clearProjectFilterFromEmptySpace(sessionLabel),
  menuControl: clearProjectFilterFromEmptySpace(menuPadding),
  fileTreeSurface: clearProjectFilterFromEmptySpace(fileTree),
  fileTreePadding: clearProjectFilterFromEmptySpace(treePadding),
  fileTreeLoading: clearProjectFilterFromEmptySpace(treeLoading),
  fileTreeEmpty: clearProjectFilterFromEmptySpace(treeEmptyColumn),
};
const keyboard = keyEvent(nav, "Enter");
result.keyboard = clearProjectFilterFromChooserKey(keyboard);
result.keyboardPrevented = keyboard.defaultPrevented;
const spaceKeyboard = keyEvent(nav, " ");
result.spaceKeyboard = clearProjectFilterFromChooserKey(spaceKeyboard);
result.spaceKeyboardPrevented = spaceKeyboard.defaultPrevented;
const childKeyboard = keyEvent(projectLink, "Enter");
result.childKeyboard = clearProjectFilterFromChooserKey(childKeyboard);
result.childKeyboardPrevented = childKeyboard.defaultPrevented;
const modifiedKeyboard = keyEvent(nav, "Enter", { ctrlKey: true });
result.modifiedKeyboard = clearProjectFilterFromChooserKey(modifiedKeyboard);
result.overviewCount = overviewCount;
return result;
})()`);
assert.match(browser, /if \(drawerIsOpen\(\)\) \{[\s\S]*?return;\n    \}\n    if \(clearProjectFilterFromChooserKey\(event\)\) return;/,
  "modal and drawer keyboard guards run before chooser-background activation");
assert.match(browser, /!event\.defaultPrevented && !modifiedClick\(event\) && clearProjectFilterFromEmptySpace\(target\)/,
  "ordinary pointer and synthesized touch clicks reach the guarded empty-surface action");
assert.deepEqual({ ...chooserBehavior }, {
  railPadding: true,
  navPadding: true,
  projectRow: false,
  projectLink: false,
  closeControl: false,
  sessionStrip: false,
  menuControl: false,
  fileTreeSurface: false,
  fileTreePadding: false,
  fileTreeLoading: false,
  fileTreeEmpty: false,
  keyboard: true,
  keyboardPrevented: true,
  spaceKeyboard: true,
  spaceKeyboardPrevented: true,
  childKeyboard: false,
  childKeyboardPrevented: false,
  modifiedKeyboard: false,
  overviewCount: 4,
}, "only genuine left chooser space, or the focused chooser landmark, enters overview");
const connectorSource = browser.match(/const paintSessionConnectors = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(connectorSource, /for \(const group of liveTrackerGroups\(tracker\)\)[\s\S]*?createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "path"\)/,
  "connector geometry creates at most one path for each project group");
assert.match(connectorSource, /projectItem\?\.closest\("\.active-projects"\)[\s\S]*?connectorOverflowClientRect\(projectOverflow\)[\s\S]*?connectorOverflowClientRect\(tracker\)/,
  "connector endpoints are clipped to the project and session overflow clients");
const connectorGeometrySource = browser.match(/  const connectorOverflowClientRect = [\s\S]*?(?=  const connectorProjectItem)/)?.[0] ?? "";
assert.notEqual(connectorGeometrySource, "", "connector clipping helpers remain independently provable");
const geometry = runInNewContext(`(() => {
${connectorGeometrySource}
return { connectorOverflowClientRect, intersectConnectorRect, connectorPathData };
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
assert.match(connectorGeometrySource, /projectRect\.top \+ projectRect\.height \/ 2[\s\S]*?groupRect\.top \+ groupRect\.height \/ 2/,
  "both ends use deliberate vertical centering after clipping");
assert.match(connectorGeometrySource, /if \(!narrow\)[\s\S]*?H \$\{elbowX\} V \$\{endY\} H \$\{endX\}/,
  "desktop uses one restrained orthogonal cross-column connector");
assert.match(connectorGeometrySource, /branchInset = Math\.min\(12, groupRect\.width \/ 2\)[\s\S]*?H \$\{branchX\} V \$\{endY\} H \$\{endX\}/,
  "narrow geometry turns inside the session group instead of tracing the 50/50 divider");
assert.match(connectorSource, /connectorPathData\(projectRect, groupRect, !desktopChair\(\)\)/,
  "connector painting selects geometry from the live responsive layout");
assert.doesNotMatch(connectorSource, /!desktopChair\(\)[\s\S]{0,40}!navMode\(\)/,
  "narrow connector painting is not suppressed outside one transient chair mode");
assert.match(connectorSource, /document\.querySelector\("\.live-tracker"\)/,
  "connector painting runs for the ordinary selected-project tracker as well as overview");
assert.doesNotMatch(connectorSource, /live-tracker\[data-overview/,
  "selected-project focus is not gated out of connector painting");
const clippedDesktopPath = geometry.connectorPathData(
  { left: 12, top: 23, right: 80, bottom: 40, width: 68, height: 17 },
  { left: 120, top: 50, right: 300, bottom: 110, width: 180, height: 60 },
  false,
);
assert.deepEqual({ ...clippedDesktopPath }, {
  d: "M 80.5 31.5 H 100.5 V 80.5 H 120.5",
  layout: "desktop",
}, "desktop connector geometry remains centered and orthogonal");
const clippedNarrowPath = geometry.connectorPathData(
  { left: 12, top: 23, right: 180, bottom: 40, width: 168, height: 17 },
  { left: 211, top: 50, right: 376, bottom: 110, width: 165, height: 60 },
  true,
);
assert.deepEqual({ ...clippedNarrowPath }, {
  d: "M 180.5 31.5 H 223.5 V 80.5 H 211.5",
  layout: "narrow",
}, "narrow connector geometry has a visible target bracket inside the session group");
const connectorPaint = runInNewContext(`(() => {
class Element {}
class HTMLElement extends Element {
  constructor(rect = {}, client = {}) {
    super();
    this.rect = rect;
    this.clientLeft = client.left ?? 0;
    this.clientTop = client.top ?? 0;
    this.clientWidth = client.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0));
    this.clientHeight = client.height ?? Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0));
    this.dataset = {};
    this.hidden = false;
  }
  getBoundingClientRect() { return this.rect; }
}
class SVGElement extends Element {
  constructor() { super(); this.attributes = {}; this.children = []; this.hidden = true; }
  setAttribute(name, value) { this.attributes[name] = value; }
  replaceChildren(fragment) { this.children = [...fragment.children]; }
}
class PathElement extends Element {
  constructor() { super(); this.attributes = {}; this.dataset = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const setRect = (node, rect, client = {}) => {
  node.rect = rect;
  node.clientLeft = client.left ?? 0;
  node.clientTop = client.top ?? 0;
  node.clientWidth = client.width ?? Math.max(0, rect.right - rect.left);
  node.clientHeight = client.height ?? Math.max(0, rect.bottom - rect.top);
};
const projectOverflow = new HTMLElement(
  { left: 0, top: 0, right: 160, bottom: 500 },
  { width: 160, height: 500 },
);
const tracker = new HTMLElement(
  { left: 180, top: 0, right: 980, bottom: 700 },
  { width: 800, height: 700 },
);
const projectItem = new HTMLElement({ left: 20, top: 40, right: 145, bottom: 72, width: 125, height: 32 });
projectItem.closest = () => projectOverflow;
const secondProjectItem = new HTMLElement({ left: 20, top: 82, right: 150, bottom: 114, width: 130, height: 32 });
secondProjectItem.closest = () => projectOverflow;
const group = new HTMLElement({ left: 200, top: 120, right: 700, bottom: 200, width: 500, height: 80 });
group.dataset = { project: "alpha", folder: "" };
group.projectItem = projectItem;
const secondGroup = new HTMLElement({ left: 200, top: 240, right: 700, bottom: 300, width: 500, height: 60 });
secondGroup.dataset = { project: "beta", folder: "client" };
secondGroup.projectItem = secondProjectItem;
secondGroup.hidden = true;
tracker.groups = [group, secondGroup];
const svg = new SVGElement();
const document = {
  documentElement: { clientWidth: 1000, clientHeight: 700 },
  querySelector: (selector) => selector === ".live-tracker" ? tracker : null,
  createDocumentFragment: () => ({ children: [], append(node) { this.children.push(node); } }),
  createElementNS: () => new PathElement(),
};
let narrow = false;
let sessionConnectorFrame = 1;
const sessionConnectors = () => svg;
const desktopChair = () => !narrow;
const liveTrackerGroups = () => tracker.groups;
const connectorProjectItem = (candidate) => candidate.projectItem;
${connectorGeometrySource}
${connectorSource}
const snapshot = () => ({
  count: svg.children.length,
  hidden: svg.hidden,
  d: svg.children[0]?.attributes.d,
  layout: svg.children[0]?.dataset.layout,
  layouts: svg.children.map((child) => child.dataset.layout),
  vectorEffect: svg.children[0]?.attributes["vector-effect"],
  project: svg.children[0]?.dataset.project,
  viewBox: svg.attributes.viewBox,
  width: svg.attributes.width,
  height: svg.attributes.height,
});
paintSessionConnectors();
const desktopFocus = snapshot();
secondGroup.hidden = false;
paintSessionConnectors();
const desktopOverview = snapshot();

narrow = true;
document.documentElement.clientWidth = 390;
document.documentElement.clientHeight = 700;
setRect(projectOverflow, { left: 0, top: 0, right: 195, bottom: 700 }, { width: 195, height: 700 });
setRect(tracker, { left: 195, top: 0, right: 390, bottom: 700 }, { width: 195, height: 700 });
setRect(projectItem, { left: 14, top: 40, right: 180, bottom: 72, width: 166, height: 32 });
setRect(secondProjectItem, { left: 14, top: 82, right: 180, bottom: 114, width: 166, height: 32 });
setRect(group, { left: 211, top: 120, right: 376, bottom: 210, width: 165, height: 90 });
setRect(secondGroup, { left: 211, top: 240, right: 376, bottom: 320, width: 165, height: 80 });
secondGroup.hidden = true;
paintSessionConnectors();
const narrowFocus = snapshot();
secondGroup.hidden = false;
paintSessionConnectors();
const narrowOverview = snapshot();

document.documentElement.clientWidth = 640;
document.documentElement.clientHeight = 390;
setRect(projectOverflow, { left: 0, top: 0, right: 320, bottom: 390 }, { width: 320, height: 390 });
setRect(tracker, { left: 320, top: 0, right: 640, bottom: 390 }, { width: 320, height: 390 });
setRect(projectItem, { left: 14, top: 24, right: 305, bottom: 56, width: 291, height: 32 });
setRect(secondProjectItem, { left: 14, top: 64, right: 305, bottom: 96, width: 291, height: 32 });
setRect(group, { left: 336, top: 72, right: 624, bottom: 152, width: 288, height: 80 });
setRect(secondGroup, { left: 336, top: 174, right: 624, bottom: 244, width: 288, height: 70 });
secondGroup.hidden = true;
paintSessionConnectors();
const narrowOrientation = snapshot();
return { desktopFocus, desktopOverview, narrowFocus, narrowOverview, narrowOrientation };
})()`);
assert.deepEqual({ ...connectorPaint.desktopFocus, layouts: [...connectorPaint.desktopFocus.layouts] }, {
  count: 1,
  hidden: false,
  d: "M 145.5 56.5 H 172.5 V 160.5 H 200.5",
  layout: "desktop",
  layouts: ["desktop"],
  vectorEffect: "non-scaling-stroke",
  project: "alpha",
  viewBox: "0 0 1000 700",
  width: "1000",
  height: "700",
}, "filtered desktop focus paints one visible viewport-sized connector");
assert.equal(connectorPaint.desktopOverview.count, 2,
  "desktop overview paints exactly one connector for each visible project group");
assert.deepEqual([...connectorPaint.desktopOverview.layouts], ["desktop", "desktop"],
  "desktop overview keeps both group connectors in cross-column geometry");
assert.deepEqual({ ...connectorPaint.narrowFocus, layouts: [...connectorPaint.narrowFocus.layouts] }, {
  count: 1,
  hidden: false,
  d: "M 180.5 56.5 H 223.5 V 165.5 H 211.5",
  layout: "narrow",
  layouts: ["narrow"],
  vectorEffect: "non-scaling-stroke",
  project: "alpha",
  viewBox: "0 0 390 700",
  width: "390",
  height: "700",
}, "filtered mobile focus paints one target bracket inside the right pane");
assert.equal(connectorPaint.narrowOverview.count, 2,
  "mobile overview paints one narrow connector for every visible project group");
assert.deepEqual([...connectorPaint.narrowOverview.layouts], ["narrow", "narrow"],
  "mobile overview never falls back to desktop gutter elbows");
assert.deepEqual({
  d: connectorPaint.narrowOrientation.d,
  layout: connectorPaint.narrowOrientation.layout,
  viewBox: connectorPaint.narrowOrientation.viewBox,
  width: connectorPaint.narrowOrientation.width,
  height: connectorPaint.narrowOrientation.height,
}, {
  d: "M 305.5 40.5 H 348.5 V 112.5 H 336.5",
  layout: "narrow",
  viewBox: "0 0 640 390",
  width: "640",
  height: "390",
}, "narrow connector geometry follows resize and orientation changes");
const orthogonalPath = (d) => {
  const match = d.match(/^M ([\d.]+) ([\d.]+) H ([\d.]+) V ([\d.]+) H ([\d.]+)$/);
  assert.ok(match, `connector is an orthogonal on-screen path: ${d}`);
  return match.slice(1).map(Number);
};
const assertOnScreen = (paint, width, height) => {
  const [startX, startY, branchX, endY, endX] = orthogonalPath(paint.d);
  for (const x of [startX, branchX, endX]) assert.ok(x >= 0 && x <= width, `x=${x} stays inside ${width}px`);
  for (const y of [startY, endY]) assert.ok(y >= 0 && y <= height, `y=${y} stays inside ${height}px`);
  for (const coordinate of [startX, startY, branchX, endY, endX]) {
    assert.equal(coordinate % 1, .5, `coordinate ${coordinate} centers the one-pixel stroke on a CSS pixel`);
  }
  return { startX, startY, branchX, endY, endX };
};
assertOnScreen(connectorPaint.desktopFocus, 1000, 700);
const narrowCoordinates = assertOnScreen(connectorPaint.narrowFocus, 390, 700);
assert.ok(narrowCoordinates.startX < 195 && narrowCoordinates.endX > 195,
  "mobile connector crosses from the visible left project pane to the visible right group");
assert.ok(narrowCoordinates.branchX > narrowCoordinates.endX && narrowCoordinates.branchX < 376,
  "mobile vertical branch sits inside session content rather than on the 50/50 pane border");
assertOnScreen(connectorPaint.narrowOrientation, 640, 390);
assert.match(browser, /new ResizeObserver\(scheduleSessionConnectors\)/,
  "connectors track project and session count geometry changes");
assert.match(browser, /addEventListener\("(?:resize|scroll)"[^\n]*scheduleSessionConnectors/,
  "connectors are rescheduled for viewport and scrolling changes");
assert.match(browser, /addEventListener\("orientationchange", scheduleSessionConnectors/,
  "connectors are rescheduled when a narrow device rotates");
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
assert.match(railSyncSource, /create\.hidden = child \|\| projectsScope[\s\S]*?syncLiveTrackerProjectFilter\(\)/,
  "session defaults are applied before the active tracker filter restores overview create state");
assert.doesNotMatch(railSyncSource, /syncLiveTrackerProjectFilter\(\);[\s\S]*?create\.hidden\s*=/,
  "a root session switch cannot unhide project-specific creation after overview restoration");
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
const railClamp = css.match(/--project-rail-width:\s*clamp\(([\d.]+)rem,\s*([\d.]+)vw,\s*([\d.]+)rem\)/);
assert.ok(railClamp, "desktop project rail uses a bounded responsive proportion");
const [, railMinRem, railIdealVw, railMaxRem] = railClamp.map(Number);
assert.deepEqual([railMinRem, railIdealVw, railMaxRem], [8.75, 12.5, 11],
  "desktop project rail is modestly narrower without starving labels");
const clampedRail = (viewport, minRem, idealVw, maxRem) =>
  Math.min(Math.max(minRem * 16, viewport * idealVw / 100), maxRem * 16);
for (const viewport of [800, 1024, 1440]) {
  const refined = clampedRail(viewport, railMinRem, railIdealVw, railMaxRem);
  const previous = clampedRail(viewport, 9, 14, 12);
  assert.ok(refined < previous && viewport - refined > viewport - previous,
    `the refined ${viewport}px desktop rail returns space to session content`);
}
assert.match(css, /width:\s*min\(90ch, calc\(100% - var\(--project-rail-width\) - 2rem\)\)/,
  "desktop session content consumes the space released by the narrower rail");
assert.doesNotMatch(css, /\.live-tracker-session-current\s*\{[^}]*box-shadow/,
  "current sessions keep the original understated treatment without an inset bar");
const connectorStyle = css.match(/\.session-connectors path \{([^}]*)\}/)?.[1] ?? "";
assert.match(connectorStyle, /fill:\s*none/,
  "connectors are unfilled lines rather than decorative shapes");
const connectorStroke = connectorStyle.match(/stroke:\s*(#[0-9a-f]{6})/i)?.[1] ?? "";
const connectorStrokeWidth = Number(connectorStyle.match(/stroke-width:\s*([\d.]+)/)?.[1] ?? NaN);
assert.equal(connectorStrokeWidth, 1,
  "connectors use one crisp CSS pixel rather than a disappearing antialiased subpixel");
assert.doesNotMatch(connectorStyle, /opacity\s*:/,
  "connector contrast is not reduced again through path opacity");
const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const relativeLuminance = (color) => color
  .map((channel) => channel / 255)
  .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
const contrastRatio = (foreground, background) => {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (lighter + .05) / (darker + .05);
};
assert.ok(/^#[0-9a-f]{6}$/i.test(connectorStroke), "connector stroke uses a directly testable solid color");
assert.ok(contrastRatio(rgb(connectorStroke), [0, 0, 0]) >= 3,
  "desktop connectors remain visible at 3:1 or better against the black surface");
assert.ok(contrastRatio(rgb(connectorStroke), [0x1a, 0x1a, 0x1a]) >= 3,
  "mobile connectors remain visible at 3:1 or better across the 50/50 divider");
assert.doesNotMatch(connectorStyle, /background|gradient|border|box-shadow/i,
  "connector styling adds no cards, gradients, borders, or backgrounds");
const overviewStyle = css.match(/\.live-tracker\[data-overview="true"\] \{([^}]*)\}/)?.[1] ?? "";
assert.match(overviewStyle, /flex-direction:\s*column/,
  "overview preserves project order in a simple vertical flow");
assert.doesNotMatch(overviewStyle, /background|gradient|border|box-shadow/i,
  "overview grouping adds spacing only, not ornamental chrome");
const connectorLayerStyle = css.match(/\.session-connectors \{([^}]*)\}/)?.[1] ?? "";
assert.match(connectorLayerStyle, /position:\s*fixed[\s\S]*?z-index:\s*8[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/,
  "the fixed-inset connector layer covers the viewport above both chooser panes");
assert.match(connectorLayerStyle, /overflow:\s*hidden[\s\S]*?pointer-events:\s*none/,
  "the viewport connector layer clips cleanly and never steals chooser taps");
assert.match(css, /\.project-rail \.active-projects:focus-visible \{[^}]*outline:\s*1px solid/,
  "the compact keyboard-operable chooser surface has a restrained visible focus state");
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
