#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const consoleCss = readFileSync(new URL("../assets/console.css", import.meta.url));
const normalFont = readFileSync(new URL("../assets/geist-latin-wght-normal-5.3.0.woff2", import.meta.url));
const italicFont = readFileSync(new URL("../assets/geist-latin-wght-italic-5.3.0.woff2", import.meta.url));
const factoryStart = "/* qq-prompt-echo-factory:start */";
const factoryEnd = "/* qq-prompt-echo-factory:end */";
const start = browserSource.indexOf(factoryStart);
const end = browserSource.indexOf(factoryEnd);
assert.ok(start >= 0 && end > start, "browser asset exposes the production prompt-correlation controller");
const factoryBody = browserSource.slice(start + factoryStart.length, end);

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
assert.ok(chromeBinary, "prompt geometry browser proof requires Chromium (or CHROME_BIN)");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }
  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  }
  close() { this.socket.close(); }
}

async function connectChrome(debugPort) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const target = targets.find((entry) => entry.type === "page");
      if (target?.webSocketDebuggerUrl) {
        const cdp = new Cdp(target.webSocketDebuggerUrl);
        await cdp.open();
        return cdp;
      }
    } catch { /* Chromium is starting. */ }
    await sleep(50);
  }
  throw new Error("Chromium DevTools target did not start");
}

const isTransientExecutionContextError = (error) =>
  /(?:Execution context was destroyed|Cannot find context with specified id|Cannot find default execution context)/i
    .test(String(error?.message || error));

async function waitForFixtureResult(cdp) {
  const deadline = Date.now() + 12_000;
  let lastState;
  while (Date.now() < deadline) {
    try {
      lastState = await cdp.evaluate(`({
        readyState: document.readyState,
        done: window.qqPromptGeometryDone === true,
        failed: Boolean(window.qqPromptGeometryFailure),
      })`);
      if (lastState.done || lastState.failed) {
        return await cdp.evaluate("window.qqPromptGeometryResult || window.qqPromptGeometryFailure");
      }
    } catch (error) {
      if (!isTransientExecutionContextError(error)) throw error;
      lastState = undefined;
    }
    await sleep(25);
  }
  return { timeout: true, lastState };
}

const fixtureHtml = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/console.css">
<title>Prompt geometry proof</title>
</head><body>
<header class="site-header"><span>geometry proof</span></header>
<main><section id="session-panel" class="session-panel">
  <div id="transcript" class="transcript">
    <div id="transcript-log" class="transcript-log">
      <div id="transcript-settled" class="transcript-settled"></div>
      <div id="transcript-live" class="transcript-live">
        <div id="transcript-live-nodes" class="transcript-live-nodes"></div>
        <div id="session-queue" class="session-queue"></div>
        <ol id="prompt-echoes" class="prompt-echoes" data-session-id="session-a" aria-live="off"></ol>
        <div id="provider-gap" class="provider-gap" data-state="idle" aria-hidden="true"></div>
      </div>
    </div>
  </div>
</section></main>
<footer><form id="composer" data-session-id="session-a"><textarea name="prompt"></textarea></form></footer>
<script>${factoryBody}
const input = document.querySelector("textarea[name='prompt']");
const form = document.querySelector("#composer");
const transcript = document.querySelector("#transcript");
const settledNodes = document.querySelector("#transcript-settled");
const live = document.querySelector("#transcript-live");
const liveNodes = document.querySelector("#transcript-live-nodes");
const queue = document.querySelector("#session-queue");
const echoes = document.querySelector("#prompt-echoes");
const trackedIds = new Set();
const frames = [];
let sampling = true;
const round = (value) => Math.round(value * 1000) / 1000;
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const settle = async () => { await frame(); await frame(); };
const identityCount = (id) => [...document.querySelectorAll("[data-client-message-id]")]
  .filter((node) => node.getAttribute("data-client-message-id") === id).length;
const sampleFrame = () => {
  if (!sampling) return;
  const counts = {};
  for (const id of trackedIds) counts[id] = identityCount(id);
  frames.push(counts);
  requestAnimationFrame(sampleFrame);
};
requestAnimationFrame(sampleFrame);

const controller = createQQPromptEchoController(window, {
  currentSessionId: () => "session-a",
  composer: () => input,
});
controller.commission("session-a");

const textRange = (element) => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent.length > 0) break;
  }
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()];
  const box = rects[0] || range.getBoundingClientRect();
  return { box, lines: rects.length };
};
const box = (rect) => ({
  left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom),
  width: round(rect.width), height: round(rect.height),
});
const geometry = (node) => {
  const outerRect = node.getBoundingClientRect();
  const text = node.querySelector(".queue-preview, .message-text");
  const measured = textRange(text);
  const style = getComputedStyle(node);
  const textStyle = getComputedStyle(text);
  return {
    outer: box(outerRect),
    text: box(measured.box),
    textOffset: { left: round(measured.box.left - outerRect.left), top: round(measured.box.top - outerRect.top) },
    lines: measured.lines,
    availableWidth: round(live.getBoundingClientRect().width),
    padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
    lineHeight: textStyle.lineHeight,
    background: style.backgroundColor,
    color: style.color,
  };
};
const contentGeometry = (node, selector) => {
  const outerRect = node.getBoundingClientRect();
  const contentRect = node.querySelector(selector).getBoundingClientRect();
  return {
    outer: box(outerRect),
    content: box(contentRect),
    contentOffset: { left: round(contentRect.left - outerRect.left), top: round(contentRect.top - outerRect.top) },
    lineHeight: getComputedStyle(node.querySelector(selector)).lineHeight,
  };
};
const clearTranscript = async () => {
  settledNodes.replaceChildren();
  liveNodes.replaceChildren();
  queue.replaceChildren();
  echoes.replaceChildren();
  await settle();
};
const startPrompt = async (text) => {
  input.value = text;
  const requestConfig = { elt: form, parameters: new URLSearchParams({ prompt: text }) };
  if (!controller.configRequest({ detail: requestConfig })) throw new Error("configRequest rejected geometry fixture");
  const id = requestConfig.parameters.get("clientMessageId");
  const xhr = { status: 200, getResponseHeader: () => null };
  if (!controller.beforeRequest({ detail: { requestConfig, xhr } })) throw new Error("beforeRequest rejected geometry fixture");
  trackedIds.add(id);
  const frameStart = frames.length;
  await settle();
  const echo = [...echoes.children].find((node) => node.getAttribute("data-client-message-id") === id);
  if (!echo) throw new Error("provisional echo missing");
  return { id, xhr, echo, composerCleared: input.value === "", frameStart };
};
const queueRow = ({ id, text, steering = false, editable = false }) => {
  const row = document.createElement("li");
  row.className = "queue-item message-queued";
  if (id) row.setAttribute("data-client-message-id", id);
  row.setAttribute("data-message-id", "core-" + (id || "editor"));
  row.setAttribute("data-placement", steering ? "steering" : "queued");
  row.setAttribute("aria-label", steering ? "Steering message" : "Queued message");
  const mark = document.createElement("span");
  mark.className = "queue-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "◦";
  row.append(mark);
  if (editable) {
    const edit = document.createElement("form");
    edit.className = "queue-edit";
    edit.setAttribute("action", "/queue");
    edit.setAttribute("method", "post");
    const label = document.createElement("label");
    label.setAttribute("for", "editor-probe");
    label.textContent = "Edit pending message";
    const textarea = document.createElement("textarea");
    textarea.id = "editor-probe";
    textarea.className = "queue-edit-text";
    textarea.name = "text";
    textarea.rows = Math.max(1, text.split("\\n").length);
    textarea.value = text;
    edit.append(label, textarea);
    row.append(edit);
  } else {
    const preview = document.createElement("p");
    preview.className = "queue-preview";
    preview.textContent = text;
    row.append(preview);
  }
  const remove = document.createElement("form");
  remove.className = "queue-remove";
  remove.setAttribute("action", "/queue");
  remove.setAttribute("method", "post");
  const item = document.createElement("input");
  item.type = "hidden";
  item.name = "itemId";
  item.value = "core-" + (id || "editor");
  const button = document.createElement("button");
  button.type = "submit";
  button.name = "operation";
  button.value = "remove";
  button.setAttribute("aria-label", "Remove pending message");
  button.textContent = "×";
  remove.append(item, button);
  row.append(remove);
  const section = document.createElement("section");
  section.className = "pending-queue";
  const list = document.createElement("ol");
  list.append(row);
  section.append(list);
  return { section, row, button };
};
const admittedNode = ({ id, text, steering = false }) => {
  const article = document.createElement("article");
  article.className = "message message-user" + (steering ? " message-steering" : "");
  article.setAttribute("data-seq", "1");
  if (id) article.setAttribute("data-client-message-id", id);
  article.setAttribute("data-message-id", "core-" + (id || "editor"));
  const content = document.createElement("div");
  content.className = "message-text";
  content.textContent = text;
  article.append(content);
  return article;
};

const runLifecycle = async ({ name, text, steering = false, settled = false }) => {
  await clearTranscript();
  if (settled) {
    const prior = document.createElement("article");
    prior.className = "message message-assistant";
    const priorText = document.createElement("div");
    priorText.className = "message-text";
    priorText.textContent = "Earlier settled transcript content";
    prior.append(priorText);
    settledNodes.append(prior);
  }
  const request = await startPrompt(text);
  const provisional = geometry(request.echo);
  const provisionalControlDisabled = request.echo.querySelector(".queue-remove button")?.disabled === true;
  const authorityMarkup = queueRow({ id: request.id, text, steering });
  queue.replaceChildren(authorityMarkup.section);
  await settle();
  const authorityNode = queue.querySelector(".queue-item");
  const authority = geometry(authorityNode);
  const authorityCount = identityCount(request.id);
  const authorityControlEnabled = authorityMarkup.button.disabled === false;

  // Model normal observation precisely: transcript authority arrives first and
  // the queue-empty SSE is intentionally late. The production observer must
  // retire the exact queue row in the insertion microtask, before any paint.
  const admittedMarkup = admittedNode({ id: request.id, text, steering });
  if (settled) settledNodes.append(admittedMarkup);
  else liveNodes.replaceChildren(admittedMarkup);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const delayedQueueRetired = queue.querySelector(".queue-item") === null;
  queue.replaceChildren();
  await settle();

  // A delayed/stale queue payload can race after transcript admission too. It
  // must remove itself by exact identity in that same mutation microtask.
  const staleAuthority = queueRow({ id: request.id, text, steering });
  queue.replaceChildren(staleAuthority.section);
  await settle();
  const staleQueueRetired = queue.querySelector(".queue-item") === null;
  const admitted = geometry(admittedMarkup);
  const admittedCount = identityCount(request.id);
  const handoffFrames = frames.slice(request.frameStart);
  trackedIds.delete(request.id);
  return {
    name, id: request.id, text, steering, settled, provisional, authority, admitted,
    composerCleared: request.composerCleared,
    provisionalControlDisabled, authorityControlEnabled, authorityCount, admittedCount,
    delayedQueueRetired, staleQueueRetired, handoffFrames,
  };
};

const runRapidIdentical = async () => {
  await clearTranscript();
  const text = "rapid identical prompt";
  const first = await startPrompt(text);
  const second = await startPrompt(text);
  const ids = [first.id, second.id];
  const provisionalCounts = ids.map(identityCount);
  const firstAuthority = queueRow({ id: first.id, text });
  const secondAuthority = queueRow({ id: second.id, text });
  const section = document.createElement("section");
  section.className = "pending-queue";
  const list = document.createElement("ol");
  list.append(secondAuthority.row, firstAuthority.row);
  section.append(list);
  queue.replaceChildren(section);
  await settle();
  const authorityCounts = ids.map(identityCount);
  queue.replaceChildren();
  liveNodes.replaceChildren(
    admittedNode({ id: first.id, text }),
    admittedNode({ id: second.id, text }),
  );
  await settle();
  const admittedCounts = ids.map(identityCount);
  return { text, ids, provisionalCounts, authorityCounts, admittedCounts };
};

const runEditorProbe = async () => {
  await clearTranscript();
  const text = [
    "editable line one", "editable line two", "editable line three", "editable line four",
    "editable line five", "editable line six", "editable line seven",
  ].join("\\n");
  const authorityMarkup = queueRow({ id: "", text, steering: true, editable: true });
  let submitted = null;
  authorityMarkup.section.addEventListener("submit", (event) => {
    event.preventDefault();
    submitted = Object.fromEntries(new FormData(event.target, event.submitter));
  });
  queue.replaceChildren(authorityMarkup.section);
  await settle();
  const textarea = authorityMarkup.row.querySelector("textarea");
  const beforeFocus = contentGeometry(authorityMarkup.row, "textarea");
  textarea.focus();
  await settle();
  const textareaFocused = contentGeometry(authorityMarkup.row, "textarea");
  authorityMarkup.button.focus();
  await settle();
  const buttonFocused = contentGeometry(authorityMarkup.row, "textarea");
  authorityMarkup.button.click();
  const enabled = !textarea.disabled && !authorityMarkup.button.disabled;
  const article = admittedNode({ id: "", text, steering: true });
  queue.replaceChildren();
  liveNodes.replaceChildren(article);
  await settle();
  const admitted = contentGeometry(article, ".message-text");
  return { beforeFocus, textareaFocused, buttonFocused, admitted, enabled, submitted };
};

(async () => {
  await document.fonts.ready;
  const ordinary = await runLifecycle({ name: "ordinary-single-line", text: "ordinary queued prompt" });
  const steering = await runLifecycle({
    name: "steering-multiline",
    text: "Steering stays aligned across explicit lines.\\nA deliberately long continuation also wraps consistently on Android-sized viewports.",
    steering: true,
    settled: true,
  });
  const rapid = await runRapidIdentical();
  const editor = await runEditorProbe();
  await settle();
  sampling = false;
  controller.dispose();
  window.qqPromptGeometryResult = {
    viewport: { width: innerWidth, height: innerHeight, mobileMedia: matchMedia("(max-width: 42rem)").matches },
    scenarios: [ordinary, steering], rapid, editor, frames,
  };
  window.qqPromptGeometryDone = true;
})().catch((error) => {
  sampling = false;
  window.qqPromptGeometryFailure = { error: String(error), stack: String(error?.stack || "") };
});
</script></body></html>`;

const server = createServer((req, res) => {
  if (req.url === "/console.css") {
    res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
    res.end(consoleCss);
    return;
  }
  if (req.url === "/geist-latin-wght-normal-5.3.0.woff2") {
    res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "no-store" });
    res.end(normalFont);
    return;
  }
  if (req.url === "/geist-latin-wght-italic-5.3.0.woff2") {
    res.writeHead(200, { "Content-Type": "font/woff2", "Cache-Control": "no-store" });
    res.end(italicFont);
    return;
  }
  if (req.url === "/queue" && req.method === "POST") {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(fixtureHtml);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const fixtureUrl = `http://127.0.0.1:${server.address().port}/`;

async function runViewport({ name, width, height, mobile }) {
  const debugPort = await freePort();
  const profile = await mkdtemp(join(tmpdir(), `qq-prompt-geometry-${name}-`));
  const child = spawn(chromeBinary, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--disable-background-networking", "--disable-component-update", "--no-first-run",
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeErrors = "";
  child.stderr.on("data", (chunk) => { chromeErrors += chunk; });
  let cdp;
  try {
    cdp = await connectChrome(debugPort);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: mobile ? 2.625 : 1, mobile,
    });
    await cdp.send("Page.navigate", { url: fixtureUrl });
    const result = await waitForFixtureResult(cdp);
    assert.equal(result.timeout, undefined, `${name} geometry fixture timed out: ${JSON.stringify(result)}`);
    assert.equal(result.error, undefined, `${name} geometry fixture failed: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    if (chromeErrors) error.message += `\nChromium: ${chromeErrors.slice(-1600)}`;
    throw error;
  } finally {
    if (cdp) {
      try { await cdp.send("Browser.close"); } catch { child.kill("SIGKILL"); }
      cdp.close();
    } else child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(1_000).then(() => child.kill("SIGKILL")),
    ]);
    await rm(profile, { recursive: true, force: true });
  }
}

const tolerance = 1;
const close = (actual, expected, message) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${message}: expected ${expected} ±${tolerance}px, got ${actual}`,
);
const compareGeometry = (left, right, label) => {
  for (const field of ["left", "top", "width", "height"]) {
    close(right.outer[field], left.outer[field], `${label} outer ${field}`);
  }
  for (const field of ["left", "top"]) {
    close(right.text[field], left.text[field], `${label} absolute text ${field}`);
    close(right.textOffset[field], left.textOffset[field], `${label} relative text ${field}`);
  }
  assert.equal(right.lines, left.lines, `${label} preserves wrapping/line count`);
  assert.equal(right.lineHeight, left.lineHeight, `${label} preserves line height`);
  assert.deepEqual(right.padding, left.padding, `${label} preserves outer padding`);
};
const assertResult = (result, expected, name) => {
  assert.equal(result.viewport.width, expected.width, `${name} uses the requested viewport width`);
  assert.equal(result.viewport.mobileMedia, expected.mobile, `${name} exercises the intended responsive rules`);
  for (const scenario of result.scenarios) {
    const label = `${name} ${scenario.name}`;
    assert.match(scenario.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(scenario.composerCleared, true, `${label} clears the composer immediately`);
    assert.equal(scenario.provisionalControlDisabled, true, `${label} provisional controls are disabled`);
    assert.equal(scenario.authorityControlEnabled, true, `${label} authoritative controls are enabled`);
    assert.equal(scenario.authorityCount, 1, `${label} queue replacement leaves one identity`);
    assert.equal(scenario.admittedCount, 1, `${label} admission leaves one identity`);
    assert.equal(scenario.delayedQueueRetired, true,
      `${label} transcript authority retires the exact row before delayed queue-empty`);
    assert.equal(scenario.staleQueueRetired, true,
      `${label} a stale matching queue insertion self-retires before paint`);
    assert.ok(scenario.handoffFrames.length >= 4, `${label} samples the handoff across several real frames`);
    assert.equal(scenario.handoffFrames.every((frame) => frame[scenario.id] === 1), true,
      `${label} exact identity count is one at every provisional → queue → admitted frame`);
    for (const [stage, geometry] of Object.entries({
      provisional: scenario.provisional,
      authority: scenario.authority,
      admitted: scenario.admitted,
    })) {
      close(geometry.outer.width, geometry.availableWidth, `${label} ${stage} fills transcript content width`);
    }
    compareGeometry(scenario.provisional, scenario.authority, `${label} provisional → authority`);
    compareGeometry(scenario.authority, scenario.admitted, `${label} authority → admitted`);
    assert.equal(scenario.authority.background, scenario.admitted.background,
      `${label} authority already has the normal admitted block tint`);
    assert.equal(scenario.authority.color, scenario.admitted.color,
      `${label} authority already has the normal admitted text color`);
    if (scenario.steering) assert.ok(scenario.admitted.lines > 1, `${label} is a real multiline/wrapped proof`);
  }
  assert.equal(new Set(result.rapid.ids).size, 2, `${name} identical prompts receive distinct identities`);
  assert.deepEqual(result.rapid.provisionalCounts, [1, 1], `${name} rapid identical provisionals are singular`);
  assert.deepEqual(result.rapid.authorityCounts, [1, 1], `${name} rapid identical queue authority is singular`);
  assert.deepEqual(result.rapid.admittedCounts, [1, 1], `${name} rapid identical admissions are singular`);
  assert.equal(result.frames.some((frame) => Object.values(frame).some((count) => count > 1)), false,
    `${name} no rendered animation frame contains duplicate identity representations`);

  const editor = result.editor;
  assert.equal(editor.enabled, true, `${name} authoritative edit/remove controls are enabled`);
  assert.ok(editor.beforeFocus.outer.height > 128,
    `${name} editable multiline authority grows beyond the former 8rem clipping cap; geometry=${JSON.stringify(editor.beforeFocus)}`);
  assert.deepEqual(editor.submitted, { itemId: "core-editor", operation: "remove" },
    `${name} authoritative remove form remains functional`);
  for (const focused of [editor.textareaFocused, editor.buttonFocused]) {
    for (const field of ["left", "top", "width", "height"]) {
      close(focused.outer[field], editor.beforeFocus.outer[field], `${name} focus keeps editor outer ${field}`);
      close(focused.content[field], editor.beforeFocus.content[field], `${name} focus keeps editor content ${field}`);
    }
  }
  for (const field of ["left", "top", "width", "height"]) {
    close(editor.admitted.outer[field], editor.beforeFocus.outer[field], `${name} editable authority → admitted outer ${field}`);
  }
  close(editor.admitted.contentOffset.left, editor.beforeFocus.contentOffset.left,
    `${name} editable authority → admitted content origin`);
  assert.equal(editor.admitted.lineHeight, editor.beforeFocus.lineHeight,
    `${name} editable authority → admitted line height`);
};

try {
  const viewports = [
    { name: "desktop", width: 1280, height: 800, mobile: false },
    { name: "android", width: 412, height: 915, mobile: true },
  ];
  for (const viewport of viewports) {
    const result = await runViewport(viewport);
    assertResult(result, viewport, viewport.name);
  }
  console.log("prompt geometry browser proof passed (desktop + Android)");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
