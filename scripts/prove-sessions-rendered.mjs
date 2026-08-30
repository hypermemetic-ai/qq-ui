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
  { key: "p:beta:", name: "beta", label: "Beta", folder: "", folderLabel: "", sessions: [] },
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
const dashboard = validatedDashboardSnapshot({ schema: "qq.dashboard/v1", projects: sourceProjects });
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
    dashboard: { schema: "qq.dashboard/v1", projects },
  };
};
const smallProjects = dashboard.projects.slice(0, 4);
const expectedSmall = smallProjects.map((project) => `${project.name}\n${project.folder}`);
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
  const visiblePairSequenceFor = (groupClip) => projects.flatMap((project) => {
    const group = groupByIdentity.get(identity(project));
    return !group?.hidden && visibleSlice(project, projectVisibilityClip)
      && visibleSlice(group, groupClip) ? [identity(project)] : [];
  });
  const rawVisiblePairSequence = visiblePairSequenceFor(rawGroupVisibilityClip);
  const visiblePairSequence = visiblePairSequenceFor(groupVisibilityClip);
  const composerOccludedPairSequence = rawVisiblePairSequence
    .filter((identity) => !visiblePairSequence.includes(identity));
  const layer = document.querySelector('#session-connectors');
  const paths = [...document.querySelectorAll('#session-connectors path[data-project][data-folder]')];
  const route = (path) => {
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    const style = getComputedStyle(path);
    const project = projects.find((candidate) => identity(candidate) === identity(path));
    const group = groupByIdentity.get(identity(path));
    const projectBox = project?.getBoundingClientRect();
    const groupBox = group?.getBoundingClientRect();
    const projectSlice = visibleSlice(project, projectVisibilityClip);
    const groupSlice = visibleSlice(group, groupVisibilityClip);
    return {
      identity: identity(path), d: path.getAttribute('d') || '', length,
      start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
      strokeWidth: Number.parseFloat(style.strokeWidth), stroke: style.stroke,
      opacity: Number.parseFloat(style.opacity), display: style.display, visibility: style.visibility,
      vectorEffect: style.vectorEffect,
      direct: (path.getAttribute('d')?.match(/[ML]/g) || []).length === 2,
      startAttached: Boolean(projectBox && projectSlice)
        && Math.abs(start.x - projectBox.right) <= 2
        && start.y >= projectSlice.top - 1 && start.y <= projectSlice.bottom + 1,
      endAttached: Boolean(groupBox && groupSlice)
        && Math.abs(end.x - groupBox.left) <= 2
        && end.y >= groupSlice.top - 1 && end.y <= groupSlice.bottom + 1,
    };
  };
  const routes = paths.map(route);
  const cross = (a, b) => {
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const a1 = orient(a.start, a.end, b.start);
    const a2 = orient(a.start, a.end, b.end);
    const b1 = orient(b.start, b.end, a.start);
    const b2 = orient(b.start, b.end, a.end);
    return a1 * a2 < -.01 && b1 * b2 < -.01;
  };
  const collinear = (a, b) => {
    const area = (p) => (a.end.x - a.start.x) * (p.y - a.start.y) - (a.end.y - a.start.y) * (p.x - a.start.x);
    return Math.abs(area(b.start)) < .01 && Math.abs(area(b.end)) < .01;
  };
  const routeConflicts = [];
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      if (cross(routes[left], routes[right]) || collinear(routes[left], routes[right])) {
        routeConflicts.push([routes[left].identity, routes[right].identity]);
      }
    }
  }
  const alphaGroup = groups.find((group) => group.dataset.project === 'alpha' && (group.dataset.folder || '') === '');
  const child = alphaGroup?.querySelector('.live-tracker-child-strip .live-tracker-session');
  const childStyle = child ? getComputedStyle(child) : null;
  const headingVisibility = visibleGroups.map((group) => {
    const heading = group.querySelector('.live-tracker-project-name');
    const style = heading ? getComputedStyle(heading) : null;
    return { text: heading?.textContent.trim() || '', position: style?.position || '', width: heading?.getBoundingClientRect().width || 0 };
  });
  return {
    standalone: matchMedia('(display-mode: standalone)').matches,
    navMode: document.body.classList.contains('nav-mode'),
    overview: groupPort?.dataset.overview === 'true',
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
    emptyGroups: groups.filter((group) => group.querySelector('.live-tracker-project-empty')).map(identity),
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
function assertSelected(state, expected, selected = "alpha\n") {
  assert.equal(state.connectorPaths.length, 0, "selected mode has zero project connector paths");
  assert.ok(state.connectorElements === 0 || state.connectorLayerHidden,
    "selected mode removes or hides an empty connector layer");
  assert.equal(state.overview, false, "one project group is selected");
  assert.deepEqual(state.projectSequence, expected, "left DOM/reading order is canonical");
  assert.deepEqual(state.groupSequence, expected, "right DOM/reading order matches the left exactly");
  assert.deepEqual(state.visibleGroups, [selected], "selected mode exposes only its authoritative project group");
}
function assertOverview(state, expected) {
  assert.equal(state.overview, true, "overview mode is active");
  assert.equal(state.connectorElements, 1, "overview has one viewport connector layer");
  assert.equal(state.connectorPointerEvents, "none", "relationship routes never intercept full-row interaction");
  assert.deepEqual(state.connectorPathIdentities, state.visiblePairSequence,
    "overview has exactly one route for each meaningfully visible authoritative pair");
  assert.ok(state.connectorPaths.length > 0, "overview normally exposes visible relationship routes");
  assert.ok(state.connectorPaths.every((route) => route.display !== "none" && route.visibility === "visible" && route.opacity > 0),
    "every emitted relationship route is normally visible without hover or focus");
  assert.ok(state.connectorPaths.every((route) => route.strokeWidth > 0 && route.strokeWidth <= 1),
    "all relationship routes use a restrained hairline no thicker than one CSS pixel");
  assert.ok(state.connectorPaths.every((route) => route.direct && route.startAttached && route.endAttached),
    "each independent direct route attaches to its project and matching group surfaces");
  assert.ok(state.groupVisibilityClip && state.connectorPaths.every((route) =>
    route.end.y >= state.groupVisibilityClip.top - 1 && route.end.y <= state.groupVisibilityClip.bottom + 1),
  "right endpoints stay inside the unobscured group surface rather than the composer-covered padding");
  assert.deepEqual(state.routeConflicts, [], "routes never cross or overlap into shared/heavier geometry");
  assert.deepEqual(state.projectSequence, expected, "left project identities keep canonical order");
  assert.deepEqual(state.groupSequence, expected, "right group identities exactly match canonical left order");
  assert.deepEqual(state.visibleGroups, expected, "overview exposes every group in reading order");
  assert.ok(ascending(state.projectVisualTops), "left visual top order follows DOM order");
  assert.ok(ascending(state.groupVisualTops), "right visual top order follows DOM order despite uneven heights");
  assert.ok(state.headingVisibility.every((heading) => heading.position === "static" && heading.width > 1 && heading.text),
    "every overview group has a visible human heading instead of relying on a line");
}

await mkdir(artifacts, { recursive: true });
try {
  const report = {};

  // Desktop verifies the unfiltered initial state, canonical order, native Tab
  // sequence, independent pane scrolling, resize, and a live chrome replacement.
  const desktop = await launchChrome("/many");
  await desktop.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitForPaint(desktop.cdp);
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
  assert.deepEqual(report.desktopOverview.emptyGroups, ["beta\n"],
    "empty groups retain a deliberate canonical position");
  assert.ok(report.desktopOverview.child?.fullRowLink && report.desktopOverview.child?.display === "flex"
    && report.desktopOverview.child?.direction === "row" && report.desktopOverview.child?.justify === "flex-start",
  "compact child metadata remains a full-row, left-biased focus target");
  assert.equal(report.desktopOverview.child?.phase, "implementation", "child keeps its own workflow phase");
  assert.match(report.desktopOverview.child?.elapsed ?? "", /^\d+[mh]$/, "child keeps its own elapsed time");
  assert.equal(report.desktopOverview.child?.elapsedOwner, 1, "elapsed metadata belongs to the child row");
  assert.equal(report.desktopOverview.idleParentElapsedCount, 0, "idle architect does not inherit delegated elapsed time");
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
    "epsilon right endpoint remains visible below the shorter centered left project list");
  assert.ok(report.pwaSmallOverview.composerCoversTracker
    && Math.abs(report.pwaSmallOverview.groupVisibilityClip.bottom - report.pwaSmallOverview.composerRect.top) < .01
    && epsilonRoute.end.y < report.pwaSmallOverview.composerRect.top,
  "small overview clips the right tracker at the actual composer while retaining epsilon above it");
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
  await closeChrome(manyPwa);

  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`sessions rendered proof ${diagnose ? "diagnosed" : "passed"}: ${artifacts}`);
} catch (error) {
  if (chromeErrors) error.message += `\nChromium: ${chromeErrors.slice(-2000)}`;
  throw error;
} finally {
  await new Promise((resolveClose) => fixture.close(resolveClose));
}
