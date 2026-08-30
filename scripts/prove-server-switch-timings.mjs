#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createConsoleHandler } from "../src/http-app.mjs";
import {
  MAX_SESSION_SWITCH_SERVER_TIMING_MS,
  sanitizeLatencyBatch,
  SESSION_SWITCH_SERVER_TIMING_FIELDS,
} from "../src/latency-store.mjs";
import { analyzeLatencyRecords } from "./report-ui-latency.mjs";

const sessionId = "session-c2000000-0000-4000-8000-000000000001";
const snapshot = () => ({
  id: sessionId,
  project: "proof",
  events: [],
  sessions: [{ id: sessionId, project: "proof" }],
  conversation: { nodes: [], pending: [] },
  children: [],
  agentStatus: "idle",
});

function parseSse(chunk) {
  return String(chunk).replaceAll("\r", "").split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    return event ? [{
      event,
      data: lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
    }] : [];
  });
}

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.log = [];
    this.destroyed = false;
    this.writableEnded = false;
    this.socket = { setNoDelay() {} };
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.log.push({ type: "headers" });
  }
  flushHeaders() { this.log.push({ type: "flush-headers" }); }
  write(chunk) {
    this.log.push(...parseSse(chunk).map((frame) => ({ type: "event", ...frame })));
    return true;
  }
  flush() { this.log.push({ type: "flush" }); }
  end() { this.writableEnded = true; }
}

// Each explicit timing boundary advances exactly one millisecond. No sleep or
// broad inequality is involved, so additions/removals of measured work change
// this fixture deterministically.
let clock = 0;
const backend = {
  defaultProject: "proof",
  listProjects: () => [{ name: "proof", label: "proof" }],
  read: async () => snapshot(),
  list: async () => snapshot().sessions,
  observe(_id, listener) {
    listener(null, snapshot());
    return () => {};
  },
  create: async () => snapshot(),
  prompt: async () => snapshot(),
  interrupt: async () => snapshot(),
  close: async () => ({ id: null }),
};
const handler = createConsoleHandler(backend, {
  ssePollMs: 10_000,
  latencyPersistence: false,
  performanceNow: () => ++clock,
});
const request = new EventEmitter();
Object.assign(request, {
  method: "GET",
  url: `/qq/project/proof/session/${sessionId}/events?bootstrap=session&switch=23`,
  headers: {},
});
const response = new FakeResponse();
await handler(request, response);
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (response.log.some((entry) => entry.event === "switch-ready")) break;
  await new Promise((resolve) => setImmediate(resolve));
}
const criticalEvents = response.log.filter((entry) => entry.type === "event").slice(0, 8);
assert.deepEqual(criticalEvents.map(({ event }) => event), [
  "switch-meta", "chrome", "transcript-reset", "live", "queue", "popups", "composer-shell", "switch-ready",
], "C2 leaves the exact critical switch order unchanged");
assert.ok(response.log.findIndex((entry) => entry.type === "headers")
  < response.log.findIndex((entry) => entry.event === "switch-meta"),
"critical render remains after SSE headers");
const readyPayload = JSON.parse(criticalEvents.at(-1).data);
assert.deepEqual(Object.keys(readyPayload).sort(), ["generation", "id", "timings"]);
assert.equal(readyPayload.id, sessionId);
assert.equal(readyPayload.generation, 23);
assert.deepEqual(Object.keys(readyPayload.timings), SESSION_SWITCH_SERVER_TIMING_FIELDS);
assert.deepEqual(readyPayload.timings, {
  serverViewMs: 7,
  serverReadMs: 1,
  serverSessionsMs: 1,
  serverSheetsMs: 1,
  serverRenderLoadMs: 1,
  serverSurfaceMs: 1,
  serverLiveStateMs: 1,
  serverFingerprintsMs: 1,
  serverChromeRenderMs: 1,
  serverTranscriptRenderMs: 1,
  serverLiveRenderMs: 1,
  serverQueueRenderMs: 1,
  serverPopupsRenderMs: 1,
  serverComposerRenderMs: 1,
  serverCriticalRenderMs: 21,
}, "controlled monotonic boundaries produce an exact fixed phase fixture");
assert.ok(SESSION_SWITCH_SERVER_TIMING_FIELDS.every((field) =>
  Number.isFinite(readyPayload.timings[field]) && readyPayload.timings[field] >= 0));
request.emit("close");
handler.dispose();

// Load the browser's real collector factory rather than duplicating its wire
// normalizer in the proof.
const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const factoryStart = "/* qq-latency-factory:start */";
const factoryEnd = "/* qq-latency-factory:end */";
const factoryBody = browserSource.slice(
  browserSource.indexOf(factoryStart) + factoryStart.length,
  browserSource.indexOf(factoryEnd),
);
const createQQLatencyStudy = Function(`${factoryBody}\nreturn createQQLatencyStudy;`)();
assert.match(browserSource,
  /timingEnvelopeIsFixed[\s\S]*if \(!timingEnvelopeIsFixed\) return;[\s\S]*finishLiveSwitch/,
  "unknown top-level ready payload fields are rejected before adoption");
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
}
const script = { dataset: { uiGeneration: "proof", uiRevision: "proof" } };
const document = Object.assign(new Target(), {
  currentScript: script,
  documentElement: {},
  querySelector: (selector) => selector.includes("script") ? script : null,
  querySelectorAll: () => [],
});
let browserNow = 1_000;
let frame = null;
const storage = new Map();
const host = Object.assign(new Target(), {
  document,
  location: { href: "https://qq.invalid/qq/session/redacted", search: "", origin: "https://qq.invalid" },
  sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  performance: { now: () => browserNow, timeOrigin: 1_700_000_000_000, getEntriesByType: () => [] },
  crypto: { randomUUID: () => "110ec58a-a0f2-4ac4-8393-c866d813b8d1" },
  MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
  requestAnimationFrame: (callback) => { frame = callback; return 1; },
  cancelAnimationFrame: () => { frame = null; },
  setTimeout: () => 1,
  clearTimeout() {},
  visualViewport: new Target(),
  navigator: { userAgent: "proof-browser" },
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 2,
  URL,
  URLSearchParams,
});
Object.assign(host.visualViewport, { width: 800, height: 600, scale: 1 });
const collector = createQQLatencyStudy(host, { runId: "page-server-phase-proof" });
const switchId = collector.markSessionSwitch("/qq/session/private-value");
browserNow = 1_500;
assert.equal(collector.markSessionSwitchServerTimings(switchId, readyPayload.timings), true);
browserNow = 1_600;
assert.equal(collector.markSessionSwitchReady(switchId, null), true);
const readyStage = collector.snapshot().stages.find((entry) => entry.kind === "session-switch-ready");
assert.ok(readyStage);
assert.deepEqual(
  Object.fromEntries(SESSION_SWITCH_SERVER_TIMING_FIELDS.map((field) => [field, readyStage[field]])),
  readyPayload.timings,
  "fixed server phases round-trip through the real browser collector",
);
assert.doesNotMatch(JSON.stringify(collector.snapshot()), /private-value|prompt|project-secret/i,
  "collector state contains no raw SSE or private route payload");

const page = {
  timeOrigin: 1_700_000_000_000,
  startedAt: 1_000,
  startedAtISO: "2023-11-14T22:13:21.000Z",
  navigation: null,
  firstPaint: null,
  firstContentfulPaint: null,
  navigationIntent: null,
  ui: { generation: "proof", revision: "proof" },
  viewport: { width: 800, height: 600, devicePixelRatio: 2, visual: { width: 800, height: 600, scale: 1 } },
  userAgent: "proof-browser",
};
const wireBatch = {
  schema: "qq.visual-latency-batch/v1",
  runId: "page-server-phase-proof",
  batchId: "page-server-phase-proof-1",
  page,
  origins: [],
  stages: collector.snapshot().stages,
  visuals: [],
};
const sanitized = sanitizeLatencyBatch(wireBatch);
const storedReady = sanitized.stages.find((entry) => entry.kind === "session-switch-ready");
assert.deepEqual(
  Object.fromEntries(SESSION_SWITCH_SERVER_TIMING_FIELDS.map((field) => [field, storedReady[field]])),
  readyPayload.timings,
  "strict latency storage retains every allowlisted server phase",
);

const malformedSwitchId = collector.markSessionSwitch("/qq/session/another-private-value");
assert.equal(collector.markSessionSwitchServerTimings(malformedSwitchId, {
  ...readyPayload.timings,
  serverReadMs: -1,
  prompt: "PRIVATE PROMPT",
}), false);
browserNow = 1_700;
assert.equal(collector.markSessionSwitchReady(malformedSwitchId, null), true,
  "invalid timing data is ignored without breaking switch adoption");
const malformedReadyStage = collector.snapshot().stages.find((entry) =>
  entry.kind === "session-switch-ready" && entry.sessionSwitchId === malformedSwitchId);
assert.ok(malformedReadyStage);
for (const field of SESSION_SWITCH_SERVER_TIMING_FIELDS) {
  assert.equal(Object.hasOwn(malformedReadyStage, field), false);
}
assert.doesNotMatch(JSON.stringify(malformedReadyStage), /PRIVATE PROMPT|another-private-value/);

const invalidCases = [
  ["unknown", { ...readyPayload.timings, prompt: "PRIVATE PROMPT" }],
  ["negative", { ...readyPayload.timings, serverReadMs: -1 }],
  ["nonfinite", { ...readyPayload.timings, serverReadMs: Infinity }],
  ["over-cap", { ...readyPayload.timings, serverReadMs: MAX_SESSION_SWITCH_SERVER_TIMING_MS + 1 }],
  ["string", { ...readyPayload.timings, serverReadMs: "1" }],
];
for (const [label, timings] of invalidCases) {
  assert.equal(collector.normalizeSessionSwitchServerTimings(timings), null, `${label} browser timing is rejected`);
}
assert.equal(collector.normalizeSessionSwitchServerTimings(undefined), null, "old absent timings remain validly absent");

const readyTemplate = {
  sequence: 1,
  at: 1,
  event: "qq:sessionSwitch",
  kind: "session-switch-ready",
  requestId: null,
  originId: null,
  originLatencyMs: null,
  dispatchLatencyMs: null,
  requestCompleteLatencyMs: null,
  conversationSequence: null,
  channel: null,
  sessionSwitchId: "switch-proof",
  target: null,
  action: "NAVIGATE /qq/session/:id",
};
let stageBatchSequence = 0;
const stageBatch = (stage) => ({ ...wireBatch, batchId: `batch-${++stageBatchSequence}`, stages: [stage] });
for (const [label, timings] of invalidCases) {
  const candidate = { ...readyTemplate, ...timings };
  assert.throws(() => sanitizeLatencyBatch(stageBatch(candidate)), /Invalid latency batch/,
    `${label} server timing cannot enter strict storage`);
}
assert.doesNotThrow(() => sanitizeLatencyBatch(stageBatch(readyTemplate)),
  "old ready stages without server fields remain backward compatible");
assert.throws(() => sanitizeLatencyBatch(stageBatch({ ...readyTemplate, serverReadMs: 1 })),
  /complete or absent/, "strict storage rejects partial timing sets rather than inferring missing values");
assert.throws(() => sanitizeLatencyBatch(stageBatch({ ...readyTemplate, prompt: "PRIVATE PROMPT" })),
  /is not allowed/, "private prompt content is not an accepted stage field");
assert.throws(() => sanitizeLatencyBatch(stageBatch({
  ...readyTemplate, kind: "session-switch-start", ...readyPayload.timings,
})), /only allowed on session-switch-ready/, "server phases cannot be detached from ready correlation");

// Add presentation evidence and old/incomplete rows directly as already-stored
// log records. Reporter input can include damaged historical lines, so it must
// independently reject invalid numeric samples.
const completeRecord = {
  ...sanitized,
  visuals: [{ sequence: 1, at: 1_616, sessionSwitchId: switchId, sources: ["mutation:childList"] }],
};
const oldRecord = {
  schema: "qq.ui-latency-log/v1",
  runId: "page-old",
  batchId: "old",
  stages: [
    { sequence: 1, at: 2_000, kind: "session-switch-start", sessionSwitchId: "switch-old", action: "NAVIGATE /qq/session/:id" },
    { sequence: 2, at: 2_500, kind: "session-switch-ready", sessionSwitchId: "switch-old" },
  ],
  visuals: [],
  origins: [],
};
const damagedRecord = {
  schema: "qq.ui-latency-log/v1",
  runId: "page-damaged",
  batchId: "damaged",
  stages: [
    { sequence: 1, at: 3_000, kind: "session-switch-start", sessionSwitchId: "switch-damaged", action: "NAVIGATE /qq/session/:id" },
    { sequence: 2, at: 3_500, kind: "session-switch-ready", sessionSwitchId: "switch-damaged",
      ...readyPayload.timings, serverReadMs: MAX_SESSION_SWITCH_SERVER_TIMING_MS + 1 },
  ],
  visuals: [{ sequence: 1, at: 3_516, sessionSwitchId: "switch-damaged", sources: ["mutation:childList"] }],
  origins: [],
};
const report = analyzeLatencyRecords([completeRecord, oldRecord, damagedRecord]);
const completeRow = report.sessionSwitchRows.find((row) => row.switchId === switchId);
assert.equal(completeRow.switchToSseOpenMs, null, "missing client connection evidence is not inferred");
assert.equal(completeRow.serverViewMs, 7);
assert.equal(completeRow.serverCriticalRenderMs, 21);
assert.equal(completeRow.readyToFirstPresentationMs, 16);
const oldRow = report.sessionSwitchRows.find((row) => row.switchId === "switch-old");
assert.equal(oldRow.status, "INCOMPLETE_PRESENTATION");
for (const field of SESSION_SWITCH_SERVER_TIMING_FIELDS) assert.equal(oldRow[field], null);
assert.equal(report.sessionSwitchSummary.metrics.serverView.samples, 1,
  "reporter retains rows but excludes an atomically invalid server timing set");
assert.equal(report.sessionSwitchSummary.metrics.serverRead.samples, 1,
  "reporter aggregates only the complete valid server timing sample");
assert.equal(report.sessionSwitchSummary.metrics.serverRead.p50Ms, 1);
assert.equal(report.sessionSwitchSummary.incomplete, 1);
assert.ok(frame, "ready still schedules the normal presentation opportunity");
collector.stop();

console.log("prove-server-switch-timings: pass");
