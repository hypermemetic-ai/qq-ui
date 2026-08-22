import { readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  renderDocumentViewerProofPage as bundledRenderDocumentViewerProofPage,
  renderFilePage as bundledRenderFilePage,
  renderPage as bundledRenderPage,
  renderSessionContent as bundledRenderSessionContent,
} from "./render.mjs";

const MAX_FORM_BYTES = 524_288;
const DEFAULT_SSE_POLL_MS = 100;
const SECURITY_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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
  "console-v18.css": "assets/console.css",
  "console-v19.css": "assets/console.css",
  "browser-v9.js": "assets/browser-v9.js",
});
const RENDER_FILE = fileURLToPath(new URL("./render.mjs", import.meta.url));

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

function text(res, status, message, head = false) {
  write(res, status, { "Content-Type": "text/plain; charset=utf-8" }, `${message}\n`, head);
}

function json(res, status, value, head = false) {
  write(res, status, { "Content-Type": "application/json; charset=utf-8" }, `${JSON.stringify(value)}\n`, head);
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
  if (parts.length < 1 || parts.length > 2 || !parts[0]) return undefined;
  let sessionId;
  try {
    sessionId = decodeURIComponent(parts[0]);
  } catch {
    return undefined;
  }
  return { sessionId, action: parts[1] ?? "page" };
}

const PROJECT_ROUTE_ACTIONS = new Set(["sessions", "session", "file", "open"]);

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
  if ((rest[0] === "file" || rest[0] === "open") && rest.length === 2 && rest[1]) {
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
    if ((rest[2] === "file" || rest[2] === "open") && rest.length === 4 && rest[3]) {
      let filePath;
      try {
        filePath = decodeURIComponent(rest[3]);
      } catch {
        return undefined;
      }
      return { ...base, sessionId, filePath, action: rest[2] };
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
  return Boolean(result && typeof result === "object" && result.kind === "navigate" && result.id);
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
  const assetsPrefix = `${basePath}/assets/`;
  const sessionsPath = `${basePath}/sessions`;
  const switchSessionPath = `${sessionsPath}/open`;
  const assetPaths = Object.freeze({
    htmx: `${assetsPrefix}htmx-2.0.10.min.js`,
    sse: `${assetsPrefix}htmx-ext-sse-2.2.4.js`,
    css: `${assetsPrefix}console-v19.css`,
    browser: `${assetsPrefix}browser-v9.js`,
    icon192: `${assetsPrefix}icon-v2-192.png`,
    icon512: `${assetsPrefix}icon-v2-512.png`,
    manifest: `${assetsPrefix}manifest-v3.webmanifest`,
    serviceWorker: `${basePath}/sw.js`,
  });
  const streams = new Set();
  const findWork = new Map();
  const readOffer = typeof options.offerFor === "function" ? options.offerFor : null;
  const chooseOffer = typeof options.chooseOffer === "function" ? options.chooseOffer : null;
  const readApproval = typeof options.approvalFor === "function" ? options.approvalFor : null;
  const decideApproval = typeof options.decideApproval === "function" ? options.decideApproval : null;
  const readLoginSheet = typeof options.loginSheetFor === "function" ? options.loginSheetFor : null;
  const readOverlay = typeof options.overlayFor === "function" ? options.overlayFor : null;
  const chooseOverlay = typeof options.chooseOverlay === "function" ? options.chooseOverlay : null;
  const readProgress = typeof options.progressFor === "function" ? options.progressFor : null;
  const inFindMode = typeof options.inFindMode === "function" ? options.inFindMode : null;
  const sessionModeFor = typeof options.sessionModeFor === "function" ? options.sessionModeFor : null;
  const workflowsFor = typeof options.workflowsFor === "function" ? options.workflowsFor : null;
  const completeWorkflows = typeof options.completeWorkflows === "function" ? options.completeWorkflows : null;

  async function withSheets(snapshot) {
    if (!snapshot?.id) return snapshot;
    let next = snapshot;
    if (readOffer) {
      try {
        const offer = await readOffer(snapshot.id);
        if (offer) next = { ...next, offer };
      } catch {
        /* leftover offer is optional */
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

  function viewFingerprint(snapshot) {
    const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
    const last = events.at(-1);
    const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
    const offer = snapshot?.offer;
    return JSON.stringify([
      snapshot?.id,
      snapshot?.project,
      snapshot?.agentStatus,
      events.length,
      last?.seq,
      last?.type,
      last?.data?.reason?.kind,
      (snapshot?.conversation?.pending ?? []).map((item) => [item.id, item.target, item.text]),
      sessions.map((session) => [session.id, session.createdAt, session.alias, session.project]),
      snapshot?.alias,
      offer?.id ?? "",
      offer?.brief ?? "",
      snapshot?.approval?.id ?? "",
      snapshot?.approval?.toolName ?? "",
      snapshot?.loginSheet?.action ?? "",
      (snapshot?.loginSheet?.connectors ?? []).map((connector) => connector.id),
      snapshot?.overlay?.id ?? "",
      snapshot?.overlay?.media?.src ?? "",
      snapshot?.overlay?.chrome === false ? "0" : "1",
      snapshot?.progress?.title ?? "",
      snapshot?.sessionMode ?? "",
      (snapshot?.workflows ?? []).join(","),
      snapshot?.findWork ?? "",
    ]);
  }

  async function view(sessionId) {
    const snapshot = await backend.read(sessionId);
    const available = snapshot.scope === "home" && typeof backend.listHome === "function"
      ? await backend.listHome()
      : snapshot.scope === "projects"
        ? [{
            id: snapshot.id,
            createdAt: snapshot.createdAt ?? 0,
            scope: "projects",
            context: "projects",
            ...(snapshot.alias ? { alias: snapshot.alias } : {}),
          }]
        : await backend.list(snapshot.project, snapshot.folder);
    if (snapshot.id && !available.some((session) => session.id === snapshot.id)) {
      available.unshift({
        id: snapshot.id,
        createdAt: 0,
        ...(snapshot.scope ? { scope: snapshot.scope } : {}),
        ...(snapshot.project ? { project: snapshot.project } : {}),
      });
    }
    return withSheets({ ...snapshot, sessions: available });
  }

  async function projectView(project, folder) {
    const available = await backend.list(project, folder);
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
    const listing = wanted === "~"
      ? await backend.listProjectFiles()
      : await backend.listProjectFiles(project, wanted);
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

  function watch(sessionId, listener, extra = {}) {
    if (typeof backend.observe !== "function") {
      throw new Error("qq-ui: qq service observe() is required");
    }
    if (!readOffer && !readOverlay && !readProgress && !inFindMode && !sessionModeFor && !workflowsFor) {
      return backend.observe(sessionId, listener, { intervalMs: ssePollMs, ...extra });
    }
    const intervalMs = extra.intervalMs ?? ssePollMs;
    let cancelled = false;
    let timer;
    let fingerprint;
    const tick = async () => {
      if (cancelled) return;
      try {
        const snapshot = await view(sessionId);
        const next = viewFingerprint(snapshot);
        if (next !== fingerprint) {
          fingerprint = next;
          try { listener(null, snapshot); } catch {}
        }
      } catch (error) {
        try { listener(error); } catch {}
      }
      if (cancelled) return;
      timer = setTimeout(tick, intervalMs);
      timer.unref?.();
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
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

  async function conflictResponse(req, res, sessionId, message) {
    const snapshot = await view(sessionId);
    const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
    if (isHtmx(req)) {
      const { renderSessionContent } = await loadRender();
      const body = renderSessionContent(snapshot, paths, message);
      write(res, 409, { "Content-Type": "text/html; charset=utf-8" }, body);
      return;
    }
    text(res, 409, message);
  }

  async function loadRender() {
    if (!liveAssets) {
      return {
        renderDocumentViewerProofPage: bundledRenderDocumentViewerProofPage,
        renderFilePage: bundledRenderFilePage,
        renderPage: bundledRenderPage,
        renderSessionContent: bundledRenderSessionContent,
      };
    }
    const stamp = statSync(RENDER_FILE).mtimeMs;
    return import(`${pathToFileURL(RENDER_FILE).href}?t=${stamp}`);
  }

  async function mutationResponse(req, res, sessionId, notice = "") {
    const snapshot = await view(sessionId);
    const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
    if (isHtmx(req)) {
      const { renderSessionContent } = await loadRender();
      const body = renderSessionContent(snapshot, paths, notice);
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

    const projectRoute = parseProjectRoute(basePath, url.pathname);
    if (projectRoute) {
      if (!isProjectAware(backend)) {
        text(res, 404, "Not found", head);
        return;
      }
      const known = backend.listProjects().find((entry) => entry.name === projectRoute.project);
      if (!known) {
        text(res, 404, "qq: project not found", head);
        return;
      }
      if (projectRoute.folder && !(known.folders ?? []).some((entry) => entry.name === projectRoute.folder)) {
        text(res, 404, "qq: project folder not found", head);
        return;
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
          }, paths, assetPaths);
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
          const groupedPicker = known.grouped === true && !projectRoute.folder;
          if (!groupedPicker) {
            const rows = await backend.list(projectRoute.project, projectRoute.folder);
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
          }
          const snapshot = await projectView(projectRoute.project, projectRoute.folder);
          const paths = routes(basePath, "", projectRoute.project, projectRoute.folder);
          const drawer = await drawerView(projectRoute.project, url, false, projectRoute.folder);
          const { renderPage } = await loadRender();
          const body = renderPage({ ...snapshot, drawer }, paths, assetPaths);
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
          const homeProject = encodeProject(backend.defaultProject);
          const homeFolder = backend.defaultFolder ? `/${encodeProject(backend.defaultFolder)}` : "";
          write(
            res,
            303,
            {
              Location: `${basePath}/project/${homeProject}${homeFolder}${url.search}`,
              "Content-Type": "text/plain; charset=utf-8",
            },
            "See other\n",
            head,
          );
          return;
        }
        if (selected?.sessionId && isProjectAware(backend) && !projectRoute) {
          const location = await liveLocation(selected.sessionId);
          const current = `${basePath}/session/${encodeURIComponent(selected.sessionId)}`;
          if (location !== current) {
            navigationResponse(req, res, location, head);
            return;
          }
        }
        const sessionId = rootPage ? backend.defaultSessionId : selected.sessionId;
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
        const { renderPage } = await loadRender();
        const body = renderPage({ ...snapshot, drawer }, paths, assetPaths);
        write(res, 200, { "Content-Type": "text/html; charset=utf-8" }, body, head);
      } catch (error) {
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`, head);
      }
      return;
    }

    if (selected?.action === "events") {
      if (req.method !== "GET") {
        write(res, 405, { Allow: "GET", "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed\n", head);
        return;
      }
      let snapshot;
      try {
        snapshot = await view(selected.sessionId);
        if (projectRoute && snapshot.project && snapshot.project !== projectRoute.project) {
          text(res, 404, "DSH session is not in this project");
          return;
        }
        if (projectRoute?.folder && snapshot.folder && projectRoute.folder !== snapshot.folder) {
          text(res, 404, "DSH session is not in this project");
          return;
        }
      } catch (error) {
        text(res, errorStatus(error), `DSH session unavailable: ${errorMessage(error)}`);
        return;
      }
      const paths = routes(basePath, snapshot.id, snapshot.project, snapshot.folder);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
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
      stop = watch(selected.sessionId, async (error, next) => {
        if (closed || res.destroyed || res.writableEnded) {
          close();
          return;
        }
        if (error) {
          res.write(sseEvent("console-error", errorMessage(error)));
          close();
          return;
        }
        const { renderSessionContent } = await loadRender();
        res.write(sseEvent("session", renderSessionContent(next, paths)));
      });
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
            navigationResponse(req, res, routes(basePath, result.id, result.project, result.folder).canonical);
            return;
          }
          await mutationResponse(req, res, selected.sessionId, typeof result === "string" ? result : "");
        } finally {
          findWork.delete(selected.sessionId);
        }
      } catch (error) {
        findWork.delete(selected.sessionId);
        const message = errorMessage(error);
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
        await mutationResponse(req, res, selected.sessionId);
      } catch (error) {
        const message = errorMessage(error);
        if (isHtmx(req)) {
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
        const next = closed.id
          ? routes(basePath, closed.id, closed.project, closed.folder).canonical
          : routes(
            basePath,
            "",
            closed.project || (isProjectAware(backend) ? backend.defaultProject : undefined),
            closed.folder || (isProjectAware(backend) ? backend.defaultFolder : undefined),
          ).canonical;
        navigationResponse(req, res, next);
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
        if (!decideApproval) {
          const error = new Error("approval answerer is unavailable");
          error.status = 503;
          throw error;
        }
        const form = await readForm(req);
        await decideApproval(selected.sessionId, form);
        await mutationResponse(req, res, selected.sessionId);
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
          renderDocumentViewerProofPage(assetPaths),
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
  routes,
  sameOrigin,
  sseEvent,
});
