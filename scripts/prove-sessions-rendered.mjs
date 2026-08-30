#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validatedDashboardSnapshot } from "../src/http-app.mjs";
import { renderPage } from "../src/render.mjs";

const diagnose = process.argv.includes("--diagnose");
const root = resolve(new URL("..", import.meta.url).pathname);
const artifacts = join(root, ".artifacts", "sessions-rendered");
const cachedChromium = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  join(process.env.HOME || "", ".cache/ms-playwright"),
  "/home/qqp/.cache/ms-playwright",
].filter(Boolean).flatMap((cache) => {
  try {
    return readdirSync(cache)
      .filter((entry) => entry.startsWith("chromium-") && !entry.includes("headless"))
      .sort().reverse()
      .flatMap((entry) => ["chrome-linux64/chrome", "chrome-linux/chrome"].map((path) => join(cache, entry, path)));
  } catch { return []; }
}).find(existsSync);
const chromeBinary = [
  process.env.CHROME_BIN,
  cachedChromium,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].find((candidate) => candidate && existsSync(candidate));
assert.ok(chromeBinary, "browser-rendered proof requires Chromium (set CHROME_BIN when it is not installed conventionally)");

const now = Date.now();
const sessionId = (serial) => `session-7b330000-0000-4000-8000-${String(serial).padStart(12, "0")}`;
const idleRow = (serial, alias, { parentSessionId = "", depth = 0 } = {}) => ({
  sessionId: sessionId(serial),
  alias,
  label: depth ? "implementation" : "architect",
  parentSessionId,
  depth,
  activity: "idle",
  idleForMs: 60_000,
  workflow: null,
  phase: "none",
  phaseStartedAt: null,
});
const workingRow = (serial, alias, {
  parentSessionId = "", depth = 0, workflow = depth ? "implementation" : "architect",
  phase = depth ? "work" : "planning", elapsed = 8 * 60_000,
} = {}) => ({
  sessionId: sessionId(serial),
  alias,
  label: depth ? "implementation" : "architect",
  parentSessionId,
  depth,
  activity: "working",
  idleForMs: null,
  workflow,
  phase,
  phaseStartedAt: now - elapsed,
});

const architectB = sessionId(1);
const architectA = sessionId(2);
const childA = sessionId(3);
const childB2 = sessionId(4);
const childB1 = sessionId(5);
const alphaSessions = [
  // Deliberately flat/interleaved producer order. Validation must rebuild
  // architect B's family before architect A's without using activity.
  workingRow(4, "runner-b2", { parentSessionId: architectB, depth: 1, elapsed: 11 * 60_000 }),
  idleRow(1, "opal-b"),
  workingRow(2, "opal-a", { elapsed: 4 * 60_000 }),
  workingRow(3, "runner-a", { parentSessionId: architectA, depth: 1, elapsed: 7 * 60_000 }),
  workingRow(5, "runner-b1", { parentSessionId: architectB, depth: 1, elapsed: 9 * 60_000 }),
];
const sourceProjects = [
  { key: "p:theta:", name: "theta", label: "Theta", folder: "", folderLabel: "", sessions: [idleRow(20, "theta-arch")] },
  { key: "p:studio:west", name: "studio", label: "Studio", folder: "west", folderLabel: "West", sessions: [idleRow(21, "studio-west")] },
  { key: "p:beta:", name: "beta", label: "Beta", folder: "", folderLabel: "", sessions: [idleRow(32, "beta-arch")] },
  { key: "p:alpha:", name: "alpha", label: "Alpha", folder: "", folderLabel: "", sessions: alphaSessions },
  { key: "p:mu:", name: "mu", label: "Mu", folder: "", folderLabel: "", sessions: [idleRow(22, "mu-arch")] },
  { key: "p:studio:east", name: "studio", label: "Studio", folder: "east", folderLabel: "East", sessions: [idleRow(23, "studio-east")] },
  { key: "p:kappa:", name: "kappa", label: "Kappa", folder: "", folderLabel: "", sessions: [idleRow(24, "kappa-arch")] },
  { key: "p:zeta:", name: "zeta", label: "Zeta", folder: "", folderLabel: "", sessions: [idleRow(25, "zeta-arch")] },
  { key: "p:delta:", name: "delta", label: "Delta", folder: "", folderLabel: "", sessions: [idleRow(26, "delta-arch")] },
  { key: "p:lambda:", name: "lambda", label: "Lambda", folder: "", folderLabel: "", sessions: [idleRow(27, "lambda-arch")] },
  { key: "p:eta:", name: "eta", label: "Eta", folder: "", folderLabel: "", sessions: [idleRow(28, "eta-arch")] },
  { key: "p:gamma:", name: "gamma", label: "Gamma", folder: "", folderLabel: "", sessions: [idleRow(29, "gamma-arch")] },
  { key: "p:iota:", name: "iota", label: "Iota", folder: "", folderLabel: "", sessions: [idleRow(30, "iota-arch")] },
  { key: "p:epsilon:", name: "epsilon", label: "Epsilon", folder: "", folderLabel: "", sessions: [idleRow(31, "epsilon-arch")] },
];
const dashboard = validatedDashboardSnapshot({
  schema: "qq.dashboard/v1",
  projects: sourceProjects,
  usage: {
    generatedAt: now,
    providers: [{
      id: "qwen", label: "Qwen", state: "estimated", observedAt: now - 90_000,
      meters: [
        { id: "five-hour", label: "5h", usedRatio: .42, resetAt: null, detail: "4200 / 10000 estimated" },
        { id: "weekly", label: "7d", usedRatio: 1.1, resetAt: now + 4 * 86_400_000, detail: "44000 / 40000 estimated" },
      ],
    }, {
      id: "grok", label: "Grok", state: "unavailable", observedAt: null, meters: [],
    }, {
      id: "codex", label: "Codex", state: "ready", observedAt: now - 60_000,
      meters: [{ id: "weekly", label: "7d", usedRatio: .25, resetAt: now + 6 * 86_400_000, detail: "" }],
    }],
  },
});
assert.ok(dashboard, "representative dashboard fixture validates");
const expectedMany = dashboard.projects.map((project) => `${project.name}\n${project.folder}`);
assert.deepEqual(expectedMany.slice(-2), ["theta\n", "zeta\n"], "fixture canonical order is deterministic");
assert.ok(expectedMany.includes("studio\neast") && expectedMany.includes("studio\nwest"),
  "fixture contains duplicate project names with distinct authoritative folders");
const alpha = dashboard.projects.find((project) => project.name === "alpha");
assert.deepEqual(alpha.sessions.map((row) => row.sessionId), [architectB, childB2, childB1, architectA, childA],
  "fixture validation establishes contiguous architect families before browser rendering");

const activeProjectsFor = (projects) => projects.slice().reverse().flatMap((project, index) => {
  const rootSession = project.sessions.find((row) => row.depth === 0);
  if (!rootSession) return [];
  return [{
    id: rootSession.sessionId,
    project: project.name,
    projectLabel: project.label,
    folder: project.folder,
    folderLabel: project.folderLabel,
    alias: rootSession.alias,
    // Volatile values intentionally conflict with visual order.
    createdAt: now - ((index * 7919) % 60_000),
    latestEventAt: now - ((index * 3571) % 60_000),
  }];
});
const snapshotFor = (projects) => {
  const activeProjects = activeProjectsFor(projects);
  return {
    id: architectB,
    project: "alpha",
    projectLabel: "Alpha",
    alias: "opal-b",
    createdAt: now - 3_600_000,
    events: [],
    activeProjects,
    sessions: activeProjects.filter((entry) => entry.project === "alpha"),
    agentStatus: "idle",
    children: [],
    conversation: { nodes: [], pending: [] },
    sessionMode: "architect",
    workflows: ["architect", "iterate", "find", "base"],
    dashboard: { schema: "qq.dashboard/v1", projects, usage: dashboard.usage },
  };
};
const smallProjects = dashboard.projects.slice(0, 4);
const expectedSmall = smallProjects.map((project) => `${project.name}\n${project.folder}`);
const overviewSnapshotFor = (projects) => ({
  ...snapshotFor(projects),
  scope: "projects",
  project: "",
  projectLabel: "Projects",
  folder: "",
});
const paths = {
  canonical: `/qq/project/alpha/session/${architectB}`,
  projectsBase: "/qq/project",
  projectsSession: "/qq/projects",
  createSession: "/qq/project/alpha/sessions",
  switchSession: "/qq/sessions/open",
  close: `/qq/session/${architectB}/close`,
  prompt: `/qq/session/${architectB}/prompt`,
  interrupt: `/qq/session/${architectB}/interrupt`,
};
const assetPaths = {
  css: "/qq/assets/console.css",
  browser: "/qq/assets/browser.js",
  htmx: "/qq/assets/htmx-2.0.10.min.js",
  sse: "/qq/assets/htmx-ext-sse-2.2.4.js",
  serviceWorker: "/qq/assets/sw.js",
  icon192: "/qq/assets/icon-v2-192.png",
  icon512: "/qq/assets/icon-v2-512.png",
  manifest: "/qq/assets/manifest.webmanifest",
};
const pages = {
  "/small": renderPage(snapshotFor(smallProjects), paths, assetPaths),
  "/small-overview": renderPage(overviewSnapshotFor(smallProjects), paths, assetPaths),
  "/many": renderPage(snapshotFor(dashboard.projects), paths, assetPaths),
};
const mime = (path) => path.endsWith(".css") ? "text/css; charset=utf-8"
  : path.endsWith(".js") ? "text/javascript; charset=utf-8"
    : path.endsWith(".png") ? "image/png"
      : path.endsWith(".woff2") ? "font/woff2" : "text/html; charset=utf-8";

async function fixtureServer() {
  const assetsByPath = new Map([
    ["/qq/assets/console.css", "assets/console.css"],
    ["/qq/assets/browser.js", "assets/browser-v9.js"],
    ["/qq/assets/htmx-2.0.10.min.js", "vendor/htmx-2.0.10.min.js"],
    ["/qq/assets/htmx-ext-sse-2.2.4.js", "vendor/htmx-ext-sse-2.2.4.js"],
    ["/qq/assets/icon-v2-192.png", "assets/icon-v2-192.png"],
    ["/qq/assets/geist-latin-wght-normal-5.3.0.woff2", "assets/geist-latin-wght-normal-5.3.0.woff2"],
    ["/qq/assets/geist-latin-wght-italic-5.3.0.woff2", "assets/geist-latin-wght-italic-5.3.0.woff2"],
  ]);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://fixture.invalid").pathname;
    const source = assetsByPath.get(pathname);
    if (source) {
      response.writeHead(200, { "Content-Type": mime(source), "Cache-Control": "no-store" });
      response.end(await readFile(join(root, source)));
      return;
    }
    if (pathname.endsWith(".js") || pathname.endsWith(".webmanifest") || pathname.endsWith("sw.js")) {
      response.writeHead(200, { "Content-Type": mime(pathname), "Cache-Control": "no-store" });
      response.end(pathname.endsWith(".webmanifest") ? "{}" : "");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(pages[pathname] ?? pages["/many"]);
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  return server;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        this.exceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "browser exception");
        return;
      }
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    };
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolveOpen, reject) => {
      this.socket.onopen = resolveOpen;
      this.socket.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function connectChrome(debugPort, expectedUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(expectedUrl));
      if (target?.webSocketDebuggerUrl) {
        const cdp = new Cdp(target.webSocketDebuggerUrl);
        await cdp.open();
        return cdp;
      }
    } catch { /* Chrome is starting. */ }
    await sleep(50);
  }
  throw new Error("Chromium DevTools target did not start");
}

const fixture = await fixtureServer();
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
let chromeErrors = "";
async function launchChrome(path, { app = false } = {}) {
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "qq-sessions-rendered-"));
  const url = `${fixtureOrigin}${path}`;
  const args = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-background-networking", "--disable-component-update", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    ...(app ? [`--app=${url}`] : [url]),
  ];
  const child = spawn(chromeBinary, args, { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (chunk) => { chromeErrors += chunk; });
  const cdp = await connectChrome(debugPort, url);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { child, cdp, profile, url };
}
async function closeChrome(chrome) {
  try { await chrome.cdp.send("Browser.close"); } catch { chrome.child.kill("SIGKILL"); }
  chrome.cdp.close();
  await Promise.race([
    new Promise((resolveExit) => chrome.child.once("exit", resolveExit)),
    sleep(1_000).then(() => chrome.child.kill("SIGKILL")),
  ]);
  await rm(chrome.profile, { recursive: true, force: true });
}
async function waitForPaint(cdp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await cdp.evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.live-tracker'))`);
    if (ready) break;
    await sleep(25);
  }
  await sleep(180);
}
async function screenshot(cdp, name) {
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(capture.data, "base64"));
}
async function accessibleNewSessionCount(cdp) {
  const tree = await cdp.send("Accessibility.getFullAXTree");
  return tree.nodes.filter((node) => !node.ignored && node.name?.value === "New session").length;
}
const openNavigation = (cdp) => cdp.evaluate(`document.querySelector('.session-heading-start').click()`);
const openOverview = (cdp) => cdp.evaluate(`(() => {
  const nav = document.querySelector('.active-projects');
  nav.focus();
  nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);

const inspectExpression = `(() => {
  const identity = (node) => node ? (node.dataset.project || '') + '\\n' + (node.dataset.folder || '') : '';
  const projects = [...document.querySelectorAll('.active-project-item[data-project]')];
  const groups = [...document.querySelectorAll('.live-tracker-project[data-project]')];
  const visibleGroups = groups.filter((group) => !group.hidden);
  const projectPort = document.querySelector('.active-projects');
  const groupPort = document.querySelector('.live-tracker');
  const composerShell = document.querySelector('#session-composer');
  const rail = document.querySelector('#project-rail');
  const railStyle = rail ? getComputedStyle(rail) : null;
  const createForms = [...(groupPort?.querySelectorAll('form.new-session') ?? [])];
  const createButtons = createForms.flatMap((form) => [...form.querySelectorAll('button[type="submit"]')]);
  const clientRect = (node) => {
    const box = node?.getBoundingClientRect();
    return box ? {
      left: box.left + (node.clientLeft || 0), top: box.top + (node.clientTop || 0),
      right: box.left + (node.clientLeft || 0) + node.clientWidth,
      bottom: box.top + (node.clientTop || 0) + node.clientHeight,
    } : null;
  };
  const elementRect = (node) => {
    const box = node?.getBoundingClientRect();
    return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
  };
  const projectVisibilityClip = clientRect(projectPort);
  const rawGroupVisibilityClip = clientRect(groupPort);
  const composerRect = elementRect(composerShell);
  const narrowNav = document.body.classList.contains('nav-mode')
    && !matchMedia('(min-width: 42.01rem)').matches;
  const composerStyle = composerShell ? getComputedStyle(composerShell) : null;
  const composerCoversTracker = Boolean(narrowNav && rawGroupVisibilityClip && composerRect
    && composerStyle?.display !== 'none' && composerStyle?.visibility !== 'hidden'
    && composerRect.width > 0 && composerRect.height > 0
    && composerRect.left < rawGroupVisibilityClip.right && composerRect.right > rawGroupVisibilityClip.left
    && composerRect.top < rawGroupVisibilityClip.bottom && composerRect.bottom > rawGroupVisibilityClip.top);
  const groupVisibilityClip = rawGroupVisibilityClip ? {
    ...rawGroupVisibilityClip,
    bottom: composerCoversTracker
      ? Math.max(rawGroupVisibilityClip.top, Math.min(rawGroupVisibilityClip.bottom, composerRect.top))
      : rawGroupVisibilityClip.bottom,
  } : null;
  const visibleSlice = (node, clip) => {
    const box = node?.getBoundingClientRect();
    if (!box || !clip) return null;
    const slice = {
      left: Math.max(box.left, clip.left), top: Math.max(box.top, clip.top),
      right: Math.min(box.right, clip.right), bottom: Math.min(box.bottom, clip.bottom),
    };
    const meaningfulHeight = Math.min(12, Math.max(4, box.height * .35));
    return slice.right - slice.left >= 8 && slice.bottom - slice.top >= meaningfulHeight ? slice : null;
  };
  const groupByIdentity = new Map(groups.map((group) => [identity(group), group]));
  const connectorPairVisible = (project, groupClip) => {
    const group = groupByIdentity.get(identity(project));
    const projectBox = project?.getBoundingClientRect();
    const groupBox = group?.getBoundingClientRect();
    const sessionsBox = group?.querySelector('.live-tracker-sessions')?.getBoundingClientRect();
    const projectSlice = visibleSlice(project, projectVisibilityClip);
    const groupSlice = visibleSlice(group, groupClip);
    if (group?.hidden || !projectBox || !groupBox || !sessionsBox || !projectSlice || !groupSlice) return false;
    const sourceY = (projectBox.top + projectBox.bottom) / 2;
    const preferredBaseline = groupBox.bottom + 4;
    const baselineY = Math.abs(preferredBaseline - sourceY) >= 1
      ? preferredBaseline : preferredBaseline + (preferredBaseline >= sourceY ? 2 : -2);
    return sourceY >= projectSlice.top - .01 && sourceY <= projectSlice.bottom + .01
      && baselineY >= groupClip.top + .75 && baselineY <= groupClip.bottom - .75
      && sessionsBox.right > sessionsBox.left;
  };
  const visiblePairSequenceFor = (groupClip) => projects.flatMap((project) => (
    connectorPairVisible(project, groupClip) ? [identity(project)] : []
  ));
  const rawVisiblePairSequence = visiblePairSequenceFor(rawGroupVisibilityClip);
  const visiblePairSequence = visiblePairSequenceFor(groupVisibilityClip);
  const composerOccludedPairSequence = rawVisiblePairSequence
    .filter((identity) => !visiblePairSequence.includes(identity));
  const layer = document.querySelector('#session-connectors');
  const paths = [...document.querySelectorAll('#session-connectors path[data-project][data-folder]')];
  const route = (path) => {
    const d = path.getAttribute('d') || '';
    const tokens = d.trim().split(/\\s+/);
    const values = [tokens[1], tokens[2], tokens[4], tokens[6], tokens[8]].map(Number);
    const parsed = tokens.length === 9 && tokens[0] === 'M' && tokens[3] === 'H'
      && tokens[5] === 'V' && tokens[7] === 'H' && values.every(Number.isFinite);
    const start = parsed ? { x: values[0], y: values[1] } : { x: NaN, y: NaN };
    const laneX = parsed ? values[2] : NaN;
    const baselineY = parsed ? values[3] : NaN;
    const end = parsed ? { x: values[4], y: baselineY } : { x: NaN, y: NaN };
    const style = getComputedStyle(path);
    const project = projects.find((candidate) => identity(candidate) === identity(path));
    const group = groupByIdentity.get(identity(path));
    const projectBox = project?.getBoundingClientRect();
    const groupBox = group?.getBoundingClientRect();
    const sessionsBox = group?.querySelector('.live-tracker-sessions')?.getBoundingClientRect();
    const contentLeft = groupBox && sessionsBox ? Math.max(groupBox.left, sessionsBox.left) : NaN;
    const openGap = contentLeft - start.x;
    const channelMidpoint = start.x + (openGap / 2);
    const projectGapArm = laneX - start.x;
    const sessionGapArm = contentLeft - laneX;
    const shorterGapArm = Math.min(projectGapArm, sessionGapArm);
    const gapArmRatio = shorterGapArm > 0
      ? Math.max(projectGapArm, sessionGapArm) / shorterGapArm : Infinity;
    const projectSlice = visibleSlice(project, projectVisibilityClip);
    const nextGroup = group ? groups[groups.indexOf(group) + 1] : null;
    const nextGroupBox = nextGroup?.getBoundingClientRect();
    const segments = parsed ? [
      { axis: 'h', fixed: start.y, from: start.x, to: laneX, name: 'source' },
      { axis: 'v', fixed: laneX, from: start.y, to: baselineY, name: 'lane' },
      { axis: 'h', fixed: baselineY, from: laneX, to: end.x, name: 'underline' },
    ] : [];
    return {
      identity: identity(path), d, length: path.getTotalLength(), start, end, laneX, baselineY, segments,
      contentLeft, openGap, channelMidpoint, projectGapArm, sessionGapArm, gapArmRatio,
      centeredLane: Number.isFinite(channelMidpoint) && openGap > 0
        && Math.abs(laneX - channelMidpoint) <= (openGap * .2) + .5,
      balancedGapArms: Number.isFinite(gapArmRatio) && gapArmRatio <= 2.25,
      strokeWidth: Number.parseFloat(style.strokeWidth), stroke: style.stroke,
      opacity: Number.parseFloat(style.opacity), display: style.display, visibility: style.visibility,
      vectorEffect: style.vectorEffect, lineJoin: style.strokeLinejoin, lineCap: style.strokeLinecap,
      orthogonal: Boolean(parsed),
      bends: Boolean(parsed && Math.abs(laneX - start.x) > .5
        && Math.abs(baselineY - start.y) > .5 && Math.abs(end.x - laneX) > .5),
      startAttached: Boolean(projectBox && projectSlice)
        && Math.abs(start.x - projectBox.right) <= 2
        && Math.abs(start.y - ((projectBox.top + projectBox.bottom) / 2)) <= 1
        && start.y >= projectSlice.top - 1 && start.y <= projectSlice.bottom + 1,
      laneInChannel: Boolean(sessionsBox) && laneX > start.x && laneX < sessionsBox.left,
      underlineAttached: Boolean(groupBox && sessionsBox)
        && baselineY >= groupBox.bottom + 1.9 && baselineY <= groupBox.bottom + 6.1
        && laneX < groupBox.left
        && Math.abs(end.x - sessionsBox.right) <= 2,
      baselineClear: !nextGroupBox || baselineY <= nextGroupBox.top - 2,
      insideVisibility: Boolean(projectVisibilityClip && groupVisibilityClip && sessionsBox)
        && start.y >= projectVisibilityClip.top - 1 && start.y <= projectVisibilityClip.bottom + 1
        && baselineY >= groupVisibilityClip.top - 1 && baselineY <= groupVisibilityClip.bottom + 1
        && end.x >= groupVisibilityClip.left - 1 && end.x <= groupVisibilityClip.right + 1
        && (!composerCoversTracker || Math.max(start.y, baselineY) <= composerRect.top + 1),
    };
  };
  const routes = paths.map(route);
  const range = (segment) => [Math.min(segment.from, segment.to), Math.max(segment.from, segment.to)];
  const segmentConflict = (left, right) => {
    if (left.axis === right.axis) {
      if (Math.abs(left.fixed - right.fixed) > .01) return '';
      const [leftMin, leftMax] = range(left);
      const [rightMin, rightMax] = range(right);
      return Math.min(leftMax, rightMax) >= Math.max(leftMin, rightMin) - .01 ? 'coincident' : '';
    }
    const horizontal = left.axis === 'h' ? left : right;
    const vertical = left.axis === 'v' ? left : right;
    const [horizontalMin, horizontalMax] = range(horizontal);
    const [verticalMin, verticalMax] = range(vertical);
    return vertical.fixed >= horizontalMin - .01 && vertical.fixed <= horizontalMax + .01
      && horizontal.fixed >= verticalMin - .01 && horizontal.fixed <= verticalMax + .01 ? 'intersection' : '';
  };
  const routeConflicts = [];
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      for (const leftSegment of routes[left].segments) {
        for (const rightSegment of routes[right].segments) {
          const kind = segmentConflict(leftSegment, rightSegment);
          if (kind) routeConflicts.push({
            left: routes[left].identity, leftSegment: leftSegment.name,
            right: routes[right].identity, rightSegment: rightSegment.name, kind,
          });
        }
      }
    }
  }
  const alphaGroup = groups.find((group) => group.dataset.project === 'alpha' && (group.dataset.folder || '') === '');
  const child = alphaGroup?.querySelector('.live-tracker-child-strip .live-tracker-session');
  const childStyle = child ? getComputedStyle(child) : null;
  const childElbowStyle = child ? getComputedStyle(child, '::before') : null;
  const headingVisibility = visibleGroups.map((group) => {
    const heading = group.querySelector('.live-tracker-project-name');
    const style = heading ? getComputedStyle(heading) : null;
    const box = heading?.getBoundingClientRect();
    return {
      text: heading?.textContent.trim() || '', id: heading?.id || '',
      labelled: Boolean(heading?.id && group.getAttribute('aria-labelledby') === heading.id),
      position: style?.position || '', width: box?.width || 0, height: box?.height || 0,
      clipPath: style?.clipPath || '', overflow: style?.overflow || '',
    };
  });
  return {
    standalone: matchMedia('(display-mode: standalone)').matches,
    navMode: document.body.classList.contains('nav-mode'),
    overview: groupPort?.dataset.overview === 'true',
    narrowNav,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      || document.body.scrollWidth > document.documentElement.clientWidth + 1,
    railBorderRightWidth: Number.parseFloat(railStyle?.borderRightWidth || '0'),
    railBorderRightStyle: railStyle?.borderRightStyle || '',
    newSession: {
      count: createForms.length,
      visibleCount: createForms.filter((form) => {
        const style = getComputedStyle(form);
        const box = form.getBoundingClientRect();
        return !form.hidden && style.display !== 'none' && style.visibility !== 'hidden'
          && box.width > 0 && box.height > 0;
      }).length,
      tabbableCount: createButtons.filter((button) => !button.disabled && button.tabIndex >= 0).length,
      labelledCount: createButtons.filter((button) => button.getAttribute('aria-label') === 'New session').length,
      action: createForms[0] ? new URL(createForms[0].action, location.href).pathname : '',
      method: createForms[0]?.method || '',
    },
    connectorElements: document.querySelectorAll('#session-connectors').length,
    connectorLayerHidden: !layer || getComputedStyle(layer).display === 'none' || getComputedStyle(layer).visibility === 'hidden',
    connectorPointerEvents: layer ? getComputedStyle(layer).pointerEvents : '',
    connectorPaths: routes,
    connectorPathIdentities: routes.map((entry) => entry.identity),
    projectVisibilityClip,
    rawGroupVisibilityClip,
    groupVisibilityClip,
    composerRect,
    composerCoversTracker,
    rawVisiblePairSequence,
    visiblePairSequence,
    composerOccludedPairSequence,
    routeConflicts,
    projectSequence: projects.map(identity),
    groupSequence: groups.map(identity),
    groupHeadings: groups.map((group) => group.querySelector('.live-tracker-project-name')?.textContent.trim() || ''),
    visibleGroups: visibleGroups.map(identity),
    projectVisualTops: projects.map((item) => item.offsetTop),
    groupVisualTops: visibleGroups.map((group) => group.offsetTop),
    headingVisibility,
    alphaRows: alphaGroup ? [...alphaGroup.querySelectorAll('.live-tracker-session')].map((row) => ({ id: row.dataset.sessionId, depth: Number(row.dataset.depth) })) : [],
    duplicateStudio: groups.filter((group) => group.dataset.project === 'studio').map(identity),
    child: child ? {
      display: childStyle.display,
      direction: childStyle.flexDirection,
      justify: childStyle.justifyContent,
      minHeight: childStyle.minHeight,
      identity: child.querySelector('.live-tracker-face')?.textContent.trim() || '',
      phase: child.querySelector('.live-tracker-phase')?.textContent.trim() || '',
      elapsed: child.querySelector('.live-tracker-elapsed')?.textContent.trim() || '',
      elapsedOwner: child.querySelectorAll('.live-tracker-elapsed').length,
      fullRowLink: child.parentElement?.tagName === 'LI',
      elbow: childElbowStyle ? {
        borderLeftWidth: childElbowStyle.borderLeftWidth,
        borderLeftStyle: childElbowStyle.borderLeftStyle,
        borderBottomWidth: childElbowStyle.borderBottomWidth,
        borderBottomStyle: childElbowStyle.borderBottomStyle,
        pointerEvents: childElbowStyle.pointerEvents,
      } : null,
    } : null,
    idleParentElapsedCount: alphaGroup?.querySelector('.live-tracker-session[data-session-id="${architectB}"] .live-tracker-elapsed')?.textContent.trim() ? 1 : 0,
    scroll: {
      projectTop: projectPort?.scrollTop || 0,
      projectHeight: projectPort?.clientHeight || 0,
      projectScrollHeight: projectPort?.scrollHeight || 0,
      trackerTop: groupPort?.scrollTop || 0,
      trackerHeight: groupPort?.clientHeight || 0,
      trackerScrollHeight: groupPort?.scrollHeight || 0,
    },
  };
})()`;
async function inspect(cdp, name, { capture = true } = {}) {
  await sleep(90);
  const state = await cdp.evaluate(inspectExpression);
  assert.deepEqual(cdp.exceptions, [], `${name}: browser has no uncaught runtime exception`);
  if (capture) await screenshot(cdp, name);
  return state;
}
async function nativeProjectFocusSequence(cdp, count) {
  await cdp.evaluate(`document.querySelector('.active-project-item[data-project]')?.focus()`);
  const sequence = [];
  for (let index = 0; index < count; index += 1) {
    sequence.push(await cdp.evaluate(`(() => {
      const item = document.activeElement?.closest?.('.active-project-item[data-project]');
      return item ? (item.dataset.project || '') + '\\n' + (item.dataset.folder || '') : '';
    })()`));
    if (index + 1 < count) {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    }
  }
  return sequence;
}
const ascending = (values) => values.every((value, index) => index === 0 || value >= values[index - 1]);
const createActionFor = (identity) => {
  const [project, folder = ""] = identity.split("\n");
  return `/qq/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/sessions`;
};
function assertNoCenterDivider(state) {
  if (!state.narrowNav) return;
  assert.equal(state.railBorderRightWidth, 0,
    "narrow installed-app project/session split has no full-height center divider");
}
function assertSelected(state, expected, selected = "alpha\n") {
  assert.equal(state.connectorPaths.length, 0, "selected mode has zero project connector paths");
  assert.ok(state.connectorElements === 0 || state.connectorLayerHidden,
    "selected mode removes or hides an empty connector layer");
  assert.equal(state.overview, false, "one project group is selected");
  assert.deepEqual(state.projectSequence, expected, "left DOM/reading order is canonical");
  assert.deepEqual(state.groupSequence, expected, "right DOM/reading order matches the left exactly");
  assert.deepEqual(state.visibleGroups, [selected], "selected mode exposes only its authoritative project group");
  assert.deepEqual(state.newSession, {
    count: 1, visibleCount: 1, tabbableCount: 1, labelledCount: 1,
    action: createActionFor(selected), method: "post",
  }, "selected-project mode exposes one labelled, tabbable add-session form for the exact project/folder");
  assertNoCenterDivider(state);
}
function assertOverview(state, expected) {
  assert.equal(state.overview, true, "overview mode is active");
  assert.deepEqual(state.newSession, {
    count: 0, visibleCount: 0, tabbableCount: 0, labelledCount: 0, action: "", method: "",
  }, "all-project overview has no rendered, visible, interactive, or accessibility-exposed add-session control");
  assertNoCenterDivider(state);
  assert.equal(state.horizontalOverflow, false, "connector routing and its viewport SVG create no horizontal overflow");
  assert.equal(state.connectorElements, 1, "overview has one viewport connector layer");
  assert.equal(state.connectorPointerEvents, "none", "relationship routes never intercept full-row interaction");
  assert.deepEqual(state.connectorPathIdentities, state.visiblePairSequence,
    "overview has exactly one route for each meaningfully visible authoritative pair");
  assert.ok(state.connectorPaths.length > 0, "overview normally exposes visible relationship routes");
  assert.ok(state.connectorPaths.every((route) => route.display !== "none" && route.visibility === "visible" && route.opacity > 0),
    "every emitted relationship route is normally visible without hover or focus");
  assert.ok(state.connectorPaths.every((route) => route.strokeWidth > 0 && route.strokeWidth <= 1
    && route.vectorEffect === "non-scaling-stroke" && route.lineJoin === "miter" && route.lineCap === "butt"),
  "all relationship routes retain square, non-scaling quiet hairline styling");
  if (diagnose) {
    const invalid = state.connectorPaths.filter((route) => !route.orthogonal || !route.bends)
      .map(({ identity, d, orthogonal, bends, start, laneX, baselineY, end }) => (
        { identity, d, orthogonal, bends, start, laneX, baselineY, end }
      ));
    if (invalid.length) console.error("invalid connector bends", invalid);
  }
  assert.ok(state.connectorPaths.every((route) => route.orthogonal && route.bends),
    "every overview relationship has horizontal/vertical bends and no diagonal or curved segment");
  assert.ok(state.connectorPaths.every((route) => route.startAttached && route.laneInChannel),
    "each route starts at its matching project center and enters a gutter-only vertical lane");
  assert.ok(state.connectorPaths.every((route) => route.centeredLane && route.balancedGapArms),
    "each vertical lane stays near its real open-gap midpoint so the two gap arms remain intentionally comparable");
  if (diagnose) {
    const invalid = state.connectorPaths.filter((route) => !route.underlineAttached || !route.baselineClear)
      .map(({ identity, d, underlineAttached, baselineClear, start, laneX, baselineY, end }) => (
        { identity, d, underlineAttached, baselineClear, start, laneX, baselineY, end }
      ));
    if (invalid.length) console.error("invalid connector underlines", invalid);
  }
  assert.ok(state.connectorPaths.every((route) => route.underlineAttached && route.baselineClear),
    "each final segment is one visible underline immediately below and across its matching session group");
  assert.ok(state.connectorPaths.every((route) => route.insideVisibility),
    "routes remain in their project/tracker bands and above actual composer occlusion");
  assert.equal(new Set(state.connectorPaths.map((route) => route.laneX.toFixed(2))).size, state.connectorPaths.length,
    "every simultaneously visible route owns a unique vertical lane");
  assert.deepEqual(state.routeConflicts, [],
    "routes have no coincident segments or pairwise horizontal/vertical intersections");
  assert.deepEqual(state.projectSequence, expected, "left project identities keep canonical order");
  assert.deepEqual(state.groupSequence, expected, "right group identities exactly match canonical left order");
  assert.deepEqual(state.visibleGroups, expected, "overview exposes every group in reading order");
  assert.ok(ascending(state.projectVisualTops), "left visual top order follows DOM order");
  assert.ok(ascending(state.groupVisualTops), "right visual top order follows DOM order despite uneven heights");
  assert.ok(state.headingVisibility.every((heading) => heading.text && heading.id && heading.labelled
    && heading.position === "absolute" && heading.width <= 1 && heading.height <= 1
    && heading.overflow === "hidden" && heading.clipPath !== "none"),
  "duplicate project headings are visually hidden while retaining labelled accessible text");
}


async function menuState(cdp) {
  return cdp.evaluate(`(() => {
    const menu = document.querySelector('.console-menu');
    const summary = menu?.querySelector(':scope > summary');
    const action = menu?.querySelector('.usage-choice');
    return {
      exists: Boolean(menu),
      open: Boolean(menu?.open),
      summaryLabel: summary?.getAttribute('aria-label') ?? '',
      actionText: action?.textContent ?? '',
      actionTag: action?.tagName ?? '',
      actionExpanded: action?.getAttribute('aria-expanded') ?? '',
      workflowValues: [...(menu?.querySelectorAll('.workflows-choice') ?? [])].map((button) => button.value),
      formMethod: menu?.querySelector('.workflows-menu-list')?.method ?? '',
      focused: document.activeElement?.className || document.activeElement?.tagName || '',
    };
  })()`);
}

async function pressKey(cdp, key) {
  await cdp.evaluate(`document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
}

async function usageLayout(cdp, name, { capture = true } = {}) {
  await waitForPaint(cdp);
  if (capture) await screenshot(cdp, name);
  return cdp.evaluate(`(() => {
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const view = document.querySelector('#session-usage');
    const chrome = document.querySelector('#session-chrome');
    const composer = document.querySelector('#session-composer');
    const providers = [...document.querySelectorAll('.usage-provider')];
    const qwen = providers.find((provider) => provider.querySelector('h3')?.textContent === 'Qwen');
    const unavailable = providers.find((provider) => provider.querySelector('h3')?.textContent === 'Grok');
    const bars = [...document.querySelectorAll('.usage-meter-fill')];
    const values = [...document.querySelectorAll('.usage-meter-value')].map((node) => ({ text: node.textContent, aria: node.getAttribute('aria-label') }));
    const providerTops = providers.map((provider) => provider.getBoundingClientRect().top);
    return {
      selected: document.querySelector('#session-panel')?.dataset.consoleView ?? '',
      display: getComputedStyle(view).display,
      transcriptDisplay: getComputedStyle(document.querySelector('#transcript')).display,
      view: rect(view), chrome: rect(chrome), composer: rect(composer),
      viewport: { width: innerWidth, height: innerHeight },
      overflow: view.scrollWidth > view.clientWidth + 1,
      providerCount: providers.length,
      providerTops,
      values,
      qwenMeters: [...(qwen?.querySelectorAll('.usage-meter-label') ?? [])].map((node) => node.textContent),
      qwenDetails: [...(qwen?.querySelectorAll('.usage-meter-detail') ?? [])].map((node) => node.textContent),
      qwenResetCount: qwen?.querySelectorAll('.usage-reset').length ?? 0,
      unavailableMeters: unavailable?.querySelectorAll('.usage-meter').length ?? -1,
      unavailableText: unavailable?.textContent ?? '',
      maximumBarWidth: Math.max(0, ...bars.map((bar) => bar.getBoundingClientRect().width / bar.parentElement.getBoundingClientRect().width)),
      idsLeaked: document.querySelector('.usage-content')?.textContent.includes('five-hour')
        || document.querySelector('.usage-content')?.textContent.includes('weekly')
        || document.querySelector('.usage-content')?.textContent.includes('qwen'),
      menuOpen: Boolean(document.querySelector('.console-menu')?.open),
      activeId: document.activeElement?.id ?? '',
      connectorPaths: document.querySelectorAll('.session-connectors path').length,
    };
  })()`);
}

function assertUsageLayout(state, { narrow = false } = {}) {
  assert.equal(state.selected, "usage", "the general action selects usage view state");
  assert.equal(state.display, "flex", "usage view is visibly rendered");
  assert.equal(state.transcriptDisplay, "none", "usage replaces rather than overlays transcript content");
  assert.ok(state.view && state.chrome && state.composer
    && state.view.top >= state.chrome.bottom - 1
    && state.view.bottom <= state.composer.top + 1,
  "usage remains between protected chrome and composer controls");
  assert.equal(state.overflow, false, "usage view has no horizontal viewport overflow");
  assert.equal(state.providerCount, 3, "all provider rows render");
  assert.deepEqual(state.qwenMeters, ["5h", "7d"], "Qwen renders both human meter labels");
  assert.deepEqual(state.qwenDetails, ["4200 / 10000 estimated", "44000 / 40000 estimated"]);
  assert.equal(state.qwenResetCount, 1, "null reset is omitted while known reset is shown");
  assert.equal(state.unavailableMeters, 0, "unavailable provider has no fake meter");
  assert.match(state.unavailableText, /unavailable[\s\S]*No usage reading is available\./);
  assert.ok(state.values.some((value) => value.text === "110%" && value.aria === "110% used"),
    "over-limit usage remains numeric and assistive");
  assert.ok(state.maximumBarWidth <= 1.001, "visual bars alone are clamped");
  assert.equal(state.idsLeaked, false, "provider and meter IDs are not visible");
  assert.equal(state.menuOpen, false, "usage action closes its menu");
  if (narrow) assert.equal(new Set(state.providerTops).size, 3, "narrow installed app stacks providers in one column");
}

await mkdir(artifacts, { recursive: true });
try {
  const report = {};

  // A projects-scope document starts directly in overview with no destinationless
  // add control, then gains/removes the exact control through client-side transitions.
  const initialOverviewPwa = await launchChrome("/small-overview", { app: true });
  await initialOverviewPwa.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 700, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 700,
  });
  await waitForPaint(initialOverviewPwa.cdp);
  report.pwaInitialOverviewClosed = await inspect(initialOverviewPwa.cdp, "pwa-initial-overview-closed", { capture: false });
  assert.equal(report.pwaInitialOverviewClosed.overview, true, "initial projects-scope render remains in overview during client startup");
  assert.equal(report.pwaInitialOverviewClosed.newSession.count, 0, "initial overview markup and startup expose no add control");
  assert.equal(report.pwaInitialOverviewClosed.connectorPaths.length, 0, "closed initial narrow navigation has no routes");
  await openNavigation(initialOverviewPwa.cdp);
  report.pwaInitialOverview = await inspect(initialOverviewPwa.cdp, "pwa-initial-overview");
  assertOverview(report.pwaInitialOverview, expectedSmall);
  assert.equal(await accessibleNewSessionCount(initialOverviewPwa.cdp), 0,
    "initial overview exposes no New session control in Chromium's accessibility tree");
  await initialOverviewPwa.cdp.evaluate(`document.querySelector('.active-project-item[data-project="beta"][data-folder=""]')?.click()`);
  report.pwaInitialSelected = await inspect(initialOverviewPwa.cdp, "pwa-initial-selected", { capture: false });
  assertSelected(report.pwaInitialSelected, expectedSmall, "beta\n");
  assert.equal(await accessibleNewSessionCount(initialOverviewPwa.cdp), 1,
    "selected-project transition exposes exactly one labelled New session control to accessibility APIs");
  await openOverview(initialOverviewPwa.cdp);
  report.pwaInitialOverviewReentered = await inspect(initialOverviewPwa.cdp, "pwa-initial-overview-reentered", { capture: false });
  assertOverview(report.pwaInitialOverviewReentered, expectedSmall);
  assert.equal(await accessibleNewSessionCount(initialOverviewPwa.cdp), 0,
    "returning to overview removes New session from Chromium's accessibility tree");
  await closeChrome(initialOverviewPwa);

  // Desktop verifies the unfiltered initial state, canonical order, native Tab
  // sequence, independent pane scrolling, resize, and a live chrome replacement.
  const desktop = await launchChrome("/many");
  await desktop.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitForPaint(desktop.cdp);
  report.menuClosed = await menuState(desktop.cdp);
  assert.deepEqual({
    exists: report.menuClosed.exists,
    open: report.menuClosed.open,
    summaryLabel: report.menuClosed.summaryLabel,
    actionText: report.menuClosed.actionText,
    actionTag: report.menuClosed.actionTag,
    workflowValues: report.menuClosed.workflowValues,
    formMethod: report.menuClosed.formMethod,
  }, {
    exists: true,
    open: false,
    summaryLabel: "Console menu",
    actionText: "usage",
    actionTag: "A",
    workflowValues: ["/workflows architect", "/workflows iterate", "/workflows find"],
    formMethod: "post",
  }, "general menu retains exact workflow submissions and adds one non-submit usage action");
  await desktop.cdp.evaluate(`document.querySelector('.console-menu > summary').focus()`);
  await pressKey(desktop.cdp, "Enter");
  report.menuKeyboardOpen = await menuState(desktop.cdp);
  assert.ok(report.menuKeyboardOpen.open && String(report.menuKeyboardOpen.focused).includes("workflows-current"),
    "Enter opens the general menu and preserves current-workflow focus semantics");
  await desktop.cdp.evaluate(`(() => {
    const form = document.querySelector('.workflows-menu-list');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.__workflowSubmission = event.submitter?.name === 'prompt' ? event.submitter.value : null;
    }, { capture: true, once: true });
  })()`);
  await pressKey(desktop.cdp, "Enter");
  assert.equal(await desktop.cdp.evaluate(`window.__workflowSubmission`), "/workflows architect",
    "keyboard activation still submits the exact current workflow form value");
  await pressKey(desktop.cdp, "ArrowUp");
  report.menuUsageFocused = await menuState(desktop.cdp);
  assert.ok(String(report.menuUsageFocused.focused).includes("usage-choice"), "arrow traversal includes usage");
  await pressKey(desktop.cdp, "Escape");
  report.menuEscape = await menuState(desktop.cdp);
  assert.ok(!report.menuEscape.open && report.menuEscape.focused === "SUMMARY", "Escape closes and restores summary focus");
  await desktop.cdp.evaluate(`document.querySelector('.console-menu > summary').click()`);
  await desktop.cdp.evaluate(`document.body.click()`);
  assert.equal((await menuState(desktop.cdp)).open, false, "outside click closes the general menu");
  report.menuOpenUsageSwap = await desktop.cdp.evaluate(`(() => {
    const menu = document.querySelector('.console-menu');
    menu.open = true;
    const current = menu.querySelector('.workflows-current');
    current.focus();
    const usage = document.querySelector('#session-usage');
    usage.innerHTML = usage.innerHTML.replace('4200 / 10000 estimated', '4300 / 10000 estimated');
    document.dispatchEvent(new CustomEvent('htmx:afterSwap', { detail: { target: usage } }));
    return {
      sameMenu: menu === document.querySelector('.console-menu'),
      open: menu.open,
      focused: document.activeElement === current,
      detailUpdated: usage.textContent.includes('4300 / 10000 estimated'),
    };
  })()`);
  assert.deepEqual(report.menuOpenUsageSwap, { sameMenu: true, open: true, focused: true, detailUpdated: true },
    "meaningful usage update replaces only usage while an open menu and its focus persist");
  await pressKey(desktop.cdp, "Escape");
  report.menuClosedUsageSwap = await desktop.cdp.evaluate(`(() => {
    const menu = document.querySelector('.console-menu');
    const usage = document.querySelector('#session-usage');
    usage.innerHTML = usage.innerHTML.replace('4300 / 10000 estimated', '4200 / 10000 estimated');
    document.dispatchEvent(new CustomEvent('htmx:afterSwap', { detail: { target: usage } }));
    return { sameMenu: menu === document.querySelector('.console-menu'), open: menu.open };
  })()`);
  assert.deepEqual(report.menuClosedUsageSwap, { sameMenu: true, open: false },
    "usage update also leaves closed menu chrome untouched");
  await desktop.cdp.evaluate(`document.querySelector('.console-menu > summary').click(); document.querySelector('.usage-choice').click()`);
  report.desktopUsage = await usageLayout(desktop.cdp, "desktop-usage");
  assertUsageLayout(report.desktopUsage);
  assert.equal(report.desktopUsage.activeId, "usage-heading", "usage action moves focus to the view heading");
  assert.equal(report.desktopUsage.connectorPaths, 0, "selected-project mode keeps zero connector paths with usage open");
  await desktop.cdp.evaluate(`document.querySelector('.usage-close').click()`);
  assert.equal(await desktop.cdp.evaluate(`getComputedStyle(document.querySelector('#transcript')).display`), "flex",
    "transcript action restores the transcript content view");
  report.desktopSelected = await inspect(desktop.cdp, "desktop-selected", { capture: false });
  assertSelected(report.desktopSelected, expectedMany);
  report.desktopFocusSequence = await nativeProjectFocusSequence(desktop.cdp, expectedMany.length);
  assert.deepEqual(report.desktopFocusSequence, expectedMany,
    "native keyboard Tab traversal follows the same canonical visible project sequence");
  await openOverview(desktop.cdp);
  report.desktopOverview = await inspect(desktop.cdp, "desktop-overview");
  assertOverview(report.desktopOverview, expectedMany);
  assert.deepEqual(report.desktopOverview.alphaRows, [
    { id: architectB, depth: 0 }, { id: childB2, depth: 1 }, { id: childB1, depth: 1 },
    { id: architectA, depth: 0 }, { id: childA, depth: 1 },
  ], "architects and their authoritative direct children remain contiguous in browser focus order");
  assert.deepEqual(report.desktopOverview.duplicateStudio, ["studio\neast", "studio\nwest"],
    "duplicate project names remain distinct by authoritative folder identity");
  assert.ok(report.desktopOverview.child?.fullRowLink && report.desktopOverview.child?.display === "flex"
    && report.desktopOverview.child?.direction === "row" && report.desktopOverview.child?.justify === "flex-start",
  "compact child metadata remains a full-row, left-biased focus target");
  const childElbow = report.desktopOverview.child?.elbow;
  assert.ok(childElbow && childElbow.borderLeftStyle === "solid" && childElbow.borderBottomStyle === "solid"
    && Number.parseFloat(childElbow.borderLeftWidth) > 0
    && childElbow.borderLeftWidth === childElbow.borderBottomWidth
    && childElbow.pointerEvents === "none",
  "the architect-to-child orthogonal elbow remains intact and non-interactive");
  assert.equal(report.desktopOverview.child?.phase, "implementation", "child keeps its own workflow phase");
  assert.match(report.desktopOverview.child?.elapsed ?? "", /^\d+[mh]$/, "child keeps its own elapsed time");
  assert.equal(report.desktopOverview.child?.elapsedOwner, 1, "elapsed metadata belongs to the child row");
  assert.equal(report.desktopOverview.idleParentElapsedCount, 0, "idle architect does not inherit delegated elapsed time");
  await desktop.cdp.evaluate(`(() => {
    const tracker = document.querySelector('.live-tracker');
    const project = document.querySelector('.active-project-item[data-project="alpha"][data-folder=""]');
    const group = document.querySelector('.live-tracker-project[data-project="alpha"][data-folder=""]');
    const projectBox = project.getBoundingClientRect();
    const groupBox = group.getBoundingClientRect();
    tracker.scrollTop += groupBox.bottom + 4 - ((projectBox.top + projectBox.bottom) / 2);
  })()`);
  report.desktopBaselineAligned = await inspect(desktop.cdp, "desktop-baseline-aligned", { capture: false });
  assertOverview(report.desktopBaselineAligned, expectedMany);
  const alignedAlpha = report.desktopBaselineAligned.connectorPaths.find((route) => route.identity === "alpha\n");
  assert.ok(alignedAlpha && Math.abs(alignedAlpha.baselineY - alignedAlpha.start.y) >= 1.5,
    "exact source/baseline scroll alignment retains a visible orthogonal bend");
  await desktop.cdp.evaluate(`(() => {
    const tracker = document.querySelector('.live-tracker');
    const projects = document.querySelector('.active-projects');
    tracker.scrollTop = Math.min(140, tracker.scrollHeight - tracker.clientHeight);
    projects.scrollTop = Math.min(95, projects.scrollHeight - projects.clientHeight);
  })()`);
  report.desktopScrolled = await inspect(desktop.cdp, "desktop-scrolled", { capture: false });
  assertOverview(report.desktopScrolled, expectedMany);
  assert.ok(report.desktopScrolled.scroll.trackerTop > 0, "session groups scroll independently");
  await desktop.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1120, height: 720, deviceScaleFactor: 1, mobile: false });
  report.desktopResized = await inspect(desktop.cdp, "desktop-resized", { capture: false });
  assertOverview(report.desktopResized, expectedMany);
  await desktop.cdp.evaluate(`(() => {
    const oldChrome = document.querySelector('#session-chrome');
    const replacement = oldChrome.cloneNode(true);
    oldChrome.replaceWith(replacement);
    document.dispatchEvent(new CustomEvent('htmx:afterSwap', { detail: { target: replacement } }));
  })()`);
  report.desktopLiveSwap = await inspect(desktop.cdp, "desktop-live-swap", { capture: false });
  assertOverview(report.desktopLiveSwap, expectedMany);
  await closeChrome(desktop);

  // Installed/standalone narrow PWA: mandatory selected and small-overview images.
  const smallPwa = await launchChrome("/small", { app: true });
  await smallPwa.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 700, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 700,
  });
  await waitForPaint(smallPwa.cdp);
  report.smallClosed = await inspect(smallPwa.cdp, "small-closed", { capture: false });
  assert.equal(report.smallClosed.connectorPaths.length, 0, "closed narrow navigation suppresses relationship routes");
  await openNavigation(smallPwa.cdp);
  report.pwaSelected = await inspect(smallPwa.cdp, "pwa-selected");
  assert.ok(report.pwaSelected.standalone && report.pwaSelected.navMode, "selected screenshot is installed-PWA navigation");
  assertSelected(report.pwaSelected, expectedSmall);
  await openOverview(smallPwa.cdp);
  report.pwaSmallOverview = await inspect(smallPwa.cdp, "pwa-small-overview");
  assertOverview(report.pwaSmallOverview, expectedSmall);
  assert.deepEqual(report.pwaSmallOverview.connectorPathIdentities, expectedSmall,
    "small overview connects every meaningfully visible pair, including epsilon");
  const epsilonRoute = report.pwaSmallOverview.connectorPaths.find((route) => route.identity === "epsilon\n");
  assert.ok(epsilonRoute, "epsilon has its required project-to-group relationship line");
  assert.ok(epsilonRoute.end.y > report.pwaSmallOverview.projectVisibilityClip.bottom,
    "epsilon underline remains visible below the shorter centered left project list");
  assert.ok(report.pwaSmallOverview.composerCoversTracker
    && Math.abs(report.pwaSmallOverview.groupVisibilityClip.bottom - report.pwaSmallOverview.composerRect.top) < .01
    && epsilonRoute.end.y < report.pwaSmallOverview.composerRect.top,
  "small overview clips the right tracker at the actual composer while retaining epsilon’s underline above it");
  await smallPwa.cdp.evaluate(`document.body.click()`);
  report.smallClosedAfter = await inspect(smallPwa.cdp, "small-closed-after", { capture: false });
  assert.equal(report.smallClosedAfter.connectorPaths.length, 0, "closing narrow navigation suppresses relationship routes");
  await openNavigation(smallPwa.cdp);
  report.smallReopened = await inspect(smallPwa.cdp, "small-reopened", { capture: false });
  assertOverview(report.smallReopened, expectedSmall);
  await smallPwa.cdp.evaluate(`document.querySelector('.active-project-item[data-project="beta"][data-folder=""]')?.click()`);
  report.pwaReselected = await inspect(smallPwa.cdp, "pwa-reselected", { capture: false });
  assertSelected(report.pwaReselected, expectedSmall, "beta\n");
  await openOverview(smallPwa.cdp);
  report.pwaOverviewReentered = await inspect(smallPwa.cdp, "pwa-overview-reentered", { capture: false });
  assertOverview(report.pwaOverviewReentered, expectedSmall);
  await smallPwa.cdp.evaluate(`document.body.click()`);
  await waitForPaint(smallPwa.cdp);
  await smallPwa.cdp.evaluate(`document.querySelector('.console-menu > summary').click(); document.querySelector('.usage-choice').click()`);
  report.pwaUsagePortrait = await usageLayout(smallPwa.cdp, "pwa-usage-portrait");
  assertUsageLayout(report.pwaUsagePortrait, { narrow: true });
  assert.equal(report.pwaUsagePortrait.connectorPaths, 0, "portrait selected mode keeps zero connector paths with usage open");
  await smallPwa.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 640, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 640, screenHeight: 390,
  });
  report.pwaUsageRotated = await usageLayout(smallPwa.cdp, "pwa-usage-rotated");
  assertUsageLayout(report.pwaUsageRotated, { narrow: true });
  assert.equal(report.pwaUsageRotated.connectorPaths, 0, "rotated selected mode keeps zero connector paths with usage open");
  await closeChrome(smallPwa);

  // Installed/standalone many-project PWA: mandatory many, independently
  // scrolled, and rotated screenshots.
  const manyPwa = await launchChrome("/many", { app: true });
  await manyPwa.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 700, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 700,
  });
  await waitForPaint(manyPwa.cdp);
  await openNavigation(manyPwa.cdp);
  await openOverview(manyPwa.cdp);
  report.pwaManyOverview = await inspect(manyPwa.cdp, "pwa-many-overview");
  assertOverview(report.pwaManyOverview, expectedMany);
  assert.ok(report.pwaManyOverview.composerOccludedPairSequence.length > 0,
    "portrait fixture includes a project-visible group hidden by the actual composer");
  assert.ok(report.pwaManyOverview.composerOccludedPairSequence.every((identity) =>
    !report.pwaManyOverview.connectorPathIdentities.includes(identity)),
  "portrait overview omits every pair whose right group surface is composer-occluded");
  await manyPwa.cdp.evaluate(`(() => {
    const tracker = document.querySelector('.live-tracker');
    const projects = document.querySelector('.active-projects');
    tracker.scrollTop = Math.min(165, tracker.scrollHeight - tracker.clientHeight);
    projects.scrollTop = Math.min(110, projects.scrollHeight - projects.clientHeight);
  })()`);
  report.pwaScrolled = await inspect(manyPwa.cdp, "pwa-scrolled");
  assertOverview(report.pwaScrolled, expectedMany);
  assert.ok(report.pwaScrolled.scroll.trackerTop > 0 && report.pwaScrolled.scroll.projectTop > 0,
    "both narrow chooser panes were independently scrolled");
  await manyPwa.cdp.evaluate(`(() => {
    const tracker = document.querySelector('.live-tracker');
    const projects = document.querySelector('.active-projects');
    tracker.scrollTop = tracker.scrollHeight - tracker.clientHeight;
    projects.scrollTop = projects.scrollHeight - projects.clientHeight;
  })()`);
  report.pwaDuplicateFolders = await inspect(manyPwa.cdp, "pwa-duplicate-folders", { capture: false });
  assertOverview(report.pwaDuplicateFolders, expectedMany);
  assert.deepEqual(report.pwaDuplicateFolders.connectorPathIdentities.filter((identity) => identity.startsWith("studio\n")),
    ["studio\neast", "studio\nwest"],
    "duplicate names route independently to the correct authoritative folder groups");
  await manyPwa.cdp.evaluate(`(() => {
    document.querySelector('.live-tracker').scrollTop = 165;
    document.querySelector('.active-projects').scrollTop = 110;
  })()`);
  await manyPwa.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 640, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 640, screenHeight: 390,
  });
  report.pwaRotated = await inspect(manyPwa.cdp, "pwa-rotated");
  assertOverview(report.pwaRotated, expectedMany);
  assert.ok(report.pwaRotated.composerOccludedPairSequence.every((identity) =>
    !report.pwaRotated.connectorPathIdentities.includes(identity)),
  "rotated overview omits every pair whose right group surface is composer-occluded");
  await manyPwa.cdp.evaluate(`document.querySelector('.active-project-item[data-project="studio"][data-folder="east"]')?.click()`);
  report.pwaFolderSelected = await inspect(manyPwa.cdp, "pwa-folder-selected", { capture: false });
  assertSelected(report.pwaFolderSelected, expectedMany, "studio\neast");
  await openOverview(manyPwa.cdp);
  report.pwaFolderOverviewReentered = await inspect(manyPwa.cdp, "pwa-folder-overview-reentered", { capture: false });
  assertOverview(report.pwaFolderOverviewReentered, expectedMany);
  await closeChrome(manyPwa);

  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`sessions rendered proof ${diagnose ? "diagnosed" : "passed"}: ${artifacts}`);
} catch (error) {
  if (chromeErrors) error.message += `\nChromium: ${chromeErrors.slice(-2000)}`;
  throw error;
} finally {
  await new Promise((resolveClose) => fixture.close(resolveClose));
}
