#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConsoleMenuRegistry } from "../src/console-menu.mjs";
import { createConsoleHandler } from "../src/http-app.mjs";
import { apply, provide } from "../src/plugin.mjs";
import { regionFingerprints, renderChrome } from "../src/render.mjs";

const registry = createConsoleMenuRegistry();
assert.ok(Object.isFrozen(registry));
assert.deepEqual(registry.items(), []);
assert.ok(Object.isFrozen(registry.items()));

const producer = {
  kind: "navigation",
  id: "sts2-companion",
  label: "StS2 Companion",
  href: "/sts2",
  order: 100,
};
const disposeSts2 = registry.register(producer);
const disposeEarly = registry.register({
  kind: "navigation",
  id: "alpha-tool",
  label: "Alpha & <tool>",
  href: "/alpha?mode=safe#top",
  order: -5,
});
producer.label = "mutated";
producer.href = "https://attacker.invalid";
const registered = registry.items();
assert.deepEqual(registered.map(({ id }) => id), ["alpha-tool", "sts2-companion"]);
assert.equal(registered[1].label, "StS2 Companion", "producer mutation cannot change a registered item");
assert.equal(registered[1].href, "/sts2");
assert.ok(Object.isFrozen(registered) && registered.every(Object.isFrozen));
assert.throws(() => registry.register({ ...registered[1] }), /already registered/);

for (const bad of [
  null,
  { kind: "command", id: "command", label: "command", href: "/command" },
  { kind: "navigation", id: "Bad ID", label: "bad", href: "/bad" },
  { kind: "navigation", id: "blank", label: " ", href: "/blank" },
  { kind: "navigation", id: "external", label: "external", href: "https://attacker.invalid/" },
  { kind: "navigation", id: "protocol-relative", label: "external", href: "//attacker.invalid/" },
  { kind: "navigation", id: "relative", label: "relative", href: "sts2" },
  { kind: "navigation", id: "backslash", label: "backslash", href: "/safe\\evil" },
  { kind: "navigation", id: "control", label: "control", href: "/safe\nnope" },
  { kind: "navigation", id: "float", label: "float", href: "/float", order: 1.5 },
  { kind: "navigation", id: "huge", label: "huge", href: "/huge", order: 10_001 },
]) {
  assert.throws(() => registry.register(bad), /qq-ui console menu item/);
}

disposeSts2();
disposeSts2();
assert.deepEqual(registry.items().map(({ id }) => id), ["alpha-tool"], "disposal is idempotent");
const disposeReplacement = registry.register({
  kind: "navigation",
  id: "sts2-companion",
  label: "StS2 Companion",
  href: "/sts2",
  order: 100,
});
disposeSts2();
assert.equal(registry.items().some(({ id }) => id === "sts2-companion"), true,
  "a stale disposer cannot remove a later registration");

const snapshot = {
  id: "session-a1000000-0000-4000-8000-000000000001",
  alias: "1",
  events: [],
  workflows: ["architect"],
  consoleMenu: registry.items(),
  sessions: [],
};
const paths = {
  canonical: `/qq/session/${snapshot.id}`,
  project: "/qq",
  projectsBase: "/qq/project",
  projectsSession: "/qq/projects",
  prompt: `/qq/session/${snapshot.id}/prompt`,
  close: `/qq/session/${snapshot.id}/close`,
  switchSession: "/qq/sessions/open",
};
const chrome = renderChrome(snapshot, paths);
const usageAt = chrome.indexOf(">usage</a>");
const alphaAt = chrome.indexOf("Alpha &amp; &lt;tool&gt;");
const sts2At = chrome.indexOf("StS2 Companion");
const workflowAt = chrome.indexOf('value="/workflows architect"');
assert.ok(usageAt >= 0 && alphaAt > usageAt && sts2At > alphaAt && workflowAt > sts2At,
  "shell action, sorted navigation, and workflow action keep their semantic order");
assert.match(chrome, /<a class="console-menu-choice" role="menuitem" href="\/sts2">StS2 Companion<\/a>/);
assert.doesNotMatch(chrome, /mutated|attacker\.invalid/);
const emptyChrome = renderChrome({ ...snapshot, consoleMenu: [] }, paths);
assert.doesNotMatch(emptyChrome, /StS2 Companion|Alpha &amp;/,
  "no contributors leave no navigation artifact");
assert.notEqual(
  regionFingerprints({ ...snapshot, consoleMenu: [] }).chrome,
  regionFingerprints(snapshot).chrome,
  "console menu changes invalidate the chrome region",
);

assert.equal(provide, "qq-ui");
let provided;
let registeredHandler;
const effects = [];
const pluginBackend = {
  read() {},
  list() {},
  create() {},
  prompt() {},
  interrupt() {},
  close() {},
};
const pluginCtx = {
  webServer: {
    host: "127.0.0.1",
    register(entry) {
      registeredHandler = entry.handler;
      return () => {};
    },
  },
  get(name) {
    if (name === "qq-core") return pluginBackend;
    return undefined;
  },
  provide(name, value) {
    provided = { name, value };
  },
  effect(factory) {
    const dispose = factory();
    if (typeof dispose === "function") effects.push(dispose);
  },
};
apply(pluginCtx, {});
assert.equal(provided?.name, "qq-ui");
assert.equal(typeof provided?.value?.consoleMenu?.register, "function");
assert.equal(typeof provided?.value?.consoleMenu?.items, "function");
assert.ok(Object.isFrozen(provided.value) && Object.isFrozen(provided.value.consoleMenu));
assert.equal(typeof registeredHandler, "function");
for (const dispose of effects.reverse()) dispose();

const liveRegistry = createConsoleMenuRegistry();
const disposeLive = liveRegistry.register({
  kind: "navigation",
  id: "generic-provider",
  label: "Generic <Provider>",
  href: "/generic",
  order: 10,
});
const liveSnapshot = {
  id: snapshot.id,
  alias: "1",
  events: [],
  sessions: [],
  conversation: { messages: [], pending: [] },
};
const backend = {
  async read(id) {
    assert.equal(id, liveSnapshot.id);
    return structuredClone(liveSnapshot);
  },
  async list() {
    return [{ id: liveSnapshot.id, alias: "1", createdAt: 1 }];
  },
  observe() { return () => {}; },
  async create() { return structuredClone(liveSnapshot); },
  async prompt() { return structuredClone(liveSnapshot); },
  async interrupt() { return structuredClone(liveSnapshot); },
  async close() { return { id: null }; },
};
const handler = createConsoleHandler(backend, { consoleMenuFor: liveRegistry.items });
const server = createServer(handler);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const first = await fetch(`${base}/qq/session/${liveSnapshot.id}`);
  assert.equal(first.status, 200);
  const firstHtml = await first.text();
  assert.match(firstHtml, /href="\/generic">Generic &lt;Provider&gt;<\/a>/,
    "SSR reads validated contributions through the optional sheet");

  disposeLive();
  const second = await fetch(`${base}/qq/session/${liveSnapshot.id}`);
  assert.equal(second.status, 200);
  assert.doesNotMatch(await second.text(), /Generic &lt;Provider&gt;/,
    "SSR does not retain a disposed contribution");
} finally {
  handler.dispose();
  await new Promise((resolve) => server.close(resolve));
}

disposeEarly();
disposeReplacement();
console.log("console menu contribution proof passed");
