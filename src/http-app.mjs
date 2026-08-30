import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { orderedProjectPlaces, projectPlaceIdentity } from "./project-order.mjs";
import {
  createLatencyStore,
  MAX_LATENCY_BODY_BYTES,
  sanitizeLatencyBatch,
  SESSION_SWITCH_SERVER_TIMING_FIELDS,
} from "./latency-store.mjs";
import {
  codeDispatchNodes as bundledCodeDispatchNodes,
  renderDocumentViewerProofPage as bundledRenderDocumentViewerProofPage,
  renderFilePage as bundledRenderFilePage,
  renderPage as bundledRenderPage,
  renderMutationOob as bundledRenderMutationOob,
  MUTATION_REGION_NAMES as bundledMutationRegionNames,
  PROMPT_MUTATION_REGION_NAMES as bundledPromptMutationRegionNames,
  renderSessionContent as bundledRenderSessionContent,
  renderSessionRegion as bundledRenderSessionRegion,
  renderTranscriptJunction as bundledRenderTranscriptJunction,
  renderSettledTranscriptAppend as bundledRenderSettledTranscriptAppend,
  transcriptSettledInner as bundledTranscriptSettledInner,
  renderLiveNodes as bundledRenderLiveNodes,
  renderComposer as bundledRenderComposer,
  renderToolBody as bundledRenderToolBody,
  liveTranscriptUpdate as bundledLiveTranscriptUpdate,
  regionFingerprints as bundledRegionFingerprints,
  SSE_REGION_NAMES as bundledSseRegionNames,
} from "./render.mjs";

const MAX_FORM_BYTES = 524_288;
const DEFAULT_SSE_POLL_MS = 100;
const INITIAL_SNAPSHOT_HANDOFF_MAX_ENTRIES = 32;
const INITIAL_SNAPSHOT_HANDOFF_TTL_MS = 8_000;
const INITIAL_SNAPSHOT_HANDOFF_PARAMETER = "handoff";
const LAST_SESSION_COOKIE = "qq-last-session";
const LAST_SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DASHBOARD_SCHEMA = "qq.dashboard/v1";
const DASHBOARD_SESSION_ID = LAST_SESSION_ID;
const DASHBOARD_UUID_TEXT = /(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const DASHBOARD_PHASES = new Set(["planning", "plan", "work", "none", "unknown"]);
const DASHBOARD_USAGE_STATES = new Set(["ready", "estimated", "stale", "unavailable"]);

function normalizedHandoffBinding(binding) {
  return {
    sessionId: String(binding?.sessionId ?? ""),
    project: binding?.project === null || binding?.project === undefined
      ? null
      : String(binding.project),
    folder: binding?.folder === null || binding?.folder === undefined
      ? null
      : String(binding.folder),
  };
}

function sameHandoffBinding(left, right) {
  return left.sessionId === right.sessionId
    && left.project === right.project
    && left.folder === right.folder;
}

/**
 * Short-lived one-shot bridge between a rendered page and only that page's
 * initial EventSource. This is deliberately not a reusable snapshot cache.
 */
export function createInitialSnapshotHandoffStore({
  maxEntries = INITIAL_SNAPSHOT_HANDOFF_MAX_ENTRIES,
  ttlMs = INITIAL_SNAPSHOT_HANDOFF_TTL_MS,
  now = Date.now,
  createToken = () => randomBytes(24).toString("base64url"),
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("qq-ui: initial snapshot handoff maxEntries must be a positive integer");
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
    throw new Error("qq-ui: initial snapshot handoff ttlMs must be a positive integer");
  }
  if (typeof now !== "function" || typeof createToken !== "function") {
    throw new Error("qq-ui: initial snapshot handoff clock and token factory are required");
  }
  const entries = new Map();
  const prune = (at = now()) => {
    for (const [token, entry] of entries) {
      if (entry.expiresAt <= at) entries.delete(token);
    }
  };
  const issue = (binding, snapshot) => {
    const at = now();
    prune(at);
    let token = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      token = String(createToken());
      if (/^[A-Za-z0-9_-]{24,128}$/.test(token) && !entries.has(token)) break;
      token = "";
    }
    if (!token) throw new Error("qq-ui: could not allocate an opaque initial snapshot handoff");
    while (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    entries.set(token, {
      binding: normalizedHandoffBinding(binding),
      snapshot,
      expiresAt: at + ttlMs,
    });
    return token;
  };
  const consume = (token, binding) => {
    const at = now();
    prune(at);
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{24,128}$/.test(token)) return null;
    const entry = entries.get(token);
    if (!entry) return null;
    // Delete before checking identity: both successful use and probing mismatch
    // are terminal, so a copied token can never be replayed against another route.
    entries.delete(token);
    if (entry.expiresAt <= at
      || !sameHandoffBinding(entry.binding, normalizedHandoffBinding(binding))) return null;
    return entry.snapshot;
  };
  const discard = (token) => entries.delete(String(token ?? ""));
  const clear = () => entries.clear();
  return Object.freeze({
    issue,
    consume,
    discard,
    clear,
    get size() {
      prune();
      return entries.size;
    },
  });
}

function snapshotHandoffBinding(sessionId, project, folder) {
  return normalizedHandoffBinding({
    sessionId,
    project: project ? project : null,
    folder: project && folder ? folder : null,
  });
}

function eventsWithSnapshotHandoff(events, token) {
  return `${events}${events.includes("?") ? "&" : "?"}${INITIAL_SNAPSHOT_HANDOFF_PARAMETER}=${encodeURIComponent(token)}`;
}

function dashboardText(value, { empty = false, display = false } = {}) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if ((!empty && !result) || (display && result && DASHBOARD_UUID_TEXT.test(result))) return null;
  return result;
}

function dashboardDuration(value) {
  return value === null || (Number.isFinite(value) && Number.isInteger(value) && value >= 0);
}

function dashboardTimestamp(value, nullable = false) {
  return (nullable && value === null)
    || (Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000);
}

function validatedDashboardUsage(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
    || !dashboardTimestamp(candidate.generatedAt) || !Array.isArray(candidate.providers)) return null;
  const providerIds = new Set();
  const providers = [];
  for (const provider of candidate.providers) {
    if (!provider || typeof provider !== "object" || Array.isArray(provider)
      || !Array.isArray(provider.meters)) return null;
    const id = dashboardText(provider.id);
    const label = dashboardText(provider.label, { display: true });
    const { state, observedAt } = provider;
    if (id === null || label === null || providerIds.has(id)
      || !DASHBOARD_USAGE_STATES.has(state) || !dashboardTimestamp(observedAt, true)) return null;
    providerIds.add(id);
    const meterIds = new Set();
    const meters = [];
    for (const meter of provider.meters) {
      if (!meter || typeof meter !== "object" || Array.isArray(meter)) return null;
      const meterId = dashboardText(meter.id);
      const meterLabel = dashboardText(meter.label, { display: true });
      const detail = dashboardText(meter.detail, { empty: true });
      if (meterId === null || meterLabel === null || detail === null || meterIds.has(meterId)
        || typeof meter.usedRatio !== "number" || !Number.isFinite(meter.usedRatio) || meter.usedRatio < 0
        || !dashboardTimestamp(meter.resetAt, true)) return null;
      meterIds.add(meterId);
      meters.push(Object.freeze({
        id: meterId,
        label: meterLabel,
        usedRatio: meter.usedRatio,
        resetAt: meter.resetAt,
        detail,
      }));
    }
    if (state === "unavailable" && (observedAt !== null || meters.length !== 0)) return null;
    providers.push(Object.freeze({
      id, label, state, observedAt, meters: Object.freeze(meters),
    }));
  }
  providers.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return Object.freeze({
    generatedAt: candidate.generatedAt,
    providers: Object.freeze(providers),
  });
}

/**
 * Validate and isolate the presentation fields consumed by qq-ui. The top-level
 * generatedAt is intentionally omitted because it advances on cache refresh
 * even when the semantic tracker is unchanged. Optional usage is validated in
 * its own boundary so a malformed provider cycle cannot suppress tracking.
 */
export function validatedDashboardSnapshot(candidate) {
  try {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || candidate.schema !== DASHBOARD_SCHEMA || !Array.isArray(candidate.projects)) return null;
    const projects = [];
    const projectKeys = new Set();
    const projectPlaces = new Set();
    const sessionIds = new Set();
    for (const project of candidate.projects) {
      if (!project || typeof project !== "object" || Array.isArray(project)
        || !Array.isArray(project.sessions)) return null;
      const key = dashboardText(project.key);
      const name = dashboardText(project.name);
      const label = dashboardText(project.label, { display: true });
      const folder = dashboardText(project.folder, { empty: true });
      const folderLabel = dashboardText(project.folderLabel, { empty: true, display: true });
      const place = projectPlaceIdentity({ name, folder });
      if (key === null || name === null || label === null || folder === null || folderLabel === null
        || projectKeys.has(key) || projectPlaces.has(place)
        || (folder && !folderLabel) || (!folder && folderLabel)) return null;
      projectKeys.add(key);
      projectPlaces.add(place);
      const sessions = [];
      const projectSessions = new Map();
      for (const row of project.sessions) {
        if (!row || typeof row !== "object" || Array.isArray(row)) return null;
        const sessionId = dashboardText(row.sessionId);
        const alias = dashboardText(row.alias, { empty: true, display: true });
        const rowLabel = dashboardText(row.label, { display: true });
        const parentSessionId = dashboardText(row.parentSessionId, { empty: true });
        const depth = row.depth;
        const activity = row.activity;
        const idleForMs = row.idleForMs;
        const workflow = row.workflow === null
          ? null
          : typeof row.workflow === "string" ? dashboardText(row.workflow, { display: true }) : undefined;
        const phase = row.phase;
        const phaseStartedAt = row.phaseStartedAt;
        if (!DASHBOARD_SESSION_ID.test(sessionId ?? "") || sessionIds.has(sessionId)
          || alias === null || rowLabel === null
          || (parentSessionId !== "" && !DASHBOARD_SESSION_ID.test(parentSessionId ?? ""))
          || !Number.isInteger(depth) || depth < 0
          || (activity !== "working" && activity !== "idle")
          || !dashboardDuration(idleForMs)
          || (activity === "working" && idleForMs !== null)
          || workflow === "" || workflow === undefined
          || (row.workflow !== null && workflow === null)
          || (workflow === null && phase !== "none")
          || (workflow !== null && phase === "none")
          || !DASHBOARD_PHASES.has(phase)
          || !dashboardDuration(phaseStartedAt)
          || ((phase === "none" || phase === "unknown") && phaseStartedAt !== null)) return null;
        sessionIds.add(sessionId);
        const normalized = Object.freeze({
          sessionId, alias, label: rowLabel, parentSessionId, depth, activity,
          workflow, phase, phaseStartedAt,
        });
        sessions.push(normalized);
        projectSessions.set(sessionId, normalized);
      }

      // Parent IDs are authoritative. Rebuild a stable pre-order from the
      // producer's root and sibling order so each family stays contiguous even
      // when activity polling supplies rows in a flat or interleaved order.
      const roots = [];
      const children = new Map();
      for (const row of sessions) {
        if (row.depth === 0) {
          if (row.parentSessionId !== "") return null;
          roots.push(row);
          continue;
        }
        const parent = projectSessions.get(row.parentSessionId);
        if (!parent || parent.depth + 1 !== row.depth) return null;
        if (!children.has(parent.sessionId)) children.set(parent.sessionId, []);
        children.get(parent.sessionId).push(row);
      }
      const orderedSessions = [];
      const appendFamily = (row) => {
        orderedSessions.push(row);
        for (const child of children.get(row.sessionId) ?? []) appendFamily(child);
      };
      for (const root of roots) appendFamily(root);
      if (orderedSessions.length !== sessions.length) return null;
      projects.push(Object.freeze({
        key, name, label, folder, folderLabel,
        sessions: Object.freeze(orderedSessions),
      }));
    }
    let usage;
    try {
      if (Object.prototype.hasOwnProperty.call(candidate, "usage")) {
        usage = validatedDashboardUsage(candidate.usage) ?? undefined;
      }
    } catch {
      // Usage is an optional independently produced subtree. Discard only it.
    }
    return Object.freeze({
      schema: DASHBOARD_SCHEMA,
      projects: Object.freeze(orderedProjectPlaces(projects)),
      ...(usage ? { usage } : {}),
    });
  } catch {
    return null;
  }
}
/** Console chat is the architect fold floor: current operator pair plus previous. */
export const CONSOLE_PAIRS = 2;

export function consoleFoldWindow(snapshot) {
  const nodes = Array.isArray(snapshot?.conversation?.nodes) ? snapshot.conversation.nodes : [];
  const operatorStarts = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index]?.kind !== "user") continue;
    operatorStarts.push(index);
  }
  const start = operatorStarts.length > CONSOLE_PAIRS ? operatorStarts.at(-CONSOLE_PAIRS) : 0;
  if (start === 0) return snapshot;
  return {
    ...snapshot,
    conversation: {
      ...(snapshot.conversation ?? {}),
      nodes: nodes.slice(start),
    },
  };
}

const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

const root = new URL("../", import.meta.url);
const SERVICE_WORKER_NAMES = new Set([
  "sw.js",
  "sw-v10.js",
  "sw-v11.js",
  "sw-v12.js",
  "sw-v13.js",
  "sw-v14.js",
  "sw-v15.js",
  "sw-v16.js",
  "sw-v17.js",
  "sw-v18.js",
]);
const serviceWorkerBody = readFileSync(new URL("assets/sw.js", root));
const bundledAssets = Object.freeze({
  "htmx-2.0.10.min.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("vendor/htmx-2.0.10.min.js", root)),
  },
  "htmx-ext-sse-2.2.4.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("vendor/htmx-ext-sse-2.2.4.js", root)),
  },
  "console-v8.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v9.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v10.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v11.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v12.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v13.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v14.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v15.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v16.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v17.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v18.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v19.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v20.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v21.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console-v22.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "console.css": {
    type: "text/css; charset=utf-8",
    body: readFileSync(new URL("assets/console.css", root)),
  },
  "geist-latin-wght-normal-5.3.0.woff2": {
    type: "font/woff2",
    body: readFileSync(new URL("assets/geist-latin-wght-normal-5.3.0.woff2", root)),
  },
  "geist-latin-wght-italic-5.3.0.woff2": {
    type: "font/woff2",
    body: readFileSync(new URL("assets/geist-latin-wght-italic-5.3.0.woff2", root)),
  },
  "browser-v4.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v4.js", root)),
  },
  "browser-v5.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v5.js", root)),
  },
  "browser-v6.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v5.js", root)),
  },
  "browser-v7.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v5.js", root)),
  },
  "browser-v8.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v8.js", root)),
  },
  "browser-v9.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v9.js", root)),
  },
  "browser-v10.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v9.js", root)),
  },
  "browser.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/browser-v9.js", root)),
  },
  "reconnect-v1.js": {
    type: "text/javascript; charset=utf-8",
    body: readFileSync(new URL("assets/reconnect-v1.js", root)),
  },
  "icon-v1.svg": {
    type: "image/svg+xml",
    body: readFileSync(new URL("assets/icon-v1.svg", root)),
  },
  "icon-v2-192.png": {
    type: "image/png",
    body: readFileSync(new URL("assets/icon-v2-192.png", root)),
  },
  "icon-v2-512.png": {
    type: "image/png",
    body: readFileSync(new URL("assets/icon-v2-512.png", root)),
  },
  "offline-v8.html": {
    type: "text/html; charset=utf-8",
    body: readFileSync(new URL("assets/offline-v8.html", root)),
  },
  ...Object.fromEntries(
    [...SERVICE_WORKER_NAMES].map((name) => [name, {
      type: "text/javascript; charset=utf-8",
      body: serviceWorkerBody,
    }]),
  ),
});

const LIVE_ASSET_FILES = Object.freeze({
  "console.css": "assets/console.css",
  "browser.js": "assets/browser-v9.js",
  "console-v18.css": "assets/console.css",
  "console-v19.css": "assets/console.css",
  "console-v20.css": "assets/console.css",
  "console-v21.css": "assets/console.css",
  "console-v22.css": "assets/console.css",
  "browser-v9.js": "assets/browser-v9.js",
  "browser-v10.js": "assets/browser-v9.js",
});
const RENDER_FILE = fileURLToPath(new URL("./render.mjs", import.meta.url));
const BROWSER_FILE = fileURLToPath(new URL("assets/browser-v9.js", root));
const CSS_FILE = fileURLToPath(new URL("assets/console.css", root));

function liveGenerationStamp() {
  return [
    Math.trunc(statSync(RENDER_FILE).mtimeMs),
    Math.trunc(statSync(BROWSER_FILE).mtimeMs),
    Math.trunc(statSync(CSS_FILE).mtimeMs),
  ].join("-");
}

const BOOT_GENERATION = liveGenerationStamp();

/** Generation the process is actually serving. Live reads disk; frozen at boot otherwise. */
export function readUiGeneration(liveAssets = false) {
  return liveAssets ? liveGenerationStamp() : BOOT_GENERATION;
}

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const BOOT_STARTED_AT = new Date().toISOString();

export function readUiRevision(cwd = REPO_ROOT) {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd, encoding: "utf8", timeout: 2_000,
    }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], {
      cwd, encoding: "utf8", timeout: 2_000,
    }).trim().length > 0;
    return { sha, dirty };
  } catch {
    return { sha: "", dirty: false };
  }
}

function formatUiRevision(revision) {
  if (!revision?.sha) return "";
  return revision.dirty ? `${revision.sha}:dirty` : revision.sha;
}

const BOOT_REVISION = readUiRevision();
const BOOT_REVISION_LABEL = formatUiRevision(BOOT_REVISION);

export function createRootRedirectHandler(basePath = "/qq") {
  const target = normalizeBasePath(basePath);
  return function rootRedirectHandler(req, res) {
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
      return;
    }
    let search = "";
    try {
      search = new URL(req.url ?? "/", "http://qq-ui.invalid").search;
    } catch {
      text(res, 400, "Malformed request URL", head);
      return;
    }
    write(
      res,
      308,
      { Location: `${target}/${search}`, "Content-Type": "text/plain; charset=utf-8" },
      "Permanent redirect\n",
      head,
    );
  };
}

export function resolveAsset(name, liveAssets = false) {
  const bundled = bundledAssets[name];
  if (!bundled) return undefined;
  const relative = LIVE_ASSET_FILES[name];
  if (!liveAssets || !relative) return { type: bundled.type, body: bundled.body, live: false };
  return {
    type: bundled.type,
    body: readFileSync(new URL(relative, root)),
    live: true,
  };
}

function normalizeBasePath(value) {
  const path = String(value ?? "/qq");
  if (!path.startsWith("/") || path.endsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("qq-ui: basePath must be an absolute path without a trailing slash");
  }
  return path;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`qq-ui: ${name} must be a positive integer`);
  }
  return value;
}

function write(res, status, headers, body, head = false) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(head ? undefined : body);
}

function lastSessionCookie(req) {
  const header = String(req.headers.cookie ?? "");
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const cut = trimmed.indexOf("=");
    if (cut < 0) continue;
    if (trimmed.slice(0, cut) !== LAST_SESSION_COOKIE) continue;
    const value = trimmed.slice(cut + 1);
    if (LAST_SESSION_ID.test(value)) return value;
  }
  return undefined;
}

function rememberSessionHeaders(sessionId, extra = {}) {
  if (!LAST_SESSION_ID.test(String(sessionId ?? ""))) return extra;
  return {
    ...extra,
    "Set-Cookie": `${LAST_SESSION_COOKIE}=${sessionId}; Path=/qq; SameSite=Lax; HttpOnly`,
  };
}

function text(res, status, message, head = false) {
  write(res, status, { "Content-Type": "text/plain; charset=utf-8" }, `${message}\n`, head);
}

function json(res, status, value, head = false) {
  write(res, status, { "Content-Type": "application/json; charset=utf-8" }, `${JSON.stringify(value)}\n`, head);
}

async function readJsonBody(req, maximum = MAX_LATENCY_BODY_BYTES) {
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    const error = new Error("Expected an application/json latency batch");
    error.status = 415;
    throw error;
  }
  const encoding = String(req.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  if (encoding && encoding !== "identity") {
    const error = new Error("Encoded latency batches are not accepted");
    error.status = 415;
    throw error;
  }
  const declared = String(req.headers["content-length"] ?? "");
  if (declared) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      const error = new Error("Invalid Content-Length");
      error.status = 400;
      throw error;
    }
    if (bytes > maximum) {
      const error = new Error("Latency batch is too large");
      error.status = 413;
      throw error;
    }
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) {
      const error = new Error("Latency batch is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Malformed latency JSON");
    error.status = 400;
    throw error;
  }
}

async function readForm(req) {
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0];
  if (contentType !== "application/x-www-form-urlencoded") {
    const error = new Error("Expected a URL-encoded form submission");
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_FORM_BYTES) {
      const error = new Error("Form submission is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function sameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.origin;
  // A no-referrer document navigation can serialize a legitimate POST Origin
  // as `null`; Sec-Fetch-Site remains the browser-controlled same-site proof.
  if (!origin || origin === "null") return !site || site === "same-origin" || site === "none";
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function encodeProject(name) {
  return encodeURIComponent(String(name ?? ""));
}

function routes(basePath, sessionId, project, folder) {
  if (project) {
    const projectBase = folder
      ? `${basePath}/project/${encodeProject(project)}/${encodeProject(folder)}`
      : `${basePath}/project/${encodeProject(project)}`;
    const canonical = sessionId
      ? `${projectBase}/session/${encodeURIComponent(sessionId)}`
      : projectBase;
    return Object.freeze({
      canonical,
      project: projectBase,
      projectsBase: `${basePath}/project`,
      projectsSession: `${basePath}/projects`,
      fileView: `${canonical}/file/`,
      fileOpen: `${canonical}/open/`,
      fileDownload: `${canonical}/download/`,
      events: sessionId ? `${canonical}/events` : "",
      interrupt: sessionId ? `${canonical}/interrupt` : "",
      prompt: sessionId ? `${canonical}/prompt` : "",
      queue: sessionId ? `${canonical}/queue` : "",
      offer: sessionId ? `${canonical}/offer` : "",
      approval: sessionId ? `${canonical}/approval` : "",
      overlay: sessionId ? `${canonical}/overlay` : "",
      close: sessionId ? `${canonical}/close` : "",
      createSession: `${projectBase}/sessions`,
      switchSession: `${basePath}/sessions/open`,
      home: `${basePath}/home`,
    });
  }
  const canonical = `${basePath}/session/${encodeURIComponent(sessionId)}`;
  return Object.freeze({
    canonical,
    project: basePath,
    projectsBase: `${basePath}/project`,
    projectsSession: `${basePath}/projects`,
    fileView: "",
    fileOpen: "",
    fileDownload: "",
    events: `${canonical}/events`,
    interrupt: `${canonical}/interrupt`,
    prompt: `${canonical}/prompt`,
    queue: `${canonical}/queue`,
    offer: `${canonical}/offer`,
    approval: `${canonical}/approval`,
    overlay: `${canonical}/overlay`,
    close: `${canonical}/close`,
    createSession: `${basePath}/sessions`,
    switchSession: `${basePath}/sessions/open`,
    home: `${basePath}/home`,
  });
}

function parseSessionRoute(basePath, pathname) {
  const prefix = `${basePath}/session/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const parts = pathname.slice(prefix.length).split("/");
  if (parts.length < 1 || !parts[0]) return undefined;
  let sessionId;
  try {
    sessionId = decodeURIComponent(parts[0]);
  } catch {
    return undefined;
  }
  if (parts.length === 1) return { sessionId, action: "page" };
  if (parts.length === 2) return { sessionId, action: parts[1] };
  if (parts.length === 3 && parts[1] === "tool" && parts[2]) {
    try {
      return { sessionId, action: "tool", callId: decodeURIComponent(parts[2]) };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const PROJECT_ROUTE_ACTIONS = new Set(["sessions", "session", "file", "open", "download"]);

function parseProjectRoute(basePath, pathname) {
  const prefix = `${basePath}/project/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const parts = pathname.slice(prefix.length).split("/");
  if (!parts[0]) return undefined;
  let project;
  try {
    project = decodeURIComponent(parts[0]);
  } catch {
    return undefined;
  }
  let index = 1;
  let folder;
  if (parts[1] && !PROJECT_ROUTE_ACTIONS.has(parts[1])) {
    try {
      folder = decodeURIComponent(parts[1]);
    } catch {
      return undefined;
    }
    index = 2;
  }
  const rest = parts.slice(index);
  const base = folder ? { project, folder } : { project };
  if (rest.length === 0) return { ...base, action: "project" };
  if (rest[0] === "sessions" && rest.length === 1) return { ...base, action: "create" };
  if (["file", "open", "download"].includes(rest[0]) && rest.length === 2 && rest[1]) {
    let filePath;
    try {
      filePath = decodeURIComponent(rest[1]);
    } catch {
      return undefined;
    }
    return { ...base, filePath, action: rest[0] };
  }
  if (rest[0] === "session" && rest[1]) {
    let sessionId;
    try {
      sessionId = decodeURIComponent(rest[1]);
    } catch {
      return undefined;
    }
    if (["file", "open", "download"].includes(rest[2]) && rest.length === 4 && rest[3]) {
      let filePath;
      try {
        filePath = decodeURIComponent(rest[3]);
      } catch {
        return undefined;
      }
      return { ...base, sessionId, filePath, action: rest[2] };
    }
    if (rest[2] === "tool" && rest.length === 4 && rest[3]) {
      try {
        return { ...base, sessionId, action: "tool", callId: decodeURIComponent(rest[3]) };
      } catch {
        return undefined;
      }
    }
    return { ...base, sessionId, action: rest[2] ?? "page" };
  }
  return undefined;
}

function groupedFilePath(route) {
  const path = String(route.filePath ?? "");
  if (!route.folder) return path;
  if (!path || path === route.folder || path.startsWith(`${route.folder}/`)) return path;
  return `${route.folder}/${path}`;
}

function isProjectAware(backend) {
  return typeof backend.listProjects === "function" && Boolean(backend.defaultProject);
}

function isFileAware(backend) {
  return isProjectAware(backend)
    && typeof backend.listProjectFiles === "function"
    && typeof backend.readProjectFile === "function"
    && typeof backend.openProjectFile === "function";
}

function contentDisposition(mode, name) {
  const kind = mode === "inline" ? "inline" : "attachment";
  const fallback = String(name ?? "file").replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(String(name ?? "file"))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function isHtmx(req) {
  return String(req.headers["hx-request"] ?? "").toLowerCase() === "true";
}

function isNavigateResult(result) {
  return Boolean(
    result
    && typeof result === "object"
    && result.kind === "navigate"
    && (result.id || (result.action === "close" && result.id === null)),
  );
}

async function closeNavigationLocation(
  basePath,
  backend,
  closed,
  { closedSessionId = "", rememberedSessionIds = [] } = {},
) {
  if (closed?.id) {
    return routes(basePath, closed.id, closed.project, closed.folder).canonical;
  }

  let remaining = [];
  if (typeof backend.list === "function") {
    try {
      const listed = await backend.list();
      if (Array.isArray(listed)) remaining = listed;
    } catch {
      /* the projects chair remains a safe fallback when discovery is unavailable */
    }
  }
  const closingId = String(closedSessionId ?? "");
  const liveRow = (sessionId) => {
    const id = String(sessionId ?? "");
    if (!id || id === closingId) return undefined;
    return remaining.find((row) => String(row?.id ?? "") === id);
  };
  for (const remembered of rememberedSessionIds) {
    const row = liveRow(remembered);
    if (row) return routes(basePath, row.id, row.project, row.folder).canonical;
  }
  const first = remaining.find((row) => row?.id && String(row.id) !== closingId);
  if (first) return routes(basePath, first.id, first.project, first.folder).canonical;
  return `${basePath}/projects`;
}

function sseEvent(name, data) {
  const lines = String(data).replaceAll("\r", "").split("\n");
  return `event: ${name}\n${lines.map((line) => `data: ${line}`).join("\n")}\n\n`;
}

function errorStatus(error) {
  return Number.isInteger(error?.status) ? error.status : 503;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isQqService(backend) {
  return Boolean(
    backend &&
    typeof backend.read === "function" &&
    typeof backend.list === "function" &&
    typeof backend.create === "function" &&
    typeof backend.prompt === "function" &&
    typeof backend.interrupt === "function" &&
    typeof backend.close === "function",
  );
}

function overlaySaveChoice(form) {
  const choice = String(form?.get?.("choice") ?? "").trim();
  return choice === "keep" || choice === "good";
}

function compilingFindPrompt(prompt, sessionId, inFindMode) {
  const trimmed = String(prompt ?? "").trim();
  if (!trimmed) return false;
  const match = /^\/find(?:[\t ]+(.*))?$/su.exec(trimmed);
  if (match) return Boolean(String(match[1] ?? "").trim());
  if (trimmed.startsWith("/")) return false;
  return typeof inFindMode === "function" && inFindMode(sessionId) === true;
}

/** Build one HTTP handler over the qq session service. */
export function createConsoleHandler(backend, options = {}) {
  if (!isQqService(backend)) {
    throw new Error("qq-ui: a qq session service is required");
  }
  const basePath = normalizeBasePath(options.basePath);
  const ssePollMs = positiveInteger(options.ssePollMs, DEFAULT_SSE_POLL_MS, "ssePollMs");
  const liveAssets = options.liveAssets === true;
  // Production always uses the monotonic Performance API. The option is a
  // narrow proof seam so phase boundaries can be deterministic without sleeps.
  const performanceNow = typeof options.performanceNow === "function"
    ? options.performanceNow
    : () => performance.now();
  const timingNow = () => {
    const value = Number(performanceNow());
    return Number.isFinite(value) ? value : 0;
  };
  const roundedTiming = (value) => {
    const finite = Number.isFinite(value) ? Math.max(0, value) : 0;
    return Number(finite.toFixed(3));
  };
  const timingDuration = (startedAt) => roundedTiming(timingNow() - startedAt);
  const addTimingDuration = (left, right) => {
    const total = left + right;
    return Number.isFinite(total) ? roundedTiming(total) : Number.MAX_VALUE;
  };
  const emptySwitchServerTimings = () => Object.fromEntries(
    SESSION_SWITCH_SERVER_TIMING_FIELDS.map((field) => [field, 0]),
  );
  const latencyPersistence = options.latencyPersistence !== false;
  const latencyPath = `${basePath}/ui-latency`;
  const latencyStore = latencyPersistence
    ? createLatencyStore({ path: options.latencyLogPath, maxBytes: options.latencyLogMaxBytes })
    : null;
  const assetsPrefix = `${basePath}/assets/`;
  const sessionsPath = `${basePath}/sessions`;
  const switchSessionPath = `${sessionsPath}/open`;
  const assetPaths = Object.freeze({
    htmx: `${assetsPrefix}htmx-2.0.10.min.js`,
    sse: `${assetsPrefix}htmx-ext-sse-2.2.4.js`,
    css: `${assetsPrefix}console.css`,
    browser: `${assetsPrefix}browser.js`,
    icon192: `${assetsPrefix}icon-v2-192.png`,
    icon512: `${assetsPrefix}icon-v2-512.png`,
    manifest: `${assetsPrefix}manifest-v3.webmanifest`,
    serviceWorker: `${basePath}/sw.js`,
    latencyEndpoint: latencyPersistence ? latencyPath : "",
  });
  const pageAssetPaths = () => Object.freeze({
    ...assetPaths,
    uiGeneration: readUiGeneration(liveAssets),
    uiRevision: liveAssets ? formatUiRevision(readUiRevision()) : BOOT_REVISION_LABEL,
  });
  const streams = new Set();
  const initialSnapshotHandoffs = options.initialSnapshotHandoffs
    ?? createInitialSnapshotHandoffStore();
  if (!initialSnapshotHandoffs
    || typeof initialSnapshotHandoffs.issue !== "function"
    || typeof initialSnapshotHandoffs.consume !== "function"
    || typeof initialSnapshotHandoffs.discard !== "function"
    || typeof initialSnapshotHandoffs.clear !== "function") {
    throw new Error("qq-ui: invalid initial snapshot handoff store");
  }
  const findWork = new Map();
  let lastViewedSessionId = "";
  const readOffer = typeof options.offerFor === "function" ? options.offerFor : null;
  const chooseOffer = typeof options.chooseOffer === "function" ? options.chooseOffer : null;
  const readCase = typeof options.caseFor === "function" ? options.caseFor : null;
  const readApproval = typeof options.approvalFor === "function" ? options.approvalFor : null;
  const decideApproval = typeof options.decideApproval === "function" ? options.decideApproval : null;
  const readCaseFile = typeof options.caseFileFor === "function" ? options.caseFileFor : null;
  const readLoginSheet = typeof options.loginSheetFor === "function" ? options.loginSheetFor : null;
  const readOverlay = typeof options.overlayFor === "function" ? options.overlayFor : null;
  const chooseOverlay = typeof options.chooseOverlay === "function" ? options.chooseOverlay : null;
  const readProgress = typeof options.progressFor === "function" ? options.progressFor : null;
  const inFindMode = typeof options.inFindMode === "function" ? options.inFindMode : null;
  const sessionModeFor = typeof options.sessionModeFor === "function" ? options.sessionModeFor : null;
  const workflowsFor = typeof options.workflowsFor === "function" ? options.workflowsFor : null;
  const completeWorkflows = typeof options.completeWorkflows === "function" ? options.completeWorkflows : null;
  const readDashboard = typeof options.dashboardFor === "function" ? options.dashboardFor : null;

  async function withSheets(snapshot) {
    const nextBase = { ...snapshot };
    delete nextBase.dashboard;
    let next = nextBase;
    if (typeof backend.list === "function") {
      try {
        next = { ...next, activeProjects: await backend.list() };
      } catch {
        /* live project list is optional */
      }
    }
    if (readDashboard) {
      try {
        const dashboard = validatedDashboardSnapshot(readDashboard());
        if (dashboard) next = { ...next, dashboard };
      } catch {
        /* optional live tracking renders its unavailable state on provider failure */
      }
    }
    if (snapshot.origin === "subagent") {
      if (readProgress) {
        try {
          const progress = await readProgress(snapshot.id);
          if (progress) next = { ...next, progress };
        } catch {
          /* passive child progress is optional */
        }
      }
      return next;
    }
    if (readCaseFile) {
      try {
        const caseFile = await readCaseFile(snapshot.id);
        if (caseFile) next = { ...next, caseFile };
      } catch {
        /* working memory casefile is optional */
      }
    }
    if (readOffer) {
      try {
        const offer = await readOffer(snapshot.id);
        if (offer) next = { ...next, offer };
      } catch {
        /* leftover offer is optional */
      }
    }
    if (readCase) {
      try {
        const caseFile = await readCase(snapshot.id);
        if (caseFile) next = { ...next, caseFile };
      } catch {
        /* architect case file is optional */
      }
    }
    if (readApproval) {
      try {
        const approval = await readApproval(snapshot.id);
        if (approval) next = { ...next, approval };
      } catch {
        /* pending approval is optional */
      }
    }
    if (readLoginSheet) {
      try {
        const loginSheet = await readLoginSheet(snapshot.id);
        if (loginSheet) next = { ...next, loginSheet };
      } catch {
        /* login sheet is optional */
      }
    }
    if (readOverlay) {
      try {
        const overlay = await readOverlay(snapshot.id);
        if (overlay) next = { ...next, overlay };
      } catch {
        /* session overlay is optional */
      }
    }
    if (readProgress) {
      try {
        const progress = await readProgress(snapshot.id);
        if (progress) next = { ...next, progress };
      } catch {
        /* download chip is optional */
      }
    }
    const mode = sessionModeFor?.(snapshot.id) ?? (inFindMode?.(snapshot.id) ? "find" : null);
    if (mode) next = { ...next, sessionMode: mode };
    const listed = workflowsFor?.(snapshot.id);
    if (Array.isArray(listed) && listed.length > 0) next = { ...next, workflows: listed };
    const work = findWork.get(snapshot.id);
    if (work) next = { ...next, findWork: work };
    return next;
  }

  async function projectsSessions(snapshot, serverTimings = null) {
    if (snapshot?.origin !== "subagent") {
      return [{
        id: snapshot.id,
        createdAt: snapshot.createdAt ?? 0,
        scope: "projects",
        context: "projects",
        ...(snapshot.alias ? { alias: snapshot.alias } : {}),
      }];
    }
    if (!snapshot.parent) return [];
    const readStartedAt = timingNow();
    try {
      const parent = await backend.read(snapshot.parent);
      if (parent?.origin === "subagent" || parent?.scope !== "projects") return [];
      return [{
        id: parent.id,
        createdAt: parent.createdAt ?? 0,
        scope: "projects",
        context: "projects",
        ...(parent.alias ? { alias: parent.alias } : {}),
      }];
    } catch {
      return [];
    } finally {
      if (serverTimings) {
        serverTimings.serverReadMs = addTimingDuration(
          serverTimings.serverReadMs,
          timingDuration(readStartedAt),
        );
      }
    }
  }

  async function view(sessionId, serverTimings = null) {
    const readStartedAt = timingNow();
    const snapshot = await backend.read(sessionId);
    if (serverTimings) {
      serverTimings.serverReadMs = addTimingDuration(
        serverTimings.serverReadMs,
        timingDuration(readStartedAt),
      );
    }
    const sessionsStartedAt = timingNow();
    const available = snapshot.scope === "home" && typeof backend.listHome === "function"
      ? await backend.listHome()
      : snapshot.scope === "projects"
        ? await projectsSessions(snapshot, serverTimings)
        : await backend.list(snapshot.project, snapshot.folder ?? "");
    if (serverTimings) serverTimings.serverSessionsMs = timingDuration(sessionsStartedAt);
    if (snapshot.id
      && snapshot.origin !== "subagent"
      && !available.some((session) => session.id === snapshot.id)) {
      available.unshift({
        id: snapshot.id,
        createdAt: 0,
        ...(snapshot.scope ? { scope: snapshot.scope } : {}),
        ...(snapshot.project ? { project: snapshot.project } : {}),
        ...(snapshot.folder ? { folder: snapshot.folder } : {}),
      });
    }
    const sheetsStartedAt = timingNow();
    const enriched = await withSheets({ ...snapshot, sessions: available });
    if (serverTimings) serverTimings.serverSheetsMs = timingDuration(sheetsStartedAt);
    return enriched;
  }

  async function assertChairMutation(sessionId) {
    const snapshot = await backend.read(sessionId);
    if (snapshot?.origin !== "subagent") return snapshot;
    const error = new Error("Child sessions are observe-only");
    error.status = 403;
    error.code = "child-observe-only";
    throw error;
  }

  async function projectView(project, folder) {
    const available = await backend.list(project, folder ?? "");
    const meta = backend.listProjects().find((entry) => entry.name === project);
    const folderMeta = folder
      ? (meta?.folders ?? []).find((entry) => entry.name === folder)
      : undefined;
    return withSheets({
      id: "",
      project,
      ...(meta?.label ? { projectLabel: meta.label } : {}),
      ...(folder ? { folder, folderLabel: folderMeta?.label ?? folder } : {}),
      sessions: available,
      events: [],
      agentStatus: "idle",
    });
  }

  async function drawerView(project, url, forceClosed = false, folder = "") {
    if (!isFileAware(backend)) return undefined;
    const requested = !forceClosed && url.searchParams.has("drawer");
    const wanted = requested ? String(url.searchParams.get("drawer") ?? "") : (folder || "");
    let listing;
    if (requested && (wanted === "" || wanted === "~")) {
      listing = await backend.listProjectFiles();
    } else if (wanted.startsWith("~/")) {
      const rest = wanted.slice(2);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const inner = slash === -1 ? "" : rest.slice(slash + 1);
      listing = await backend.listProjectFiles(name, inner);
    } else {
      listing = await backend.listProjectFiles(project, wanted);
    }
    return { ...listing, open: requested };
  }

  function locationFor(snapshot) {
    return routes(basePath, snapshot?.id, snapshot?.project, snapshot?.folder).canonical;
  }

  async function liveLocation(sessionId) {
    if (typeof backend.inspect === "function") {
      const info = await backend.inspect(sessionId);
      if (info.live === false) {
        const error = new Error("DSH session is not active");
        error.status = 404;
        error.code = "inactive";
        throw error;
      }
      return routes(basePath, info.id, info.project, info.folder).canonical;
    }
    const snapshot = await backend.read(sessionId);
    return locationFor(snapshot);
  }

  function inspectedRootLocation(sessionId) {
    if (!sessionId || typeof backend.inspectAgent !== "function") return "";
    try {
      // qq-core's live-agent lookup is deliberately synchronous. Do not await
      // an incompatible thenable here: root routing must not acquire an async
      // persistence lookup through a similarly named fixture method.
      const row = backend.inspectAgent(sessionId);
      if (row && typeof row.then === "function") {
        row.catch?.(() => {});
        return "";
      }
      if (!row || row.live === false || String(row.id ?? "") !== sessionId) return "";
      // Current qq-core agent rows prove liveness but expose only cwd identity.
      // The legacy session route canonicalizes project/folder/child identity
      // through inspect() without loading a transcript. Richer fixtures may
      // already provide project metadata and can skip that extra redirect.
      return routes(basePath, row.id, row.project, row.folder).canonical;
    } catch {
      return "";
    }
  }

  async function rootLiveLocation(remembered) {
    const inspected = inspectedRootLocation(remembered);
    if (inspected) return inspected;

    // list() is live-only metadata in qq-core and is the compatibility path for
    // older fixtures. In particular, never use read() to validate a stale root
    // cookie: that can scan and project an entire persisted transcript.
    const listed = typeof backend.list === "function" ? await backend.list() : [];
    const rows = Array.isArray(listed) ? listed : [];
    const rememberedRow = remembered
      ? rows.find((row) => String(row?.id ?? "") === remembered)
      : undefined;
    const row = rememberedRow ?? rows.find((candidate) => candidate?.id);
    return row ? routes(basePath, row.id, row.project, row.folder).canonical : "";
  }

  async function assertChairMutation(sessionId) {
    const snapshot = await backend.read(sessionId);
    if (snapshot?.origin !== "subagent") return snapshot;
    const error = new Error("Child sessions are observe-only");
    error.status = 403;
    error.code = "child-observe-only";
    throw error;
  }

  function isMissingSession(error) {
    if (errorStatus(error) !== 404) return false;
    const code = error?.code;
    return code === "inactive" || code === "not-found" || code === undefined;
  }

  async function liveProjectLocation(project, folder, search = "") {
    const rows = typeof backend.list === "function"
      ? await backend.list(project, folder ?? "")
      : [];
    if (rows[0]?.id) {
      return `${routes(basePath, rows[0].id, project, folder).canonical}${search}`;
    }
    return `${routes(basePath, "", project, folder).canonical}${search}`;
  }

  const SHEET_KEYS = Object.freeze([
    "caseFile", "offer", "approval", "loginSheet", "overlay", "progress",
    "sessionMode", "workflows", "activeProjects", "findWork", "dashboard",
  ]);

  function sheetFields(snapshot) {
    const sheets = {};
    for (const key of SHEET_KEYS) {
      if (snapshot?.[key] !== undefined) sheets[key] = snapshot[key];
    }
    return sheets;
  }

  async function loadSheets(snapshot) {
    return sheetFields(await withSheets(snapshot));
  }

  function watch(sessionId, listener, extra = {}) {
    if (typeof backend.observe !== "function") {
      throw new Error("qq-ui: qq service observe() is required");
    }
    const { initialSnapshot = null, ...observeOptions } = extra;
    const intervalMs = observeOptions.intervalMs ?? ssePollMs;
    const hasSheets = Boolean(
      typeof backend.list === "function"
      || readCaseFile || readOffer || readOverlay || readProgress || readApproval || readLoginSheet
      || inFindMode || sessionModeFor || workflowsFor || readCase || readDashboard,
    );
    let cancelled = false;
    let sheets = sheetFields(initialSnapshot);
    let lastSnapshot = initialSnapshot;
    const deliver = (snapshot) => {
      if (cancelled || !snapshot) return;
      try { listener(null, { ...snapshot, ...sheets }); } catch {}
    };
    const stopObserve = backend.observe(sessionId, (error, snapshot) => {
      if (cancelled) return;
      if (error) {
        try { listener(error); } catch {}
        return;
      }
      lastSnapshot = snapshot;
      deliver(snapshot);
    }, { ...observeOptions, intervalMs });
    let timer;
    let sheetFp;
    const tickSheets = async () => {
      if (cancelled || !hasSheets) return;
      if (lastSnapshot) {
        try {
          const next = await loadSheets(lastSnapshot);
          const fingerprint = JSON.stringify(next);
          if (fingerprint !== sheetFp) {
            sheetFp = fingerprint;
            sheets = next;
            deliver(lastSnapshot);
          }
        } catch (error) {
          try { listener(error); } catch {}
        }
      }
      if (cancelled) return;
      timer = setTimeout(tickSheets, intervalMs);
      timer.unref?.();
    };
    if (hasSheets) void tickSheets();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      try { stopObserve?.(); } catch {}
    };
  }

  function navigationResponse(req, res, location, head = false) {
    if (isHtmx(req)) {
      write(
        res,
        200,
        { "HX-Redirect": location, "Content-Type": "text/plain; charset=utf-8" },
        "Open session\n",
        head,
      );
      return;
    }
    write(
      res,
      303,
      { Location: location, "Content-Type": "text/plain; charset=utf-8" },
      "See other\n",
      head,
    );
  }

  async function fallbackProjectsResponse(req, res, head = false, url = null) {
    const search = url?.search ?? "";
    if (typeof backend.createProjects === "function") {
      try {
        const projects = await backend.createProjects();
        navigationResponse(req, res, `${routes(basePath, projects.id).canonical}${search}`, head);
        return true;
      } catch {}
    }
    if (typeof backend.list === "function") {
      try {
        const rows = await backend.list();
        if (rows.length > 0) {
          const location = `${routes(basePath, rows[0].id, rows[0].project, rows[0].folder).canonical}${search}`;
          navigationResponse(req, res, location, head);
          return true;
        }
      } catch {}
    }
    if (isProjectAware(backend)) {
      try {
        const homeProject = encodeProject(backend.defaultProject);
        const homeFolder = backend.defaultFolder ? `/${encodeProject(backend.defaultFolder)}` : "";
        navigationResponse(req, res, `${basePath}/project/${homeProject}${homeFolder}${search}`, head);
        return true;
      } catch {}
    }
    return false;
  }

  async function conflictResponse(req, res, sessionId, message) {
    const snapshot = await view(sessionId);
    const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
    if (isHtmx(req)) {
      const { renderMutationOob } = await loadRender();
      const body = renderMutationOob(snapshot, paths, message);
      write(res, 409, { "Content-Type": "text/html; charset=utf-8" }, body);
      return;
    }
    text(res, 409, message);
  }

  const bundledRender = Object.freeze({
    codeDispatchNodes: bundledCodeDispatchNodes,
    renderDocumentViewerProofPage: bundledRenderDocumentViewerProofPage,
    renderFilePage: bundledRenderFilePage,
    renderPage: bundledRenderPage,
    renderSessionContent: bundledRenderSessionContent,
    renderSessionRegion: bundledRenderSessionRegion,
    renderTranscriptJunction: bundledRenderTranscriptJunction,
    renderSettledTranscriptAppend: bundledRenderSettledTranscriptAppend,
    transcriptSettledInner: bundledTranscriptSettledInner,
    renderLiveNodes: bundledRenderLiveNodes,
    renderComposer: bundledRenderComposer,
    renderToolBody: bundledRenderToolBody,
    liveTranscriptUpdate: bundledLiveTranscriptUpdate,
    renderMutationOob: bundledRenderMutationOob,
    MUTATION_REGION_NAMES: bundledMutationRegionNames,
    PROMPT_MUTATION_REGION_NAMES: bundledPromptMutationRegionNames,
    regionFingerprints: bundledRegionFingerprints,
    SSE_REGION_NAMES: bundledSseRegionNames,
  });
  let liveRender = bundledRender;
  let liveRenderStamp = 0;
  let liveRenderFromDisk = false;

  async function loadRender() {
    if (!liveAssets) return bundledRender;
    for (;;) {
      let stamp;
      try {
        stamp = statSync(RENDER_FILE).mtimeMs;
      } catch (error) {
        if (liveRenderFromDisk) return liveRender;
        throw error;
      }
      if (liveRenderFromDisk && stamp === liveRenderStamp) return liveRender;
      try {
        const mod = await import(`${pathToFileURL(RENDER_FILE).href}?t=${stamp}`);
        const latest = statSync(RENDER_FILE).mtimeMs;
        if (latest !== stamp) continue;
        liveRender = mod;
        liveRenderStamp = stamp;
        liveRenderFromDisk = true;
        return mod;
      } catch (error) {
        if (liveRenderFromDisk) return liveRender;
        throw error;
      }
    }
  }

  async function mutationResponse(req, res, sessionId, notice = "", regions) {
    const snapshot = await view(sessionId);
    const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
    if (isHtmx(req)) {
      const { renderMutationOob, PROMPT_MUTATION_REGION_NAMES } = await loadRender();
      const body = renderMutationOob(
        snapshot,
        paths,
        notice,
        regions ?? PROMPT_MUTATION_REGION_NAMES ?? bundledPromptMutationRegionNames,
      );
      write(res, 200, { "Content-Type": "text/html; charset=utf-8" }, body);
      return;
    }
    write(
      res,
      303,
      { Location: paths.canonical, "Content-Type": "text/plain; charset=utf-8" },
      "See other\n",
    );
  }

  async function consoleHandler(req, res) {
    const head = req.method === "HEAD";
    let url;
    try {
      url = new URL(req.url ?? basePath, "http://qq-ui.invalid");
    } catch {
      text(res, 400, "Malformed request URL", head);
      return;
    }

    if (url.pathname === latencyPath) {
      if (!latencyPersistence) {
        text(res, 404, "Passive latency persistence is disabled", head);
        return;
      }
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      if (!sameOrigin(req)) {
        text(res, 403, "Cross-origin latency ingestion refused");
        return;
      }
      try {
        const batch = sanitizeLatencyBatch(await readJsonBody(req));
        const maximum = (entries) => entries.reduce((result, entry) => Math.max(result, entry.sequence), 0);
        const cursors = {
          origins: maximum(batch.origins),
          stages: maximum(batch.stages),
          visuals: maximum(batch.visuals),
        };
        // Browser metadata is frozen before this request is acknowledged. The
        // persisted log can safely record the final accepted cursors so the
        // latest health line is not one successful batch behind.
        const storedBatch = batch.health ? {
          ...batch,
          health: {
            ...batch.health,
            acknowledged: Object.fromEntries(["origins", "stages", "visuals"].map((kind) => [
              kind,
              Math.max(batch.health.acknowledged[kind], cursors[kind]),
            ])),
          },
        } : batch;
        const stored = await latencyStore.append(storedBatch);
        json(res, 200, {
          schema: "qq.visual-latency-ack/v1",
          accepted: true,
          duplicate: stored.duplicate,
          runId: batch.runId,
          batchId: batch.batchId,
          cursors,
        });
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (url.pathname === `${basePath}/health` && (req.method === "GET" || head)) {
      const revision = liveAssets ? readUiRevision() : BOOT_REVISION;
      write(
        res,
        200,
        { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
        JSON.stringify({
          generation: readUiGeneration(liveAssets),
          revision: revision.sha,
          dirty: revision.dirty,
          pid: process.pid,
          startedAt: BOOT_STARTED_AT,
        }),
        head,
      );
      return;
    }

    if (url.pathname === basePath && (req.method === "GET" || head)) {
      write(
        res,
        308,
        { Location: `${basePath}/${url.search}`, "Content-Type": "text/plain; charset=utf-8" },
        "Permanent redirect\n",
        head,
      );
      return;
    }

    const serviceWorkerName = url.pathname.startsWith(`${basePath}/`)
      ? url.pathname.slice(basePath.length + 1)
      : "";
    if (SERVICE_WORKER_NAMES.has(serviceWorkerName)) {
      if (req.method !== "GET" && !head) {
        write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      const asset = bundledAssets[serviceWorkerName];
      write(
        res,
        200,
        {
          "Content-Type": asset.type,
          "Content-Length": String(asset.body.length),
          "Service-Worker-Allowed": `${basePath}/`,
        },
        asset.body,
        head,
      );
      return;
    }

    if (url.pathname.startsWith(assetsPrefix)) {
      if (req.method !== "GET" && !head) {
        write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      const name = url.pathname.slice(assetsPrefix.length);
      if (name === "manifest-v3.webmanifest") {
        const manifest = JSON.stringify({
          id: `${basePath}/`,
          name: "qq",
          short_name: "qq",
          description: "A network-only operator surface for durable DSH sessions.",
          start_url: `${basePath}/`,
          scope: `${basePath}/`,
          display: "standalone",
          background_color: "#000000",
          theme_color: "#000000",
          icons: [
            { src: assetPaths.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
            { src: assetPaths.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
          ],
        });
        write(res, 200, { "Content-Type": "application/manifest+json; charset=utf-8" }, manifest, head);
        return;
      }
      const asset = resolveAsset(name, liveAssets);
      if (!asset || name.includes("/") || SERVICE_WORKER_NAMES.has(name)) {
        text(res, 404, "Not found", head);
        return;
      }
      write(
        res,
        200,
        {
          "Cache-Control": asset.live ? "no-store" : "public, max-age=31536000, immutable",
          "Content-Type": asset.type,
          "Content-Length": String(asset.body.length),
        },
        asset.body,
        head,
      );
      return;
    }

    if (url.pathname === switchSessionPath && (req.method === "GET" || head)) {
      try {
        const sessionId = String(url.searchParams.get("session") ?? "");
        navigationResponse(req, res, await liveLocation(sessionId), head);
      } catch (error) {
        if (await fallbackProjectsResponse(req, res, head, url)) return;
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`, head);
      }
      return;
    }

    if (url.pathname === `${basePath}/home` && (req.method === "GET" || head)) {
      try {
        if (typeof backend.latestHome === "function") {
          const existing = await backend.latestHome();
          if (existing?.id) {
            navigationResponse(req, res, `${routes(basePath, existing.id).canonical}${url.search}`, head);
            return;
          }
        }
        if (typeof backend.createHome === "function") {
          const created = await backend.createHome();
          navigationResponse(req, res, `${routes(basePath, created.id).canonical}${url.search}`, head);
          return;
        }
        write(
          res,
          303,
          { Location: `${basePath}/${url.search}`, "Content-Type": "text/plain; charset=utf-8" },
          "See other\n",
          head,
        );
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error), head);
      }
      return;
    }

    if (url.pathname === `${basePath}/projects` && (req.method === "GET" || head)) {
      if (typeof backend.createProjects !== "function") {
        text(res, 404, "Not found", head);
        return;
      }
      try {
        const created = await backend.createProjects();
        const location = `${routes(basePath, created.id).canonical}${url.search}`;
        write(
          res,
          303,
          { Location: location, "Content-Type": "text/plain; charset=utf-8" },
          "See other\n",
          head,
        );
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error), head);
      }
      return;
    }

    async function createAt(projectName, folderName) {
      if (!sameOrigin(req)) {
        const error = new Error("Cross-origin form submission refused");
        error.status = 403;
        throw error;
      }
      await readForm(req);
      const created = await backend.create(projectName, folderName);
      navigationResponse(req, res, routes(basePath, created.id, created.project, created.folder).canonical);
    }

    if (url.pathname === sessionsPath) {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        await createAt(
          isProjectAware(backend) ? backend.defaultProject : undefined,
          isProjectAware(backend) ? backend.defaultFolder : undefined,
        );
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    let projectRoute = parseProjectRoute(basePath, url.pathname);
    if (projectRoute) {
      if (!isProjectAware(backend)) {
        text(res, 404, "Not found", head);
        return;
      }
      const catalog = backend.listProjects();
      let known = catalog.find((entry) => entry.name === projectRoute.project);
      if (!known) {
        text(res, 404, "qq: project not found", head);
        return;
      }
      if (projectRoute.folder && !(known.folders ?? []).some((entry) => entry.name === projectRoute.folder)) {
        const child = catalog.find((entry) => entry.name === projectRoute.folder);
        if (!child) {
          text(res, 404, "qq: project folder not found", head);
          return;
        }
        projectRoute = { ...projectRoute, project: child.name, folder: undefined };
        known = child;
      }
      if (projectRoute.action === "file") {
        if (req.method !== "GET" && !head) {
          write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
          return;
        }
        const paths = routes(basePath, projectRoute.sessionId ?? "", projectRoute.project, projectRoute.folder);
        let file;
        let fileError;
        try {
          file = await backend.readProjectFile(projectRoute.project, groupedFilePath(projectRoute));
        } catch (error) {
          fileError = error;
        }
        try {
          const { renderFilePage } = await loadRender();
          const body = renderFilePage({
            project: projectRoute.project,
            path: projectRoute.filePath,
            name: String(projectRoute.filePath).split("/").at(-1),
            file,
            error: fileError,
          }, paths, pageAssetPaths());
          write(
            res,
            fileError ? errorStatus(fileError) : 200,
            { "Content-Type": "text/html; charset=utf-8" },
            body,
            head,
          );
        } catch (error) {
          text(res, errorStatus(error), errorMessage(error), head);
        }
        return;
      }
      if (projectRoute.action === "open") {
        if (req.method !== "GET" && !head) {
          write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
          return;
        }
        try {
          const opened = await backend.openProjectFile(projectRoute.project, groupedFilePath(projectRoute), { includeBody: !head });
          write(res, 200, {
            "Content-Type": opened.mediaType,
            "Content-Length": String(opened.size),
            "Content-Disposition": contentDisposition(opened.disposition, opened.name),
          }, opened.body ?? Buffer.alloc(0), head);
        } catch (error) {
          text(res, errorStatus(error), errorMessage(error), head);
        }
        return;
      }
      if (projectRoute.action === "download") {
        if (req.method !== "GET" && !head) {
          write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
          return;
        }
        try {
          const downloadHandler = typeof backend.downloadProjectFile === "function"
            ? backend.downloadProjectFile.bind(backend)
            : backend.openProjectFile.bind(backend);
          const downloaded = await downloadHandler(projectRoute.project, groupedFilePath(projectRoute), { includeBody: !head });
          write(res, 200, {
            "Content-Type": downloaded.mediaType ?? "application/octet-stream",
            "Content-Length": String(downloaded.size),
            "Content-Disposition": contentDisposition("attachment", downloaded.name),
          }, downloaded.body ?? Buffer.alloc(0), head);
        } catch (error) {
          text(res, errorStatus(error), errorMessage(error), head);
        }
        return;
      }
      if (projectRoute.action === "create") {
        if (req.method !== "POST") {
          write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
          return;
        }
        try {
          await createAt(projectRoute.project, projectRoute.folder);
        } catch (error) {
          text(res, errorStatus(error), errorMessage(error));
        }
        return;
      }
      if (projectRoute.action === "project" && (req.method === "GET" || head)) {
        try {
          const rows = await backend.list(projectRoute.project, projectRoute.folder ?? "");
          if (rows[0]) {
            write(
              res,
              303,
              {
                Location: routes(basePath, rows[0].id, projectRoute.project, projectRoute.folder).canonical + url.search,
                "Content-Type": "text/plain; charset=utf-8",
              },
              "See other\n",
              head,
            );
            return;
          }
          const snapshot = await projectView(projectRoute.project, projectRoute.folder);
          const paths = routes(basePath, "", projectRoute.project, projectRoute.folder);
          const drawer = await drawerView(projectRoute.project, url, false, projectRoute.folder);
          const { renderPage } = await loadRender();
          const body = renderPage(consoleFoldWindow({ ...snapshot, drawer }), paths, pageAssetPaths());
          write(res, 200, { "Content-Type": "text/html; charset=utf-8" }, body, head);
        } catch (error) {
          text(res, errorStatus(error), errorMessage(error), head);
        }
        return;
      }
    }

    const selected = projectRoute?.sessionId
      ? projectRoute
      : parseSessionRoute(basePath, url.pathname);
    const rootPage = url.pathname === `${basePath}/`;
    if ((rootPage || selected?.action === "page") && (req.method === "GET" || head)) {
      try {
        if (rootPage && isProjectAware(backend)) {
          const remembered = lastSessionCookie(req) || lastViewedSessionId;
          const liveRoot = await rootLiveLocation(remembered);
          if (liveRoot) {
            write(
              res,
              303,
              { Location: `${liveRoot}${url.search}`, "Content-Type": "text/plain; charset=utf-8" },
              "See other\n",
              head,
            );
            return;
          }
          if (typeof backend.createHome === "function" || typeof backend.latestHome === "function") {
            write(
              res,
              303,
              {
                Location: `${basePath}/home${url.search}`,
                "Content-Type": "text/plain; charset=utf-8",
              },
              "See other\n",
              head,
            );
            return;
          }
          text(res, 404, "No live session", head);
          return;
        }
        if (selected?.sessionId && isProjectAware(backend) && !projectRoute) {
          const location = await liveLocation(selected.sessionId);
          const current = `${basePath}/session/${encodeURIComponent(selected.sessionId)}`;
          if (location !== current) {
            navigationResponse(req, res, `${location}${url.search}`, head);
            return;
          }
        }
        const sessionId = rootPage ? backend.defaultSessionId : selected.sessionId;
        const serverViewStartedAt = performance.now();
        const snapshot = await view(sessionId);
        if (projectRoute && snapshot.project && snapshot.project !== projectRoute.project) {
          text(res, 404, "DSH session is not in this project", head);
          return;
        }
        if (projectRoute?.folder && snapshot.folder && projectRoute.folder !== snapshot.folder) {
          text(res, 404, "DSH session is not in this project", head);
          return;
        }
        if (projectRoute?.sessionId && snapshot.folder && !projectRoute.folder) {
          navigationResponse(req, res, routes(basePath, snapshot.id, snapshot.project, snapshot.folder).canonical + url.search, head);
          return;
        }
        const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
        const drawer = await drawerView(snapshot.project, url, false, snapshot.folder);
        const pageSnapshot = consoleFoldWindow({ ...snapshot, drawer });
        const serverViewDuration = Math.max(0, performance.now() - serverViewStartedAt);
        const serverRenderStartedAt = performance.now();
        const { renderPage } = await loadRender();
        let handoffToken = "";
        if (!head && snapshot.id && paths.events) {
          handoffToken = initialSnapshotHandoffs.issue(
            snapshotHandoffBinding(snapshot.id, snapshot.project, snapshot.folder),
            pageSnapshot,
          );
        }
        const pagePaths = handoffToken
          ? Object.freeze({ ...paths, events: eventsWithSnapshotHandoff(paths.events, handoffToken) })
          : paths;
        let body;
        try {
          body = renderPage(pageSnapshot, pagePaths, pageAssetPaths());
        } catch (error) {
          if (handoffToken) initialSnapshotHandoffs.discard(handoffToken);
          throw error;
        }
        const serverRenderDuration = Math.max(0, performance.now() - serverRenderStartedAt);
        if (snapshot.id) lastViewedSessionId = snapshot.id;
        try {
          write(
            res,
            200,
            rememberSessionHeaders(snapshot.id, {
              "Content-Type": "text/html; charset=utf-8",
              // Fixed privacy-safe phases only: no descriptions, route values, or
              // session identifiers are exposed through Server-Timing.
              "Server-Timing": `qq-view;dur=${serverViewDuration.toFixed(3)}, qq-render;dur=${serverRenderDuration.toFixed(3)}`,
            }),
            body,
            head,
          );
        } catch (error) {
          if (handoffToken) initialSnapshotHandoffs.discard(handoffToken);
          throw error;
        }
      } catch (error) {
        if (await fallbackProjectsResponse(req, res, head, url)) return;
        if (projectRoute?.project && isMissingSession(error)) {
          try {
            navigationResponse(req, res, await liveProjectLocation(projectRoute.project, projectRoute.folder, url.search), head);
            return;
          } catch {
            /* fall through to the unavailable page */
          }
        }
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`, head);
      }
      return;
    }

    if (selected?.action === "events") {
      if (req.method !== "GET") {
        write(res, 405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      const bootstrapSession = url.searchParams.get("bootstrap") === "session";
      const switchValue = String(url.searchParams.get("switch") ?? "");
      const switchGeneration = /^\d+$/.test(switchValue) && Number.isSafeInteger(Number(switchValue))
        ? Number(switchValue)
        : switchValue;
      let snapshot;
      const serverTimings = bootstrapSession ? emptySwitchServerTimings() : null;
      let handedOffSnapshot = false;
      let handoffRender = null;
      try {
        // A live-switch bootstrap always proves fresh destination truth. Only a
        // page's ordinary initial EventSource may consume its one-shot handoff.
        if (!bootstrapSession) {
          snapshot = initialSnapshotHandoffs.consume(
            url.searchParams.get(INITIAL_SNAPSHOT_HANDOFF_PARAMETER),
            snapshotHandoffBinding(selected.sessionId, projectRoute?.project, projectRoute?.folder),
          );
          handedOffSnapshot = snapshot !== null;
        }
        if (!snapshot) {
          const viewStartedAt = timingNow();
          snapshot = await view(selected.sessionId, serverTimings);
          if (serverTimings) serverTimings.serverViewMs = timingDuration(viewStartedAt);
        }
        if (projectRoute && snapshot.project && snapshot.project !== projectRoute.project) {
          text(res, 404, "DSH session is not in this project");
          return;
        }
        if (projectRoute?.folder && snapshot.folder && projectRoute.folder !== snapshot.folder) {
          text(res, 404, "DSH session is not in this project");
          return;
        }
        if (handedOffSnapshot) handoffRender = await loadRender();
      } catch (error) {
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`);
        return;
      }
      const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
      const streamHeaders = {
        ...SECURITY_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      };
      res.writeHead(200, bootstrapSession
        ? rememberSessionHeaders(snapshot.id, streamHeaders)
        : streamHeaders);
      res.flushHeaders?.();
      res.socket?.setNoDelay?.(true);
      // Authoritative post-open wall phase starts at the first server work after
      // headers and includes observer/bootstrap setup through ready creation.
      const serverCriticalStartedAt = bootstrapSession ? timingNow() : null;
      if (bootstrapSession && snapshot.id) lastViewedSessionId = snapshot.id;
      let closed = false;
      let keepalive;
      let stop;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        try { stop?.(); } catch {}
        streams.delete(res);
        if (!res.writableEnded && !res.destroyed) {
          try { res.end(); } catch {}
        }
      };
      streams.add(res);
      req.once("close", close);
      res.once("close", close);
      let fingerprints = {};
      let liveState = null;
      let settledKeys = null;
      let initialized = false;
      let lastUiGeneration = readUiGeneration(liveAssets);
      let tick = Promise.resolve();
      let bootstrapping = bootstrapSession;
      let bufferedObservation = null;
      if (handedOffSnapshot) {
        // Commit the exact object rendered into the page as this stream's
        // baseline. The immediately attached observer can now reconcile only
        // later truth instead of repainting the page or calling view() again.
        const append = handoffRender.renderSettledTranscriptAppend(null, snapshot);
        liveState = handoffRender.liveTranscriptUpdate(null, snapshot).state;
        fingerprints = handoffRender.regionFingerprints(snapshot);
        settledKeys = append.keys;
        initialized = true;
      }
      if (!bootstrapSession) res.write(sseEvent("ui", lastUiGeneration));
      const writeLiveFrames = (next) => {
        if (closed || res.destroyed || res.writableEnded) return;
        const liveUpdate = liveRender.liveTranscriptUpdate(liveState, next);
        liveState = liveUpdate.state;
        if (liveUpdate.frames.length === 0) return;
        for (const frame of liveUpdate.frames) {
          res.write(sseEvent(frame.event, frame.data));
        }
        if (typeof res.flush === "function") res.flush();
      };
      const writeObservation = (error, next) => {
        if (closed || res.destroyed || res.writableEnded) {
          close();
          return;
        }
        if (error) {
          res.write(sseEvent("console-error", errorMessage(error)));
          close();
          return;
        }
        // Token frames must not wait behind loadRender or chrome HTML. The
        // observe callback is the session/event hot path. Console sees the
        // same two-pair window as first paint.
        const surface = consoleFoldWindow(next);
        writeLiveFrames(surface);
        tick = tick.then(async () => {
          if (closed || res.destroyed || res.writableEnded) {
            close();
            return;
          }
          let render;
          try {
            render = await loadRender();
          } catch {
            return;
          }
          const nextFp = render.regionFingerprints(surface);
          const append = typeof render.renderSettledTranscriptAppend === "function"
            ? render.renderSettledTranscriptAppend(settledKeys, surface)
            : { keys: settledKeys, html: "" };
          const initial = !initialized;
          const changed = render.SSE_REGION_NAMES.filter((name) =>
            name !== "live" && name !== "transcript" && nextFp[name] !== fingerprints[name]);
          // Ordinary growth is already painted node-by-node by writeLiveFrames.
          // Only a surface replace recommissions the settled prefix.
          const transcriptHtml = !initial && append.reset ? append.html : "";
          const generation = readUiGeneration(liveAssets);
          const uiChanged = generation !== lastUiGeneration;
          if (changed.length === 0 && !transcriptHtml && !uiChanged) {
            fingerprints = nextFp;
            settledKeys = append.keys;
            initialized = true;
            return;
          }
          const { renderSessionRegion } = render;
          for (const name of changed) {
            res.write(sseEvent(name, renderSessionRegion(name, surface, paths)));
          }
          if (transcriptHtml) {
            res.write(sseEvent(append.reset ? "transcript-reset" : "transcript", transcriptHtml));
          }
          if (uiChanged) {
            res.write(sseEvent("ui", generation));
            lastUiGeneration = generation;
          }
          if (typeof res.flush === "function") res.flush();
          fingerprints = nextFp;
          settledKeys = append.keys;
          initialized = true;
        }).catch(() => {});
      };
      stop = watch(selected.sessionId, (error, next) => {
        if (bootstrapping) {
          bufferedObservation = { error, next };
          return;
        }
        writeObservation(error, next);
      }, { initialSnapshot: snapshot });
      if (bootstrapSession) {
        tick = tick.then(async () => {
          if (closed || res.destroyed || res.writableEnded) return;
          let render;
          let surface;
          try {
            let phaseStartedAt = timingNow();
            render = await loadRender();
            serverTimings.serverRenderLoadMs = timingDuration(phaseStartedAt);

            phaseStartedAt = timingNow();
            surface = consoleFoldWindow(snapshot);
            serverTimings.serverSurfaceMs = timingDuration(phaseStartedAt);

            phaseStartedAt = timingNow();
            liveState = render.liveTranscriptUpdate(null, surface).state;
            serverTimings.serverLiveStateMs = timingDuration(phaseStartedAt);

            phaseStartedAt = timingNow();
            const append = render.renderSettledTranscriptAppend(null, surface);
            fingerprints = render.regionFingerprints(surface);
            settledKeys = append.keys;
            serverTimings.serverFingerprintsMs = timingDuration(phaseStartedAt);
            initialized = true;
            const meta = {
              id: snapshot.id,
              generation: switchGeneration,
              canonical: paths.canonical,
              project: snapshot.project ?? "",
              folder: snapshot.folder ?? "",
              scope: snapshot.scope ?? "",
              origin: snapshot.origin ?? "",
              parent: snapshot.parent ?? "",
            };
            // Critical destination truth and interaction arrive as one ordered
            // batch. Baseline commitment precedes ready, so the browser can
            // safely adopt the transcript/live sequence namespace at ready.
            res.write(sseEvent("switch-meta", JSON.stringify(meta)));

            phaseStartedAt = timingNow();
            const chromeHtml = render.renderSessionRegion("chrome", surface, paths);
            serverTimings.serverChromeRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("chrome", chromeHtml));

            phaseStartedAt = timingNow();
            const transcriptHtml = render.transcriptSettledInner(surface);
            serverTimings.serverTranscriptRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("transcript-reset", transcriptHtml));

            phaseStartedAt = timingNow();
            const liveHtml = render.renderLiveNodes(surface);
            serverTimings.serverLiveRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("live", liveHtml));

            phaseStartedAt = timingNow();
            const queueHtml = render.renderSessionRegion("queue", surface, paths);
            serverTimings.serverQueueRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("queue", queueHtml));

            phaseStartedAt = timingNow();
            const popupsHtml = render.renderSessionRegion("popups", surface, paths);
            serverTimings.serverPopupsRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("popups", popupsHtml));

            phaseStartedAt = timingNow();
            const composerHtml = render.renderComposer(surface, paths);
            serverTimings.serverComposerRenderMs = timingDuration(phaseStartedAt);
            res.write(sseEvent("composer-shell", composerHtml));

            // Serialize once before closing the authoritative total so payload
            // object creation is inside the measured critical computation. The
            // final serialization only replaces the total's initial zero.
            const readyPayload = { id: snapshot.id, generation: switchGeneration, timings: serverTimings };
            JSON.stringify(readyPayload);
            serverTimings.serverCriticalRenderMs = timingDuration(serverCriticalStartedAt);
            res.write(sseEvent("switch-ready", JSON.stringify(readyPayload)));
            // Flush readiness before even rendering secondary regions. A plain
            // Node response has no flush(), so also yield one event-loop turn to
            // let its writes reach the socket before secondary HTML is computed.
            if (typeof res.flush === "function") res.flush();
            await new Promise((resolve) => setImmediate(resolve));
          } catch (error) {
            if (!closed && !res.destroyed && !res.writableEnded) {
              res.write(sseEvent("console-error", errorMessage(error)));
            }
            close();
            return;
          }

          // Keep observations buffered through this bounded batch. Ready has
          // already been flushed, so secondary work cannot delay critical
          // presentation or race newer truth ahead of bootstrap ordering.
          const secondaryErrors = [];
          for (const name of ["usage", "children", "case"]) {
            if (closed || res.destroyed || res.writableEnded) return;
            let html;
            try {
              html = render.renderSessionRegion(name, surface, paths);
            } catch (error) {
              // Ensure the next observation retries a region that did not make
              // it into this bootstrap, without invalidating critical readiness.
              delete fingerprints[name];
              secondaryErrors.push(error);
              continue;
            }
            res.write(sseEvent(name, html));
          }
          if (!closed && !res.destroyed && !res.writableEnded) {
            res.write(sseEvent("ui", lastUiGeneration));
            if (secondaryErrors.length > 0) {
              res.write(sseEvent("console-error", "Secondary session regions could not be rendered"));
            }
            if (typeof res.flush === "function") res.flush();
          }
          bootstrapping = false;
          const buffered = bufferedObservation;
          bufferedObservation = null;
          if (buffered) writeObservation(buffered.error, buffered.next);
        }).catch((error) => {
          // Failures outside the isolated secondary render loop indicate a
          // broken stream/reconciliation path, not an optional region failure.
          if (closed || res.destroyed || res.writableEnded) return;
          try { res.write(sseEvent("console-error", errorMessage(error))); } catch {}
          close();
        });
      }
      keepalive = setInterval(() => {
        if (closed || res.destroyed || res.writableEnded) {
          close();
          return;
        }
        res.write(": keepalive\n\n");
      }, ssePollMs);
      keepalive.unref?.();
      return;
    }

    if (selected?.action === "tool") {
      if (req.method !== "GET" && !head) {
        write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        const snapshot = await view(selected.sessionId);
        if (projectRoute && snapshot.project && snapshot.project !== projectRoute.project) {
          text(res, 404, "DSH session is not in this project", head);
          return;
        }
        const callId = String(selected.callId ?? "");
        const { codeDispatchNodes, renderToolBody } = await loadRender();
        const node = (snapshot.conversation?.nodes ?? []).find((item) =>
          item?.kind === "tool" && item.callId === callId)
          ?? codeDispatchNodes(snapshot.events).find((item) => item.callId === callId);
        if (!node) {
          text(res, 404, "qq: tool output is not available", head);
          return;
        }
        write(res, 200, { "Content-Type": "text/html; charset=utf-8" }, renderToolBody(node), head);
      } catch (error) {
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`, head);
      }
      return;
    }

    if (selected?.action === "complete") {
      if (req.method !== "GET" && !head) {
        write(res, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      if (!sameOrigin(req)) {
        text(res, 403, "Cross-origin completion refused", head);
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const line = url.searchParams.get("line") ?? "";
      const result = completeWorkflows
        ? completeWorkflows(line)
        : { completed: line, candidates: [] };
      json(res, 200, {
        completed: typeof result?.completed === "string" ? result.completed : line,
        candidates: Array.isArray(result?.candidates) ? result.candidates : [],
      }, head);
      return;
    }

    if (selected?.action === "prompt") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await assertChairMutation(selected.sessionId);
        const form = await readForm(req);
        const prompt = String(form.get("prompt") ?? "");
        if (!prompt.trim()) {
          const error = new Error("Message must not be empty");
          error.status = 422;
          throw error;
        }
        if (prompt.length > 32_768) {
          const error = new Error("Message exceeds 32,768 characters");
          error.status = 413;
          throw error;
        }
        const compiling = compilingFindPrompt(prompt, selected.sessionId, inFindMode);
        if (compiling) findWork.set(selected.sessionId, "compile");
        try {
          const result = await backend.prompt(selected.sessionId, prompt);
          findWork.delete(selected.sessionId);
          if (isNavigateResult(result)) {
            const next = result.action === "close"
              ? await closeNavigationLocation(basePath, backend, result, {
                  closedSessionId: selected.sessionId,
                  rememberedSessionIds: [lastSessionCookie(req), lastViewedSessionId],
                })
              : routes(basePath, result.id, result.project, result.folder).canonical;
            navigationResponse(req, res, next);
            return;
          }
          await mutationResponse(req, res, selected.sessionId, typeof result === "string" ? result : "");
        } finally {
          findWork.delete(selected.sessionId);
        }
      } catch (error) {
        findWork.delete(selected.sessionId);
        const message = errorMessage(error);
        if (error?.code === "child-observe-only") {
          text(res, errorStatus(error), message);
          return;
        }
        if (errorStatus(error) === 409 && isHtmx(req)) {
          try {
            await conflictResponse(req, res, selected.sessionId, message);
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        const unknownSlash = /unknown slash command/.test(message);
        if (!unknownSlash && isHtmx(req) && errorStatus(error) !== 409) {
          try {
            await mutationResponse(req, res, selected.sessionId, message);
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), message);
      }
      return;
    }

    if (selected?.action === "queue") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await assertChairMutation(selected.sessionId);
        const form = await readForm(req);
        const operation = String(form.get("operation") ?? "");
        const itemId = String(form.get("itemId") ?? "");
        if (!itemId) {
          const error = new Error("Pending message identity is required");
          error.status = 422;
          throw error;
        }
        if (operation === "edit") {
          if (typeof backend.editPending !== "function") {
            const error = new Error("Pending message editing is unavailable");
            error.status = 501;
            throw error;
          }
          await backend.editPending(selected.sessionId, itemId, String(form.get("text") ?? ""));
        } else if (operation === "remove") {
          if (typeof backend.removePending !== "function") {
            const error = new Error("Pending message removal is unavailable");
            error.status = 501;
            throw error;
          }
          await backend.removePending(selected.sessionId, itemId);
        } else {
          const error = new Error("Unknown pending message operation");
          error.status = 422;
          throw error;
        }
        await mutationResponse(req, res, selected.sessionId, "", bundledMutationRegionNames);
      } catch (error) {
        const message = errorMessage(error);
        if (error?.code === "child-observe-only") {
          text(res, errorStatus(error), message);
          return;
        }
        if (isHtmx(req)) {
          try {
            await mutationResponse(req, res, selected.sessionId, message, bundledMutationRegionNames);
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), message);
      }
      return;
    }

    if (selected?.action === "close") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await readForm(req);
        const closed = await backend.close(selected.sessionId);
        const location = await closeNavigationLocation(basePath, backend, closed, {
          closedSessionId: selected.sessionId,
          rememberedSessionIds: [lastSessionCookie(req), lastViewedSessionId],
        });
        navigationResponse(req, res, location);
      } catch (error) {
        const message = errorMessage(error);
        if (errorStatus(error) === 409) {
          try {
            await conflictResponse(req, res, selected.sessionId, message);
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), message);
      }
      return;
    }

    if (selected?.action === "reopen" || selected?.action === "resume") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await readForm(req);
        if (typeof backend.reopen !== "function") {
          const error = new Error("Reopening sessions is unavailable");
          error.status = 501;
          throw error;
        }
        const reopened = await backend.reopen(selected.sessionId);
        const next = routes(basePath, reopened.id, reopened.project, reopened.folder).canonical;
        navigationResponse(req, res, next);
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (selected?.action === "interrupt") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await assertChairMutation(selected.sessionId);
        await readForm(req);
        findWork.delete(selected.sessionId);
        const interrupted = await backend.interrupt(selected.sessionId);
        await mutationResponse(
          req,
          res,
          selected.sessionId,
          interrupted ? "Interrupt requested for the running DSH turn." : "No DSH turn was running.",
        );
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (selected?.action === "approval") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        await assertChairMutation(selected.sessionId);
        if (!decideApproval) {
          const error = new Error("approval answerer is unavailable");
          error.status = 503;
          throw error;
        }
        const form = await readForm(req);
        await decideApproval(selected.sessionId, form);
        await mutationResponse(req, res, selected.sessionId);
      } catch (error) {
        if (error?.code === "child-observe-only") {
          text(res, 403, errorMessage(error));
          return;
        }
        if (String(req.headers["hx-request"] ?? "").toLowerCase() === "true") {
          try {
            await mutationResponse(req, res, selected.sessionId, errorMessage(error));
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (selected?.action === "offer") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        if (!chooseOffer) {
          const error = new Error("leftover offer is unavailable");
          error.status = 503;
          throw error;
        }
        const form = await readForm(req);
        const choice = String(form.get("choice") ?? "").trim();
        const decided = await chooseOffer(selected.sessionId, choice);
        const notice = decided?.status === "refused"
          ? (decided.reason || "leftover offer refused")
          : "";
        await mutationResponse(req, res, selected.sessionId, notice);
      } catch (error) {
        if (String(req.headers["hx-request"] ?? "").toLowerCase() === "true") {
          try {
            await mutationResponse(req, res, selected.sessionId, errorMessage(error));
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (selected?.action === "overlay") {
      if (req.method !== "POST") {
        write(res, 405, { Allow: "POST", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      try {
        if (!sameOrigin(req)) {
          const error = new Error("Cross-origin form submission refused");
          error.status = 403;
          throw error;
        }
        if (!chooseOverlay) {
          const error = new Error("session overlay is unavailable");
          error.status = 503;
          throw error;
        }
        const form = await readForm(req);
        const saving = overlaySaveChoice(form);
        if (saving) findWork.set(selected.sessionId, "save");
        try {
          const decided = await chooseOverlay(selected.sessionId, form);
          findWork.delete(selected.sessionId);
          const notice = decided?.status === "refused"
            ? (decided.reason || "overlay action refused")
            : "";
          await mutationResponse(req, res, selected.sessionId, notice);
        } finally {
          findWork.delete(selected.sessionId);
        }
      } catch (error) {
        findWork.delete(selected.sessionId);
        if (String(req.headers["hx-request"] ?? "").toLowerCase() === "true") {
          try {
            await mutationResponse(req, res, selected.sessionId, errorMessage(error));
            return;
          } catch {
            // Fall through when the DSH session itself cannot be read.
          }
        }
        text(res, errorStatus(error), errorMessage(error));
      }
      return;
    }

    if (url.pathname === `${basePath}/__document-viewer-proof` && (req.method === "GET" || head)) {
      try {
        const { renderDocumentViewerProofPage } = await loadRender();
        write(
          res,
          200,
          { "Content-Type": "text/html; charset=utf-8" },
          renderDocumentViewerProofPage(pageAssetPaths()),
          head,
        );
      } catch (error) {
        text(res, errorStatus(error), errorMessage(error), head);
      }
      return;
    }

    text(res, 404, "Not found", head);
  }

  consoleHandler.dispose = () => {
    for (const stream of [...streams]) {
      try { stream.destroy(); } catch {}
    }
    streams.clear();
    initialSnapshotHandoffs.clear();
  };
  return consoleHandler;
}

export const internals = Object.freeze({
  DEFAULT_SSE_POLL_MS,
  MAX_FORM_BYTES,
  SECURITY_HEADERS,
  LIVE_ASSET_FILES,
  SERVICE_WORKER_NAMES: [...SERVICE_WORKER_NAMES],
  assetNames: Object.keys(bundledAssets),
  file: fileURLToPath(import.meta.url),
  compilingFindPrompt,
  overlaySaveChoice,
  normalizeBasePath,
  parseSessionRoute,
  parseProjectRoute,
  resolveAsset,
  readUiGeneration,
  readUiRevision,
  routes,
  sameOrigin,
  sseEvent,
  regionFingerprints: bundledRegionFingerprints,
  SSE_REGION_NAMES: bundledSseRegionNames,
});
