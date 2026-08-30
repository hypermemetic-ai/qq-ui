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
const maximumBodyBytes = Buffer.byteLength(JSON.stringify(maximumBatch));
assert.ok(maximumBodyBytes < MAX_LATENCY_BODY_BYTES, "the maximum legal serialized batch fits the HTTP endpoint");
assert.ok(maximumBodyBytes <= Math.floor(MAX_LATENCY_BODY_BYTES * 0.85),
  `the maximum legal batch retains at least 15% headroom (${maximumBodyBytes}/${MAX_LATENCY_BODY_BYTES} bytes)`);

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
  stages: [{ sequence: 1, requestId: "request-1", action: "POST /qq/session/:id/prompt" }],
  visuals: [],
};
const reportVisuals = (batchId, entries) => ({
  schema: "qq.ui-latency-log/v1",
  runId: "page-report",
  batchId,
  origins: [],
  stages: [],
  visuals: entries.map(([sequence, latency]) => ({
    sequence,
    activeRequestId: "request-1",
    activeRequestLatencyMs: latency,
    sources: ["stream-paint"],
  })),
});
await writeFile(`${reporterPath}.1`, `${JSON.stringify(reportStage)}\n${JSON.stringify(reportVisuals("report-a", [[1, 10], [2, 20], [3, 30]]))}\n`, "utf8");
await writeFile(reporterPath, `${JSON.stringify(reportVisuals("report-b", [[3, 999], [4, 40], [5, 50]]))}\n{malformed\n`, "utf8");
const report = await reportLatency(reporterPath);
assert.equal(report.malformedLines, 1);
assert.equal(report.runs, 1);
assert.equal(report.entries.stages, 1);
assert.equal(report.entries.visuals, 5);
assert.equal(report.duplicates, 1, "reporter deduplicates retry overlap by run, kind, and sequence");
assert.deepEqual(report.rows, [{
  action: "POST /qq/session/:id/prompt",
  source: "stream-paint",
  count: 5,
  firstLatencyMs: 10,
  p50LatencyMs: 30,
  p95LatencyMs: 48,
  lastLatencyMs: 50,
}], "reporter preserves first/last order and uses interpolated percentiles");
assert.deepEqual(analyzeLatencyRecords([]).rows, []);
const cli = JSON.parse(execFileSync(process.execPath, [
  new URL("./report-ui-latency.mjs", import.meta.url).pathname,
  reporterPath,
  "--json",
], { encoding: "utf8" }));
assert.equal(cli.rows[0].p95LatencyMs, 48, "the dependency-free report command reads both rolling files");

console.log("passive latency ingestion, retention, and reporter proof passed");
