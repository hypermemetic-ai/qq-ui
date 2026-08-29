#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const factoryStart = "/* qq-latency-factory:start */";
const factoryEnd = "/* qq-latency-factory:end */";
const start = browserSource.indexOf(factoryStart);
const end = browserSource.indexOf(factoryEnd);
assert.ok(start >= 0 && end > start, "browser asset contains the testable latency-study factory");
const factoryBody = browserSource.slice(start + factoryStart.length, end);
const createQQLatencyStudy = Function(`${factoryBody}\nreturn createQQLatencyStudy;`)();
assert.equal(typeof createQQLatencyStudy, "function");
assert.match(browserSource, /window\.qqLatency\s*=\s*qqLatency/, "the browser exposes window.qqLatency");
assert.match(browserSource, /paintLiveSlice[\s\S]*qqLatency\.markStreamPaint/, "smoothed stream painting has an explicit study hook");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }
  dispatch(type, event = {}) {
    event.type = type;
    if (!("target" in event)) event.target = this;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener.call(this, event);
    return event;
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.length, 0);
  }
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, { id = "", classes = [], attributes = {}, parent = null } = {}) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.classList = classes;
    this.className = classes.join(" ");
    this.attributes = { ...attributes };
    this.parentElement = parent;
    this.form = null;
    this.value = "";
    this.textContent = "";
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes[name] ?? null;
  }
  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  closest(selector) {
    const interactive = /button|a|input|select|textarea|summary|form|\[role/.test(selector);
    for (let current = this; current; current = current.parentElement) {
      if (interactive && /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|FORM)$/.test(current.tagName)) return current;
    }
    return null;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(script) {
    super();
    this.currentScript = script;
    this.documentElement = new FakeElement("html");
  }
  querySelector(selector) {
    if (selector.includes("script")) return this.currentScript;
    return null;
  }
}

function fixture({ search = "", stored = null, limits } = {}) {
  let now = 0;
  const storage = new Map();
  if (stored !== null) storage.set("qq:latency", stored);
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const script = new FakeElement("script");
  script.dataset = { uiGeneration: "generation-proof", uiRevision: "revision-proof" };
  const document = new FakeDocument(script);
  const viewport = new FakeEventTarget();
  Object.assign(viewport, { width: 700, height: 500, scale: 1 });
  let nextFrame = 1;
  const frames = new Map();
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.records = [];
      this.connected = false;
      observers.push(this);
    }
    observe() { this.connected = true; }
    disconnect() { this.connected = false; }
    takeRecords() { return this.records.splice(0); }
    emit(records) { if (this.connected) this.callback(records); }
    queue(records) { if (this.connected) this.records.push(...records); }
  }
  const host = new FakeEventTarget();
  Object.assign(host, {
    document,
    location: { href: `https://qq.invalid/session/one${search}`, search },
    sessionStorage,
    performance: { now: () => now, timeOrigin: 1_700_000_000_000 },
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    visualViewport: viewport,
    navigator: { userAgent: "qq-proof-browser" },
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    console: { table() {} },
    URL,
    URLSearchParams,
  });
  const api = createQQLatencyStudy(host, limits ? { limits } : {});
  return {
    api,
    host,
    document,
    viewport,
    observers,
    storage,
    setNow(value) { now = value; },
    frame(value) {
      now = value;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(value);
    },
    frameCount: () => frames.size,
  };
}

const disabled = fixture();
assert.equal(disabled.api.snapshot().active, false, "study defaults off");
assert.equal(disabled.observers.length, 0, "disabled mode creates no MutationObserver");
assert.equal(disabled.document.listenerCount(), 0, "disabled mode creates no document listeners");
assert.equal(disabled.frameCount(), 0, "disabled mode schedules no animation frame");

const queryDisabled = fixture({ search: "?qq-latency=0", stored: "1" });
assert.equal(queryDisabled.api.snapshot().active, false, "query zero overrides a stored opt-in");
assert.equal(queryDisabled.storage.get("qq:latency"), "0", "query zero persists for the tab");
assert.equal(queryDisabled.observers.length, 0);

const persisted = fixture({ stored: "1" });
assert.equal(persisted.api.snapshot().active, true, "sessionStorage opt-in survives page navigation/reload");
assert.equal(persisted.observers.length, 1);
persisted.api.stop();

const study = fixture({ search: "?qq-latency=1" });
assert.equal(study.api.snapshot().active, true, "query one starts the study");
assert.equal(study.storage.get("qq:latency"), "1", "query one persists for the tab");
assert.equal(study.observers.length, 1, "enabled mode creates one observer");

const form = new FakeElement("form", { id: "composer", attributes: { action: "/qq/session/secret-id/prompt", method: "post" } });
const button = new FakeElement("button", { id: "send", classes: ["composer-send"], parent: form });
button.form = form;
const prompt = new FakeElement("textarea", { id: "prompt", classes: ["composer-input"], parent: form });
prompt.form = form;
prompt.value = "TOP SECRET PROMPT";
prompt.textContent = "TOP SECRET PROMPT";

study.setNow(10);
const pointer = study.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: button });
study.setNow(11);
study.document.dispatch("click", { isTrusted: true, button: 0, target: button });
study.setNow(12);
const submit = study.document.dispatch("submit", { isTrusted: true, target: form, submitter: button });
assert.equal(study.api.snapshot().origins.length, 1, "pointerdown/click/submit gesture chain has one origin");
assert.equal(pointer.type, "pointerdown");

const xhr = {};
study.setNow(14);
study.document.dispatch("htmx:beforeRequest", {
  target: form,
  detail: { elt: form, xhr, requestConfig: { triggeringEvent: submit, verb: "post", path: "/qq/session/secret-id/prompt?prompt=TOP+SECRET+PROMPT" } },
});
study.setNow(15);
study.document.dispatch("htmx:beforeSend", {
  target: form,
  detail: { elt: form, xhr, requestConfig: { triggeringEvent: submit, verb: "post", path: "/qq/session/secret-id/prompt?prompt=TOP+SECRET+PROMPT" } },
});

study.setNow(20);
study.document.dispatch("input", { isTrusted: true, target: prompt, data: "TOP SECRET PROMPT" });
study.observers[0].emit([
  { type: "characterData", target: { nodeType: 3, parentElement: prompt } },
  { type: "attributes", target: prompt, attributeName: "style" },
]);
assert.equal(study.frameCount(), 1, "native and mutation signals share one pending frame");
study.frame(30);
let snapshot = study.api.snapshot();
assert.equal(snapshot.visuals.length, 1, "coalesced signals produce one presentation opportunity");
assert.equal(snapshot.visuals[0].mutationCount, 2);
assert.deepEqual(snapshot.visuals[0].sources, ["input", "mutation:attributes", "mutation:characterData"]);
assert.equal(snapshot.visuals[0].latestInteractionLatencyMs, 20);
assert.equal(snapshot.visuals[0].activeRequestLatencyMs, 20);
assert.equal(snapshot.visuals[0].networkDispatchLatencyMs, 15);
study.setNow(32);
study.document.dispatch("htmx:afterRequest", {
  target: form,
  detail: { elt: form, xhr, successful: true },
});

const drawer = new FakeElement("button", { id: "project-drawer-toggle", classes: ["drawer-toggle"] });
study.setNow(40);
study.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: drawer });
study.setNow(41);
study.document.dispatch("click", { isTrusted: true, button: 0, target: drawer });
study.observers[0].emit([{ type: "attributes", target: drawer, attributeName: "class" }]);
study.frame(50);
snapshot = study.api.snapshot();
assert.equal(snapshot.origins.length, 2, "a later local gesture becomes the latest interaction");
assert.equal(snapshot.visuals[1].latestInteractionLatencyMs, 10);
assert.equal(snapshot.visuals[1].activeRequestLatencyMs, 40, "local gesture does not erase the prompt request origin");
assert.equal(snapshot.visuals[1].activeRequestId, "request-1", "request completion does not clear stream correlation");

study.setNow(60);
study.observers[0].queue([{ type: "characterData", target: { nodeType: 3, parentElement: prompt } }]);
study.api.markStreamPaint(prompt, 900);
study.setNow(61);
study.observers[0].queue([{ type: "characterData", target: { nodeType: 3, parentElement: prompt } }]);
study.api.markStreamPaint(prompt, 900);
snapshot = study.api.snapshot();
assert.equal(snapshot.visuals.length, 3, "multiple stream writes in one browser frame coalesce");
assert.equal(snapshot.visuals[2].mutationCount, 2, "stream hook drains observer records into its direct sample");
assert.deepEqual(snapshot.visuals[2].sources, ["mutation:characterData", "stream-paint"]);
assert.equal(study.frameCount(), 0, "stream sample does not add an observer-frame delay");

const interruptForm = new FakeElement("form", { id: "interrupt-form", attributes: { action: "/qq/interrupt", method: "post" } });
const interrupt = new FakeElement("button", { id: "interrupt", parent: interruptForm });
interrupt.form = interruptForm;
study.setNow(70);
const interruptPointer = study.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: interrupt });
study.setNow(71);
study.document.dispatch("click", { isTrusted: true, button: 0, target: interrupt });
const interruptXhr = {};
study.setNow(72);
study.document.dispatch("htmx:beforeRequest", {
  target: interruptForm,
  detail: { elt: interruptForm, xhr: interruptXhr, requestConfig: { triggeringEvent: interruptPointer, verb: "post", path: "/qq/interrupt" } },
});
study.setNow(73);
study.document.dispatch("htmx:beforeSend", {
  target: interruptForm,
  detail: { elt: interruptForm, xhr: interruptXhr, requestConfig: { triggeringEvent: interruptPointer, verb: "post", path: "/qq/interrupt" } },
});
study.document.dispatch("input", { isTrusted: false, target: interrupt });
study.frame(80);
snapshot = study.api.snapshot();
assert.equal(snapshot.visuals.at(-1).activeRequestId, "request-2", "a newer dispatch supersedes the active request");
assert.equal(snapshot.visuals.at(-1).activeRequestLatencyMs, 10);

study.api.clear();
study.setNow(100);
const keydown = study.document.dispatch("keydown", { isTrusted: true, key: "x", target: prompt });
study.setNow(101);
study.document.dispatch("submit", { isTrusted: true, target: form, submitter: button });
const percentileXhr = {};
study.document.dispatch("htmx:beforeRequest", {
  target: form,
  detail: { elt: form, xhr: percentileXhr, requestConfig: { triggeringEvent: keydown, verb: "post", path: "/prompt" } },
});
study.document.dispatch("htmx:beforeSend", {
  target: form,
  detail: { elt: form, xhr: percentileXhr, requestConfig: { triggeringEvent: keydown, verb: "post", path: "/prompt" } },
});
for (const latency of [10, 20, 30, 40, 50]) {
  study.setNow(100 + latency - 1);
  study.document.dispatch("input", { isTrusted: true, target: prompt, data: "never retained" });
  study.frame(100 + latency);
}
const [row] = study.api.summary();
assert.equal(row.count, 5);
assert.equal(row.firstLatencyMs, 10);
assert.equal(row.p50LatencyMs, 30);
assert.equal(row.p95LatencyMs, 48, "p95 uses linear interpolation");
assert.equal(row.lastLatencyMs, 50);
assert.deepEqual(study.api.report(), study.api.summary(), "report returns the tabled summary");

snapshot = study.api.snapshot();
assert.equal(snapshot.measurement, "visual-ready/presentation-opportunity");
assert.match(snapshot.precision, /one frame/);
assert.equal(snapshot.startedAt, 80);
assert.equal(snapshot.timeOrigin, 1_700_000_000_000);
assert.equal(snapshot.ui.generation, "generation-proof");
assert.equal(snapshot.ui.revision, "revision-proof");
assert.equal(snapshot.viewport.visual.width, 700);
assert.equal(snapshot.userAgent, "qq-proof-browser");
const encoded = JSON.stringify(snapshot);
assert.doesNotMatch(encoded, /TOP SECRET PROMPT|never retained/, "snapshot never records input or prompt text");
assert.doesNotMatch(encoded, /prompt=TOP/, "request query data is stripped");
assert.deepEqual(JSON.parse(encoded), snapshot, "snapshot is JSON-safe");

const ime = fixture({ search: "?qq-latency=1" });
const imeInput = new FakeElement("textarea", { id: "ime-input" });
imeInput.value = "PRIVATE IME TEXT";
ime.setNow(5);
ime.document.dispatch("beforeinput", {
  isTrusted: true,
  target: imeInput,
  inputType: "insertCompositionText",
  data: "PRIVATE IME TEXT",
});
const imeSnapshot = ime.api.snapshot();
assert.equal(imeSnapshot.origins[0].action, "input:insertCompositionText",
  "trusted native editing has a categorized fallback origin");
assert.doesNotMatch(JSON.stringify(imeSnapshot), /PRIVATE IME TEXT/);
ime.api.stop();

const bounded = fixture({ search: "?qq-latency=1", limits: { origins: 2, stages: 3, visuals: 3 } });
const boundedButton = new FakeElement("button", { id: "bounded" });
for (let index = 0; index < 5; index += 1) {
  bounded.setNow(index * 2000);
  bounded.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: boundedButton });
  bounded.document.dispatch("htmx:beforeRequest", { target: boundedButton, detail: { elt: boundedButton, xhr: {}, requestConfig: {} } });
  bounded.document.dispatch("input", { isTrusted: true, target: boundedButton });
  bounded.frame(index * 2000 + 10);
}
const boundedSnapshot = bounded.api.snapshot();
assert.equal(boundedSnapshot.origins.length, 2);
assert.equal(boundedSnapshot.stages.length, 3);
assert.equal(boundedSnapshot.visuals.length, 3);
assert.ok(boundedSnapshot.dropped.origins > 0);
assert.ok(boundedSnapshot.dropped.stages > 0);
assert.ok(boundedSnapshot.dropped.visuals > 0);
assert.equal(boundedSnapshot.dropped.total,
  boundedSnapshot.dropped.origins + boundedSnapshot.dropped.stages + boundedSnapshot.dropped.visuals);

const listenerCount = study.document.listenerCount() + study.host.listenerCount() + study.viewport.listenerCount();
assert.ok(listenerCount > 0);
study.api.stop();
assert.equal(study.api.snapshot().active, false);
assert.equal(study.storage.get("qq:latency"), "0");
assert.equal(study.document.listenerCount() + study.host.listenerCount() + study.viewport.listenerCount(), 0,
  "stop removes every study listener");
assert.equal(study.observers[0].connected, false, "stop disconnects the observer");
study.api.start();
assert.equal(study.api.snapshot().active, true, "API can explicitly restart recording");

console.log("visual latency study proof passed");
