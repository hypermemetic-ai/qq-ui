#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const htmxSource = readFileSync(new URL("../vendor/htmx-2.0.10.min.js", import.meta.url), "utf8");
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
assert.ok(chromeBinary, "prompt correlation browser proof requires Chromium (or CHROME_BIN)");

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
    } catch { /* Chromium is starting. */ }
    await sleep(50);
  }
  throw new Error("Chromium DevTools target did not start");
}

const fixtureHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
#transcript, #transcript-live, #prompt-echoes { display:flex; flex-direction:column; gap:8px }
.queue-item { min-height:24px }
</style><script src="/htmx.js"></script></head><body>
<main id="transcript"><div id="transcript-live"><div id="transcript-live-nodes"></div><div id="session-queue"></div><ol id="prompt-echoes" data-session-id="session-a" aria-live="off"></ol></div></main>
<form id="composer" data-session-id="session-a" method="post" action="/prompt" hx-post="/prompt" hx-swap="none"><textarea name="prompt">identical prompt text</textarea><button type="submit">Send</button></form>
<script>${factoryBody}
const input = document.querySelector("textarea[name='prompt']");
const form = document.querySelector("#composer");
const queue = document.querySelector("#session-queue");
const echoes = document.querySelector("#prompt-echoes");
const durableMessageId = "durable-message-1";
const controller = createQQPromptEchoController(window, {
  currentSessionId: () => "session-a",
  composer: () => input,
});
controller.commission("session-a");
let startedAt = 0;
let queueAt = 0;
let clientMessageId = "";
const frames = [];
let sampling = false;
const count = () => ({
  at: performance.now() - startedAt,
  echoes: echoes.querySelectorAll("[data-prompt-echo-state]").length,
  authority: queue.querySelectorAll(".queue-item").length,
});
const sampleFrame = () => {
  if (!sampling) return;
  frames.push(count());
  requestAnimationFrame(sampleFrame);
};
let resolveResult;
const eventLog = [];
window.qqPromptCorrelationResult = new Promise((resolve) => { resolveResult = resolve; });
setTimeout(() => resolveResult({
  timeout: true,
  eventLog,
  href: location.href,
  readyState: document.readyState,
  hasHtmx: typeof window.htmx === "object",
  echoes: echoes.children.length,
}), 5_000);
document.addEventListener("htmx:beforeRequest", (event) => {
  eventLog.push("beforeRequest");
  controller.beforeRequest(event);
  if (event.detail?.elt !== form) return;
  startedAt = performance.now();
  clientMessageId = event.detail.requestConfig.parameters.get("clientMessageId");
  sampling = true;
  requestAnimationFrame(sampleFrame);
  setTimeout(() => {
    const row = document.createElement("li");
    row.className = "queue-item message-queued";
    row.setAttribute("data-message-id", durableMessageId);
    row.setAttribute("data-client-message-id", clientMessageId);
    row.textContent = "identical prompt text";
    queue.append(row);
    queueAt = performance.now();
    queueMicrotask(() => { window.qqAfterQueueMicrotask = count(); });
  }, 100);
});
document.addEventListener("htmx:afterRequest", (event) => {
  eventLog.push("afterRequest");
  controller.afterRequest(event);
  if (event.detail?.elt !== form) return;
  const completedAt = performance.now();
  requestAnimationFrame(async () => {
    sampling = false;
    const wireBody = await (await fetch("/wire")).text();
    resolveResult({
      clientMessageId,
      wireClientMessageId: new URLSearchParams(wireBody).get("clientMessageId"),
      responseLagMs: completedAt - queueAt,
      afterQueueMicrotask: window.qqAfterQueueMicrotask,
      duplicateFrames: frames.filter((frame) => frame.echoes > 0 && frame.authority > 0),
      final: count(),
    });
    controller.dispose();
  });
});
document.addEventListener("htmx:load", () => {
  eventLog.push("load");
  form.requestSubmit();
}, { once: true });
</script></body></html>`;

let receivedWireBody = "";
const serverRequests = [];
const server = createServer(async (req, res) => {
  serverRequests.push(`${req.method} ${req.url}`);
  if (req.url === "/htmx.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(htmxSource);
    return;
  }
  if (req.url === "/prompt" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    receivedWireBody = Buffer.concat(chunks).toString("utf8");
    setTimeout(() => {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-QQ-Message-Id": "durable-message-1",
        "X-QQ-Prompt-Outcome": "accepted",
      });
      res.end("");
    }, 1_300);
    return;
  }
  if (req.url === "/wire") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(receivedWireBody);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(fixtureHtml);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const url = `http://127.0.0.1:${server.address().port}/`;
const debugPort = await freePort();
const profile = await mkdtemp(join(tmpdir(), "qq-prompt-correlation-"));
const child = spawn(chromeBinary, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--disable-background-networking", "--disable-component-update", "--no-first-run",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, url,
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = "";
child.stderr.on("data", (chunk) => { chromeErrors += chunk; });
let cdp;
try {
  cdp = await connectChrome(debugPort, url);
  await cdp.send("Runtime.enable");
  const result = await cdp.evaluate("window.qqPromptCorrelationResult");
  assert.equal(result.timeout, undefined, `real HTMX fixture timed out: ${JSON.stringify(result)}; requests=${serverRequests.join(",")}`);
  assert.match(result.clientMessageId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "beforeRequest creates and captures a cryptographically random correlation UUID");
  assert.equal(result.wireClientMessageId, result.clientMessageId,
    "real HTMX transport sends the exact correlation bound to provisional and authority");
  assert.ok(result.responseLagMs > 1_000, "controlled durable completion trails queue authority by over one second");
  assert.deepEqual(result.afterQueueMicrotask, { at: result.afterQueueMicrotask.at, echoes: 0, authority: 1 },
    "the authoritative queue mutation microtask leaves exactly one representation");
  assert.equal(result.duplicateFrames.length, 0,
    "no rendered animation frame contains both optimistic and authoritative representations");
  assert.equal(result.final.echoes, 0);
  assert.equal(result.final.authority, 1);
  console.log("prompt correlation browser proof passed");
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
  await new Promise((resolve) => server.close(resolve));
}
