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

const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const syncRail = browser.match(/const syncRailAfterSwitch = \(meta\) => \{([\s\S]*?)\n  \};/);
assert.ok(syncRail, "post-switch rail synchronization exists");
assert.match(syncRail[1], /meta\.scope === "projects"/);
assert.match(syncRail[1], /meta\.origin === "subagent"/);
assert.doesNotMatch(syncRail[1], /querySelector\("#session-chrome \.session-parent"\)/,
  "post-switch child state comes from switch-meta, not leftover DOM");

console.log("prove-session-switcher-polish: pass");
