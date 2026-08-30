#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderPage } from "../src/render.mjs";

const diagnose = process.argv.includes("--diagnose");
const root = resolve(new URL("..", import.meta.url).pathname);
const artifacts = join(root, ".artifacts", "sessions-rendered");
const cachedChromium = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  join(process.env.HOME || "", ".cache/ms-playwright"),
  "/home/qqp/.cache/ms-playwright",
].filter(Boolean).flatMap(cache => {
  try {
    return readdirSync(cache)
      .filter(entry => entry.startsWith("chromium-") && !entry.includes("headless"))
      .sort().reverse()
      .flatMap(entry => ["chrome-linux64/chrome", "chrome-linux/chrome"].map(path => join(cache, entry, path)));
  } catch { return []; }
}).find(existsSync);
const chromeBinary = [
  process.env.CHROME_BIN,
  cachedChromium,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].find(candidate => candidate && existsSync(candidate));
assert.ok(chromeBinary, "browser-rendered proof requires Chromium (set CHROME_BIN when it is not installed conventionally)");
const alphaArchitect = "session-7a330000-0000-4000-8000-000000000001";
const alphaChild = "session-7a330000-0000-4000-8000-000000000002";
const projectNames = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi"];
const now = Date.now();

const projects = projectNames.map((name, index) => {
  const id = index === 0 ? alphaArchitect : `session-7a330000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`;
  const label = name[0].toUpperCase() + name.slice(1);
  const architect = {
    sessionId: id,
    alias: index === 0 ? "opal" : `${name}-arch`,
    label: "architect",
    parentSessionId: "",
    depth: 0,
    activity: index === 0 ? "idle" : index % 3 === 0 ? "working" : "idle",
    workflow: "architect",
    phase: index === 0 || index % 3 !== 0 ? "none" : "planning",
    phaseStartedAt: index === 0 || index % 3 !== 0 ? null : now - (index + 2) * 60_000,
  };
  const sessions = index === 0 ? [architect, {
    sessionId: alphaChild,
    alias: "runner",
    label: "implementation",
    parentSessionId: alphaArchitect,
    depth: 1,
    activity: "working",
    workflow: "implementation",
    phase: "work",
    phaseStartedAt: now - 8 * 60_000 - 25_000,
  }] : [architect];
  return {
    key: `p:${name}:`, name, label, folder: "", folderLabel: "", sessions,
  };
});

const activeProjects = projects.map((project, index) => ({
  id: project.sessions[0].sessionId,
  project: project.name,
  projectLabel: project.label,
  folder: "",
  folderLabel: "",
  alias: project.sessions[0].alias,
  createdAt: now - index * 1000,
}));

const snapshot = {
  id: alphaArchitect,
  project: "alpha",
  projectLabel: "Alpha",
  alias: "opal",
  createdAt: now - 3_600_000,
  events: [],
  activeProjects,
  sessions: activeProjects,
  agentStatus: "idle",
  children: [],
  conversation: { nodes: [], pending: [] },
  dashboard: { schema: "qq.dashboard/v1", projects },
};
const paths = {
  canonical: `/qq/project/alpha/session/${alphaArchitect}`,
  projectsBase: "/qq/project",
  projectsSession: "/qq/projects",
  createSession: "/qq/project/alpha/sessions",
  switchSession: "/qq/sessions/open",
  close: `/qq/session/${alphaArchitect}/close`,
  prompt: `/qq/session/${alphaArchitect}/prompt`,
  interrupt: `/qq/session/${alphaArchitect}/interrupt`,
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
const page = renderPage(snapshot, paths, assetPaths);

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
    response.end(page);
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
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
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
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function connectChrome(debugPort, expectedUrl = "") {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const pages = targets.filter((target) => target.type === "page");
      const pageTarget = (expectedUrl ? pages.find((target) => target.url.startsWith(expectedUrl)) : null) ?? (!expectedUrl ? pages[0] : null);
      if (pageTarget?.webSocketDebuggerUrl) {
        const cdp = new Cdp(pageTarget.webSocketDebuggerUrl);
        await cdp.open();
        return cdp;
      }
    } catch { /* Chrome is still starting. */ }
    await sleep(50);
  }
  throw new Error("Chromium DevTools target did not start");
}

const geometryExpression = `(() => {
  const round = value => Math.round(value * 100) / 100;
  const rect = element => {
    const value = element.getBoundingClientRect();
    return { left: round(value.left), top: round(value.top), right: round(value.right), bottom: round(value.bottom), width: round(value.width), height: round(value.height) };
  };
  const trackerElement = document.querySelector('.live-tracker');
  const activeElement = document.querySelector('.active-projects');
  const trackerRect = trackerElement?.getBoundingClientRect();
  const activeRect = activeElement?.getBoundingClientRect();
  const projectItems = [...document.querySelectorAll('.active-project-item[data-project]')];
  const overlapsClip = (value, clip) => clip
    && value.right > Math.max(0, clip.left) && value.left < Math.min(innerWidth, clip.right)
    && value.bottom > Math.max(0, clip.top) && value.top < Math.min(innerHeight, clip.bottom);
  const clippedRect = (value, clip) => {
    const left = Math.max(value.left, clip.left, 0);
    const top = Math.max(value.top, clip.top, 0);
    const right = Math.min(value.right, clip.right, innerWidth);
    const bottom = Math.min(value.bottom, clip.bottom, innerHeight);
    return { left: round(left), top: round(top), right: round(right), bottom: round(bottom), width: round(right - left), height: round(bottom - top) };
  };
  const visibleGroups = [...document.querySelectorAll('.live-tracker-project[data-project]')].filter(group => {
    if (group.hidden) return false;
    const project = projectItems.find(item => item.dataset.project === group.dataset.project && (item.dataset.folder || '') === (group.dataset.folder || ''));
    return project && overlapsClip(group.getBoundingClientRect(), trackerRect)
      && overlapsClip(project.getBoundingClientRect(), activeRect);
  });
  const paths = [...document.querySelectorAll('#session-connectors path')].map(path => {
    const length = path.getTotalLength();
    const start = path.getPointAtLength(0);
    const end = path.getPointAtLength(length);
    const style = getComputedStyle(path);
    const group = visibleGroups.find(item => item.dataset.project === path.dataset.project && (item.dataset.folder || '') === (path.dataset.folder || ''));
    const project = projectItems.find(item => item.dataset.project === path.dataset.project && (item.dataset.folder || '') === (path.dataset.folder || ''));
    return {
      project: path.dataset.project,
      layout: path.dataset.layout,
      d: path.getAttribute('d'),
      length: round(length),
      bounds: rect(path),
      start: { x: round(start.x), y: round(start.y) },
      end: { x: round(end.x), y: round(end.y) },
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
      visibility: style.visibility,
      projectRect: project ? clippedRect(project.getBoundingClientRect(), activeRect) : null,
      groupRect: group ? clippedRect(group.getBoundingClientRect(), trackerRect) : null,
    };
  });
  const child = document.querySelector('.live-tracker-child-strip .live-tracker-session');
  const identity = child?.querySelector('.live-tracker-identity');
  const state = child?.querySelector('.live-tracker-state');
  const phase = child?.querySelector('.live-tracker-phase');
  const time = child?.querySelector('.live-tracker-elapsed');
  const parent = document.querySelector('.live-tracker-depth-0 .live-tracker-session');
  const svg = document.querySelector('#session-connectors');
  const tracker = document.querySelector('.live-tracker');
  const active = activeElement;
  const ancestors = node => {
    const values = [];
    for (let item = node; item; item = item.parentElement) {
      const style = getComputedStyle(item);
      values.push({ tag: item.tagName, id: item.id, className: item.className, zIndex: style.zIndex, overflow: style.overflow, transform: style.transform, opacity: style.opacity, background: style.backgroundColor });
    }
    return values;
  };
  return {
    viewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight,
      visual: window.visualViewport ? { width: round(visualViewport.width), height: round(visualViewport.height), offsetLeft: round(visualViewport.offsetLeft), offsetTop: round(visualViewport.offsetTop), scale: visualViewport.scale } : null },
    standalone: matchMedia('(display-mode: standalone)').matches,
    navMode: document.body.classList.contains('nav-mode'),
    overview: tracker?.dataset.overview === 'true',
    svg: svg ? { hidden: svg.hasAttribute('hidden'), rect: rect(svg), display: getComputedStyle(svg).display, visibility: getComputedStyle(svg).visibility, opacity: getComputedStyle(svg).opacity, zIndex: getComputedStyle(svg).zIndex } : null,
    paths,
    visibleProjects: visibleGroups.map(group => group.dataset.project),
    child: child ? {
      row: rect(child), identity: rect(identity), state: rect(state), phase: phase?.textContent || '', phaseRect: phase ? rect(phase) : null,
      elapsed: time?.textContent || '', elapsedHidden: time?.hidden ?? true, elapsedRect: time ? rect(time) : null,
      identityStateGap: round(rect(state).left - rect(identity).right), overflow: getComputedStyle(child).overflow,
    } : null,
    parentElapsedCount: parent?.querySelectorAll('.live-tracker-elapsed').length ?? 0,
    scroll: { activeTop: active?.scrollTop ?? 0, activeHeight: active?.clientHeight ?? 0, activeScrollHeight: active?.scrollHeight ?? 0,
      trackerTop: tracker?.scrollTop ?? 0, trackerHeight: tracker?.clientHeight ?? 0, trackerScrollHeight: tracker?.scrollHeight ?? 0 },
    stacking: svg ? ancestors(svg) : [],
  };
})()`;

async function waitForPaint(cdp) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await cdp.evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('.live-tracker-elapsed'))`);
    if (ready) {
      await cdp.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      return;
    }
    await sleep(50);
  }
  throw new Error("rendered fixture did not become ready");
}

async function screenshot(cdp, name) {
  const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(capture.data, "base64"));
}

async function inspect(cdp, name) {
  await cdp.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  const value = await cdp.evaluate(geometryExpression);
  await screenshot(cdp, name);
  return value;
}

function assertChooserClosed(state) {
  assert.equal(state.standalone, true, "closed mobile proof remains in installed-app display mode");
  assert.equal(state.navMode, false, "mobile project/session chooser is closed");
  assert.equal(state.svg.hidden, true, "connector layer is hidden outside the mobile chooser");
  assert.equal(state.paths.length, 0, "closed mobile navigation leaves no connector over conversation controls");
}

function assertRendered(state, { overview = false, standalone = false, scrolled = "" } = {}) {
  assert.equal(state.overview, overview, "fixture is in the requested project-filter state");
  assert.equal(state.standalone, standalone, "fixture is in the requested display mode");
  assert.equal(state.svg.hidden, false, "connector layer is not hidden");
  assert.equal(state.svg.display, "block", "connector layer participates in paint");
  assert.equal(state.svg.visibility, "visible", "connector layer is visible");
  assert.equal(state.paths.length, state.visibleProjects.length, "every visible session project has exactly one connector");
  for (const path of state.paths) {
    assert.ok(path.length >= 24, `${path.project} connector occupies a perceptible continuous span`);
    assert.ok(path.bounds.width >= 24 && (path.bounds.height > 0 || Number.parseFloat(path.strokeWidth) >= 1),
      `${path.project} connector has a visible horizontal span and painted stroke`);
    assert.notEqual(path.stroke, "none", `${path.project} connector has a computed stroke`);
    assert.ok(Number(path.opacity) >= 0.75, `${path.project} connector remains perceptible`);
    assert.ok(path.projectRect && path.groupRect, `${path.project} connector resolves both matching endpoints`);
    assert.ok(Math.abs(path.start.y - (path.projectRect.top + path.projectRect.height / 2)) <= 2,
      `${path.project} connector starts centered on its project surface`);
    assert.ok(path.start.x < path.projectRect.right && path.start.x >= path.projectRect.right - 10,
      `${path.project} connector visibly leads from inside its project surface`);
    assert.ok(Math.abs(path.end.y - (path.groupRect.top + path.groupRect.height / 2)) <= 2,
      `${path.project} connector ends centered on its session surface`);
    assert.ok(path.end.x > path.groupRect.left && path.end.x <= path.groupRect.left + 10,
      `${path.project} connector visibly leads into its session-group surface`);
  }
  if (scrolled === "tracker" || scrolled === "both") {
    assert.ok(state.scroll.trackerTop > 0, "session-group pane scroll transition was exercised");
  }
  if (scrolled === "both") {
    assert.ok(state.scroll.activeTop > 0, "active-project pane scroll transition was exercised");
  }
  if (state.visibleProjects.includes("alpha")) {
    assert.equal(state.child.phase, "implementation", "active child preserves authoritative phase/workflow text");
    assert.equal(state.child.elapsed, "8m", "active child shows completed own elapsed minutes");
    assert.equal(state.child.elapsedHidden, false, "eligible child time is visibly rendered");
    assert.ok(state.child.identityStateGap >= 0 && state.child.identityStateGap <= 12,
      "child identity, phase, and elapsed time form one compact left-biased cluster");
    assert.ok(state.child.elapsedRect.right <= state.child.row.right,
      "child elapsed value remains inside its full-row target");
    assert.equal(state.parentElapsedCount, 0, "delegated child time is not copied onto the idle architect");
  }
}

await mkdir(artifacts, { recursive: true });
const server = await fixtureServer();
const { port } = server.address();
let chromeErrors = "";

async function launchChrome({ app = false } = {}) {
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), "qq-sessions-rendered-"));
  const url = `http://127.0.0.1:${port}${paths.canonical}${app ? "?standalone=1" : ""}`;
  const chrome = spawn(chromeBinary, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    app ? `--app=${url}` : "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", chunk => { chromeErrors += chunk; });
  const cdp = await connectChrome(debugPort, app ? url : "");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return { chrome, cdp, profile, url };
}

async function closeChrome(instance) {
  instance.cdp.close();
  instance.chrome.kill("SIGTERM");
  if (instance.chrome.exitCode === null) await new Promise(resolveExit => instance.chrome.once("exit", resolveExit));
  await rm(instance.profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}

try {
  const report = {};
  const desktop = await launchChrome();
  await desktop.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await desktop.cdp.send("Page.navigate", { url: desktop.url });
  await waitForPaint(desktop.cdp);

  report.desktopSelected = await inspect(desktop.cdp, "desktop-selected");
  await desktop.cdp.evaluate(`(() => { const nav = document.querySelector('.active-projects'); nav.focus(); nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  report.desktopOverview = await inspect(desktop.cdp, "desktop-overview");
  await desktop.cdp.evaluate(`(() => { const tracker = document.querySelector('.live-tracker'); tracker.scrollTop = Math.min(110, tracker.scrollHeight - tracker.clientHeight); const projects = document.querySelector('.active-projects'); projects.scrollTop = Math.min(85, projects.scrollHeight - projects.clientHeight); })()`);
  report.desktopScrolled = await inspect(desktop.cdp, "desktop-overview-scrolled");
  await desktop.cdp.send("Emulation.setDeviceMetricsOverride", { width: 1120, height: 720, deviceScaleFactor: 1, mobile: false });
  report.desktopResized = await inspect(desktop.cdp, "desktop-overview-resized");
  await desktop.cdp.evaluate(`document.querySelector('.active-project-item[data-project="alpha"]').click()`);
  report.desktopRefiltered = await inspect(desktop.cdp, "desktop-refiltered");
  await desktop.cdp.evaluate(`document.querySelector('.live-tracker-child-strip').style.minHeight = '3rem'`);
  report.desktopLiveUpdate = await inspect(desktop.cdp, "desktop-live-update");
  await closeChrome(desktop);

  const standalone = await launchChrome({ app: true });
  await standalone.cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 700, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 700 });
  await waitForPaint(standalone.cdp);
  report.standaloneClosed = await inspect(standalone.cdp, "standalone-closed");
  await standalone.cdp.evaluate(`document.querySelector('.session-heading-start').click()`);
  report.standaloneSelected = await inspect(standalone.cdp, "standalone-selected");
  await standalone.cdp.evaluate(`(() => { const nav = document.querySelector('.active-projects'); nav.focus(); nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  report.standaloneOverview = await inspect(standalone.cdp, "standalone-overview");
  await standalone.cdp.evaluate(`(() => { const tracker = document.querySelector('.live-tracker'); tracker.scrollTop = Math.min(95, tracker.scrollHeight - tracker.clientHeight); const projects = document.querySelector('.active-projects'); projects.scrollTop = Math.min(80, projects.scrollHeight - projects.clientHeight); })()`);
  report.standaloneScrolled = await inspect(standalone.cdp, "standalone-overview-scrolled");
  await standalone.cdp.send("Emulation.setDeviceMetricsOverride", { width: 640, height: 390, deviceScaleFactor: 2, mobile: true, screenWidth: 640, screenHeight: 390 });
  report.standaloneRotated = await inspect(standalone.cdp, "standalone-overview-rotated");
  await standalone.cdp.evaluate(`document.body.click()`);
  report.standaloneClosedAfter = await inspect(standalone.cdp, "standalone-closed-after");
  await closeChrome(standalone);

  await writeFile(join(artifacts, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!diagnose) {
    assertRendered(report.desktopSelected);
    assertRendered(report.desktopOverview, { overview: true });
    assertRendered(report.desktopScrolled, { overview: true, scrolled: "tracker" });
    assertRendered(report.desktopResized, { overview: true, scrolled: "tracker" });
    assertRendered(report.desktopRefiltered);
    assertRendered(report.desktopLiveUpdate);
    assertChooserClosed(report.standaloneClosed);
    assertRendered(report.standaloneSelected, { standalone: true });
    assertRendered(report.standaloneOverview, { overview: true, standalone: true });
    assertRendered(report.standaloneScrolled, { overview: true, standalone: true, scrolled: "both" });
    assertRendered(report.standaloneRotated, { overview: true, standalone: true });
    assertChooserClosed(report.standaloneClosedAfter);
  }
  console.log(`sessions rendered proof ${diagnose ? "diagnosed" : "passed"}: ${artifacts}`);
} catch (error) {
  if (chromeErrors) error.message += `\nChromium: ${chromeErrors.slice(-2000)}`;
  throw error;
} finally {
  await new Promise(resolveClose => server.close(resolveClose));
}
