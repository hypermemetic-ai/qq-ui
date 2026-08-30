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

const isTransientExecutionContextError = (error) =>
  /(?:Execution context was destroyed|Cannot find context with specified id|Cannot find default execution context)/i
    .test(String(error?.message || error));

async function waitForFixtureResult(cdp) {
  const deadline = Date.now() + 12_000;
  let lastState;
  let contextRetries = 0;
  const stateExpression = `({
    readyState: document.readyState,
    fixtureReady: window.qqPromptCorrelationFixtureReady === true,
    hasResult: Boolean(window.qqPromptCorrelationResult),
    hasHtmx: typeof window.htmx === "object",
  })`;

  while (Date.now() < deadline) {
    try {
      lastState = await cdp.evaluate(stateExpression);
      if (lastState.readyState === "complete" && lastState.fixtureReady && lastState.hasResult) {
        try {
          return await cdp.evaluate("window.qqPromptCorrelationResult");
        } catch (error) {
          if (!isTransientExecutionContextError(error)) throw error;
          contextRetries += 1;
          lastState = undefined;
        }
      }
    } catch (error) {
      if (!isTransientExecutionContextError(error)) throw error;
      contextRetries += 1;
      lastState = undefined;
    }
    await sleep(25);
  }

  return {
    readinessTimeout: true,
    readyState: lastState?.readyState,
    fixtureReady: lastState?.fixtureReady,
    hasResult: lastState?.hasResult,
    hasHtmx: lastState?.hasHtmx,
    contextRetries,
  };
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
const eventLog = [];
const direct = { clientMessageId: "", beforeClientMessageId: "", frames: [] };
const noId = { clientMessageId: "", beforeClientMessageId: "" };
let phase = "direct";
let sampling = false;
let finished = false;
let resolveResult;
window.qqPromptCorrelationFixtureReady = false;
window.qqPromptCorrelationResult = new Promise((resolve) => { resolveResult = resolve; });
const finish = (value) => {
  if (finished) return;
  finished = true;
  clearTimeout(fixtureTimeout);
  resolveResult(value);
};
const fixtureTimeout = setTimeout(() => finish({
  timeout: true,
  eventLog,
  phase,
  readyState: document.readyState,
  hasHtmx: typeof window.htmx === "object",
  fixtureReady: window.qqPromptCorrelationFixtureReady,
  direct,
  noId,
}), 10_000);
window.addEventListener("error", (event) => eventLog.push("error:" + String(event.message || event.error)));
window.addEventListener("unhandledrejection", (event) => eventLog.push("rejection:" + String(event.reason)));

const controller = createQQPromptEchoController(window, {
  currentSessionId: () => "session-a",
  composer: () => input,
});
controller.commission("session-a");
const totalEchoes = () => echoes.querySelectorAll("[data-prompt-echo-state]").length;
const countIdentity = (clientMessageId) => ({
  at: performance.now() - direct.startedAt,
  echoes: [...echoes.querySelectorAll("[data-prompt-echo-state]")]
    .filter((node) => node.getAttribute("data-client-message-id") === clientMessageId).length,
  authority: [...queue.querySelectorAll(".queue-item")]
    .filter((node) => node.getAttribute("data-client-message-id") === clientMessageId).length,
});
const sampleFrame = () => {
  if (!sampling) return;
  direct.frames.push(countIdentity(direct.clientMessageId));
  requestAnimationFrame(sampleFrame);
};

document.addEventListener("htmx:configRequest", (event) => {
  if (event.detail?.elt !== form) return;
  eventLog.push("configRequest:" + phase);
  if (!controller.configRequest(event)) {
    finish({ controllerConfigFailed: true, eventLog, phase });
    return;
  }
  const current = phase === "direct" ? direct : noId;
  current.clientMessageId = event.detail.parameters.get("clientMessageId");
});
document.addEventListener("htmx:beforeRequest", (event) => {
  if (event.detail?.elt !== form) return;
  eventLog.push("beforeRequest:" + phase);
  controller.beforeRequest(event);
  const current = phase === "direct" ? direct : noId;
  current.beforeClientMessageId = event.detail.requestConfig.parameters.get("clientMessageId");
  current.echoesBeforeCompletion = totalEchoes();
  if (phase === "direct") {
    direct.startedAt = performance.now();
    sampling = true;
    requestAnimationFrame(sampleFrame);
  }
});

const authoritySource = new EventSource("/events");
authoritySource.addEventListener("queue", (event) => {
  eventLog.push("queueSse");
  const authority = JSON.parse(event.data);
  const row = document.createElement("li");
  row.className = "queue-item message-queued";
  row.setAttribute("data-message-id", authority.messageId);
  row.setAttribute("data-client-message-id", authority.clientMessageId);
  row.textContent = authority.text;
  queue.append(row);
  direct.queueAt = performance.now();
  queueMicrotask(() => { direct.afterQueueMicrotask = countIdentity(direct.clientMessageId); });
});

document.addEventListener("htmx:afterRequest", (event) => {
  if (event.detail?.elt !== form) return;
  eventLog.push("afterRequest:" + phase);
  controller.afterRequest(event);
  if (phase === "direct") {
    sampling = false;
    direct.completedAt = performance.now();
    direct.responseLagMs = direct.completedAt - direct.queueAt;
    direct.final = countIdentity(direct.clientMessageId);
    phase = "no-id";
    requestAnimationFrame(() => {
      input.value = "/find resolved without admission";
      form.requestSubmit();
    });
    return;
  }
  noId.echoesAfterCompletion = totalEchoes();
  noId.authority = [...queue.querySelectorAll("[data-client-message-id]")]
    .filter((node) => node.getAttribute("data-client-message-id") === noId.clientMessageId).length;
  requestAnimationFrame(() => {
    noId.echoesAfterPaint = totalEchoes();
    const result = {
      eventLog,
      direct,
      noId,
      finalEchoes: totalEchoes(),
      finalAuthority: queue.querySelectorAll(".queue-item").length,
    };
    authoritySource.close();
    controller.dispose();
    finish(result);
  });
});

let htmxReady = false;
let sseReady = false;
let submitted = false;
const maybeSubmit = () => {
  if (submitted || !htmxReady || !sseReady) return;
  submitted = true;
  window.qqPromptCorrelationFixtureReady = true;
  eventLog.push("fixtureReady");
  form.requestSubmit();
};
document.addEventListener("htmx:load", () => {
  eventLog.push("htmxLoad");
  htmxReady = true;
  maybeSubmit();
}, { once: true });
authoritySource.addEventListener("open", () => {
  eventLog.push("sseOpen");
  sseReady = true;
  maybeSubmit();
}, { once: true });
</script></body></html>`;

const receivedWireRequests = [];
const serverRequests = [];
const sseClients = new Set();
const sendQueueAuthority = (body) => {
  const clientMessageId = new URLSearchParams(body).get("clientMessageId") || "";
  const event = JSON.stringify({
    clientMessageId,
    messageId: "durable-message-1",
    text: "identical prompt text",
  });
  for (const client of sseClients) client.write(`event: queue\ndata: ${event}\n\n`);
};
const server = createServer(async (req, res) => {
  serverRequests.push(`${req.method} ${req.url}`);
  if (req.url === "/htmx.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(htmxSource);
    return;
  }
  if (req.url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    sseClients.add(res);
    req.once("close", () => sseClients.delete(res));
    return;
  }
  if (req.url === "/prompt" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const prompt = new URLSearchParams(body).get("prompt") || "";
    receivedWireRequests.push({ url: req.url, body, prompt });
    if (!prompt.startsWith("/find ")) {
      setTimeout(() => sendQueueAuthority(body), 100);
      setTimeout(() => {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "X-QQ-Message-Id": "durable-message-1",
          "X-QQ-Prompt-Outcome": "accepted",
        });
        res.end("");
      }, 1_400);
    } else {
      setTimeout(() => {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "X-QQ-Prompt-Outcome": "accepted",
        });
        res.end("");
      }, 150);
    }
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
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const result = await waitForFixtureResult(cdp);
  assert.equal(result.readinessTimeout, undefined,
    `real HTMX fixture readiness timed out: ${JSON.stringify(result)}; requests=${serverRequests.join(",")}`);
  assert.equal(result.timeout, undefined,
    `real HTMX fixture timed out: ${JSON.stringify(result)}; requests=${serverRequests.join(",")}`);
  assert.equal(result.controllerConfigFailed, undefined, `production configRequest rejected fixture: ${JSON.stringify(result)}`);

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(result.direct.clientMessageId ?? "", uuidPattern,
    "configRequest creates a cryptographically random correlation UUID");
  assert.match(result.noId.clientMessageId ?? "", uuidPattern,
    "each prompt gets a fresh browser correlation UUID");
  assert.notEqual(result.direct.clientMessageId, result.noId.clientMessageId);
  assert.equal(result.direct.beforeClientMessageId, result.direct.clientMessageId,
    "beforeRequest binds the exact UUID configured for the direct prompt");
  assert.equal(result.noId.beforeClientMessageId, result.noId.clientMessageId,
    "beforeRequest binds the exact UUID configured for the no-ID prompt");
  assert.deepEqual(result.eventLog.filter((entry) => /(?:configRequest|beforeRequest)/.test(entry)), [
    "configRequest:direct", "beforeRequest:direct", "configRequest:no-id", "beforeRequest:no-id",
  ], "real HTMX dispatches configRequest before provisional creation for each request");

  assert.equal(receivedWireRequests.length, 2,
    `server received both controlled prompt requests: ${JSON.stringify(receivedWireRequests)}`);
  const directWire = receivedWireRequests.find((entry) => entry.prompt === "identical prompt text");
  const noIdWire = receivedWireRequests.find((entry) => entry.prompt === "/find resolved without admission");
  assert.equal(new URLSearchParams(directWire?.body).get("clientMessageId"), result.direct.clientMessageId,
    "the server received the exact direct-prompt UUID injected during configRequest");
  assert.equal(new URLSearchParams(noIdWire?.body).get("clientMessageId"), result.noId.clientMessageId,
    `the server received the exact no-ID-route UUID injected during configRequest; wire=${JSON.stringify(receivedWireRequests)} events=${JSON.stringify(result.eventLog)}`);

  assert.ok(result.direct.responseLagMs > 1_000,
    "controlled durable completion trails authoritative queue SSE by over one second");
  assert.deepEqual(result.direct.afterQueueMicrotask, {
    at: result.direct.afterQueueMicrotask.at,
    echoes: 0,
    authority: 1,
  }, "the authoritative queue SSE mutation microtask leaves exactly one representation");
  assert.equal(result.direct.frames.filter((frame) => frame.echoes > 0 && frame.authority > 0).length, 0,
    "no rendered animation frame contains both provisional and authoritative representations");
  assert.equal(result.direct.final.echoes, 0);
  assert.equal(result.direct.final.authority, 1);

  assert.equal(result.noId.echoesBeforeCompletion, 1,
    "the non-admitting route still presents an immediate provisional row while pending");
  assert.equal(result.noId.echoesAfterCompletion, 0,
    "successful completion without X-QQ-Message-Id removes the provisional immediately");
  assert.equal(result.noId.echoesAfterPaint, 0,
    "the no-ID route never leaves an accepted ghost into the next paint");
  assert.equal(result.noId.authority, 0);
  assert.equal(result.finalEchoes, 0);
  assert.equal(result.finalAuthority, 1);
  console.log("prompt correlation browser proof passed");
} catch (error) {
  if (chromeErrors) error.message += `\nChromium: ${chromeErrors.slice(-1600)}`;
  throw error;
} finally {
  for (const client of sseClients) client.end();
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
