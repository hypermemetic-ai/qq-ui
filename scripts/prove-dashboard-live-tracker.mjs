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
  workflow: `/qq/session/${rootId}/workflow`,
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
const architectStrip = alphaGroup.match(new RegExp(`<li class="live-tracker-row live-tracker-depth-0"><a class="live-tracker-session[^\"]*"[^>]*data-session-id="${rootId}"[\\s\\S]*?<\\/a><\\/li>`))?.[0] ?? "";
assert.match(architectStrip, /class="live-tracker-phase" data-phase="planning">planning</,
  "the architect strip exposes its own authoritative current phase");
assert.doesNotMatch(architectStrip, /data-activity="working"[^>]*>working</,
  "authoritative architect phase replaces redundant generic working text");
assert.match(childStrip, /class="live-tracker-phase" data-phase="implementation">implementation</,
  "the child strip uses status space for its authoritative workflow role");
assert.doesNotMatch(childStrip, /data-activity="working"[^>]*>working</,
  "the child role replaces redundant generic working text");
assert.match(architectStrip, new RegExp(`<time class="live-tracker-elapsed" data-phase-started-at="${phaseStartedAt}" hidden></time>`),
  "a working architect emits its own absolute active-time source");
assert.match(childStrip, new RegExp(`<time class="live-tracker-elapsed" data-phase-started-at="${phaseStartedAt + 1_000}" hidden></time>`),
  "a concurrently working child emits its distinct active-time source");
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
const initialOverviewHtml = renderSessionContent({
  ...rawSnapshot,
  scope: "projects",
  project: "",
  dashboard: validDashboard,
}, paths);
assert.match(initialOverviewHtml, /class="session-traversal live-tracker"[^>]*aria-label="All project sessions"[^>]*data-overview="true"/,
  "projects-scope markup starts explicitly in the all-project sessions overview");
assert.doesNotMatch(initialOverviewHtml, /class="new-session"/,
  "initial all-project markup does not render a destinationless add-session control");
const initialOverviewGroups = [...initialOverviewHtml.matchAll(/<section class="live-tracker-project"[^>]*>/g)].map((match) => match[0]);
assert.equal(initialOverviewGroups.length, validDashboard.projects.length);
assert.ok(initialOverviewGroups.every((group) => !/ hidden(?:>| )/.test(group) && /data-current="false"/.test(group)),
  "initial all-project markup exposes every semantic group without selecting one");
assert.match(html, /id="session-chrome"[^>]*sse-swap="chrome"[\s\S]*?class="session-traversal live-tracker"/,
  "the tracker belongs to the existing SSE-owned chrome region");
const connectorRail = renderProjectRail({
  ...rawSnapshot,
  sessions: legacyRows,
  activeProjects: legacyRows,
  dashboard: validDashboard,
}, paths);
assert.doesNotMatch(connectorRail, /session-connectors|<svg[^>]*>\s*<path/,
  "server markup does not guess connector geometry before browser layout");
assert.match(connectorRail, /<nav class="active-projects"[^>]*aria-keyshortcuts="ArrowUp ArrowDown Enter Space"[^>]*tabindex="0">/,
  "the project chooser surface exposes a focused keyboard route to the all-project overview");

const familyIds = Array.from({ length: 5 }, (_, index) =>
  `session-7a120000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const idleRow = (sessionId, alias, parentSessionId = "", depth = 0) => ({
  sessionId, alias, label: depth ? "implementation" : "architect", parentSessionId, depth,
  activity: "idle", idleForMs: 1_000, workflow: null, phase: "none", phaseStartedAt: null,
});
const canonicalCandidate = {
  schema: "qq.dashboard/v1",
  projects: [{
    key: "p:zeta:", name: "zeta", label: "Zeta", folder: "", folderLabel: "",
    sessions: [idleRow("session-7a120000-0000-4000-8000-000000000010", "zeta-root")],
  }, {
    key: "p:atlas:south", name: "atlas", label: "Atlas", folder: "south", folderLabel: "South",
    sessions: [idleRow("session-7a120000-0000-4000-8000-000000000011", "south-root")],
  }, {
    key: "p:beta:", name: "beta", label: "Beta", folder: "", folderLabel: "", sessions: [],
  }, {
    key: "p:atlas:north", name: "atlas", label: "Atlas", folder: "north", folderLabel: "North",
    sessions: [
      idleRow(familyIds[3], "b-child-2", familyIds[0], 1),
      idleRow(familyIds[0], "architect-b"),
      idleRow(familyIds[1], "architect-a"),
      idleRow(familyIds[2], "a-child", familyIds[1], 1),
      idleRow(familyIds[4], "b-child-1", familyIds[0], 1),
    ],
  }],
};
const canonicalDashboard = validatedDashboardSnapshot(canonicalCandidate);
assert.ok(canonicalDashboard, "valid interleaved families and empty projects remain available");
assert.deepEqual(canonicalDashboard.projects.map((project) => `${project.name}\n${project.folder}`), [
  "atlas\nnorth", "atlas\nsouth", "beta\n", "zeta\n",
], "dashboard places use one human, stable order independent of producer activity order");
assert.deepEqual(canonicalDashboard.projects[0].sessions.map((row) => row.sessionId), [
  familyIds[0], familyIds[3], familyIds[4], familyIds[1], familyIds[2],
], "authoritative parents form contiguous families while root and sibling source order remains stable");
for (const child of canonicalDashboard.projects[0].sessions.filter((row) => row.depth === 1)) {
  const parent = canonicalDashboard.projects[0].sessions.find((row) => row.sessionId === child.parentSessionId);
  assert.ok(parent && parent.depth === 0, "every normalized direct child retains its authoritative parent ID");
}
const reversedActive = canonicalDashboard.projects.slice().reverse().flatMap((project, index) =>
  project.sessions[0] ? [{
    id: project.sessions[0].sessionId,
    project: project.name,
    projectLabel: project.label,
    folder: project.folder,
    folderLabel: project.folderLabel,
    createdAt: 10_000 - index,
  }] : []);
const canonicalSnapshot = {
  ...rawSnapshot,
  id: familyIds[0],
  project: "atlas",
  projectLabel: "Atlas",
  folder: "north",
  folderLabel: "North",
  sessions: reversedActive,
  activeProjects: reversedActive,
  dashboard: canonicalDashboard,
};
const canonicalRail = renderProjectRail(canonicalSnapshot, paths);
const canonicalTracker = renderSessionContent(canonicalSnapshot, paths);
const identitySequence = (markup, pattern) => [...markup.matchAll(pattern)]
  .map((match) => `${match[1]}\n${match[2]}`);
const railSequence = identitySequence(canonicalRail,
  /class="active-project-item[^"]*"[^>]*data-project="([^"]+)" data-folder="([^"]*)"/g);
const groupSequence = identitySequence(canonicalTracker,
  /class="live-tracker-project"[^>]*data-project="([^"]+)" data-folder="([^"]*)"/g);
assert.deepEqual(railSequence, groupSequence,
  "left project DOM/focus order exactly equals right group DOM/reading order");
assert.deepEqual(railSequence, ["atlas\nnorth", "atlas\nsouth", "beta\n", "zeta\n"],
  "duplicate project names are distinguished and ordered by authoritative folder identity");
assert.match(canonicalRail, />Atlas \/ North<\/span>/,
  "folder projects are labeled unambiguously in the left sequence");
assert.match(canonicalTracker, /class="live-tracker-project-empty">no live sessions<\/li>/,
  "an empty project has a deliberate stable group rather than disappearing or shifting peers");
assert.doesNotMatch(canonicalRail + canonicalTracker, /session-connectors/,
  "the server preserves canonical identity surfaces while browser mode owns relationship geometry");

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
  "browser elapsed display derives from each row's absolute active-time source");
assert.match(browser, /setTimeout\(syncLiveTrackerElapsed, nextUpdate\)/,
  "browser schedules the next visible unit threshold without server rerenders");
assert.doesNotMatch(browser, /setInterval\(syncLiveTrackerElapsed,\s*1000\)/,
  "tracker elapsed metadata avoids needless one-second polling");
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
assert.match(overviewSource, /removeLiveTrackerCreate\(tracker\)/,
  "overview removes the destinationless create control from rendering, interaction, and accessibility");
const chooserBehaviorSource = browser.match(/  const CHOOSER_INTERACTIVE = [\s\S]*?(?=  const sessionEventsUrl)/)?.[0] ?? "";
const chooserClickSource = browser.match(/  const modifiedClick = [\s\S]*?(?=  const applyChairMode)/)?.[0] ?? "";
assert.notEqual(chooserBehaviorSource, "", "empty-space behavior remains independently provable");
assert.notEqual(chooserClickSource, "", "chooser click consumption remains independently provable");
assert.match(chooserBehaviorSource, /closest\?\.\("#project-rail, \.active-projects, \.session-traversal"\)/,
  "empty-space clearing is limited to the guarded Projects and Sessions chooser surfaces");
assert.match(chooserBehaviorSource, /closest\?\.\("#inactive-project-tree"\)[\s\S]*?return null/,
  "the whole inactive file-tree region is excluded before rail-surface classification");
assert.match(chooserBehaviorSource, /\.active-projects li, \.session-traversal li/,
  "non-actionable padding inside project and session rows remains row-owned");
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
      if (selector === "#project-rail, .active-projects, .session-traversal") {
        if (node.kind === "rail" || node.kind === "nav" || node.kind === "sessions") return node;
      } else if (selector === "#inactive-project-tree") {
        if (node.kind === "file-tree") return node;
      } else if (selector === ".active-projects li, .session-traversal li") {
        if (node.kind === "project-row" || node.kind === "session-row") return node;
      } else if (node.actionable) {
        return node;
      }
    }
    return null;
  }
}
let overviewCount = 0;
let desktop = true;
let navOpen = false;
const desktopChair = () => desktop;
const navMode = () => navOpen;
const showLiveTrackerOverview = () => { overviewCount += 1; return true; };
${chooserBehaviorSource}
${chooserClickSource}
const rail = new Element("rail");
const nav = new Element("nav", rail, true);
const navPadding = new Element("project-padding", nav);
const projectRow = new Element("project-row", nav);
const projectRowGutter = new Element("project-row-gutter", projectRow);
const projectLink = new Element("project-link", projectRow, true);
const projectLabel = new Element("project-label", projectLink);
const projectForm = new Element("project-form", rail, true);
const projectInput = new Element("project-input", projectForm, true);
const closeButton = new Element("close", rail, true);
const closeMark = new Element("close-mark", closeButton);
const sessions = new Element("sessions");
const sessionPadding = new Element("session-padding", sessions);
const sessionRow = new Element("session-row", sessions);
const sessionRowGutter = new Element("session-row-gutter", sessionRow);
const sessionLink = new Element("session-link", sessionRow, true);
const sessionLabel = new Element("session-label", sessionLink);
const sessionForm = new Element("session-form", sessions, true);
const sessionButton = new Element("session-button", sessionForm, true);
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
  button: 0,
  defaultPrevented: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  preventDefault() { this.defaultPrevented = true; },
  ...extras,
});
const result = {
  desktopProjectRail: clearProjectFilterFromEmptySpace(rail),
  desktopProjectPadding: clearProjectFilterFromEmptySpace(navPadding),
  desktopSessionPadding: clearProjectFilterFromEmptySpace(sessionPadding),
  projectRow: clearProjectFilterFromEmptySpace(projectRowGutter),
  projectLink: clearProjectFilterFromEmptySpace(projectLabel),
  projectFormInput: clearProjectFilterFromEmptySpace(projectInput),
  closeControl: clearProjectFilterFromEmptySpace(closeMark),
  sessionRow: clearProjectFilterFromEmptySpace(sessionRowGutter),
  sessionLink: clearProjectFilterFromEmptySpace(sessionLabel),
  sessionFormButton: clearProjectFilterFromEmptySpace(sessionButton),
  menuControl: clearProjectFilterFromEmptySpace(menuPadding),
  fileTreeSurface: clearProjectFilterFromEmptySpace(fileTree),
  fileTreePadding: clearProjectFilterFromEmptySpace(treePadding),
  fileTreeLoading: clearProjectFilterFromEmptySpace(treeLoading),
  fileTreeEmpty: clearProjectFilterFromEmptySpace(treeEmptyColumn),
};
desktop = false;
navOpen = true;
result.mobileProjectPadding = clearProjectFilterFromEmptySpace(navPadding);
result.mobileSessionPadding = clearProjectFilterFromEmptySpace(sessionPadding);
result.mobileSessionRow = clearProjectFilterFromEmptySpace(sessionRowGutter);
const modifiedSessionClick = keyEvent(sessionPadding, "", { ctrlKey: true });
result.modifiedSessionConsumed = activateOverviewFromChooserClick(modifiedSessionClick, sessionPadding);
result.modifiedSessionPrevented = modifiedSessionClick.defaultPrevented;
const preconsumedSessionClick = keyEvent(sessionPadding, "", { defaultPrevented: true });
result.preconsumedSessionConsumed = activateOverviewFromChooserClick(preconsumedSessionClick, sessionPadding);
const mobileSessionClick = keyEvent(sessionPadding, "");
result.mobileSessionConsumed = activateOverviewFromChooserClick(mobileSessionClick, sessionPadding);
result.mobileSessionPrevented = mobileSessionClick.defaultPrevented;
let overlayCloseCount = 0;
if (!result.mobileSessionConsumed && navMode()) overlayCloseCount += 1;
result.overlayCloseCount = overlayCloseCount;
navOpen = false;
result.mobileClosedSessionPadding = clearProjectFilterFromEmptySpace(sessionPadding);
desktop = true;
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
assert.match(browser, /if \(activateOverviewFromChooserClick\(event, target\)\) return;[\s\S]*?if \(navMode\(\)/,
  "chooser overview activation is consumed before the mobile overlay close handler");
assert.deepEqual({ ...chooserBehavior }, {
  desktopProjectRail: true,
  desktopProjectPadding: true,
  desktopSessionPadding: true,
  projectRow: false,
  projectLink: false,
  projectFormInput: false,
  closeControl: false,
  sessionRow: false,
  sessionLink: false,
  sessionFormButton: false,
  menuControl: false,
  fileTreeSurface: false,
  fileTreePadding: false,
  fileTreeLoading: false,
  fileTreeEmpty: false,
  mobileProjectPadding: true,
  mobileSessionPadding: true,
  mobileSessionRow: false,
  modifiedSessionConsumed: false,
  modifiedSessionPrevented: false,
  preconsumedSessionConsumed: false,
  mobileSessionConsumed: true,
  mobileSessionPrevented: true,
  overlayCloseCount: 0,
  mobileClosedSessionPadding: false,
  keyboard: true,
  keyboardPrevented: true,
  spaceKeyboard: true,
  spaceKeyboardPrevented: true,
  childKeyboard: false,
  childKeyboardPrevented: false,
  modifiedKeyboard: false,
  overviewCount: 8,
}, "only genuine Projects/Sessions background or the focused chooser landmark enters overview across desktop and nav mode");
const connectorSource = browser.match(/const SESSION_CONNECTOR_ID[\s\S]*?function scheduleSessionConnectors\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
assert.match(connectorSource, /SESSION_CONNECTOR_ID = "session-connectors"[\s\S]*?const paintSessionConnectors/,
  "the client owns a fresh viewport relationship layer after layout exists");
assert.match(connectorSource, /new Map\(\)[\s\S]*?groups\.set\(projectIdentity\(group\.dataset\), group\)/,
  "session groups are indexed by authoritative project plus folder identity");
assert.match(connectorSource, /projectIdentity\(project\.dataset\)[\s\S]*?groups\.get\(key\)/,
  "each project route resolves only its exact folder-aware group");
assert.match(connectorSource, /projectClip = sessionConnectorRect\(projects\)[\s\S]*?trackerClip = sessionTrackerConnectorRect\(tracker\)[\s\S]*?visibleConnectorSurface\(project, projectClip\)[\s\S]*?visibleConnectorSurface\(group, trackerClip\)/,
  "each endpoint is omitted only when it is not meaningfully visible in its own actual pane");
assert.match(connectorSource, /sessionTrackerConnectorRect[\s\S]*?#session-composer[\s\S]*?Math\.min\(clip\.bottom, composer\.top\)/,
  "narrow group visibility uses the right tracker band capped by the actual composer");
assert.doesNotMatch(connectorSource, /targetVerticalScrollport|visibleConnectorSurface\(group, tracker, projects\)/,
  "right endpoint visibility never proxies through or requires overlap with the left project list");
assert.match(connectorSource, /sessionConnectorLaneOrder[\s\S]*?canonicalOrderWorks[\s\S]*?reverseOrderWorks[\s\S]*?incoming/,
  "mixed vertical intervals produce deterministic pairwise constraints with canonical tie-breaking");
assert.match(connectorSource, /SESSION_CONNECTOR_LANE_GAP = 6[\s\S]*?SESSION_CONNECTOR_MIN_LANE_GAP = 1\.25[\s\S]*?SESSION_CONNECTOR_LANE_BUNDLE_RATIO = 0\.34/,
  "lanes retain defined preferred/minimum separation inside a modest adaptive bundle");
assert.match(connectorSource, /sessionConnectorBaseline[\s\S]*?Math\.abs\(preferred - sourceY\) >= 1[\s\S]*?preferred >= sourceY \? 2 : -2/,
  "an exact source/baseline alignment selects another clear below-group baseline instead of collapsing its bend");
assert.match(connectorSource, /channelStart[\s\S]*?channelEnd[\s\S]*?channelMidpoint = \(channelStart \+ channelEnd\) \/ 2[\s\S]*?firstLane = channelMidpoint - \(laneSpan \/ 2\)[\s\S]*?laneRanks[\s\S]*?routes\[index\]\.lane/,
  "every eligible route receives a unique modestly offset lane centered in the actual project-to-content gap");
assert.match(connectorSource, /setAttribute\("d", `M \${start\.x[^`]* H \${lane[^`]* V \${baseline[^`]* H \${endX/,
  "every relationship is one continuous M/H/V/H path ending in its group underline");
assert.doesNotMatch(connectorSource, /setAttribute\("d",[^\n]*[LQCSTA] \${/,
  "relationship path emission contains no diagonal, curved, or arc command");
assert.match(browser, /const showLiveTrackerOverview[\s\S]*?scheduleSessionConnectors\(\)[\s\S]*?const showLiveTrackerProject[\s\S]*?suppressSessionConnectors\(\)/,
  "overview entry schedules routes while single-project entry synchronously removes them");
assert.match(browser, /const removeLiveTrackerCreate[\s\S]*?create\.remove\(\)[\s\S]*?const ensureLiveTrackerCreate[\s\S]*?create\.method = "post"[\s\S]*?aria-label", "New session"/,
  "client mode transitions remove the overview control node and reconstruct one native labelled POST form on selection");
assert.match(browser, /const showLiveTrackerOverview[\s\S]*?removeLiveTrackerCreate\(tracker\)[\s\S]*?const showLiveTrackerProject[\s\S]*?ensureLiveTrackerCreate\(tracker, project, folder\)/,
  "overview and selected-project transitions reconcile add-session DOM presence in opposite directions");
assert.match(browser, /ensureLiveTrackerCreate[\s\S]*?encodeURIComponent\(project\)[\s\S]*?encodeURIComponent\(folder\)[\s\S]*?\/sessions/,
  "the reconstructed selected-project action is project/folder aware");
assert.match(browser, /event\.target\?\.matches\?\.\("\.active-projects, \.live-tracker"\)[\s\S]*?scheduleSessionConnectors\(\)/,
  "independent project and group pane scrolling recomputes relationship geometry");
assert.match(browser, /new ResizeObserver[\s\S]*?window\.addEventListener\("resize", scheduleSessionConnectors[\s\S]*?orientationchange/,
  "surface resize, viewport resize, and rotation all recompute relationship geometry");
assert.match(browser, /id === "session-chrome"[\s\S]*?syncLiveTrackerProjectFilter\(\)[\s\S]*?scheduleSessionConnectors\(\)/,
  "live chrome replacement restores mode before repainting its routes");
assert.match(browser, /touchesComposer\(id\)[\s\S]*?restoreDraft\(\)[\s\S]*?scheduleSessionConnectors\(\)/,
  "live composer replacement recomputes the right-side unobscured band");
assert.match(browser, /const activeProjectEntry = \(item\) => \(\{[\s\S]*?projectLabel:[\s\S]*?folderLabel:/,
  "client reconciliation retains the labels required by canonical ordering");
assert.match(browser, /const appendActiveProject = \(entry\) => \{[\s\S]*?restoreActiveProjects\(\)/,
  "asynchronous project discovery re-runs canonical ordering instead of appending by completion time");
assert.doesNotMatch(browser, /qq-active-projects|readRememberedProjects|restoreListOrder/,
  "session storage can no longer override canonical project order");
const projectPickerSource = browser.match(/const selectOverlayProject = \(item\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(projectPickerSource, /if \(filterLiveTrackerProject\(projectItem\)\) return true;\s+const sessions/,
  "a normal project filter returns before legacy session selection or navigation");
assert.match(browser, /const filterOnlyProject = link\.matches[\s\S]*?const closesMobileRail = picker && !filterOnlyProject/,
  "filter-only project clicks keep the mobile two-pane chooser open");
assert.match(browser, /id === "session-chrome"[\s\S]*?syncLiveTrackerProjectFilter\(\)/,
  "SSE chrome refreshes preserve the chosen project filter");
const filterSyncSource = browser.match(/const syncLiveTrackerProjectFilter = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(filterSyncSource, /liveTrackerProjectFilter === LIVE_TRACKER_OVERVIEW\s*\|\|\s*\(!liveTrackerProjectFilter && tracker\.dataset\.overview === "true"\)/,
  "server overview markup initializes an empty filter without overriding a remembered project selection");
assert.match(filterSyncSource, /liveTrackerProjectFilter === LIVE_TRACKER_OVERVIEW[\s\S]*?showLiveTrackerOverview\(\{ remember: false \}\)/,
  "SSE chrome refreshes also preserve the all-project overview");
const railSyncSource = browser.match(/const syncRailAfterSwitch = \(meta\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(railSyncSource, /liveTrackerProjectFilter !== LIVE_TRACKER_OVERVIEW[\s\S]*?liveTrackerProjectFilter = projectIdentity\(\{ project, folder \}\)/,
  "selecting a session updates navigation without collapsing an active all-project overview");
assert.match(railSyncSource, /create\.hidden = child \|\| projectsScope[\s\S]*?syncLiveTrackerProjectFilter\(\)/,
  "session defaults are applied before the active tracker mode reconciles project-specific creation");
assert.doesNotMatch(railSyncSource, /syncLiveTrackerProjectFilter\(\);[\s\S]*?create\.hidden\s*=/,
  "a session switch cannot restore a destinationless control after overview reconciliation");
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
assert.match(css, /\.nav-mode \.project-rail \{[^}]*width:\s*50%[^}]*border-right:\s*0/,
  "the narrow installed-app split removes its full-height central divider");
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
const connectorLayerStyle = css.match(/\.session-connectors \{([^}]*)\}/)?.[1] ?? "";
const connectorPathStyle = css.match(/\.session-connectors path \{([^}]*)\}/)?.[1] ?? "";
assert.match(connectorLayerStyle, /position:\s*fixed[\s\S]*?pointer-events:\s*none/,
  "the viewport relationship layer is layout-independent and cannot block full-row interaction");
const connectorStroke = Number(connectorPathStyle.match(/stroke-width:\s*([\d.]+)px/)?.[1]);
assert.ok(connectorStroke > 0 && connectorStroke <= 1,
  "relationship lines are visible hairlines no thicker than one CSS pixel");
assert.match(connectorPathStyle, /stroke:\s*#[0-9a-f]{6}[\s\S]*?stroke-linecap:\s*butt[\s\S]*?stroke-linejoin:\s*miter[\s\S]*?vector-effect:\s*non-scaling-stroke/i,
  "relationship lines retain a restrained neutral, square, non-scaling stroke");
assert.doesNotMatch(connectorPathStyle, /filter|animation|marker|drop-shadow|round/i,
  "relationship lines add no glow, animation, arrows, dots, or heavy rounding");
const overviewStyle = css.match(/\.live-tracker\[data-overview="true"\] \{([^}]*)\}/)?.[1] ?? "";
assert.match(overviewStyle, /flex-direction:\s*column[\s\S]*?gap:\s*\.9rem/,
  "overview preserves project order and reserves clear below-group baseline space");
assert.doesNotMatch(overviewStyle, /background|gradient|border|box-shadow/i,
  "overview grouping adds spacing only, not ornamental chrome");
const overviewHeadingStyle = css.match(/\.live-tracker\[data-overview="true"\] \.live-tracker-project-name \{([^}]*)\}/)?.[1] ?? "";
assert.match(overviewHeadingStyle, /position:\s*absolute[\s\S]*?width:\s*1px[\s\S]*?clip-path:\s*inset\(50%\)/,
  "overview project/folder headings retain semantic text while becoming visually hidden");
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
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session::before \{[^}]*border-bottom:\s*\.75px solid[^}]*border-left:\s*\.75px solid/,
  "each direct child has one restrained orthogonal dependency branch");
assert.match(childStripStyle, /justify-content:\s*flex-start[\s\S]*?gap:\s*\.4rem/,
  "child identity and work metadata form one compact left-biased cluster");
assert.doesNotMatch(childStripStyle, /justify-content:\s*space-between/,
  "child state is never stranded at the far edge of an empty strip");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-state \{[^}]*max-width:\s*none/,
  "child phase and own elapsed time can use reclaimed row space");
assert.doesNotMatch(css, /\.live-tracker-child-strip \.live-tracker-(?:phase|elapsed)[^}]*display:\s*none/,
  "child workflow role and active-work time remain visible");
assert.match(css, /\.live-tracker-elapsed\[hidden\] \{ display:\s*none; \}/,
  "sub-minute elapsed metadata leaves no separator or reserved-width artifact");
assert.doesNotMatch(childStripStyle, /background|gradient|box-shadow/i,
  "child hierarchy is expressed without cards or decorative surfaces");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-face \{[^}]*font-size:\s*\.68rem/,
  "child identity typography remains smaller and quieter than its architect");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session:focus-visible \{[^}]*outline:\s*1px solid/,
  "the reduced child strip retains a visible keyboard focus indicator");
assert.match(css, /\.live-tracker-child-strip \.live-tracker-session-current \{[^}]*background:\s*transparent/,
  "the compact active state stays understated and card-free");
assert.match(browser, /\.new-session:not\(\[hidden\]\)/,
  "the new-session shortcut only targets a selected-project control that is still present");

const plugin = readFileSync(new URL("../src/plugin.mjs", import.meta.url), "utf8");
assert.match(plugin, /const dashboardOf = \(\) => ctx\.get\?\.\("qq-dashboard", false\) \?\? null;/,
  "plugin resolves the optional dashboard service through a replacement-safe closure");
assert.match(plugin, /dashboardFor:\s*\(\) => dashboardOf\(\)\?\.snapshot\?\.\(\)/,
  "the handler reads the current dashboard service rather than a frozen instance");

console.log("prove-dashboard-live-tracker: pass");
