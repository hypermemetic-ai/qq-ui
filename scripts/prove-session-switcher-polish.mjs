#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createConsoleHandler } from "../src/http-app.mjs";
import { renderProjectRail, renderSessionContent } from "../src/render.mjs";

const rootId = "session-63a11000-0000-4000-8000-0000000000aa";
const siblingId = "session-63a11000-0000-4000-8000-0000000000bb";
const childId = "session-63a11000-0000-4000-8000-0000000000cc";
const paths = {
  canonical: `/qq/project/qq/session/${rootId}`,
  projectsBase: "/qq/project",
  projectsSession: "/qq/projects",
  createSession: "/qq/project/qq/sessions",
  switchSession: "/qq/sessions/open",
  close: `/qq/project/qq/session/${rootId}/close`,
  events: `/qq/project/qq/session/${rootId}/events`,
  prompt: `/qq/project/qq/session/${rootId}/prompt`,
  workflow: `/qq/project/qq/session/${rootId}/workflow`,
  interrupt: `/qq/project/qq/session/${rootId}/interrupt`,
  approval: `/qq/project/qq/session/${rootId}/approval`,
  offer: `/qq/project/qq/session/${rootId}/offer`,
  overlay: `/qq/project/qq/session/${rootId}/overlay`,
};

const projectsSnapshot = {
  id: rootId,
  scope: "projects",
  events: [],
  sessions: [{ id: rootId, scope: "projects", alias: "projects" }],
  activeProjects: [{ id: siblingId, project: "qq", alias: "41" }],
};
const projectsContent = renderSessionContent(projectsSnapshot, paths);
const projectsRail = renderProjectRail(projectsSnapshot, paths);
assert.doesNotMatch(projectsContent, /class="session-token/,
  "the projects chair never paints itself as a session token");
assert.doesNotMatch(projectsContent, /class="new-session/,
  "the projects chair cannot create a default-project session from traversal");
assert.match(projectsRail, new RegExp(`class="active-project-item projects-session-item active-project-current"[^>]*href="/qq/projects"[^>]*data-session-id="${rootId}"[^>]*aria-current="page"`));
assert.doesNotMatch(projectsRail, /projects-session-item[^>]*data-project=/,
  "the pinned projects chair is outside remembered project identity");
assert.match(projectsContent, new RegExp(`class="projects-choice projects-session-choice projects-choice-current"[^>]*href="/qq/projects"[^>]*data-session-id="${rootId}"`),
  "the mobile projects menu stays in sync with the pinned rail chair");

const childSnapshot = {
  id: childId,
  project: "qq",
  origin: "subagent",
  parent: rootId,
  parentAlias: "40",
  events: [],
  sessions: [
    { id: rootId, project: "qq", alias: "40" },
    { id: siblingId, project: "qq", alias: "41" },
  ],
};
const childContent = renderSessionContent(childSnapshot, paths);
assert.doesNotMatch(childContent, /class="session-token/,
  "a child does not paint its parent's root token list");
assert.doesNotMatch(childContent, /class="new-session/,
  "a child does not expose chair creation");
assert.doesNotMatch(childContent, /session-parent-close/,
  "an observe-only child has no close mutation");
assert.match(childContent, new RegExp(`class="session-parent"[\\s\\S]*data-session-id="${rootId}"`),
  "the parent return link is a live session picker");

const parentContent = renderSessionContent({
  id: rootId,
  project: "qq",
  events: [],
  sessions: [{ id: rootId, project: "qq" }],
  children: [{ id: childId, alias: "child", status: "running" }],
}, paths);
assert.match(parentContent, new RegExp(`class="session-child"[^>]*data-session-id="${childId}"`),
  "child links use the live session picker identity");

const approval = { id: "approval-proof", toolName: "bash", reason: "proof" };
const offer = { id: "offer-proof", brief: "leftover offer proof" };
const overlay = { id: "overlay-proof", title: "overlay proof", media: { src: "/proof.png" } };
const rawSnapshot = {
  id: rootId,
  project: "qq",
  events: [],
  agentStatus: "idle",
  sessions: [{ id: rootId, project: "qq" }],
  children: [],
  conversation: { nodes: [], pending: [] },
};

function fixture() {
  let offerReads = 0;
  const backend = {
    read: async () => structuredClone(rawSnapshot),
    list: async () => [{ id: rootId, project: "qq" }],
    observe(_id, listener) {
      // qq-core observes immediately. This raw observation intentionally has no
      // sheet fields and used to clobber view() before the sheet poll returned.
      listener(null, structuredClone(rawSnapshot));
      return () => {};
    },
    create: async () => structuredClone(rawSnapshot),
    prompt: async () => structuredClone(rawSnapshot),
    interrupt: async () => structuredClone(rawSnapshot),
    close: async () => ({ id: "", project: "qq" }),
  };
  const handler = createConsoleHandler(backend, {
    ssePollMs: 25,
    offerFor: () => {
      offerReads += 1;
      // Keep the first watch poll pending. The SSE proof must rely on the
      // viewSnapshot seed, not on a conveniently fast withSheets() refresh.
      return offerReads === 1 ? offer : new Promise(() => {});
    },
    approvalFor: () => approval,
    overlayFor: () => overlay,
  });
  return { handler };
}

async function withFixture(run) {
  const { handler } = fixture();
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    handler.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

function takeSseFrames(state, chunk) {
  state.buffer += chunk.replaceAll("\r", "");
  const frames = [];
  for (;;) {
    const boundary = state.buffer.indexOf("\n\n");
    if (boundary < 0) break;
    const block = state.buffer.slice(0, boundary);
    state.buffer = state.buffer.slice(boundary + 2);
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
    const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    if (event) frames.push({ event, data });
  }
  return frames;
}

async function collectSse(base, query, { afterReadyMs = 0 } = {}) {
  const controller = new AbortController();
  const response = await fetch(`${base}/qq/session/${rootId}/events${query}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = { buffer: "" };
  const frames = [];
  const started = Date.now();
  let readyAt = 0;
  try {
    for (;;) {
      const remaining = readyAt
        ? readyAt + afterReadyMs - Date.now()
        : started + 2000 - Date.now();
      if (remaining <= 0) break;
      const result = await Promise.race([
        reader.read().then((value) => ({ type: "read", value })),
        new Promise((resolve) => setTimeout(() => resolve({ type: "timeout" }), remaining)),
      ]);
      if (result.type === "timeout" || result.value.done) break;
      for (const frame of takeSseFrames(parser, decoder.decode(result.value.value, { stream: true }))) {
        frames.push(frame);
        if (frame.event === "switch-ready") readyAt = Date.now();
      }
      if (!afterReadyMs && frames.some((frame) => frame.event === "popups")) break;
    }
  } finally {
    controller.abort();
    try { await reader.cancel(); } catch {}
  }
  return frames;
}

function assertSheetPopups(frames, context) {
  const popups = frames.filter((frame) => frame.event === "popups");
  assert.ok(popups.length > 0, `${context} emits a popups region`);
  for (const popup of popups) {
    assert.match(popup.data, /data-approval-id="approval-proof"/, `${context} preserves approval`);
    assert.match(popup.data, /data-offer-id="offer-proof"/, `${context} preserves leftover offer`);
    assert.match(popup.data, /data-overlay-id="overlay-proof"/, `${context} preserves overlay`);
  }
}

await withFixture(async (base) => {
  const response = await fetch(`${base}/qq/session/${rootId}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-approval-id="approval-proof"/, "first paint includes approval");
  assert.match(html, /data-offer-id="offer-proof"/, "first paint includes leftover offer");
  assert.match(html, /data-overlay-id="overlay-proof"/, "first paint includes overlay");
});

await withFixture(async (base) => {
  const ordinary = await collectSse(base, "");
  assertSheetPopups(ordinary, "ordinary SSE first observation");
});

await withFixture(async (base) => {
  const bootstrap = await collectSse(base, "?bootstrap=session&switch=7", { afterReadyMs: 100 });
  assertSheetPopups(bootstrap, "live-switch bootstrap and buffered observation");
  const meta = JSON.parse(bootstrap.find((frame) => frame.event === "switch-meta")?.data ?? "null");
  assert.deepEqual(
    { scope: meta?.scope, origin: meta?.origin, parent: meta?.parent },
    { scope: "", origin: "", parent: "" },
    "switch-meta carries destination scope, origin, and parent",
  );
});

const closeAId = "session-63a11000-0000-4000-8000-0000000000da";
const closeBId = "session-63a11000-0000-4000-8000-0000000000db";
const closeCId = "session-63a11000-0000-4000-8000-0000000000dc";

function closeFixture(initialRows, { promptCloses = false } = {}) {
  let rows = structuredClone(initialRows);
  const snapshots = () => new Map(rows.map((row) => [row.id, {
    ...row,
    events: [],
    agentStatus: "idle",
    conversation: { nodes: [], pending: [] },
  }]));
  const closeSession = async (id) => {
    const closing = rows.find((row) => row.id === id);
    rows = rows.filter((row) => row.id !== id);
    const sameProject = rows.find((row) => (
      row.project === closing?.project && String(row.folder ?? "") === String(closing?.folder ?? "")
    ));
    return {
      id: sameProject?.id ?? "",
      project: closing?.project ?? "",
      ...(closing?.folder ? { folder: closing.folder } : {}),
    };
  };
  const backend = {
    defaultProject: "alpha",
    defaultFolder: "",
    listProjects: () => [
      { name: "alpha", label: "alpha" },
      { name: "bravo", label: "bravo" },
      { name: "charlie", label: "charlie" },
      { name: "empty", label: "empty" },
    ],
    read: async (id) => {
      const snapshot = snapshots().get(id);
      if (!snapshot) {
        const error = new Error("missing session");
        error.status = 404;
        throw error;
      }
      return structuredClone(snapshot);
    },
    list: async (...args) => args.length === 0
      ? structuredClone(rows)
      : structuredClone(rows.filter((row) => (
          row.project === args[0] && String(row.folder ?? "") === String(args[1] ?? "")
        ))),
    observe(id, listener) {
      const snapshot = snapshots().get(id);
      if (snapshot) listener(null, structuredClone(snapshot));
      return () => {};
    },
    create: async (project, folder = "") => ({
      id: closeAId,
      project,
      ...(folder ? { folder } : {}),
      events: [],
    }),
    createProjects: async () => ({
      id: "session-63a11000-0000-4000-8000-0000000000dd",
      scope: "projects",
      events: [],
    }),
    prompt: async (id) => {
      if (!promptCloses) return snapshots().get(id);
      const closed = await closeSession(id);
      return { ...closed, kind: "navigate", action: "close", id: closed.id || null };
    },
    interrupt: async (id) => snapshots().get(id),
    close: closeSession,
  };
  return createConsoleHandler(backend);
}

async function withCloseFixture(rows, run, options = {}) {
  const handler = closeFixture(rows, options);
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    handler.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

const closeRowA = { id: closeAId, project: "alpha", alias: "10" };
const closeRowB = { id: closeBId, project: "bravo", alias: "20" };
const closeRowC = { id: closeCId, project: "charlie", alias: "30" };

await withCloseFixture([closeRowA, closeRowC, closeRowB], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qq-last-session=${closeBId}`,
    },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/qq/project/bravo/session/${closeBId}`,
    "closing a project's last session prefers a still-live cookie chair over the first global row",
  );
});

await withCloseFixture([
  closeRowA,
  { id: "session-63a11000-0000-4000-8000-0000000000de", project: "alpha", alias: "11" },
  closeRowB,
], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qq-last-session=${closeBId}`,
    },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "/qq/project/alpha/session/session-63a11000-0000-4000-8000-0000000000de",
    "the same-project remainder returned by close stays first",
  );
});

await withCloseFixture([closeRowA, closeRowC, closeRowB], async (base) => {
  const viewed = await fetch(`${base}/qq/project/bravo/session/${closeBId}`);
  assert.equal(viewed.status, 200);
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qq-last-session=${closeAId}`,
    },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/qq/project/bravo/session/${closeBId}`,
    "a closing cookie is ignored and a still-live last-viewed chair wins",
  );
});

await withCloseFixture([closeRowA, closeRowC, closeRowB], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/qq/project/charlie/session/${closeCId}`,
    "without live remembered chairs the first remaining global row wins",
  );
});

await withCloseFixture([closeRowA, closeRowC, closeRowB], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qq-last-session=${closeBId}`,
      "hx-request": "true",
    },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("hx-redirect"),
    `/qq/project/bravo/session/${closeBId}`,
    "HTMX close uses HX-Redirect for the same live-chair destination",
  );
});

await withCloseFixture([closeRowA, closeRowC, closeRowB], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/prompt`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qq-last-session=${closeBId}`,
    },
    body: "prompt=%2Fclose",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    `/qq/project/bravo/session/${closeBId}`,
    "close navigate-results use the live-chair resolver too",
  );
}, { promptCloses: true });

await withCloseFixture([closeRowA], async (base) => {
  const response = await fetch(`${base}/qq/project/alpha/session/${closeAId}/close`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "/qq/projects",
    "closing the final live session leaves the operator on the projects chair",
  );
});

await withCloseFixture([closeRowB], async (base) => {
  const response = await fetch(`${base}/qq/project/empty`, { redirect: "manual" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /\bsse-connect=/, "an empty project has no SSE connection");
  assert.doesNotMatch(html, /id="switch-(?:meta|ready)"/,
    "an empty project has no live-switch bootstrap targets");
  assert.match(html, new RegExp(`class="active-project-item[^"]*"[^>]*href="/qq/project/bravo"[^>]*data-session-id="${closeBId}"`),
    "the empty surface still renders a selectable live project");
  assert.match(html, /class="new-session" action="\/qq\/project\/empty\/sessions"/,
    "the empty project's new-session action remains available");

  const liveProject = await fetch(`${base}/qq/project/bravo`, { redirect: "manual" });
  assert.equal(liveProject.status, 303);
  assert.equal(liveProject.headers.get("location"), `/qq/project/bravo/session/${closeBId}`,
    "navigating a live project's href opens one of its sessions");

  const created = await fetch(`${base}/qq/project/empty/sessions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "",
    redirect: "manual",
  });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), `/qq/project/empty/session/${closeAId}`,
    "the empty project's new-session form remains operational");
});

const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const canLiveSwitchSource = browser.match(/const canLiveSwitch = \(\) => \{[\s\S]*?\n  \};/);
assert.ok(canLiveSwitchSource, "live-switch capability is explicit");
assert.match(canLiveSwitchSource[0], /hasAttribute\("sse-connect"\)/,
  "live switching refuses a console without an SSE connection");
assert.match(canLiveSwitchSource[0], /!liveSessionId/,
  "live switching refuses a console without a current session identity");
assert.match(canLiveSwitchSource[0], /#switch-meta/,
  "live switching refuses a console without switch-meta");
assert.match(canLiveSwitchSource[0], /#switch-ready/,
  "live switching refuses a console without switch-ready");
const liveSwitchSource = browser.match(/const liveSwitch = \(sessionId,[\s\S]*?\n  \};/);
assert.ok(liveSwitchSource, "live switching exists");
assert.match(liveSwitchSource[0], /!canLiveSwitch\(\)/,
  "live switching refuses a console that cannot live-switch");
assert.match(liveSwitchSource[0], /id === liveSessionId && !bootstrapSwitch\)\) return false/,
  "already-live remains a no-op inside liveSwitch");
const switchOrNavigate = browser.match(/const liveSwitchOrNavigate = \([\s\S]*?\n  \};/);
assert.ok(switchOrNavigate, "empty-surface fallback is shared");
assert.match(switchOrNavigate[0], /if \(canLiveSwitch\(\)\) liveSwitch/,
  "href fallback runs only when the console cannot live-switch");
assert.match(switchOrNavigate[0], /else void navigatePage/,
  "a surface without SSE infrastructure navigates the project href");
assert.doesNotMatch(switchOrNavigate[0], /if \(!liveSwitch\(/,
  "already-live liveSwitch false is not treated as cannot-switch");
const selectProjectSource = browser.match(/const selectOverlayProject = \(item\) => \{([\s\S]*?)\n  \};/);
assert.ok(selectProjectSource, "overlay project selection exists");
assert.match(selectProjectSource[1], /liveSwitchOrNavigate\(sessionId,[\s\S]*?projectItem\.href/,
  "re-selecting the projects chair uses the capability-gated fallback");
assert.match(selectProjectSource[1], /liveSwitchOrNavigate\(selected\.id,[\s\S]*?projectItem\.href/,
  "project selection navigates its href when live switching cannot run");
assert.doesNotMatch(selectProjectSource[1], /if \(!liveSwitch\(/,
  "overlay project clicks do not full-navigate merely because the session is already live");
assert.match(selectProjectSource[1], /if \(!selected\?\.id\)[\s\S]*?navigatePage\(projectItem\.href/,
  "a project without a session navigates to its empty page instead of becoming a no-op");
const chairGoSource = browser.match(/const chairGo = \(value, current = null\) => \{([\s\S]*?)\n  \};/);
assert.ok(chairGoSource, "chair navigation exists");
assert.match(chairGoSource[1], /selectOverlayProject\(current\)\) return;[\s\S]*?navigatePage\(value, current\)/,
  "chair navigation falls through to page navigation when project selection declines");
const syncRail = browser.match(/const syncRailAfterSwitch = \(meta\) => \{([\s\S]*?)\n  \};/);
assert.ok(syncRail, "post-switch rail synchronization exists");
assert.match(syncRail[1], /meta\.scope === "projects"/);
assert.match(syncRail[1], /meta\.origin === "subagent"/);
assert.doesNotMatch(syncRail[1], /querySelector\("#session-chrome \.session-parent"\)/,
  "post-switch child state comes from switch-meta, not leftover DOM");

console.log("prove-session-switcher-polish: pass");
