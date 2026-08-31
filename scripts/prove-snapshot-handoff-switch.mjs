#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  createConsoleHandler,
  createInitialSnapshotHandoffStore,
} from "../src/http-app.mjs";

const sessionId = "session-c1000000-0000-4000-8000-000000000001";
const otherSessionId = "session-c1000000-0000-4000-8000-000000000002";
const binding = { sessionId, project: "alpha", folder: null };
const tokenOf = (serial) => `proof_${String(serial).padStart(40, "0")}`;

const opaqueDefaults = createInitialSnapshotHandoffStore();
const opaqueToken = opaqueDefaults.issue(binding, { id: sessionId });
assert.match(opaqueToken, /^[A-Za-z0-9_-]{32}$/,
  "production handoffs are 192-bit cryptographic base64url tokens");
opaqueDefaults.discard(opaqueToken);

let defaultNow = 10_000;
let defaultSerial = 0;
const defaultPolicy = createInitialSnapshotHandoffStore({
  now: () => defaultNow,
  createToken: () => tokenOf(10_000 + ++defaultSerial),
});
const defaultExpiry = defaultPolicy.issue(binding, { id: sessionId });
defaultNow += 8_000;
assert.equal(defaultPolicy.consume(defaultExpiry, binding), null, "the production TTL is 8 seconds");
let defaultEvicted;
for (let index = 0; index < 33; index += 1) {
  const token = defaultPolicy.issue(binding, { index });
  if (index === 0) defaultEvicted = token;
}
assert.equal(defaultPolicy.size, 32, "the production store cap is 32 entries");
assert.equal(defaultPolicy.consume(defaultEvicted, binding), null, "the production cap evicts oldest-first");
defaultPolicy.clear();

// The handoff container is a bounded, expiring, exact-reference, one-shot store.
let now = 1_000;
let tokenSerial = 0;
const store = createInitialSnapshotHandoffStore({
  maxEntries: 3,
  ttlMs: 100,
  now: () => now,
  createToken: () => tokenOf(++tokenSerial),
});
const exactSnapshot = { id: sessionId, marker: Symbol("exact-page-object") };
const exactToken = store.issue(binding, exactSnapshot);
assert.match(exactToken, /^[A-Za-z0-9_-]+$/, "handoff tokens are URL-safe");
assert.strictEqual(store.consume(exactToken, binding), exactSnapshot,
  "consume returns the exact retained page object, not a clone or reconstruction");
assert.equal(store.consume(exactToken, binding), null, "a handoff is one-shot and replay-safe");

const mismatchedSession = store.issue(binding, { id: sessionId });
assert.equal(store.consume(mismatchedSession, { ...binding, sessionId: otherSessionId }), null);
assert.equal(store.consume(mismatchedSession, binding), null, "a session mismatch deletes the token");
const mismatchedRoute = store.issue(binding, { id: sessionId });
assert.equal(store.consume(mismatchedRoute, { ...binding, project: "bravo" }), null);
assert.equal(store.consume(mismatchedRoute, binding), null, "a route mismatch deletes the token");
const mismatchedFolder = store.issue(binding, { id: sessionId });
assert.equal(store.consume(mismatchedFolder, { ...binding, folder: "nested" }), null);
assert.equal(store.consume(mismatchedFolder, binding), null, "a folder mismatch also deletes the token");

const expired = store.issue(binding, { id: sessionId });
now += 101;
assert.equal(store.consume(expired, binding), null, "expired snapshots cannot be disclosed");
assert.equal(store.size, 0, "expiry is lazily pruned");

const evicted = store.issue(binding, { serial: 1 });
const retainedTwo = store.issue(binding, { serial: 2 });
const retainedThree = store.issue(binding, { serial: 3 });
const retainedFour = store.issue(binding, { serial: 4 });
assert.equal(store.size, 3, "the store never exceeds its hard cap");
assert.equal(store.consume(evicted, binding), null, "the oldest entry is evicted at the cap");
assert.deepEqual(store.consume(retainedTwo, binding), { serial: 2 });
assert.deepEqual(store.consume(retainedThree, binding), { serial: 3 });
assert.deepEqual(store.consume(retainedFour, binding), { serial: 4 });
assert.equal(store.consume("not-a-real-token", binding), null, "invalid tokens safely miss");

function snapshot({ running = false } = {}) {
  const live = running ? [{
    kind: "assistant",
    key: "assistant:1",
    seq: 1,
    turn: 1,
    step: 1,
    status: "streaming",
    blocks: [{ type: "text", text: "later observation" }],
  }] : [];
  return {
    id: sessionId,
    project: "alpha",
    events: [],
    agentStatus: running ? "running" : "idle",
    sessions: [{ id: sessionId, project: "alpha", alias: "one" }],
    children: [],
    conversation: { nodes: live, pending: [] },
  };
}

function backendFixture({ bufferedChange = false } = {}) {
  let reads = 0;
  let observer = null;
  const initial = snapshot();
  const backend = {
    defaultProject: "alpha",
    defaultFolder: "",
    listProjects: () => [
      { name: "alpha", label: "alpha" },
      { name: "bravo", label: "bravo" },
    ],
    read: async (id) => {
      reads += 1;
      if (id !== sessionId) {
        const error = new Error("missing");
        error.status = 404;
        throw error;
      }
      return structuredClone(initial);
    },
    list: async () => structuredClone(initial.sessions),
    observe(_id, listener) {
      observer = listener;
      listener(null, structuredClone(bufferedChange ? snapshot({ running: true }) : initial));
      return () => { observer = null; };
    },
    create: async () => structuredClone(initial),
    prompt: async () => structuredClone(initial),
    interrupt: async () => structuredClone(initial),
    close: async () => ({ id: "", project: "alpha" }),
  };
  return {
    backend,
    reads: () => reads,
    observe: (next) => observer?.(null, structuredClone(next)),
  };
}

function parseSse(text) {
  return text.replaceAll("\r", "").split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    if (!event) return [];
    return [{
      event,
      data: lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
    }];
  });
}

async function withHttpFixture(run) {
  const fixture = backendFixture();
  let clock = 10_000;
  let serial = 0;
  const handoffs = createInitialSnapshotHandoffStore({
    maxEntries: 3,
    ttlMs: 100,
    now: () => clock,
    createToken: () => tokenOf(100 + ++serial),
  });
  const handler = createConsoleHandler(fixture.backend, {
    ssePollMs: 1_000,
    initialSnapshotHandoffs: handoffs,
  });
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, fixture, handoffs, advance: (ms) => { clock += ms; } });
  } finally {
    handler.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

function eventPath(html) {
  const encoded = html.match(/id="console-stream"[^>]*sse-connect="([^"]+)"/)?.[1];
  assert.ok(encoded, "a rendered session page has an initial EventSource URL");
  return encoded.replaceAll("&amp;", "&");
}

async function openSse(url, { afterOpen } = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  try {
    await reader.read().then(({ value }) => { body += decoder.decode(value ?? new Uint8Array()); });
    await afterOpen?.();
    const deadline = Date.now() + 75;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve(null), remaining)),
      ]);
      if (!result || result.done) break;
      if (result.value) body += decoder.decode(result.value);
    }
  } finally {
    controller.abort();
    try { await reader.cancel(); } catch {}
  }
  return { response, frames: parseSse(body) };
}

await withHttpFixture(async ({ base, fixture, handoffs, advance }) => {
  const canonical = `/qq/project/alpha/session/${sessionId}`;
  const page = await fetch(`${base}${canonical}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("referrer-policy"), "no-referrer",
    "privacy headers are unchanged by the URL-local handoff");
  const html = await page.text();
  const events = eventPath(html);
  assert.match(events, /\/events\?handoff=proof_\d+$/);
  const pageToken = new URL(events, base).searchParams.get("handoff");
  assert.equal(html.split(pageToken).length, 2,
    "the opaque token occurs only in this page's initial sse-connect URL");
  assert.doesNotMatch(html.match(/<a href="[^"]+" aria-label="Reload/)?.[0] ?? "", /handoff=/,
    "canonical/history navigation stays token-free");
  assert.doesNotMatch(page.url, /handoff=/, "the page URL remains canonical and private");
  assert.equal(fixture.reads(), 1);
  assert.equal(handoffs.size, 1);

  const first = await openSse(`${base}${events}`, {
    afterOpen: () => fixture.observe(snapshot({ running: true })),
  });
  assert.equal(first.response.status, 200);
  assert.equal(fixture.reads(), 1, "valid handoff skips the duplicate view/read");
  assert.equal(handoffs.size, 0, "valid handoff is consumed");
  assert.equal(first.frames[0]?.event, "ui");
  assert.ok(first.frames.some((frame) => ["live", "live-append"].includes(frame.event)),
    "a later observation reconciles against the handed-off baseline");
  assert.ok(first.frames.some((frame) => frame.event === "chrome"));
  assert.ok(!first.frames.some((frame) => frame.event === "transcript-reset"),
    "the initial stream does not repeat the full settled page snapshot");

  const replay = await openSse(`${base}${events}`);
  assert.equal(replay.response.status, 200);
  assert.equal(fixture.reads(), 2, "replay safely falls back to an ordinary view");

  const secondPage = await fetch(`${base}${canonical}`);
  const secondEvents = eventPath(await secondPage.text());
  assert.equal(fixture.reads(), 3);
  const token = new URL(secondEvents, base).searchParams.get("handoff");
  const mismatch = await fetch(`${base}/qq/project/bravo/session/${sessionId}/events?handoff=${token}`);
  assert.equal(mismatch.status, 404, "route mismatch discloses no retained snapshot");
  assert.equal(fixture.reads(), 4, "route mismatch falls back through ordinary validation");
  const mismatchReplay = await openSse(`${base}${secondEvents}`);
  assert.equal(mismatchReplay.response.status, 200);
  assert.equal(fixture.reads(), 5, "mismatched token was deleted before replay");

  const thirdPage = await fetch(`${base}${canonical}`);
  const thirdEvents = eventPath(await thirdPage.text());
  assert.equal(fixture.reads(), 6);
  const separator = thirdEvents.includes("?") ? "&" : "?";
  const bootstrap = await openSse(`${base}${thirdEvents}${separator}bootstrap=session&switch=9`);
  assert.equal(bootstrap.response.status, 200);
  assert.equal(fixture.reads(), 7, "live-switch bootstrap categorically uses a fresh view");
  assert.ok(bootstrap.frames.some((frame) => frame.event === "switch-ready"));
  assert.equal(handoffs.size, 1, "bootstrap neither consumes nor exposes the page handoff");
  const afterBootstrap = await openSse(`${base}${thirdEvents}`);
  assert.equal(afterBootstrap.response.status, 200);
  assert.equal(fixture.reads(), 7, "the rightful non-bootstrap request can still consume it");

  const head = await fetch(`${base}${canonical}`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(handoffs.size, 0, "HEAD rendering never allocates a handoff");

  const expiringPage = await fetch(`${base}${canonical}`);
  const expiringEvents = eventPath(await expiringPage.text());
  const readsBeforeExpiry = fixture.reads();
  advance(101);
  const expiredFallback = await openSse(`${base}${expiringEvents}`);
  assert.equal(expiredFallback.response.status, 200);
  assert.equal(fixture.reads(), readsBeforeExpiry + 1, "expiry safely falls back to view");
  assert.equal(handoffs.size, 0);

  const readsBeforeInvalid = fixture.reads();
  const invalidFallback = await openSse(
    `${base}${canonical}/events?handoff=${tokenOf(99_999)}`,
  );
  assert.equal(invalidFallback.response.status, 200);
  assert.equal(fixture.reads(), readsBeforeInvalid + 1, "an unknown valid-shaped token falls back to view");
});

async function instrumentedHttpApp() {
  const sourceUrl = new URL("../src/http-app.mjs", import.meta.url);
  let source = await readFile(sourceUrl, "utf8");
  const pageNeedle = "    renderPage: bundledRenderPage,\n";
  const regionNeedle = "    renderSessionRegion: bundledRenderSessionRegion,\n";
  assert.ok(source.includes(pageNeedle) && source.includes(regionNeedle),
    "proof seams find bundled page and region renderers");
  source = source.replace(pageNeedle, `    renderPage: (...args) => {
      globalThis.__qqProofRenderedPageSnapshot = args[0];
      if (globalThis.__qqProofFailPageRenderOnce === true) {
        globalThis.__qqProofFailPageRenderOnce = false;
        throw new Error("proof page render failure");
      }
      return bundledRenderPage(...args);
    },
`);
  source = source.replace(regionNeedle, `    renderSessionRegion: (...args) => {
      if (args[0] === "usage" && globalThis.__qqProofFailSecondaryOnce === true) {
        globalThis.__qqProofFailSecondaryOnce = false;
        throw new Error("proof secondary render failure");
      }
      return bundledRenderSessionRegion(...args);
    },
`);
  const watchNeedle = "      }, { initialSnapshot: snapshot, deferSheets: bootstrapSession });\n";
  assert.ok(source.includes(watchNeedle), "proof seam finds the watch baseline");
  source = source.replace(watchNeedle,
    "      }, { initialSnapshot: (globalThis.__qqProofWatchInitialSnapshot = snapshot), deferSheets: bootstrapSession });\n");
  const temporaryUrl = new URL(`../src/.prove-http-c1-${process.pid}.mjs`, import.meta.url);
  await writeFile(temporaryUrl, source);
  try {
    return await import(`${temporaryUrl.href}?proof=c1`);
  } finally {
    await rm(temporaryUrl, { force: true });
  }
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.log = [];
    this.destroyed = false;
    this.writableEnded = false;
    this.socket = { setNoDelay: () => this.log.push({ type: "nodelay" }) };
  }
  writeHead(status, headers) { this.status = status; this.headers = headers; this.log.push({ type: "headers" }); }
  flushHeaders() { this.log.push({ type: "flush-headers" }); }
  write(chunk) {
    const frames = parseSse(String(chunk));
    if (frames.length) this.log.push(...frames.map((frame) => ({ type: "event", ...frame })));
    else this.log.push({ type: "write", data: String(chunk) });
    return true;
  }
  flush() { this.log.push({ type: "flush" }); }
  end(body) {
    this.body = body === undefined ? "" : String(body);
    this.writableEnded = true;
    this.log.push({ type: "end" });
  }
  destroy() { this.destroyed = true; this.emit("close"); }
}

async function proveFailureBoundaries() {
  const instrumented = await instrumentedHttpApp();

  const pageFixture = backendFixture();
  let issuedSnapshot = null;
  let pageTokenSerial = 900;
  const backingHandoffs = createInitialSnapshotHandoffStore({
    maxEntries: 3,
    ttlMs: 100,
    now: () => 1_000,
    createToken: () => tokenOf(pageTokenSerial++),
  });
  const handoffs = {
    issue(binding, value) {
      issuedSnapshot = value;
      return backingHandoffs.issue(binding, value);
    },
    consume: (token, binding) => backingHandoffs.consume(token, binding),
    discard: (token) => backingHandoffs.discard(token),
    clear: () => backingHandoffs.clear(),
    get size() { return backingHandoffs.size; },
  };
  const pageHandler = instrumented.createConsoleHandler(pageFixture.backend, {
    initialSnapshotHandoffs: handoffs,
  });
  const makePageRequest = () => {
    const req = new EventEmitter();
    Object.assign(req, {
      method: "GET",
      url: `/qq/project/alpha/session/${sessionId}`,
      headers: {},
    });
    return req;
  };

  const exactPageRes = new FakeResponse();
  await pageHandler(makePageRequest(), exactPageRes);
  assert.strictEqual(globalThis.__qqProofRenderedPageSnapshot, issuedSnapshot,
    "renderPage and handoff issuance share the exact enriched page object");
  const exactEvents = eventPath(exactPageRes.body);
  const exactSseReq = new EventEmitter();
  Object.assign(exactSseReq, { method: "GET", url: exactEvents, headers: {} });
  const exactSseRes = new FakeResponse();
  await pageHandler(exactSseReq, exactSseRes);
  assert.strictEqual(globalThis.__qqProofWatchInitialSnapshot, issuedSnapshot,
    "valid consume passes the exact rendered object to watch(initialSnapshot)");
  exactSseReq.emit("close");

  const failedPageRes = new FakeResponse();
  globalThis.__qqProofFailPageRenderOnce = true;
  await pageHandler(makePageRequest(), failedPageRes);
  assert.equal(handoffs.size, 0, "a renderer exception cannot leak its allocated snapshot entry");
  pageHandler.dispose();

  const switchFixture = backendFixture({ bufferedChange: true });
  const switchHandler = instrumented.createConsoleHandler(switchFixture.backend, { ssePollMs: 10_000 });
  const switchReq = new EventEmitter();
  Object.assign(switchReq, {
    method: "GET",
    url: `/qq/project/alpha/session/${sessionId}/events?bootstrap=session&switch=18`,
    headers: {},
  });
  const switchRes = new FakeResponse();
  globalThis.__qqProofFailSecondaryOnce = true;
  await switchHandler(switchReq, switchRes);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const names = switchRes.log.filter((entry) => entry.type === "event").map((entry) => entry.event);
    if (names.includes("console-error") && names.includes("usage")) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const names = switchRes.log.filter((entry) => entry.type === "event").map((entry) => entry.event);
  const readyAt = names.indexOf("switch-ready");
  const errorAt = names.indexOf("console-error");
  const retriedUsageAt = names.indexOf("usage");
  assert.ok(readyAt >= 0 && errorAt > readyAt,
    "secondary failure is reported only after critical readiness");
  assert.ok(retriedUsageAt > errorAt,
    "invalidating the failed fingerprint lets buffered observation repair the missing region");
  assert.equal(switchRes.writableEnded, false,
    "secondary failure does not invalidate or close an already-ready critical session");
  switchReq.emit("close");
  switchHandler.dispose();
  delete globalThis.__qqProofFailPageRenderOnce;
  delete globalThis.__qqProofFailSecondaryOnce;
  delete globalThis.__qqProofRenderedPageSnapshot;
  delete globalThis.__qqProofWatchInitialSnapshot;
}

async function proveNormalAdmissionOrder() {
  const clientMessageId = "710ec58a-a0f2-4ac4-8393-c866d813b8d7";
  const baseSnapshot = snapshot();
  const initial = {
    ...baseSnapshot,
    conversation: {
      nodes: [{
        key: "user:before", seq: 1, kind: "user", messageId: "before-core",
        content: [{ type: "text", text: "before replacement" }],
      }],
      pending: [{
        id: "admitted-core", placement: "queued", text: "exact admission", editable: true,
        message: { source: { kind: "user", clientMessageId } },
      }],
    },
  };
  const admitted = {
    ...baseSnapshot,
    conversation: {
      // A different first key proves an authoritative settled-prefix reset, not
      // ordinary append-only growth, while this observation also empties queue.
      nodes: [{
        key: "user:admitted", seq: 2, kind: "user", messageId: "admitted-core", clientMessageId,
        content: [{ type: "text", text: "exact admission" }],
      }],
      pending: [],
    },
  };
  let observer = null;
  const backend = {
    defaultProject: "alpha",
    defaultFolder: "",
    listProjects: () => [{ name: "alpha", label: "alpha" }],
    read: async () => structuredClone(initial),
    list: async () => structuredClone(initial.sessions),
    observe(_id, listener) {
      observer = listener;
      listener(null, structuredClone(initial));
      return () => { observer = null; };
    },
    create: async () => structuredClone(initial),
    prompt: async () => structuredClone(initial),
    interrupt: async () => structuredClone(initial),
    close: async () => ({ id: "", project: "alpha" }),
  };
  const handler = createConsoleHandler(backend, { basePath: "/qq", ssePollMs: 10_000 });
  const req = new EventEmitter();
  Object.assign(req, {
    method: "GET",
    url: `/qq/project/alpha/session/${sessionId}/events`,
    headers: {},
  });
  const res = new FakeResponse();
  await handler(req, res);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (res.log.some((entry) => entry.type === "flush")) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const baselineEnd = res.log.length;
  assert.equal(typeof observer, "function",
    `normal stream retains its core observer after baseline: status=${res.status} body=${res.body} log=${JSON.stringify(res.log)}`);
  observer(null, structuredClone(admitted));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (res.log.slice(baselineEnd).some((entry) => entry.type === "event" && entry.event === "queue")) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const events = res.log.slice(baselineEnd)
    .filter((entry) => entry.type === "event")
    .map((entry) => entry.event);
  const transcriptAt = events.indexOf("transcript-reset");
  const queueAt = events.indexOf("queue");
  assert.ok(transcriptAt >= 0,
    `normal replacement emits settled transcript reset: events=${events.join(",")} log=${JSON.stringify(res.log.slice(baselineEnd))}`);
  assert.ok(queueAt > transcriptAt,
    `normal observation emits admitted transcript before queue removal: ${events.join(",")}`);
  req.emit("close");
  handler.dispose();
}

async function proveSwitchOrder() {
  const fixture = backendFixture({ bufferedChange: true });
  const handler = createConsoleHandler(fixture.backend, { ssePollMs: 10_000 });
  const req = new EventEmitter();
  Object.assign(req, {
    method: "GET",
    url: `/qq/project/alpha/session/${sessionId}/events?bootstrap=session&switch=17`,
    headers: {},
  });
  const res = new FakeResponse();
  await handler(req, res);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (res.log.filter((entry) => entry.type === "flush").length >= 3) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const protocol = res.log.filter((entry) => entry.type === "event" || entry.type === "flush");
  const firstFlush = protocol.findIndex((entry) => entry.type === "flush");
  assert.deepEqual(protocol.slice(0, firstFlush).map((entry) => entry.event), [
    "switch-meta", "chrome", "transcript-reset", "live", "queue", "popups", "composer-shell", "switch-ready",
  ], "critical session truth and interaction frames have exact priority order");
  assert.equal(protocol[firstFlush - 1]?.event, "switch-ready",
    "the critical ready frame is the flush boundary");
  const secondFlush = protocol.findIndex((entry, index) => index > firstFlush && entry.type === "flush");
  assert.deepEqual(protocol.slice(firstFlush + 1, secondFlush).map((entry) => entry.event), [
    "usage", "children", "case", "composer-case", "ui",
  ], "every secondary region follows ready in exact order");
  const laterEvents = protocol.slice(secondFlush + 1).filter((entry) => entry.type === "event").map((entry) => entry.event);
  assert.ok(laterEvents.some((event) => event === "live-append" || event === "live"),
    "an observation buffered during bootstrap reconciles live state after the bounded secondary batch");
  assert.ok(laterEvents.includes("chrome"), "buffered critical changes are not lost or regressed");
  assert.ok(!protocol.slice(0, secondFlush).some((entry) => entry.event === "live-append"),
    "buffered observations cannot corrupt bootstrap ordering");
  req.emit("close");
  handler.dispose();
}

await proveFailureBoundaries();
await proveNormalAdmissionOrder();
await proveSwitchOrder();
console.log("prove-snapshot-handoff-switch: pass");
