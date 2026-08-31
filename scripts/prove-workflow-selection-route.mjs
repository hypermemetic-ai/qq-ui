#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { apply } from "../src/plugin.mjs";

const sessionId = "session-a1000000-0000-4000-8000-000000000091";
let snapshot = {
  id: sessionId,
  alias: "91",
  events: [],
  conversation: { messages: [], pending: [] },
};
let selected = "architect";
let workflowService = {
  workflows: {
    names: () => ["architect", "find", "base"],
    selected: () => selected,
    select(id, name) {
      assert.equal(id, sessionId);
      selected = name;
      selections.push(["select", id, name]);
      return name;
    },
    clear(id) {
      assert.equal(id, sessionId);
      selected = null;
      selections.push(["clear", id]);
      return null;
    },
  },
};
const selections = [];
let promptCalls = 0;
const backend = {
  async read(id) {
    assert.equal(id, sessionId);
    return structuredClone(snapshot);
  },
  async list() {
    return [{ id: sessionId, alias: "91", createdAt: 1 }];
  },
  observe() { return () => {}; },
  async create() { return structuredClone(snapshot); },
  async prompt() {
    promptCalls += 1;
    return structuredClone(snapshot);
  },
  async interrupt() { return structuredClone(snapshot); },
  async close() { return { id: null }; },
};
let registeredHandler;
const effects = [];
const ctx = {
  webServer: {
    host: "127.0.0.1",
    register(entry) {
      if (entry.kind === "prefix") registeredHandler = entry.handler;
      return () => {};
    },
  },
  get(name) {
    if (name === "qq-core") return backend;
    if (name === "qq-workflows") return workflowService;
    return undefined;
  },
  provide() {},
  effect(factory) {
    const dispose = factory();
    if (typeof dispose === "function") effects.push(dispose);
  },
};
apply(ctx, {});
assert.equal(typeof registeredHandler, "function");

const server = createServer(registeredHandler);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const page = `${base}/qq/session/${sessionId}`;
const workflowRoute = `${page}/workflow`;

async function postWorkflow(workflow, {
  origin = base,
  fetchSite = "same-origin",
  htmx = false,
} = {}) {
  return fetch(workflowRoute, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
      "sec-fetch-site": fetchSite,
      ...(htmx ? { "hx-request": "true" } : {}),
    },
    body: new URLSearchParams({ workflow }),
  });
}

try {
  const initialPage = await fetch(page, { redirect: "manual" });
  assert.equal(initialPage.status, 200);
  const initialHtml = await initialPage.text();
  assert.match(initialHtml, new RegExp(`action="/qq/session/${sessionId}/workflow"`));
  assert.match(initialHtml, /name="workflow" value="architect"/);
  assert.doesNotMatch(initialHtml, /name="prompt" value="\/workflows|value="\/workflows/,
    "workflow UI does not encode provider actions as prompt text");

  const normal = await postWorkflow("find");
  assert.equal(normal.status, 303);
  assert.equal(normal.headers.get("location"), `/qq/session/${sessionId}`);
  assert.deepEqual(selections, [["select", sessionId, "find"]]);
  assert.equal(promptCalls, 0, "workflow selection never sends a synthetic prompt");

  const htmx = await postWorkflow("architect", { htmx: true });
  assert.equal(htmx.status, 200);
  const htmxHtml = await htmx.text();
  assert.match(htmxHtml, /id="session-chrome"/);
  assert.match(htmxHtml, /data-mode="architect"/);
  assert.deepEqual(selections.at(-1), ["select", sessionId, "architect"]);

  const unknown = await postWorkflow("not-loaded");
  assert.equal(unknown.status, 400);
  assert.match(await unknown.text(), /unknown workflow selection/);
  assert.equal(selections.length, 2, "unknown names never reach the provider selector");

  const malformedHtmx = await postWorkflow("Bad Name", { htmx: true });
  assert.equal(malformedHtmx.status, 200, "same-origin HTMX failures return a safe console mutation");
  assert.match(await malformedHtmx.text(), /unknown workflow selection/);
  assert.equal(selections.length, 2);

  const crossOrigin = await postWorkflow("find", {
    origin: "https://attacker.invalid",
    fetchSite: "cross-site",
    htmx: true,
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(selections.length, 2);

  workflowService = null;
  const unavailable = await postWorkflow("find");
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /workflow selector is unavailable/);
  workflowService = {
    workflows: {
      names: () => ["architect", "find", "base"],
      selected: () => selected,
      select: (id, name) => {
        selected = name;
        selections.push(["select", id, name]);
        return name;
      },
      clear: (id) => {
        selected = null;
        selections.push(["clear", id]);
        return null;
      },
    },
  };

  const cleared = await postWorkflow("none");
  assert.equal(cleared.status, 303);
  assert.deepEqual(selections.at(-1), ["clear", sessionId]);
  assert.equal(selected, null);

  const baseSelection = await postWorkflow("base");
  assert.equal(baseSelection.status, 303);
  assert.deepEqual(selections.at(-1), ["select", sessionId, "base"]);

  snapshot = { ...snapshot, origin: "subagent", parent: "session-parent" };
  const child = await postWorkflow("find");
  assert.equal(child.status, 403);
  assert.match(await child.text(), /observe-only/i);
  snapshot = { ...snapshot, origin: undefined, parent: undefined };

  const wrongMethod = await fetch(workflowRoute, { method: "GET", redirect: "manual" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  assert.equal(promptCalls, 0);
} finally {
  await new Promise((resolve) => server.close(resolve));
  for (const dispose of effects.reverse()) dispose();
}

console.log("workflow selection route proof passed");
