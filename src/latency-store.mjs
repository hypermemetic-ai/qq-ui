import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";

export const LATENCY_BATCH_SCHEMA = "qq.visual-latency-batch/v1";
export const LATENCY_LOG_SCHEMA = "qq.ui-latency-log/v1";
export const MAX_LATENCY_BODY_BYTES = 256 * 1024;
// Ten minutes admits the observed 159-second pre-open outlier while rejecting
// implausible/unbounded payload numbers at both browser and persistence edges.
export const MAX_SESSION_SWITCH_SERVER_TIMING_MS = 600_000;
export const SESSION_SWITCH_SERVER_TIMING_FIELDS = Object.freeze([
  "serverViewMs", "serverReadMs", "serverSessionsMs", "serverSheetsMs",
  "serverRenderLoadMs", "serverSurfaceMs", "serverLiveStateMs", "serverFingerprintsMs",
  "serverChromeRenderMs", "serverTranscriptRenderMs", "serverLiveRenderMs", "serverQueueRenderMs",
  "serverPopupsRenderMs", "serverComposerRenderMs", "serverCriticalRenderMs",
]);
export const DEFAULT_LATENCY_LOG_MAX_BYTES = 16 * 1024 * 1024;
// Per-array protocol candidate limits. The aggregate HTTP body cap remains the
// final bound; the browser byte-packs prefixes of these candidates below its
// lower wire budget rather than assuming every worst-case combination fits.
export const LATENCY_BATCH_LIMITS = Object.freeze({ origins: 128, stages: 128, visuals: 128 });
export const LATENCY_VISUAL_SOURCE_LABELS = Object.freeze([
  "stream-paint", "beforeinput", "input", "change", "toggle", "focusin", "focusout", "scroll",
  "selectionchange", "invalid", "mutation:childList", "mutation:characterData", "mutation:attributes",
  "mutation:other", "window:resize", "window:scroll", "window:orientationchange", "window:pageshow",
  "window:popstate", "window:hashchange", "visualViewport:resize", "visualViewport:scroll",
]);
export const MAX_LATENCY_VISUAL_SOURCES = LATENCY_VISUAL_SOURCE_LABELS.length;

const UUID_TEXT = /(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const SAFE_ID = /^[a-zA-Z0-9_.:@/-]+$/;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

export function defaultLatencyLogPath(env = process.env, home = homedir()) {
  const state = typeof env.XDG_STATE_HOME === "string" && env.XDG_STATE_HOME.startsWith("/")
    ? env.XDG_STATE_HOME
    : resolve(home, ".local/state");
  return resolve(state, "qq/ui-latency.ndjson");
}

function plainObject(value, label, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw schemaError(`${label} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw schemaError(`${label}.${key} is not allowed`);
  }
  return value;
}

function schemaError(message) {
  const error = new Error(`Invalid latency batch: ${message}`);
  error.status = 422;
  return error;
}

function text(value, label, maximum, { nullable = false, id = false, empty = true } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length > maximum || (!empty && value.length === 0)
    || /[\u0000-\u001f\u007f]/.test(value) || (id && !SAFE_ID.test(value))) {
    throw schemaError(`${label} must be a bounded safe string`);
  }
  return value.replace(UUID_TEXT, ":id");
}

// Protocol identities must round-trip exactly so browser acknowledgements and
// server deduplication use the same key. Unlike persisted labels, these random,
// opaque values are not privacy-redacted after validation.
function opaqueId(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum
    || /[\u0000-\u001f\u007f]/.test(value) || !SAFE_ID.test(value)) {
    throw schemaError(`${label} must be a bounded safe identifier`);
  }
  return value;
}

function number(value, label, { nullable = false, integer = false, minimum = -1_000, maximum = 1_000_000_000_000 } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value))
    || value < minimum || value > maximum) {
    throw schemaError(`${label} must be a bounded finite number`);
  }
  return value;
}

function optionalNumber(value, label, limits = {}) {
  return value === undefined ? null : number(value, label, { ...limits, nullable: true });
}

function sequence(value, label) {
  return number(value, label, { integer: true, minimum: 1, maximum: MAX_SEQUENCE });
}

function idOrNull(value, label) {
  return text(value, label, 80, { nullable: true, id: true, empty: false });
}

const ORIGIN_TYPES = new Set(["pointerdown", "click", "keydown", "beforeinput", "submit", "change"]);
const STAGE_EVENTS = new Set([
  "htmx:beforeRequest", "htmx:beforeSend", "htmx:beforeSwap", "htmx:afterSwap",
  "htmx:afterSettle", "htmx:afterRequest", "htmx:sseOpen", "htmx:sseBeforeMessage", "htmx:sseMessage",
  "qq:promptAdmission", "qq:sessionSwitch",
]);
const STAGE_KINDS = new Set([
  "request-prepared", "network-dispatch", "response-before-swap", "response-after-swap",
  "response-after-settle", "request-complete", "sse-open", "sse-message-before", "sse-message-after",
  "prompt-admission-pending", "prompt-admitted", "prompt-admission-failed", "prompt-admission-unmatched",
  "session-switch-start", "session-switch-response", "session-switch-ready",
]);
const SSE_CHANNELS = new Set([
  "switch-meta", "chrome", "usage", "transcript-reset", "transcript", "live", "queue", "children",
  "popups", "case", "composer-shell", "switch-ready", "ui", "live-append", "live-tool-append",
]);
const NAVIGATION_TYPES = new Set(["navigate", "reload", "back_forward", "prerender"]);
const ACTION_LABEL = /^(?:|(?:GET|POST|PUT|PATCH|DELETE|REQUEST|NAVIGATE) \/[a-zA-Z0-9_:.@/-]*|(?:control|key|input):[a-zA-Z0-9_:.@/-]+|pointerdown|click|submit|change|beforeinput)$/;
const TARGET_LABEL = /^[a-zA-Z0-9_:@/-]+(?:#[a-zA-Z0-9_:.@/-]+)?(?:\.[a-zA-Z0-9_:.@/-]+){0,3}$/;
const SOURCE_LABELS = new Set(LATENCY_VISUAL_SOURCE_LABELS);

function oneOf(value, label, values) {
  if (!values.has(value)) throw schemaError(`${label} is not a recognized collector label`);
  return value;
}

function normalizeActionRouteIdentities(action) {
  const separator = action.indexOf(" ");
  if (separator < 0) return action;
  const verb = action.slice(0, separator);
  const segments = action.slice(separator + 1).split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] === "project" && segments[index + 1]) {
      segments[index + 1] = ":project";
      if (segments[index + 2] && segments[index + 2] !== "session") segments[index + 2] = ":folder";
    }
    if (segments[index] === "session" && segments[index + 1]) segments[index + 1] = ":id";
  }
  return `${verb} ${segments.join("/")}`;
}

function actionLabel(value, label) {
  const result = text(value, label, 200);
  if (!ACTION_LABEL.test(result)) throw schemaError(`${label} is not a recognized action label`);
  return normalizeActionRouteIdentities(result);
}

function targetLabel(value, label) {
  const result = text(value, label, 180, { nullable: true });
  if (result !== null && !TARGET_LABEL.test(result)) throw schemaError(`${label} is not a recognized target label`);
  return result;
}

function sanitizeOrigin(candidate, index) {
  const label = `origins[${index}]`;
  const value = plainObject(candidate, label, new Set(["sequence", "id", "at", "type", "action", "target"]));
  return {
    sequence: sequence(value.sequence, `${label}.sequence`),
    id: text(value.id, `${label}.id`, 80, { id: true, empty: false }),
    at: number(value.at, `${label}.at`, { minimum: 0 }),
    type: oneOf(text(value.type, `${label}.type`, 32, { empty: false }), `${label}.type`, ORIGIN_TYPES),
    action: actionLabel(value.action, `${label}.action`),
    target: targetLabel(value.target, `${label}.target`),
  };
}

function sanitizeStage(candidate, index) {
  const label = `stages[${index}]`;
  const value = plainObject(candidate, label, new Set([
    "sequence", "at", "event", "kind", "requestId", "originId", "originLatencyMs",
    "dispatchLatencyMs", "requestCompleteLatencyMs", "conversationSequence", "channel",
    "sessionSwitchId", "target", "action", ...SESSION_SWITCH_SERVER_TIMING_FIELDS,
  ]));
  const kind = oneOf(text(value.kind, `${label}.kind`, 64, { empty: false }), `${label}.kind`, STAGE_KINDS);
  const presentServerTimingFields = SESSION_SWITCH_SERVER_TIMING_FIELDS.filter((field) => Object.hasOwn(value, field));
  if (presentServerTimingFields.length > 0
    && presentServerTimingFields.length !== SESSION_SWITCH_SERVER_TIMING_FIELDS.length) {
    throw schemaError(`${label} server timings must be complete or absent`);
  }
  const serverTimings = {};
  for (const field of SESSION_SWITCH_SERVER_TIMING_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    if (kind !== "session-switch-ready") {
      throw schemaError(`${label}.${field} is only allowed on session-switch-ready`);
    }
    serverTimings[field] = number(value[field], `${label}.${field}`, {
      minimum: 0,
      maximum: MAX_SESSION_SWITCH_SERVER_TIMING_MS,
    });
  }
  return {
    sequence: sequence(value.sequence, `${label}.sequence`),
    at: number(value.at, `${label}.at`, { minimum: 0 }),
    event: oneOf(text(value.event, `${label}.event`, 64, { empty: false }), `${label}.event`, STAGE_EVENTS),
    kind,
    requestId: idOrNull(value.requestId, `${label}.requestId`),
    originId: idOrNull(value.originId, `${label}.originId`),
    originLatencyMs: optionalNumber(value.originLatencyMs, `${label}.originLatencyMs`, { minimum: 0 }),
    dispatchLatencyMs: optionalNumber(value.dispatchLatencyMs, `${label}.dispatchLatencyMs`, { minimum: 0 }),
    requestCompleteLatencyMs: optionalNumber(value.requestCompleteLatencyMs, `${label}.requestCompleteLatencyMs`, { minimum: 0 }),
    conversationSequence: value.conversationSequence === undefined || value.conversationSequence === null
      ? null
      : sequence(value.conversationSequence, `${label}.conversationSequence`),
    channel: value.channel === undefined || value.channel === null
      ? null
      : oneOf(text(value.channel, `${label}.channel`, 32, { empty: false }), `${label}.channel`, SSE_CHANNELS),
    sessionSwitchId: idOrNull(value.sessionSwitchId ?? null, `${label}.sessionSwitchId`),
    target: targetLabel(value.target, `${label}.target`),
    action: actionLabel(value.action, `${label}.action`),
    ...serverTimings,
  };
}

function stringArray(value, label, maximumEntries, maximumLength, pattern = null) {
  if (!Array.isArray(value) || value.length > maximumEntries) {
    throw schemaError(`${label} must be a bounded array`);
  }
  return value.map((entry, index) => {
    const result = text(entry, `${label}[${index}]`, maximumLength, { empty: false });
    const recognized = pattern instanceof Set ? pattern.has(result) : pattern?.test(result);
    if (pattern && !recognized) throw schemaError(`${label}[${index}] is not a recognized collector label`);
    return result;
  });
}

function sanitizeVisual(candidate, index) {
  const label = `visuals[${index}]`;
  const value = plainObject(candidate, label, new Set([
    "sequence", "at", "sources", "mutationCount", "targets", "latestInteractionId",
    "latestInteractionLatencyMs", "activeRequestId", "activeRequestOriginId",
    "activeRequestLatencyMs", "networkDispatchLatencyMs", "sessionSwitchId",
  ]));
  return {
    sequence: sequence(value.sequence, `${label}.sequence`),
    at: number(value.at, `${label}.at`, { minimum: 0 }),
    sources: stringArray(value.sources, `${label}.sources`, MAX_LATENCY_VISUAL_SOURCES, 64, SOURCE_LABELS),
    mutationCount: number(value.mutationCount, `${label}.mutationCount`, {
      integer: true,
      minimum: 0,
      maximum: 1_000_000,
    }),
    targets: stringArray(value.targets, `${label}.targets`, 12, 180, TARGET_LABEL),
    latestInteractionId: idOrNull(value.latestInteractionId, `${label}.latestInteractionId`),
    latestInteractionLatencyMs: optionalNumber(value.latestInteractionLatencyMs, `${label}.latestInteractionLatencyMs`, { minimum: 0 }),
    activeRequestId: idOrNull(value.activeRequestId, `${label}.activeRequestId`),
    activeRequestOriginId: idOrNull(value.activeRequestOriginId, `${label}.activeRequestOriginId`),
    activeRequestLatencyMs: optionalNumber(value.activeRequestLatencyMs, `${label}.activeRequestLatencyMs`, { minimum: 0 }),
    networkDispatchLatencyMs: optionalNumber(value.networkDispatchLatencyMs, `${label}.networkDispatchLatencyMs`, { minimum: 0 }),
    sessionSwitchId: idOrNull(value.sessionSwitchId ?? null, `${label}.sessionSwitchId`),
  };
}

function sanitizeViewport(candidate) {
  const value = plainObject(candidate, "page.viewport", new Set(["width", "height", "devicePixelRatio", "visual"]));
  let visual = null;
  if (value.visual !== null && value.visual !== undefined) {
    const viewport = plainObject(value.visual, "page.viewport.visual", new Set(["width", "height", "scale"]));
    visual = {
      width: optionalNumber(viewport.width, "page.viewport.visual.width", { minimum: 0, maximum: 100_000 }),
      height: optionalNumber(viewport.height, "page.viewport.visual.height", { minimum: 0, maximum: 100_000 }),
      scale: optionalNumber(viewport.scale, "page.viewport.visual.scale", { minimum: 0, maximum: 1_000 }),
    };
  }
  return {
    width: optionalNumber(value.width, "page.viewport.width", { minimum: 0, maximum: 100_000 }),
    height: optionalNumber(value.height, "page.viewport.height", { minimum: 0, maximum: 100_000 }),
    devicePixelRatio: optionalNumber(value.devicePixelRatio, "page.viewport.devicePixelRatio", { minimum: 0, maximum: 1_000 }),
    visual,
  };
}

const NAVIGATION_TIMING_FIELDS = Object.freeze([
  "startTime", "redirectStart", "redirectEnd", "workerStart", "fetchStart", "domainLookupStart",
  "domainLookupEnd", "connectStart", "secureConnectionStart", "connectEnd", "requestStart", "responseStart",
  "responseEnd", "domInteractive", "domContentLoadedEventStart", "domContentLoadedEventEnd", "domComplete",
  "loadEventStart", "loadEventEnd", "duration",
]);

function sanitizeNavigation(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const allowed = new Set(["type", ...NAVIGATION_TIMING_FIELDS,
    "transferSize", "encodedBodySize", "decodedBodySize", "serverViewDuration", "serverRenderDuration"]);
  const value = plainObject(candidate, "page.navigation", allowed);
  const result = {
    type: oneOf(text(value.type, "page.navigation.type", 32, { empty: false }), "page.navigation.type", NAVIGATION_TYPES),
  };
  for (const field of NAVIGATION_TIMING_FIELDS) {
    result[field] = optionalNumber(value[field], `page.navigation.${field}`, { minimum: 0 });
  }
  for (const field of ["transferSize", "encodedBodySize", "decodedBodySize"]) {
    result[field] = optionalNumber(value[field], `page.navigation.${field}`, {
      integer: true, minimum: 0, maximum: MAX_SEQUENCE,
    });
  }
  for (const field of ["serverViewDuration", "serverRenderDuration"]) {
    result[field] = optionalNumber(value[field], `page.navigation.${field}`, { minimum: 0 });
  }
  return result;
}

function hasUnnormalizedRouteIdentity(action) {
  const path = action.slice(action.indexOf(" ") + 1);
  const segments = path.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] === "session" && segments[index + 1] && segments[index + 1] !== ":id") return true;
    if (segments[index] === "project" && segments[index + 1] && segments[index + 1] !== ":project") return true;
    if (segments[index] === "project" && segments[index + 2]
      && segments[index + 2] !== "session" && segments[index + 2] !== ":folder") return true;
  }
  return false;
}

function sanitizeNavigationIntent(candidate) {
  if (candidate === null || candidate === undefined) return null;
  const value = plainObject(candidate, "page.navigationIntent", new Set([
    "id", "sourceRunId", "action", "target", "at", "intentToNavigationMs", "intentToCollectorMs",
  ]));
  const action = actionLabel(value.action, "page.navigationIntent.action");
  if (!action.startsWith("NAVIGATE /") || hasUnnormalizedRouteIdentity(value.action)) {
    throw schemaError("page.navigationIntent.action must be a normalized navigation action");
  }
  return {
    id: opaqueId(value.id, "page.navigationIntent.id", 80),
    sourceRunId: opaqueId(value.sourceRunId, "page.navigationIntent.sourceRunId", 128),
    action,
    target: targetLabel(value.target, "page.navigationIntent.target"),
    at: number(value.at, "page.navigationIntent.at", { minimum: 0, maximum: 10_000_000_000_000_000 }),
    intentToNavigationMs: number(value.intentToNavigationMs, "page.navigationIntent.intentToNavigationMs", { minimum: 0 }),
    intentToCollectorMs: number(value.intentToCollectorMs, "page.navigationIntent.intentToCollectorMs", { minimum: 0 }),
  };
}

function sanitizePage(candidate) {
  const value = plainObject(candidate, "page", new Set([
    "timeOrigin", "startedAt", "startedAtISO", "navigation", "firstPaint", "firstContentfulPaint",
    "navigationIntent", "ui", "viewport", "userAgent",
  ]));
  const uiValue = plainObject(value.ui, "page.ui", new Set(["generation", "revision"]));
  return {
    timeOrigin: number(value.timeOrigin, "page.timeOrigin", { minimum: 0, maximum: 10_000_000_000_000_000 }),
    startedAt: optionalNumber(value.startedAt, "page.startedAt", { minimum: 0 }),
    startedAtISO: text(value.startedAtISO, "page.startedAtISO", 40, { nullable: true }),
    navigation: sanitizeNavigation(value.navigation),
    firstPaint: optionalNumber(value.firstPaint, "page.firstPaint", { minimum: 0 }),
    firstContentfulPaint: optionalNumber(value.firstContentfulPaint, "page.firstContentfulPaint", { minimum: 0 }),
    navigationIntent: sanitizeNavigationIntent(value.navigationIntent),
    ui: {
      generation: text(uiValue.generation, "page.ui.generation", 120, { nullable: true, id: true }),
      revision: text(uiValue.revision, "page.ui.revision", 120, { nullable: true, id: true }),
    },
    viewport: sanitizeViewport(value.viewport),
    userAgent: text(value.userAgent, "page.userAgent", 512),
  };
}


function healthCounters(candidate, label) {
  const value = plainObject(candidate, label, new Set(["origins", "stages", "visuals"]));
  return {
    origins: number(value.origins, `${label}.origins`, { integer: true, minimum: 0, maximum: MAX_SEQUENCE }),
    stages: number(value.stages, `${label}.stages`, { integer: true, minimum: 0, maximum: MAX_SEQUENCE }),
    visuals: number(value.visuals, `${label}.visuals`, { integer: true, minimum: 0, maximum: MAX_SEQUENCE }),
  };
}

function sanitizeHealth(candidate) {
  const value = plainObject(candidate, "health", new Set([
    "generated", "acknowledged", "ringBufferDrops", "uploadDrops", "quarantineCount",
  ]));
  const generated = healthCounters(value.generated, "health.generated");
  const acknowledged = healthCounters(value.acknowledged, "health.acknowledged");
  const ringBufferDrops = healthCounters(value.ringBufferDrops, "health.ringBufferDrops");
  const uploadDrops = healthCounters(value.uploadDrops, "health.uploadDrops");
  const quarantineCount = number(value.quarantineCount, "health.quarantineCount", {
    integer: true,
    minimum: 0,
    maximum: MAX_SEQUENCE,
  });
  for (const kind of ["origins", "stages", "visuals"]) {
    if (acknowledged[kind] > generated[kind]) {
      throw schemaError(`health.acknowledged.${kind} exceeds generated sequences`);
    }
    if (ringBufferDrops[kind] > generated[kind]) {
      throw schemaError(`health.ringBufferDrops.${kind} exceeds generated sequences`);
    }
    if (uploadDrops[kind] > generated[kind]) {
      throw schemaError(`health.uploadDrops.${kind} exceeds generated sequences`);
    }
  }
  return { generated, acknowledged, ringBufferDrops, uploadDrops, quarantineCount };
}

function sanitizeEntries(value, kind, sanitizer) {
  if (!Array.isArray(value) || value.length > LATENCY_BATCH_LIMITS[kind]) {
    throw schemaError(`${kind} exceeds its batch limit`);
  }
  const result = value.map(sanitizer);
  const seen = new Set();
  for (const entry of result) {
    if (seen.has(entry.sequence)) throw schemaError(`${kind} contains a duplicate sequence`);
    seen.add(entry.sequence);
  }
  return result;
}

/** Validate and copy only fields that are safe to persist. */
export function sanitizeLatencyBatch(candidate) {
  const value = plainObject(candidate, "batch", new Set([
    "schema", "runId", "batchId", "page", "health", "origins", "stages", "visuals",
  ]));
  if (value.schema !== LATENCY_BATCH_SCHEMA) throw schemaError("schema is unsupported");
  const origins = sanitizeEntries(value.origins, "origins", sanitizeOrigin);
  const stages = sanitizeEntries(value.stages, "stages", sanitizeStage);
  const visuals = sanitizeEntries(value.visuals, "visuals", sanitizeVisual);
  if (origins.length + stages.length + visuals.length === 0) throw schemaError("batch has no entries");
  // Optional for same-version collectors that were loaded before health was
  // added. Newly emitted browser batches always include the strict object.
  const health = value.health === undefined ? null : sanitizeHealth(value.health);
  if (health) {
    for (const [kind, entries] of [["origins", origins], ["stages", stages], ["visuals", visuals]]) {
      const maximum = entries.reduce((result, entry) => Math.max(result, entry.sequence), 0);
      if (maximum > health.generated[kind]) {
        throw schemaError(`health.generated.${kind} is behind an emitted sequence`);
      }
    }
  }
  return {
    schema: LATENCY_LOG_SCHEMA,
    runId: opaqueId(value.runId, "runId", 128),
    batchId: opaqueId(value.batchId, "batchId", 160),
    page: sanitizePage(value.page),
    health,
    origins,
    stages,
    visuals,
  };
}

function positiveInteger(value, fallback, label) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 2) throw new Error(`qq-ui: ${label} must be an integer of at least 2 bytes`);
  return result;
}

async function fileSize(path) {
  try { return (await stat(path)).size; } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function remove(path) {
  try { await unlink(path); } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/** A serialized, two-file rolling NDJSON store. */
export function createLatencyStore(options = {}) {
  if (options.path !== undefined
    && (typeof options.path !== "string" || !options.path.trim() || options.path.includes("\0"))) {
    throw new Error("qq-ui: latencyLogPath must be a non-empty filesystem path");
  }
  const path = resolve(options.path ?? defaultLatencyLogPath());
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_LATENCY_LOG_MAX_BYTES, "latencyLogMaxBytes");
  const fileMaxBytes = Math.floor(maxBytes / 2);
  const backupPath = `${path}.1`;
  const recentLimit = positiveInteger(options.recentLimit, 8192, "latency recentLimit");
  const clock = typeof options.clock === "function" ? options.clock : () => new Date().toISOString();
  const recent = new Set();
  const order = [];
  let initialized = false;
  let tail = Promise.resolve();

  const remember = (key) => {
    if (recent.has(key)) return;
    recent.add(key);
    order.push(key);
    while (order.length > recentLimit) recent.delete(order.shift());
  };

  const initialize = async () => {
    if (initialized) return;
    const directory = dirname(path);
    let directoryExisted = true;
    try { await stat(directory); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      directoryExisted = false;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!directoryExisted) await chmod(directory, 0o700);
    for (const candidate of [backupPath, path]) {
      let info;
      try { info = await stat(candidate); } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (info.size > fileMaxBytes) {
        await remove(candidate);
        continue;
      }
      await chmod(candidate, 0o600);
      if (!info.size) continue;
      try {
        const body = await readFile(candidate, "utf8");
        for (const line of body.split("\n")) {
          if (!line) continue;
          try {
            const row = JSON.parse(line);
            if (typeof row?.runId === "string" && typeof row?.batchId === "string") {
              remember(JSON.stringify([row.runId, row.batchId]));
            }
          } catch {}
        }
      } catch {}
    }
    initialized = true;
  };

  const appendNow = async (batch) => {
    await initialize();
    const key = JSON.stringify([batch.runId, batch.batchId]);
    if (recent.has(key)) return { duplicate: true, path };
    const line = `${JSON.stringify({ ...batch, receivedAt: clock() })}\n`;
    const bytes = Buffer.byteLength(line);
    if (bytes > fileMaxBytes) {
      const error = new Error("Sanitized latency batch exceeds the configured rolling-file size");
      error.status = 413;
      throw error;
    }

    if (await fileSize(backupPath) > fileMaxBytes) await remove(backupPath);
    let currentSize = await fileSize(path);
    if (currentSize > fileMaxBytes) {
      await remove(path);
      currentSize = 0;
    }
    if (currentSize + bytes > fileMaxBytes) {
      await remove(backupPath);
      if (currentSize > 0) {
        await rename(path, backupPath);
        await chmod(backupPath, 0o600);
      }
      currentSize = 0;
    }
    const handle = await open(path, "a", 0o600);
    try {
      await handle.chmod(0o600);
      await handle.writeFile(line, "utf8");
    } finally {
      await handle.close();
    }
    remember(key);
    return { duplicate: false, path };
  };

  return Object.freeze({
    path,
    backupPath,
    maxBytes,
    fileMaxBytes,
    append(batch) {
      const result = tail.then(() => appendNow(batch));
      tail = result.catch(() => {});
      return result;
    },
  });
}
