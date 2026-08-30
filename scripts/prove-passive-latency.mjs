#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsoleHandler } from "../src/http-app.mjs";
import {
  createLatencyStore,
  LATENCY_BATCH_LIMITS,
  LATENCY_VISUAL_SOURCE_LABELS,
  MAX_LATENCY_BODY_BYTES,
  MAX_LATENCY_VISUAL_SOURCES,
  sanitizeLatencyBatch,
} from "../src/latency-store.mjs";
import { analyzeLatencyRecords, reportLatency } from "./report-ui-latency.mjs";

const sessionId = "session-1a111111-1111-4111-8111-111111111111";
const backend = {
  defaultSessionId: sessionId,
  read: async () => ({
    id: sessionId,
    project: "proof",
    events: [],
    sessions: [{ id: sessionId, project: "proof" }],
    conversation: { nodes: [], pending: [] },
    children: [],
    agentStatus: "idle",
  }),
  list: async () => [{ id: sessionId, project: "proof" }],
  create: async () => ({ id: sessionId, project: "proof", events: [] }),
  prompt: async () => ({ id: sessionId, project: "proof", events: [] }),
  interrupt: async () => ({ id: sessionId, project: "proof", events: [] }),
  close: async () => ({ id: null }),
};

const defaultRunId = "page-110ec58a-a0f2-4ac4-8393-c866d813b8d1";
const secondRunId = "page-9c80ec7f-1033-4a5a-b798-763bcf95ef11";

function batch(batchId = `${defaultRunId}-1`, sequence = 1, runId = defaultRunId) {
  return {
    schema: "qq.visual-latency-batch/v1",
    runId,
    batchId,
    page: {
      timeOrigin: 1_700_000_000_000,
      startedAt: 2,
      startedAtISO: "2023-11-14T22:13:20.002Z",
      ui: { generation: "proof-generation", revision: "proof-revision" },
      viewport: {
        width: 800,
        height: 600,
        devicePixelRatio: 2,
        visual: { width: 800, height: 600, scale: 1 },
      },
      userAgent: "proof-browser",
    },
    health: {
      generated: { origins: sequence, stages: sequence, visuals: sequence },
      acknowledged: { origins: 0, stages: 0, visuals: 0 },
      ringBufferDrops: { origins: 0, stages: 0, visuals: 0 },
      uploadDrops: { origins: 0, stages: 0, visuals: 0 },
      quarantineCount: 0,
    },
    origins: [{
      sequence,
      id: `interaction-${sequence}`,
      at: 10,
      type: "pointerdown",
      action: "POST /qq/session/session-12345678-1234-4123-8123-123456789abc/prompt",
      target: "button#send",
    }],
    stages: [{
      sequence,
      at: 12,
      event: "htmx:beforeSend",
      kind: "network-dispatch",
      requestId: `request-${sequence}`,
      originId: `interaction-${sequence}`,
      originLatencyMs: 2,
      dispatchLatencyMs: 0,
      target: "form#composer",
      action: "POST /qq/session/session-12345678-1234-4123-8123-123456789abc/prompt",
    }],
    visuals: [{
      sequence,
      at: 20,
      sources: ["mutation:childList", "stream-paint"],
      mutationCount: 1,
      targets: ["div#transcript"],
      latestInteractionId: `interaction-${sequence}`,
      latestInteractionLatencyMs: 10,
      activeRequestId: `request-${sequence}`,
      activeRequestOriginId: `interaction-${sequence}`,
      activeRequestLatencyMs: 10,
      networkDispatchLatencyMs: 8,
    }],
  };
}

function maximumLegalBatch() {
  const maximumSequence = Number.MAX_SAFE_INTEGER;
  // This legal finite value has a 24-character JSON representation, longer
  // than the decimal rendering of each field's numeric upper bound.
  const maximumJsonNumber = 0.0000010000000000000002;
  const maximumId = "i".repeat(80);
  const maximumTarget = "t".repeat(180);
  const maximumAction = `POST /${"a".repeat(194)}`;
  const origin = (sequence) => ({
    sequence,
    id: maximumId,
    at: maximumJsonNumber,
    type: "pointerdown",
    action: maximumAction,
    target: maximumTarget,
  });
  const stage = (sequence) => ({
    sequence,
    at: maximumJsonNumber,
    event: "htmx:sseBeforeMessage",
    kind: "response-after-settle",
    requestId: maximumId,
    originId: maximumId,
    originLatencyMs: maximumJsonNumber,
    dispatchLatencyMs: maximumJsonNumber,
    target: maximumTarget,
    action: maximumAction,
  });
  const visual = (sequence) => ({
    sequence,
    at: maximumJsonNumber,
    sources: [...LATENCY_VISUAL_SOURCE_LABELS],
    mutationCount: 1_000_000,
    targets: Array(12).fill(maximumTarget),
    latestInteractionId: maximumId,
    latestInteractionLatencyMs: maximumJsonNumber,
    activeRequestId: maximumId,
    activeRequestOriginId: maximumId,
    activeRequestLatencyMs: maximumJsonNumber,
    networkDispatchLatencyMs: maximumJsonNumber,
  });
  return {
    schema: "qq.visual-latency-batch/v1",
    runId: "r".repeat(128),
    batchId: "b".repeat(160),
    page: {
      timeOrigin: maximumJsonNumber,
      startedAt: maximumJsonNumber,
      // Lone surrogates force JSON.stringify's longest six-byte escape form.
      startedAtISO: "\ud800".repeat(40),
      ui: { generation: "g".repeat(120), revision: "r".repeat(120) },
      viewport: {
        width: maximumJsonNumber,
        height: maximumJsonNumber,
        devicePixelRatio: maximumJsonNumber,
        visual: {
          width: maximumJsonNumber,
          height: maximumJsonNumber,
          scale: maximumJsonNumber,
        },
      },
      userAgent: "\ud800".repeat(512),
    },
    origins: Array.from({ length: LATENCY_BATCH_LIMITS.origins }, (_, index) => origin(maximumSequence - index)),
    stages: Array.from({ length: LATENCY_BATCH_LIMITS.stages }, (_, index) => stage(maximumSequence - index)),
    visuals: Array.from({ length: LATENCY_BATCH_LIMITS.visuals }, (_, index) => visual(maximumSequence - index)),
  };
}

assert.equal(LATENCY_VISUAL_SOURCE_LABELS.length, 22);
assert.equal(MAX_LATENCY_VISUAL_SOURCES, LATENCY_VISUAL_SOURCE_LABELS.length);
const maximumBatch = maximumLegalBatch();
const sanitizedMaximum = sanitizeLatencyBatch(maximumBatch);
assert.deepEqual(sanitizedMaximum.visuals[0].sources, LATENCY_VISUAL_SOURCE_LABELS,
  "sanitizeVisual accepts every recognized browser source in one visual");
assert.equal(LATENCY_BATCH_LIMITS.visuals, 128, "the server accepts the browser's larger visual candidate ceiling");
assert.ok(Buffer.byteLength(JSON.stringify(maximumBatch)) > MAX_LATENCY_BODY_BYTES,
  "the HTTP aggregate cap, rather than worst-case array multiplication, remains the final wire bound");

const validHealth = batch().health;
assert.deepEqual(sanitizeLatencyBatch(batch()).health, validHealth);
const privateRouteBatch = batch();
privateRouteBatch.origins[0].action = "NAVIGATE /qq/project/private/folder/session/local";
privateRouteBatch.stages[0].action = "POST /qq/project/private/folder/session/local/prompt";
const normalizedPrivateRoutes = sanitizeLatencyBatch(privateRouteBatch);
assert.equal(normalizedPrivateRoutes.origins[0].action, "NAVIGATE /qq/project/:project/:folder/session/:id");
assert.equal(normalizedPrivateRoutes.stages[0].action, "POST /qq/project/:project/:folder/session/:id/prompt",
  "server-side action sanitation also protects same-version collectors already loaded before route normalization");
const healthMutation = (mutate) => {
  const candidate = JSON.parse(JSON.stringify(batch()));
  mutate(candidate.health);
  return candidate;
};
for (const [label, candidate] of [
  ["unknown", healthMutation((health) => { health.note = "arbitrary text"; })],
  ["text", healthMutation((health) => { health.generated.visuals = "1"; })],
  ["negative", healthMutation((health) => { health.uploadDrops.visuals = -1; })],
  ["unsafe", healthMutation((health) => { health.quarantineCount = Number.MAX_SAFE_INTEGER + 1; })],
  ["inconsistent", healthMutation((health) => { health.acknowledged.visuals = 2; })],
  ["trailing generated cursor", healthMutation((health) => { health.generated.visuals = 0; })],
]) {
  assert.throws(() => sanitizeLatencyBatch(candidate), (error) => error?.status === 422,
    `health schema rejects ${label} fields/values`);
}
const oldBatch = batch();
delete oldBatch.health;
assert.equal(sanitizeLatencyBatch(oldBatch).health, null, "same-version old collectors remain ingestible without metadata");

const extendedBatch = batch();
extendedBatch.page.navigation = {
  type: "navigate",
  startTime: 0,
  fetchStart: 0,
  requestStart: 10,
  responseStart: 1_210,
  responseEnd: 1_260,
  domInteractive: null,
  domContentLoadedEventEnd: null,
  loadEventEnd: null,
  duration: null,
  transferSize: 4_096,
  encodedBodySize: 3_000,
  decodedBodySize: 9_000,
  serverViewDuration: 1_100,
  serverRenderDuration: 12,
};
extendedBatch.page.firstPaint = 1_450;
extendedBatch.page.firstContentfulPaint = 1_500;
extendedBatch.visuals[0].sessionSwitchId = "switch-safe";
extendedBatch.page.navigationIntent = {
  id: "intent-safe", sourceRunId: "page-source", action: "NAVIGATE /qq/session/:id",
  target: "a#next", at: 1_699_999_999_950, intentToNavigationMs: 50, intentToCollectorMs: 52,
};
extendedBatch.stages[0] = {
  ...extendedBatch.stages[0],
  event: "qq:promptAdmission",
  kind: "prompt-admitted",
  requestCompleteLatencyMs: 5_000,
  conversationSequence: 42,
  channel: null,
  sessionSwitchId: null,
};
const sanitizedExtended = sanitizeLatencyBatch(extendedBatch);
assert.equal(sanitizedExtended.page.navigation.serverViewDuration, 1_100);
assert.equal(sanitizedExtended.page.navigationIntent.action, "NAVIGATE /qq/session/:id");
assert.equal(sanitizedExtended.stages[0].conversationSequence, 42);
assert.equal(sanitizedExtended.visuals[0].sessionSwitchId, "switch-safe");
const mutateExtended = (mutate) => {
  const candidate = structuredClone(extendedBatch);
  mutate(candidate);
  return candidate;
};
for (const [label, candidate] of [
  ["unknown navigation field", mutateExtended((value) => { value.page.navigation.url = "https://private.invalid/"; })],
  ["negative navigation timing", mutateExtended((value) => { value.page.navigation.responseStart = -1; })],
  ["unsafe navigation timing", mutateExtended((value) => { value.page.navigation.responseStart = 1_000_000_000_001; })],
  ["invalid navigation type", mutateExtended((value) => { value.page.navigation.type = "restore"; })],
  ["unsafe handoff id", mutateExtended((value) => { value.page.navigationIntent.id = "intent with spaces"; })],
  ["unsafe handoff action", mutateExtended((value) => { value.page.navigationIntent.action = "NAVIGATE /safe?prompt=private"; })],
  ["unnormalized handoff route", mutateExtended((value) => { value.page.navigationIntent.action = "NAVIGATE /qq/session/private-id"; })],
  ["non-navigation handoff action", mutateExtended((value) => { value.page.navigationIntent.action = "POST /safe"; })],
  ["negative handoff latency", mutateExtended((value) => { value.page.navigationIntent.intentToCollectorMs = -1; })],
  ["invalid conversation sequence", mutateExtended((value) => { value.stages[0].conversationSequence = 0; })],
  ["unsafe conversation sequence", mutateExtended((value) => { value.stages[0].conversationSequence = Number.MAX_SAFE_INTEGER + 1; })],
  ["unknown SSE channel", mutateExtended((value) => { value.stages[0].channel = "private-channel"; })],
  ["unsafe visual switch id", mutateExtended((value) => { value.visuals[0].sessionSwitchId = "switch with spaces"; })],
  ["unknown stage field", mutateExtended((value) => { value.stages[0].prompt = "private"; })],
]) {
  assert.throws(() => sanitizeLatencyBatch(candidate), (error) => error?.status === 422,
    `strict extended schema rejects ${label}`);
}

const temporary = await mkdtemp(join(tmpdir(), "qq-ui-latency-proof-"));
const logPath = join(temporary, "state", "qq", "ui-latency.ndjson");
const handler = createConsoleHandler(backend, {
  basePath: "/proof",
  latencyLogPath: logPath,
  latencyLogMaxBytes: 32 * 1024,
});
const server = createServer(handler);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const endpoint = `${base}/proof/ui-latency`;
try {
  const page = await fetch(`${base}/proof/session/${sessionId}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("server-timing") ?? "", /^qq-view;dur=\d+\.\d{3}, qq-render;dur=\d+\.\d{3}$/,
    "initial session HTML exposes only fixed numeric view/render Server-Timing phases");
  assert.match(await page.text(), /data-latency-endpoint="\/proof\/ui-latency"/,
    "the configured base path is explicitly passed to the browser bundle");

  assert.equal((await fetch(endpoint)).status, 405, "ingestion only permits POST");
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
    body: JSON.stringify(batch()),
  })).status, 403, "a foreign Origin is rejected");
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: base },
    body: JSON.stringify(batch()),
  })).status, 415, "only application/json is accepted");
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "gzip", origin: base },
    body: "not actually compressed",
  })).status, 415, "content encoding cannot bypass the wire-size bound");
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: "{broken",
  })).status, 400, "malformed JSON is rejected");
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: Buffer.alloc(MAX_LATENCY_BODY_BYTES + 1, 0x20),
  })).status, 413, "the raw request body has a strict cap");

  const unknown = { ...batch(), prompt: "SERVER STORAGE SECRET" };
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(unknown),
  })).status, 422, "unknown prompt-bearing fields fail schema validation");
  const unsafeIdentity = batch();
  unsafeIdentity.runId = "page identity with spaces";
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(unsafeIdentity),
  })).status, 422, "opaque protocol identities retain strict safe-character validation");
  const disguisedPrompt = batch();
  disguisedPrompt.origins[0].action = "SERVER STORAGE SECRET";
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(disguisedPrompt),
  })).status, 422, "arbitrary prose cannot be smuggled through an action label");
  const tooMany = batch();
  tooMany.visuals = Array.from({ length: LATENCY_BATCH_LIMITS.visuals + 1 }, (_, index) => ({
    ...tooMany.visuals[0],
    sequence: index + 1,
  }));
  assert.equal((await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify(tooMany),
  })).status, 422, "entry arrays are bounded independently of the wire cap");

  const body = JSON.stringify(batch());
  const accepted = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base, cookie: "qq-proof-cookie=COOKIE STORAGE SECRET" },
    body,
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), {
    schema: "qq.visual-latency-ack/v1",
    accepted: true,
    duplicate: false,
    runId: defaultRunId,
    batchId: `${defaultRunId}-1`,
    cursors: { origins: 1, stages: 1, visuals: 1 },
  }, "UUID-backed protocol identities round-trip unchanged in acknowledgements");
  assert.equal((await stat(join(temporary, "state", "qq"))).mode & 0o777, 0o700,
    "the qq state directory is user-only");
  assert.equal((await stat(logPath)).mode & 0o777, 0o600, "the rolling log is user-only");
  let persisted = await readFile(logPath, "utf8");
  assert.doesNotMatch(persisted, /SERVER STORAGE SECRET/);
  assert.doesNotMatch(persisted, /COOKIE STORAGE SECRET/, "request cookies are never copied into the log");
  assert.doesNotMatch(persisted, /12345678-1234-4123-8123-123456789abc/,
    "UUID/session route identifiers are redacted before append");
  assert.match(persisted, /POST \/qq\/session\/:id\/prompt/);
  const firstPersisted = JSON.parse(persisted.trim());
  assert.equal(firstPersisted.runId, defaultRunId,
    "opaque run identities are persisted without privacy-label rewriting");
  assert.equal(firstPersisted.batchId, `${defaultRunId}-1`,
    "opaque batch identities are persisted without privacy-label rewriting");
  assert.deepEqual(firstPersisted.health.acknowledged, { origins: 1, stages: 1, visuals: 1 },
    "persisted health includes this batch's final accepted cursors rather than lagging one batch");
  assert.equal(persisted.trim().split("\n").length, 1);

  const secondBody = JSON.stringify(batch(`${secondRunId}-1`, 1, secondRunId));
  const secondPage = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: secondBody,
  });
  assert.equal(secondPage.status, 200);
  assert.deepEqual(await secondPage.json(), {
    schema: "qq.visual-latency-ack/v1",
    accepted: true,
    duplicate: false,
    runId: secondRunId,
    batchId: `${secondRunId}-1`,
    cursors: { origins: 1, stages: 1, visuals: 1 },
  }, "UUID-backed identities from separate pages do not collapse into one deduplication key");
  persisted = await readFile(logPath, "utf8");
  assert.equal(persisted.trim().split("\n").length, 2);

  const retried = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body,
  });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).duplicate, true, "same run and batch identity is acknowledged as a retry");
  persisted = await readFile(logPath, "utf8");
  assert.equal(persisted.trim().split("\n").length, 2, "an in-process retry is not appended twice");
} finally {
  handler.dispose();
  await new Promise((resolve) => server.close(resolve));
}

const sanitized = sanitizeLatencyBatch(batch());
const restarted = createLatencyStore({ path: logPath, maxBytes: 32 * 1024 });
assert.equal((await restarted.append(sanitized)).duplicate, true,
  "dedup identities are recovered from retained files after a server reload");
assert.equal((await readFile(logPath, "utf8")).trim().split("\n").length, 2);

const rotatingPath = join(temporary, "rotation", "ui-latency.ndjson");
const rotating = createLatencyStore({ path: rotatingPath, maxBytes: 4096 });
for (let index = 1; index <= 8; index += 1) {
  await rotating.append(sanitizeLatencyBatch(batch(`page-rotation-${index}`, index)));
}
const currentSize = (await stat(rotatingPath)).size;
const backupSize = (await stat(`${rotatingPath}.1`)).size;
assert.ok(currentSize <= 2048 && backupSize <= 2048);
assert.ok(currentSize + backupSize <= 4096, "the two rolling files stay within the configured total cap");
assert.equal((await stat(rotatingPath)).mode & 0o777, 0o600);
assert.equal((await stat(`${rotatingPath}.1`)).mode & 0o777, 0o600, "rotation preserves user-only archive permissions");

const disabledHandler = createConsoleHandler(backend, {
  basePath: "/disabled",
  latencyPersistence: false,
  latencyLogPath: join(temporary, "must-not-exist.ndjson"),
});
const disabledServer = createServer(disabledHandler);
await new Promise((resolve, reject) => {
  disabledServer.once("error", reject);
  disabledServer.listen(0, "127.0.0.1", resolve);
});
try {
  const disabledBase = `http://127.0.0.1:${disabledServer.address().port}`;
  assert.equal((await fetch(`${disabledBase}/disabled/ui-latency`, { method: "POST" })).status, 404);
  const disabledPage = await fetch(`${disabledBase}/disabled/session/${sessionId}`);
  assert.doesNotMatch(await disabledPage.text(), /data-latency-endpoint=/,
    "disabling persistence leaves measurement loaded but omits passive upload configuration");
} finally {
  disabledHandler.dispose();
  await new Promise((resolve) => disabledServer.close(resolve));
}

const reporterPath = join(temporary, "reporter", "latency.ndjson");
await mkdir(join(temporary, "reporter"), { recursive: true });
const reportStage = {
  schema: "qq.ui-latency-log/v1",
  runId: "page-report",
  batchId: "report-stage",
  origins: [],
  stages: [
    { sequence: 1, at: 4, kind: "network-dispatch", requestId: "request-1", action: "POST /qq/session/:id/prompt", originLatencyMs: 4 },
    { sequence: 2, at: 12, kind: "response-before-swap", requestId: "request-1", action: "POST /qq/session/:id/prompt", dispatchLatencyMs: 8 },
    { sequence: 3, at: 14, kind: "response-after-swap", requestId: "request-1", action: "POST /qq/session/:id/prompt", dispatchLatencyMs: 10 },
    { sequence: 4, at: 16, kind: "response-after-settle", requestId: "request-1", action: "POST /qq/session/:id/prompt", dispatchLatencyMs: 12 },
    { sequence: 5, at: 100, kind: "sse-message-before", requestId: null, target: "div#transcript", action: "" },
    { sequence: 6, at: 104, kind: "response-after-swap", requestId: null, target: "div#transcript", action: "" },
    { sequence: 7, at: 106, kind: "sse-message-after", requestId: null, target: "div#transcript", action: "" },
  ],
  visuals: [],
};
const reportVisuals = (batchId, visualEntries, health = undefined) => ({
  schema: "qq.ui-latency-log/v1",
  runId: "page-report",
  batchId,
  ...(health ? { health } : {}),
  origins: [],
  stages: [],
  visuals: visualEntries.map(([sequence, interactionLatency, dispatchLatency]) => ({
    sequence,
    at: interactionLatency,
    activeRequestId: "request-1",
    activeRequestLatencyMs: interactionLatency,
    networkDispatchLatencyMs: dispatchLatency,
    sources: ["stream-paint"],
  })),
});
const reportHealth = {
  generated: { origins: 0, stages: 7, visuals: 8 },
  acknowledged: { origins: 0, stages: 7, visuals: 6 },
  ringBufferDrops: { origins: 0, stages: 0, visuals: 2 },
  uploadDrops: { origins: 0, stages: 0, visuals: 3 },
  quarantineCount: 1,
};
await writeFile(`${reporterPath}.1`, `${JSON.stringify(reportStage)}
${JSON.stringify(reportVisuals("report-a", [[1, 10, 6], [2, 20, 16], [3, 30, 26]]))}
`, "utf8");
await writeFile(reporterPath, `${JSON.stringify(reportVisuals("report-b", [[3, 999, 995], [5, 40, 36], [6, 50, 46]], reportHealth))}
{malformed
`, "utf8");
const report = await reportLatency(reporterPath);
assert.equal(report.malformedLines, 1);
assert.equal(report.runs, 1);
assert.equal(report.entries.stages, 7);
assert.equal(report.entries.visuals, 5);
assert.equal(report.duplicates, 1, "reporter deduplicates retry overlap by run, kind, and sequence");
assert.equal(report.latencySamples, 1, "progressive visuals contribute only the first correlated presentation per request");
assert.deepEqual(report.sampleCounts, {
  firstPresentations: 1,
  interactionToDispatch: 1,
  dispatchToInitialResponse: 1,
  dispatchToSwap: 1,
  dispatchToSettle: 1,
  interactionToFirstPresentation: 1,
  dispatchToFirstPresentation: 1,
  sseHandlers: 1,
  sseSwaps: 1,
});
const [requestRow] = report.requestRows;
assert.equal(requestRow.requests, 1);
assert.equal(requestRow.interactionToDispatchP50Ms, 4);
assert.equal(requestRow.dispatchToInitialResponseP50Ms, 8);
assert.equal(requestRow.dispatchToSwapP50Ms, 10);
assert.equal(requestRow.dispatchToSettleP50Ms, 12);
assert.equal(requestRow.interactionToFirstPresentationP50Ms, 10);
assert.equal(requestRow.dispatchToFirstPresentationP50Ms, 6);
assert.equal("streamAgeMs" in requestRow, false, "default request rows do not conflate progressive stream age with latency");
assert.deepEqual(report.sequenceGaps, { origins: 0, stages: 0, visuals: 1 },
  "sequence gaps count holes between retained entries, independently of an evicted/trailing prefix");
assert.deepEqual(report.retention.visuals, { retained: 5, generated: 8, percent: 62.5 });
assert.deepEqual(report.runHealth[0].health, reportHealth, "reporter exposes the latest cumulative health per run");
assert.equal(report.runHealth[0].retentionPercent.visuals, 62.5);
assert.deepEqual(report.sseRows, [{
  target: "div#transcript",
  action: "(no request action)",
  messages: 1,
  handlerSamples: 1,
  handlerP50Ms: 6,
  handlerP95Ms: 6,
  swapSamples: 1,
  swapP50Ms: 4,
  swapP95Ms: 4,
}], "SSE handler/swap timing is event-local and separate from request latency");

const sseReport = (runId, stages) => analyzeLatencyRecords([{
  schema: "qq.ui-latency-log/v1",
  runId,
  batchId: `${runId}-batch`,
  origins: [],
  stages,
  visuals: [],
}]);
const sseStage = (sequence, at, kind, target, action = "", requestId = null) => ({
  sequence,
  at,
  kind,
  target,
  action,
  requestId,
});

const staleSse = sseReport("page-stale-sse", [
  sseStage(1, 0, "sse-message-before", "div#stale"),
  sseStage(2, 30_000, "response-after-swap", "form#unrelated", "POST /qq/prompt", "request-later"),
  sseStage(3, 30_001, "sse-message-after", "div#unrelated"),
]);
assert.deepEqual(staleSse.sseRows, [],
  "an unmatched SSE before expires before a much later unrelated swap/message can consume it");
assert.equal(staleSse.sampleCounts.sseHandlers, 0);
assert.equal(staleSse.sampleCounts.sseSwaps, 0);

const replacedSse = sseReport("page-replaced-sse", [
  sseStage(1, 0, "sse-message-before", "div#old", "GET /qq/old"),
  sseStage(2, 100, "sse-message-before", "div#new", "GET /qq/new"),
  sseStage(3, 104, "response-after-swap", "div#new", "GET /qq/new"),
  sseStage(4, 106, "sse-message-after", "div#new", "GET /qq/new"),
]);
assert.deepEqual(replacedSse.sseRows, [{
  target: "div#new",
  action: "GET /qq/new",
  messages: 1,
  handlerSamples: 1,
  handlerP50Ms: 6,
  handlerP95Ms: 6,
  swapSamples: 1,
  swapP50Ms: 4,
  swapP95Ms: 4,
}], "a newer SSE before replaces an older pending record and pairs within the bounded window");

const sourceRegionSse = sseReport("page-source-region-sse", [
  sseStage(100, 1_000, "sse-message-before", "form#composer.composer", "POST /qq/session/:id/prompt", "request-prompt"),
  sseStage(101, 1_005, "response-after-swap", "div#transcript-settled.htmx-settling"),
  sseStage(102, 1_006, "sse-message-after", "form#composer.composer", "POST /qq/session/:id/prompt", "request-prompt"),
]);
assert.deepEqual(sourceRegionSse.sseRows, [{
  target: "form#composer.composer",
  action: "POST /qq/session/:id/prompt",
  messages: 1,
  handlerSamples: 1,
  handlerP50Ms: 6,
  handlerP95Ms: 6,
  swapSamples: 1,
  swapP50Ms: 5,
  swapP95Ms: 5,
}], "an SSE source and its swapped response region may have different target labels");
assert.equal(sourceRegionSse.sampleCounts.sseHandlers, 1);
assert.equal(sourceRegionSse.sampleCounts.sseSwaps, 1,
  "the reporter retains request-free swaps from the recorded source/region event shape");

const groupedSse = sseReport("page-grouped-sse", [
  sseStage(1, 200, "sse-message-before", "div#transcript", "GET /qq/transcript"),
  sseStage(2, 202, "response-after-swap", "form#prompt", "POST /qq/prompt", "request-prompt"),
  sseStage(3, 204, "response-after-swap", "div#transcript.htmx-settling", "GET /qq/transcript"),
  sseStage(4, 206, "sse-message-after", "div#transcript.htmx-settling", "GET /qq/transcript"),
  sseStage(5, 300, "sse-message-before", "div#queue", "GET /qq/queue"),
  sseStage(6, 303, "response-after-swap", "div#queue", "GET /qq/queue"),
  sseStage(7, 305, "sse-message-after", "div#queue", "GET /qq/queue"),
]);
assert.deepEqual(groupedSse.sseRows, [{
  target: "div#queue",
  action: "GET /qq/queue",
  messages: 1,
  handlerSamples: 1,
  handlerP50Ms: 5,
  handlerP95Ms: 5,
  swapSamples: 1,
  swapP50Ms: 3,
  swapP95Ms: 3,
}, {
  target: "div#transcript",
  action: "GET /qq/transcript",
  messages: 1,
  handlerSamples: 1,
  handlerP50Ms: 6,
  handlerP95Ms: 6,
  swapSamples: 1,
  swapP50Ms: 4,
  swapP95Ms: 4,
}], "complete SSE pairs keep target/action grouping, tolerate HTMX's transient class, and reject an interleaved prompt swap");

const gappedOldSse = sseReport("page-gapped-old-sse", [
  sseStage(20, 400, "sse-message-before", "div#transcript"),
  sseStage(22, 404, "response-after-swap", "div#transcript"),
  sseStage(23, 406, "sse-message-after", "div#transcript"),
]);
assert.equal(gappedOldSse.runHealth[0].health, null, "the gapped fixture retains old-log compatibility");
assert.equal(gappedOldSse.sequenceGaps.stages, 1);
assert.deepEqual(gappedOldSse.sseRows, [],
  "a stage sequence gap invalidates pending SSE correlation instead of fabricating timing");
assert.equal(gappedOldSse.sampleCounts.sseHandlers, 0);
assert.equal(gappedOldSse.sampleCounts.sseSwaps, 0);


const startupRecords = [{
  schema: "qq.ui-latency-log/v1",
  runId: "page-historical-32s",
  batchId: "historical-32",
  page: { startedAt: 32_479.4 },
  origins: [],
  stages: [{ sequence: 1, at: 32_854.4, kind: "sse-open", requestId: null }],
  visuals: [{ sequence: 1, at: 32_498.4 }],
}, {
  schema: "qq.ui-latency-log/v1",
  runId: "page-historical-22s",
  batchId: "historical-22",
  page: { startedAt: 22_744.7 },
  origins: [],
  stages: [{ sequence: 1, at: 23_753.1, kind: "sse-open", requestId: null }],
  visuals: [{ sequence: 1, at: 22_767.3 }],
}, {
  schema: "qq.ui-latency-log/v1",
  runId: "page-phased-14s",
  batchId: "phased-early",
  page: {
    startedAt: 14_000,
    firstPaint: 13_000,
    firstContentfulPaint: 13_050,
    navigation: {
      type: "navigate", startTime: 0, fetchStart: 0, requestStart: 100,
      responseStart: 12_000, responseEnd: 12_200, domInteractive: 0,
      domContentLoadedEventEnd: 0, domComplete: 0, loadEventEnd: 0,
      serverViewDuration: 11_500, serverRenderDuration: 20,
      transferSize: 6_000,
    },
    navigationIntent: {
      id: "intent-phased", sourceRunId: "page-source", action: "NAVIGATE /qq/session/:id",
      target: "a#next", at: 1_000, intentToNavigationMs: 50, intentToCollectorMs: 14_050,
    },
  },
  origins: [],
  stages: [
    { sequence: 1, at: 14_500, kind: "sse-open", requestId: null },
    { sequence: 2, at: 15_000, kind: "sse-message-before", requestId: null, channel: "switch-meta" },
    { sequence: 3, at: 15_100, kind: "sse-message-before", requestId: null, channel: "transcript-reset" },
    { sequence: 4, at: 15_200, kind: "sse-message-before", requestId: null, channel: "live" },
    { sequence: 5, at: 16_000, kind: "sse-message-before", requestId: null, channel: "switch-ready" },
  ],
  visuals: [{ sequence: 1, at: 14_020 }],
}, {
  schema: "qq.ui-latency-log/v1",
  runId: "page-phased-14s",
  batchId: "phased-late",
  page: {
    startedAt: 14_000,
    firstPaint: 13_000,
    firstContentfulPaint: 13_050,
    navigation: {
      type: "navigate", startTime: 0, fetchStart: 0, requestStart: 100,
      responseStart: 12_000, responseEnd: 12_200, domInteractive: 13_100,
      domContentLoadedEventEnd: 13_200, domComplete: 13_500, loadEventEnd: 13_600,
      serverViewDuration: 11_500, serverRenderDuration: 20,
      transferSize: 6_000,
    },
    navigationIntent: {
      id: "intent-phased", sourceRunId: "page-source", action: "NAVIGATE /qq/session/:id",
      target: "a#next", at: 1_000, intentToNavigationMs: 50, intentToCollectorMs: 14_050,
    },
  },
  origins: [], stages: [], visuals: [],
}];
const startupReport = analyzeLatencyRecords(startupRecords);
assert.deepEqual(startupReport.startupRows.map((row) => row.navigationToCollectorMs), [32_479.4, 22_744.7, 14_000],
  "default startup rows visibly sort multi-second historical and new starts slowest first");
const historical22 = startupReport.startupRows.find((row) => row.runId === "page-historical-22s");
assert.equal(historical22.navigationType, "(old/no navigation timing)");
assert.equal(historical22.navigationToFirstVisualMs, 22_767.3,
  "historical page.startedAt and first visual remain first-class without page.navigation");
assert.equal(historical22.collectorToFirstVisualMs, 22.6);
assert.equal(historical22.collectorToSseOpenMs, 1_008.4);
const phased = startupReport.startupRows.find((row) => row.runId === "page-phased-14s");
assert.equal(phased.start, "SLOW");
assert.equal(phased.fetchToRequestMs, 100);
assert.equal(phased.requestToResponseStartMs, 11_900);
assert.equal(phased.responseDownloadMs, 200);
assert.equal(phased.responseEndToCollectorMs, 1_800);
assert.equal(phased.collectorToFirstVisualMs, 20);
assert.equal(phased.collectorToSseOpenMs, 500);
assert.equal(phased.navigationToSwitchReadyMs, 16_000);
assert.equal(phased.intentToNavigationMs, 50);
assert.equal(phased.intentToFirstVisualMs, 14_070);
assert.equal(phased.intentToSwitchReadyMs, 16_050);
assert.equal(phased.action, "NAVIGATE /qq/session/:id");
assert.equal(startupReport.startupByAction.find((group) => group.action === "NAVIGATE /qq/session/:id").runs, 1,
  "cross-document session starts are grouped by their normalized action");
assert.equal(phased.loadEventEndMs, 13_600,
  "later duplicate page metadata fills completed load milestones while initial zero remains incomplete");
assert.equal(startupReport.startupSummary.navigationToCollector.samples, 3);
assert.equal(startupReport.startupSummary.navigationToCollector.maxMs, 32_479.4);

const admissionReport = analyzeLatencyRecords([{
  schema: "qq.ui-latency-log/v1",
  runId: "page-admission-report",
  batchId: "admission-report",
  origins: [],
  stages: [
    { sequence: 1, at: 12, kind: "network-dispatch", requestId: "request-1", originLatencyMs: 2,
      dispatchLatencyMs: 0, action: "POST /qq/session/:id/prompt" },
    { sequence: 2, at: 1_000, kind: "prompt-admission-pending", requestId: "request-1",
      action: "POST /qq/session/:id/prompt" },
    { sequence: 3, at: 8_000, kind: "prompt-admitted", requestId: "request-1", originLatencyMs: 7_990,
      dispatchLatencyMs: 7_988, requestCompleteLatencyMs: 7_000, conversationSequence: 41,
      action: "POST /qq/session/:id/prompt" },
    { sequence: 4, at: 1_100, kind: "prompt-admission-pending", requestId: "request-2",
      action: "POST /qq/session/:id/prompt" },
    { sequence: 5, at: 900, kind: "prompt-admission-failed", requestId: "request-3",
      action: "POST /qq/session/:id/prompt" },
    { sequence: 6, at: 9_000, kind: "prompt-admission-unmatched", requestId: null, conversationSequence: 42,
      action: "" },
    { sequence: 7, at: 500, kind: "response-before-swap", requestId: "request-1",
      action: "POST /qq/session/:id/prompt" },
    { sequence: 8, at: 1_000, kind: "request-complete", requestId: "request-1",
      action: "POST /qq/session/:id/prompt" },
  ],
  visuals: [
    { sequence: 1, at: 18, activeRequestId: "request-1", activeRequestLatencyMs: 8,
      networkDispatchLatencyMs: 6, sources: ["input"] },
    { sequence: 2, at: 8_016, activeRequestId: "request-1", activeRequestLatencyMs: 8_006,
      networkDispatchLatencyMs: 8_004, sources: ["mutation:childList"] },
  ],
}]);
assert.deepEqual(admissionReport.admissionCounts, {
  admitted: 1, unmatched: 1, failed: 1, presentations: 1, unmatchedNodes: 1,
});
assert.equal(admissionReport.feedbackRows[0].interactionToFirstPresentationP50Ms, 8,
  "composer/pending feedback remains the immediate 3-8ms-style request presentation metric");
assert.equal(admissionReport.admissionRows[0].interactionToAdmissionP50Ms, 7_990);
assert.equal(admissionReport.admissionRows[0].responseToAdmissionP50Ms, 7_500);
assert.equal(admissionReport.admissionRows[0].completeToAdmissionP50Ms, 7_000);
assert.equal(admissionReport.admissionRows[0].responseToAdmissionPresentationP50Ms, 7_516);
assert.equal(admissionReport.admissionRows[0].completeToAdmissionPresentationP50Ms, 7_016);
assert.equal(admissionReport.admissionRows[0].interactionToAdmissionPresentationP50Ms, 8_006,
  "exact admission presentation is selected only after prompt-admitted, not the earlier composer feedback");
assert.equal(admissionReport.admissionRows[0].admissionToPresentationP50Ms, 16);
const admissionOnlyFeedback = analyzeLatencyRecords([{
  schema: "qq.ui-latency-log/v1", runId: "page-admission-only", batchId: "admission-only", origins: [],
  stages: [
    { sequence: 1, at: 1_000, kind: "prompt-admission-pending", requestId: "request-only", action: "POST /qq/prompt" },
    { sequence: 2, at: 8_000, kind: "prompt-admitted", requestId: "request-only", originLatencyMs: 8_000,
      dispatchLatencyMs: 7_990, requestCompleteLatencyMs: 7_000, action: "POST /qq/prompt" },
  ],
  visuals: [{ sequence: 1, at: 8_016, activeRequestId: "request-only", activeRequestLatencyMs: 8_016,
    networkDispatchLatencyMs: 8_006 }],
}]);
assert.equal(admissionOnlyFeedback.composerFeedbackSamples, 0,
  "an admission presentation never backfills a missing immediate composer-feedback sample");
assert.equal(admissionOnlyFeedback.admissionCounts.presentations, 1);

const switchReport = analyzeLatencyRecords([{
  schema: "qq.ui-latency-log/v1",
  runId: "page-switch-report",
  batchId: "switch-report",
  origins: [],
  visuals: [{
    sequence: 1, at: 9_016, sessionSwitchId: "switch-1", sources: ["mutation:attributes"],
  }],
  stages: [
    { sequence: 1, at: 1_000, kind: "session-switch-start", sessionSwitchId: "switch-1",
      originLatencyMs: 5, action: "NAVIGATE /qq/session/:id" },
    { sequence: 13, at: 1_500, kind: "session-switch-response", sessionSwitchId: "switch-1" },
    { sequence: 2, at: 2_000, kind: "sse-open", sessionSwitchId: "switch-1" },
    { sequence: 3, at: 3_000, kind: "sse-message-before", channel: "switch-meta", sessionSwitchId: "switch-1" },
    { sequence: 4, at: 5_000, kind: "sse-message-before", channel: "transcript-reset", sessionSwitchId: "switch-1" },
    { sequence: 5, at: 6_000, kind: "sse-message-before", channel: "live", sessionSwitchId: "switch-1" },
    { sequence: 6, at: 9_000, kind: "sse-message-before", channel: "switch-ready", sessionSwitchId: "switch-1" },
    { sequence: 14, at: 9_001, kind: "session-switch-ready", sessionSwitchId: "switch-1" },
    { sequence: 7, at: 10_000, kind: "session-switch-start", sessionSwitchId: "switch-2",
      action: "NAVIGATE /qq/session/:id" },
    { sequence: 8, at: 11_000, kind: "sse-open", sessionSwitchId: "switch-2" },
    { sequence: 9, at: 12_000, kind: "sse-message-before", channel: "switch-meta", sessionSwitchId: "switch-2" },
    { sequence: 10, at: 13_000, kind: "sse-message-before", channel: "switch-meta", sessionSwitchId: "switch-3",
      action: "NAVIGATE /qq/session/:id" },
    { sequence: 11, at: 14_000, kind: "session-switch-start", sessionSwitchId: "switch-4",
      action: "NAVIGATE /qq/session/:id" },
    { sequence: 12, at: 15_000, kind: "session-switch-ready", sessionSwitchId: "switch-4" },
  ],
}]);
assert.equal(switchReport.sessionSwitchSummary.complete, 1);
assert.equal(switchReport.sessionSwitchSummary.incomplete, 3);
assert.equal(switchReport.sessionSwitchSummary.readyWithoutPresentation, 1);
assert.equal(switchReport.sessionSwitchSummary.unmatchedStarts, 1);
const completeSwitch = switchReport.sessionSwitchRows.find((row) => row.switchId === "switch-1");
assert.equal(completeSwitch.status, "SLOW");
assert.equal(completeSwitch.switchToResponseMs, 500);
assert.equal(completeSwitch.switchToSseOpenMs, 1_000);
assert.equal(completeSwitch.switchToMetaMs, 2_000);
assert.equal(completeSwitch.switchToInitialTranscriptMs, 4_000);
assert.equal(completeSwitch.switchToInitialLiveMs, 5_000);
assert.equal(completeSwitch.switchToReadyMs, 8_000);
assert.equal(completeSwitch.switchToFirstPresentationMs, 8_016);
assert.equal(completeSwitch.readyToFirstPresentationMs, 16);
assert.equal(completeSwitch.interactionToReadyMs, 8_005);
assert.equal(completeSwitch.interactionToFirstPresentationMs, 8_021);
assert.equal(switchReport.sessionSwitchRows.find((row) => row.switchId === "switch-2").status, "INCOMPLETE_READY",
  "incomplete session loads remain visible rather than disappearing from totals");
assert.equal(switchReport.sessionSwitchRows.find((row) => row.switchId === "switch-3").status, "UNMATCHED_START",
  "retained switch milestones without their evicted start remain explicit");
assert.equal(switchReport.sessionSwitchRows.find((row) => row.switchId === "switch-4").status,
  "INCOMPLETE_PRESENTATION", "ready without a presentation remains incomplete");

const startupCliPath = join(temporary, "reporter", "startup.ndjson");
await writeFile(startupCliPath, `${startupRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
const startupCli = execFileSync(process.execPath, [
  new URL("./report-ui-latency.mjs", import.meta.url).pathname,
  startupCliPath,
], { encoding: "utf8" });
assert.match(startupCli, /Startup\/session-open timing/);
assert.match(startupCli, /page-historical-32s/);
assert.match(startupCli, /32479\.4/);
assert.match(startupCli, /page-historical-22s/);
assert.match(startupCli, /22744\.7/);
assert.match(startupCli, /SLOW/,
  "default non-JSON CLI surfaces historical multi-second collector starts without requiring new data");

const oldOnly = analyzeLatencyRecords([{
  schema: "qq.ui-latency-log/v1", runId: "page-old", batchId: "old", origins: [], stages: [], visuals: [],
}]);
assert.equal(oldOnly.runHealth[0].health, null, "old log lines without health remain readable");
assert.deepEqual(analyzeLatencyRecords([]).rows, []);
const cli = JSON.parse(execFileSync(process.execPath, [
  new URL("./report-ui-latency.mjs", import.meta.url).pathname,
  reporterPath,
  "--json",
], { encoding: "utf8" }));
assert.equal(cli.rows[0].dispatchToFirstPresentationP50Ms, 6,
  "the dependency-free report command reads both rolling files with corrected semantics");

console.log("passive latency ingestion, retention, and reporter proof passed");
