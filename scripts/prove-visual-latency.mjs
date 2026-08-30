#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsoleHandler } from "../src/http-app.mjs";
import {
  LATENCY_BATCH_LIMITS,
  LATENCY_VISUAL_SOURCE_LABELS,
  sanitizeLatencyBatch,
} from "../src/latency-store.mjs";

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
assert.match(browserSource, /finishLiveSwitch[\s\S]*markSessionSwitchReady\(state\.latencySwitchId, document\.body\)/,
  "validated live-switch completion commits the session-scoped admission baseline");
assert.match(browserSource, /maximumKnownUserSequences = 4096[\s\S]*knownUserSequences\.delete/,
  "session sequence identity has an explicit memory bound");

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
    this.children = [];
    if (parent?.children) parent.children.push(this);
  }
  get dataset() {
    return Object.fromEntries(Object.entries(this.attributes)
      .filter(([name]) => name.startsWith("data-"))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  }
  set dataset(value) {
    for (const [name, entry] of Object.entries(value ?? {})) {
      const attribute = `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
      this.attributes[attribute] = entry;
    }
  }
  get href() { return this.attributes.href ?? ""; }
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
  matches(selector) {
    if (selector.includes(".message-user[data-seq]")) {
      return this.classList.includes("message-user") && this.getAttribute("data-seq") !== null;
    }
    if (selector.includes("#composer")) return this.id === "composer";
    if (selector.includes("a[href]")) return this.tagName === "A" && this.getAttribute("href") !== null;
    return false;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      for (const child of node.children ?? []) {
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  closest(selector) {
    const interactive = /button|a|input|select|textarea|summary|form|\[role/.test(selector);
    for (let current = this; current; current = current.parentElement) {
      if (selector.includes("a[href]") && current.tagName === "A" && current.getAttribute("href") !== null) return current;
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
    this.userNodes = [];
  }
  querySelector(selector) {
    if (selector.includes("script")) return this.currentScript;
    return null;
  }
  querySelectorAll(selector) {
    return selector === ".message-user[data-seq]" ? [...this.userNodes] : [];
  }
}

const deterministicRunUuid = "110ec58a-a0f2-4ac4-8393-c866d813b8d1";

function fixture({
  search = "",
  stored = null,
  limits,
  endpoint = "",
  fetchPlan = [],
  beaconResult = true,
  userAgent = "qq-proof-browser",
  wireFallback = false,
  sharedStorage = null,
  timeOrigin = 1_700_000_000_000,
  initialNow = 0,
  href = `https://qq.invalid/session/one${search}`,
  navigationEntries = [],
  paintEntries = [],
  initialUserSequences = [],
  runId,
} = {}) {
  let now = initialNow;
  const storage = sharedStorage ?? new Map();
  if (stored !== null) storage.set("qq:latency", stored);
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const script = new FakeElement("script");
  script.dataset = {
    uiGeneration: "generation-proof",
    uiRevision: "revision-proof",
    ...(endpoint ? { latencyEndpoint: endpoint } : {}),
  };
  const document = new FakeDocument(script);
  for (const sequence of initialUserSequences) {
    document.userNodes.push(new FakeElement("article", {
      classes: ["message", "message-user"],
      attributes: { "data-seq": String(sequence) },
    }));
  }
  const viewport = new FakeEventTarget();
  Object.assign(viewport, { width: 700, height: 500, scale: 1 });
  let nextFrame = 1;
  const frames = new Map();
  let nextTimer = 1;
  const timers = new Map();
  const uploads = [];
  const beacons = [];
  const observers = [];
  const timerHistory = [];
  let activeUploads = 0;
  let maximumConcurrentUploads = 0;
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
    location: { href, search, origin: new URL(href).origin },
    sessionStorage,
    performance: {
      now: () => now,
      timeOrigin,
      getEntriesByType: (type) => type === "navigation" ? navigationEntries : type === "paint" ? paintEntries : [],
    },
    crypto: { randomUUID: () => deterministicRunUuid },
    MutationObserver: FakeMutationObserver,
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      timerHistory.push(delay);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, options) {
      activeUploads += 1;
      maximumConcurrentUploads = Math.max(maximumConcurrentUploads, activeUploads);
      try {
        uploads.push({ url, options });
        const payload = JSON.parse(options.body);
        const planned = fetchPlan.shift();
        if (planned === "network") throw new Error("proof network failure");
        const plannedStatus = planned === "failure" ? 503 : planned;
        if (Number.isInteger(plannedStatus)) {
          return { ok: plannedStatus >= 200 && plannedStatus < 300, status: plannedStatus, json: async () => ({}) };
        }
        if (typeof planned === "function") return await planned(payload, options);
        const maximum = (entries) => entries.reduce((value, entry) => Math.max(value, entry.sequence), 0);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schema: "qq.visual-latency-ack/v1",
            accepted: true,
            runId: payload.runId,
            batchId: payload.batchId,
            cursors: {
              origins: maximum(payload.origins),
              stages: maximum(payload.stages),
              visuals: maximum(payload.visuals),
            },
          }),
        };
      } finally {
        activeUploads -= 1;
      }
    },
    visualViewport: viewport,
    navigator: {
      userAgent,
      sendBeacon(url, body) {
        beacons.push({ url, body });
        return beaconResult;
      },
    },
    Blob: wireFallback ? class UnavailableBlob { constructor() { throw new Error("Blob unavailable"); } } : Blob,
    ...(wireFallback ? { TextEncoder: class UnavailableTextEncoder { encode() { throw new Error("TextEncoder unavailable"); } } } : {}),
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    console: { table() {} },
    URL,
    URLSearchParams,
  });
  const api = createQQLatencyStudy(host, {
    ...(limits ? { limits } : {}),
    ...(runId ? { runId } : {}),
    uploadDebounceMs: 12_000,
  });
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
    timerCount: () => timers.size,
    timerDelays: () => [...timers.values()].map((timer) => timer.delay),
    timerHistory,
    maximumConcurrentUploads: () => maximumConcurrentUploads,
    uploads,
    beacons,
    async fireTimer(delay = null) {
      const next = delay === null
        ? timers.entries().next().value
        : [...timers.entries()].find(([, timer]) => timer.delay === delay);
      if (!next) return false;
      const [id, timer] = next;
      timers.delete(id);
      timer.callback();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
      return true;
    },
  };
}

const ordinary = fixture();
assert.equal(ordinary.api.snapshot().active, true, "study defaults on without a query or stored preference");
assert.equal(ordinary.storage.get("qq:latency"), "1", "the default-on preference persists for the tab");
assert.equal(ordinary.observers.length, 1, "default-on mode creates one MutationObserver");
assert.ok(ordinary.document.listenerCount() > 0, "default-on mode installs document listeners");
const ordinaryButton = new FakeElement("button", { id: "ordinary" });
ordinary.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: ordinaryButton });
ordinary.document.dispatch("input", { isTrusted: true, target: ordinaryButton });
assert.equal(ordinary.frameCount(), 1, "ordinary visual signals schedule collection immediately");
ordinary.frame(16);
assert.equal(ordinary.api.snapshot().origins.length, 1, "ordinary use collects interactions immediately");
assert.equal(ordinary.api.snapshot().visuals.length, 1, "ordinary use collects visual records by default");
ordinary.api.stop();

const storedDisabled = fixture({ stored: "0" });
assert.equal(storedDisabled.api.snapshot().active, false, "a stored per-tab opt-out survives navigation/reload");
assert.equal(storedDisabled.storage.get("qq:latency"), "0");
assert.equal(storedDisabled.observers.length, 0, "stored opt-out creates no MutationObserver");
assert.equal(storedDisabled.document.listenerCount(), 0, "stored opt-out creates no document listeners");
assert.equal(storedDisabled.frameCount(), 0, "stored opt-out schedules no animation frame");
storedDisabled.api.start();
assert.equal(storedDisabled.api.snapshot().active, true, "start re-enables a stored opt-out");
assert.equal(storedDisabled.storage.get("qq:latency"), "1", "start persists re-enablement for the tab");
storedDisabled.api.stop();

const queryDisabled = fixture({ search: "?qq-latency=0", stored: "1" });
assert.equal(queryDisabled.api.snapshot().active, false, "query zero overrides a stored opt-in");
assert.equal(queryDisabled.storage.get("qq:latency"), "0", "query zero persists for the tab");
assert.equal(queryDisabled.observers.length, 0);
assert.equal(queryDisabled.document.listenerCount(), 0, "query opt-out creates no document listeners");
assert.equal(queryDisabled.frameCount(), 0, "query opt-out schedules no animation frame");

const queryEnabled = fixture({ search: "?qq-latency=1", stored: "0" });
assert.equal(queryEnabled.api.snapshot().active, true, "query one overrides and re-enables a stored opt-out");
assert.equal(queryEnabled.storage.get("qq:latency"), "1", "query one persists re-enablement for the tab");
assert.equal(queryEnabled.observers.length, 1);
queryEnabled.api.stop();

const persisted = fixture({ stored: "1" });
assert.equal(persisted.api.snapshot().active, true, "sessionStorage re-enablement survives page navigation/reload");
assert.equal(persisted.observers.length, 1);
persisted.api.stop();

const correlationRace = fixture({ search: "?qq-latency=1" });
const raceForm = new FakeElement("form", { id: "race-form", attributes: { action: "/qq/prompt", method: "post" } });
const raceTarget = new FakeElement("div", { id: "race-response" });
const raceXhr = {};
correlationRace.setNow(1);
correlationRace.document.dispatch("htmx:beforeRequest", { target: raceForm, detail: { elt: raceForm, xhr: raceXhr } });
correlationRace.setNow(2);
correlationRace.document.dispatch("htmx:beforeSend", { target: raceForm, detail: { elt: raceForm, xhr: raceXhr } });
correlationRace.setNow(3);
correlationRace.document.dispatch("htmx:afterSwap", { target: raceForm, detail: { elt: raceForm, xhr: raceXhr } });
correlationRace.setNow(4);
correlationRace.document.dispatch("htmx:afterRequest", { target: raceForm, detail: { elt: raceForm, xhr: raceXhr } });
assert.equal(correlationRace.api.snapshot().activeRequest, null);
correlationRace.setNow(5);
correlationRace.observers[0].emit([{ type: "childList", target: raceTarget }]);
correlationRace.frame(16);
assert.equal(correlationRace.api.snapshot().visuals[0].activeRequestId, "request-1",
  "a swap mutation delivered after completion retains the primed request context");
correlationRace.setNow(20);
correlationRace.api.markStreamPaint(raceTarget);
assert.equal(correlationRace.api.snapshot().visuals[1].activeRequestId, null,
  "the next progressive visual does not reuse the completed request");
correlationRace.api.stop();

const pendingUpgrade = fixture({ search: "?qq-latency=1" });
const upgradeForm = new FakeElement("form", { id: "upgrade-form", attributes: { action: "/qq/prompt", method: "post" } });
const upgradeTarget = new FakeElement("div", { id: "upgrade-response" });
pendingUpgrade.document.dispatch("input", { target: upgradeTarget });
const upgradeXhr = {};
pendingUpgrade.document.dispatch("htmx:beforeRequest", { target: upgradeForm, detail: { elt: upgradeForm, xhr: upgradeXhr } });
pendingUpgrade.document.dispatch("htmx:beforeSend", { target: upgradeForm, detail: { elt: upgradeForm, xhr: upgradeXhr } });
pendingUpgrade.observers[0].emit([{ type: "childList", target: upgradeTarget }]);
pendingUpgrade.document.dispatch("htmx:afterRequest", { target: upgradeForm, detail: { elt: upgradeForm, xhr: upgradeXhr } });
pendingUpgrade.frame(16);
assert.equal(pendingUpgrade.api.snapshot().visuals[0].activeRequestId, "request-1",
  "a response signal upgrades an aggregate that began before dispatch");
pendingUpgrade.api.stop();

const concurrentRequests = fixture({ search: "?qq-latency=1" });
const firstXhr = {};
const secondXhr = {};
for (const xhr of [firstXhr, secondXhr]) {
  concurrentRequests.document.dispatch("htmx:beforeRequest", { target: raceForm, detail: { elt: raceForm, xhr } });
  concurrentRequests.document.dispatch("htmx:beforeSend", { target: raceForm, detail: { elt: raceForm, xhr } });
}
concurrentRequests.document.dispatch("htmx:afterRequest", { target: raceForm, detail: { elt: raceForm, xhr: firstXhr } });
assert.equal(concurrentRequests.api.snapshot().activeRequest.id, "request-2",
  "an older completion cannot clear the newer active request");
concurrentRequests.document.dispatch("htmx:afterRequest", { target: raceForm, detail: { elt: raceForm, xhr: secondXhr } });
assert.equal(concurrentRequests.api.snapshot().activeRequest, null);
concurrentRequests.api.stop();

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
study.setNow(22);
study.document.dispatch("htmx:afterRequest", {
  target: form,
  detail: { elt: form, xhr, successful: true },
});
assert.equal(study.api.snapshot().activeRequest, null, "request completion clears the global active request");
study.frame(30);
let snapshot = study.api.snapshot();
assert.equal(snapshot.visuals.length, 1, "coalesced signals produce one presentation opportunity");
assert.equal(snapshot.visuals[0].mutationCount, 2);
assert.deepEqual(snapshot.visuals[0].sources, ["input", "mutation:attributes", "mutation:characterData"]);
assert.equal(snapshot.visuals[0].latestInteractionLatencyMs, 20);
assert.equal(snapshot.visuals[0].activeRequestLatencyMs, 20);
assert.equal(snapshot.visuals[0].networkDispatchLatencyMs, 15,
  "pending initial response keeps the request context captured before completion");

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
assert.equal(snapshot.visuals[1].activeRequestLatencyMs, null,
  "a local visual after completion does not inherit the prompt request origin");
assert.equal(snapshot.visuals[1].activeRequestId, null, "request completion ends later visual correlation");

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
assert.equal(snapshot.visuals[2].activeRequestId, null,
  "later progressive stream paint remains measurable without an unevidenced prompt id");
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
assert.equal(study.api.summary().length, 1, "local summary emits one first-presentation row per request");
assert.equal(row.firstPresentationSamples, 1);
assert.equal(row.interactionToDispatchMs, 1);
assert.equal(row.interactionToFirstPresentationMs, 10);
assert.equal(row.dispatchToFirstPresentationMs, 9);
assert.equal("p95LatencyMs" in row, false, "progressive stream age is absent from the local request summary");
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

const sourceSessionId = "session-1a111111-1111-4111-8111-111111111111";
const sourceBackend = {
  defaultSessionId: sourceSessionId,
  read: async () => ({
    id: sourceSessionId,
    project: "source-proof",
    events: [],
    sessions: [{ id: sourceSessionId, project: "source-proof" }],
    conversation: { nodes: [], pending: [] },
    children: [],
    agentStatus: "idle",
  }),
  list: async () => [{ id: sourceSessionId, project: "source-proof" }],
  create: async () => ({ id: sourceSessionId, project: "source-proof", events: [] }),
  prompt: async () => ({ id: sourceSessionId, project: "source-proof", events: [] }),
  interrupt: async () => ({ id: sourceSessionId, project: "source-proof", events: [] }),
  close: async () => ({ id: null }),
};
const sourceTemporary = await mkdtemp(join(tmpdir(), "qq-ui-latency-sources-"));
const sourceLogPath = join(sourceTemporary, "ui-latency.ndjson");
const sourceServer = createServer(createConsoleHandler(sourceBackend, {
  basePath: "/source-proof",
  latencyLogPath: sourceLogPath,
}));
await new Promise((resolve, reject) => {
  sourceServer.once("error", reject);
  sourceServer.listen(0, "127.0.0.1", resolve);
});
try {
  const sourceEndpoint = `http://127.0.0.1:${sourceServer.address().port}/source-proof/ui-latency`;
  let browserSanitized = null;
  const allSources = fixture({
    endpoint: "/qq/ui-latency",
    fetchPlan: [async (payload, options) => {
      browserSanitized = sanitizeLatencyBatch(payload);
      return fetch(sourceEndpoint, {
        method: options.method,
        headers: options.headers,
        body: options.body,
      });
    }],
  });
  const sourceTarget = new FakeElement("div", { id: "all-visual-sources" });
  for (const type of ["beforeinput", "input", "change", "toggle", "focusin", "focusout", "scroll", "selectionchange", "invalid"]) {
    allSources.document.dispatch(type, { target: sourceTarget });
  }
  for (const type of ["resize", "scroll", "orientationchange", "pageshow", "popstate", "hashchange"]) {
    allSources.host.dispatch(type, { target: sourceTarget });
  }
  for (const type of ["resize", "scroll"]) allSources.viewport.dispatch(type, { target: sourceTarget });
  allSources.observers[0].emit([
    { type: "childList", target: sourceTarget },
    { type: "characterData", target: sourceTarget },
    { type: "attributes", target: sourceTarget },
    { type: "proof-other", target: sourceTarget },
  ]);
  allSources.api.markStreamPaint(sourceTarget);
  const coalesced = allSources.api.snapshot().visuals;
  assert.equal(coalesced.length, 1, "all recognized visual signals coalesce into one browser record");
  assert.deepEqual(coalesced[0].sources, [...LATENCY_VISUAL_SOURCE_LABELS].sort());
  assert.equal(coalesced[0].sources.length, 22);
  await allSources.fireTimer();
  for (let spin = 0; spin < 100 && allSources.api.snapshot().upload.inFlight; spin += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(browserSanitized, "the actual browser batch passes sanitizeLatencyBatch");
  assert.deepEqual(browserSanitized.visuals[0].sources, [...LATENCY_VISUAL_SOURCE_LABELS].sort());
  assert.equal(allSources.api.snapshot().upload.successes, 1, "the production HTTP route acknowledges all sources");
  const [persistedSourceLine] = (await readFile(sourceLogPath, "utf8")).trim().split("\n");
  const persistedSourceBatch = JSON.parse(persistedSourceLine);
  assert.deepEqual(persistedSourceBatch.visuals[0].sources, [...LATENCY_VISUAL_SOURCE_LABELS].sort(),
    "HTTP ingestion persists every recognized source label");
  allSources.api.stop();
} finally {
  await new Promise((resolve) => sourceServer.close(resolve));
}

const cumulativeHealth = fixture({ endpoint: "/qq/ui-latency", limits: { origins: 2, stages: 2, visuals: 2 } });
for (let index = 0; index < 3; index += 1) cumulativeHealth.api.markStreamPaint(new FakeElement("div", { id: `drop-${index}` }));
assert.equal(cumulativeHealth.api.snapshot().dropped.visuals, 1);
cumulativeHealth.api.clear();
assert.equal(cumulativeHealth.api.snapshot().dropped.visuals, 0, "clear resets the visible study window");
cumulativeHealth.api.markStreamPaint(new FakeElement("div", { id: "after-clear" }));
await cumulativeHealth.fireTimer();
const cumulativePayload = JSON.parse(cumulativeHealth.uploads[0].options.body);
assert.equal(cumulativePayload.health.ringBufferDrops.visuals, 1,
  "persisted ring-buffer health remains cumulative across a visible-window clear");
assert.equal(cumulativePayload.health.generated.visuals, 4);
cumulativeHealth.api.stop();

const uploading = fixture({ endpoint: "/qq/ui-latency", fetchPlan: ["failure"] });
const uploadForm = new FakeElement("form", {
  id: "upload-form",
  attributes: { action: "/qq/session/session-12345678-1234-4123-8123-123456789abc/prompt", method: "post" },
});
const uploadButton = new FakeElement("button", { id: "upload-button", parent: uploadForm });
uploadButton.form = uploadForm;
const uploadPrompt = new FakeElement("textarea", { id: "upload-prompt", parent: uploadForm });
uploadPrompt.form = uploadForm;
uploadPrompt.value = "WIRE SECRET PROMPT";
uploading.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: uploadButton });
uploading.document.dispatch("input", { isTrusted: true, target: uploadPrompt, data: "WIRE SECRET PROMPT" });
uploading.frame(16);
let uploadSnapshot = uploading.api.snapshot();
assert.equal(uploadSnapshot.origins[0].sequence, 1, "origins receive per-page monotonic upload sequences");
assert.equal(uploadSnapshot.visuals[0].sequence, 1, "visuals receive independent monotonic upload sequences");
assert.equal(uploadSnapshot.upload.enabled, true);
assert.equal(uploadSnapshot.upload.runId, `page-${deterministicRunUuid}`,
  "the deterministic proof exercises the production randomUUID run-id path");
assert.equal(uploadSnapshot.upload.pending.origins, 1);
assert.equal(uploading.timerCount(), 1, "new samples share one modest upload debounce");
await uploading.fireTimer();
assert.equal(uploading.uploads.length, 1);
assert.equal(uploading.uploads[0].options.keepalive, false);
assert.equal(uploading.api.snapshot().upload.failures, 1);
assert.equal(uploading.api.snapshot().upload.retrying, true, "failed batches retain their identity for retry");
const failedBody = uploading.uploads[0].options.body;
assert.equal(JSON.parse(failedBody).batchId, `page-${deterministicRunUuid}-1`);
assert.doesNotMatch(failedBody, /WIRE SECRET PROMPT/, "wire deltas retain no prompt or input text");

uploading.setNow(20);
uploading.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: uploadButton });
uploading.document.dispatch("input", { isTrusted: true, target: uploadPrompt, data: "ANOTHER WIRE SECRET" });
uploading.frame(32);
await uploading.fireTimer();
assert.equal(uploading.uploads.length, 2);
assert.equal(uploading.uploads[1].options.body, failedBody, "retry is byte-for-byte the same batch and identity");
uploadSnapshot = uploading.api.snapshot();
assert.deepEqual(uploadSnapshot.upload.acknowledged, { origins: 1, stages: 0, visuals: 1 });
assert.deepEqual(uploadSnapshot.upload.pending, { origins: 1, stages: 0, visuals: 1 },
  "acknowledging the retried batch leaves newer records pending");
await uploading.fireTimer();
const delta = JSON.parse(uploading.uploads[2].options.body);
assert.deepEqual(delta.origins.map((entry) => entry.sequence), [2], "post-ack upload includes only the origin delta");
assert.deepEqual(delta.visuals.map((entry) => entry.sequence), [2], "post-ack upload includes only the visual delta");
assert.notEqual(delta.batchId, JSON.parse(failedBody).batchId);
assert.deepEqual(uploading.api.snapshot().upload.pending, { origins: 0, stages: 0, visuals: 0 });
assert.equal(uploading.api.snapshot().upload.successes, 2);

uploading.api.clear();
uploading.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: uploadButton });
assert.equal(uploading.api.snapshot().origins[0].sequence, 3, "clear does not reuse a page sequence");
assert.equal(uploading.timerCount(), 1);
uploading.api.stop();
assert.equal(uploading.timerCount(), 0, "stop cancels passive upload scheduling");
const stoppedUploadCount = uploading.uploads.length;
uploading.host.dispatch("pagehide");
assert.equal(uploading.beacons.length, 0, "stopped mode does not flush on pagehide");
assert.equal(uploading.uploads.length, stoppedUploadCount);
uploading.api.start();
assert.equal(uploading.timerCount(), 1, "collection restart resumes upload of retained deltas");
uploading.api.stop();

const quarantined = fixture({ endpoint: "/qq/ui-latency", fetchPlan: [413] });
const rejectedFirst = new FakeElement("button", { id: "rejected-first" });
quarantined.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: rejectedFirst });
await quarantined.fireTimer();
let quarantineSnapshot = quarantined.api.snapshot().upload;
assert.equal(quarantineSnapshot.retrying, false, "413 is quarantined instead of pinning retryBatch");
assert.equal(quarantineSnapshot.quarantinedBatches, 1);
assert.equal(quarantineSnapshot.failures, 1);
assert.deepEqual(quarantineSnapshot.acknowledged, { origins: 1, stages: 0, visuals: 0 });
assert.deepEqual(quarantineSnapshot.dropped, { origins: 1, stages: 0, visuals: 0, total: 1 });
assert.deepEqual(quarantineSnapshot.pending, { origins: 0, stages: 0, visuals: 0 });
quarantined.setNow(1000);
const acceptedSecond = new FakeElement("button", { id: "accepted-second" });
quarantined.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: acceptedSecond });
await quarantined.fireTimer();
assert.deepEqual(JSON.parse(quarantined.uploads[1].options.body).origins.map((entry) => entry.sequence), [2],
  "the batch after a quarantined 413 starts strictly after the rejected cursor");
quarantineSnapshot = quarantined.api.snapshot().upload;
assert.equal(quarantineSnapshot.successes, 1);
assert.deepEqual(quarantineSnapshot.acknowledged, { origins: 2, stages: 0, visuals: 0 });
assert.deepEqual(quarantineSnapshot.dropped, { origins: 1, stages: 0, visuals: 0, total: 1 },
  "accepting a later batch does not over-count the rejected batch");
quarantined.api.stop();

for (const status of [400, 422]) {
  const rejected = fixture({ endpoint: "/qq/ui-latency", fetchPlan: [status] });
  rejected.document.dispatch("pointerdown", {
    isTrusted: true,
    button: 0,
    target: new FakeElement("button", { id: `rejected-${status}` }),
  });
  await rejected.fireTimer();
  const state = rejected.api.snapshot().upload;
  assert.equal(state.quarantinedBatches, 1, `${status} is deterministically quarantined`);
  assert.equal(state.retrying, false);
  assert.equal(state.dropped.origins, 1);
  rejected.api.stop();
}

for (const transient of ["network", 408, 429, 503]) {
  const retrying = fixture({ endpoint: "/qq/ui-latency", fetchPlan: [transient] });
  retrying.document.dispatch("pointerdown", {
    isTrusted: true,
    button: 0,
    target: new FakeElement("button", { id: `retry-${transient}` }),
  });
  await retrying.fireTimer();
  const retryBody = retrying.uploads[0].options.body;
  let state = retrying.api.snapshot().upload;
  assert.equal(state.retrying, true, `${transient} remains retryable`);
  assert.equal(state.quarantinedBatches, 0);
  assert.equal(state.dropped.total, 0);
  assert.deepEqual(retrying.timerDelays(), [12_000], `${transient} retries on the normal debounce, not a tight loop`);
  await retrying.fireTimer();
  assert.equal(retrying.uploads[1].options.body, retryBody, `${transient} retries byte-identically`);
  state = retrying.api.snapshot().upload;
  assert.equal(state.retrying, false);
  assert.equal(state.successes, 1);
  retrying.api.stop();
}

const splitVisuals = fixture({ endpoint: "/qq/ui-latency" });
const backlogSize = 321;
for (let index = 0; index < backlogSize; index += 1) {
  splitVisuals.setNow(index + 1);
  splitVisuals.api.markStreamPaint(new FakeElement("div", { id: `visual-${index}` }));
}
assert.equal(splitVisuals.api.snapshot().visuals.length, backlogSize, "upload bounds do not lower in-memory retention");
assert.deepEqual(splitVisuals.timerDelays(), [12_000], "the first backlog upload keeps the normal debounce");
while (splitVisuals.timerCount()) await splitVisuals.fireTimer();
const splitPayloads = splitVisuals.uploads.map((upload) => JSON.parse(upload.options.body));
assert.deepEqual(splitPayloads.map((payload) => payload.visuals.length), [128, 128, 65],
  "300+ typical visuals drain through the larger candidate ceiling");
assert.deepEqual(splitPayloads.flatMap((payload) => payload.visuals.map((entry) => entry.sequence)),
  Array.from({ length: backlogSize }, (_, index) => index + 1), "sequential batches retain every visual sequence without gaps");
assert.deepEqual(splitVisuals.timerHistory, [12_000, 0, 0], "acknowledged backlog batches continue immediately");
assert.equal(splitVisuals.maximumConcurrentUploads(), 1, "sequential backlog drain never overlaps requests");
assert.equal(splitVisuals.api.snapshot().upload.pending.visuals, 0);
assert.deepEqual(splitPayloads[0].health.generated, { origins: 0, stages: 0, visuals: backlogSize });
assert.deepEqual(splitPayloads[1].health.acknowledged, { origins: 0, stages: 0, visuals: 128 });
splitVisuals.api.stop();

const quarantineBacklog = fixture({ endpoint: "/qq/ui-latency", fetchPlan: [413] });
for (let index = 0; index < 140; index += 1) {
  quarantineBacklog.api.markStreamPaint(new FakeElement("div", { id: `quarantine-${index}` }));
}
await quarantineBacklog.fireTimer();
assert.deepEqual(quarantineBacklog.timerDelays(), [0], "deterministic quarantine advances to remaining backlog immediately");
await quarantineBacklog.fireTimer();
const postQuarantine = JSON.parse(quarantineBacklog.uploads[1].options.body);
assert.deepEqual(postQuarantine.visuals.map((entry) => entry.sequence), Array.from({ length: 12 }, (_, index) => index + 129));
assert.equal(postQuarantine.health.quarantineCount, 1);
assert.equal(postQuarantine.health.uploadDrops.visuals, 128);
assert.equal(quarantineBacklog.maximumConcurrentUploads(), 1);
quarantineBacklog.api.stop();

const wireBudgeted = fixture({
  endpoint: "/qq/ui-latency",
  userAgent: "測定🚀".repeat(180),
  wireFallback: true,
});
const maximalTargets = Array.from({ length: 12 }, (_, index) => new FakeElement("presentation-target", {
  id: `target-${index}-${"i".repeat(48)}`,
  classes: [`${"a".repeat(40)}`, `${"b".repeat(40)}`, `${"c".repeat(40)}`],
}));
const emitMaximalVisual = (targetStudy = wireBudgeted) => {
  let targetIndex = 0;
  const nextTarget = () => maximalTargets[targetIndex++ % maximalTargets.length];
  for (const type of ["beforeinput", "input", "change", "toggle", "focusin", "focusout", "scroll", "selectionchange", "invalid"]) {
    targetStudy.document.dispatch(type, { target: nextTarget() });
  }
  for (const type of ["resize", "scroll", "orientationchange", "pageshow", "popstate", "hashchange"]) {
    targetStudy.host.dispatch(type, { target: nextTarget() });
  }
  for (const type of ["resize", "scroll"]) targetStudy.viewport.dispatch(type, { target: nextTarget() });
  targetStudy.observers[0].emit([
    { type: "childList", target: nextTarget() },
    { type: "characterData", target: nextTarget() },
    { type: "attributes", target: nextTarget() },
    { type: "proof-other", target: nextTarget() },
  ]);
  targetStudy.api.markStreamPaint(nextTarget());
};
for (let index = 0; index < 140; index += 1) emitMaximalVisual();
assert.equal(wireBudgeted.api.snapshot().visuals[0].sources.length, 22);
assert.equal(wireBudgeted.api.snapshot().visuals[0].targets.length, 12);
while (wireBudgeted.timerCount()) await wireBudgeted.fireTimer();
assert.ok(wireBudgeted.uploads.length > 1, "maximal visual candidates are byte-trimmed into multiple batches");
for (const { options } of wireBudgeted.uploads) {
  const bytes = Buffer.byteLength(options.body);
  const payload = JSON.parse(options.body);
  assert.ok(bytes <= 220 * 1024, `browser fallback body stays under 220 KiB (${bytes})`);
  assert.ok(bytes < 256 * 1024, "browser body stays below the HTTP hard cap");
  assert.ok(payload.visuals.length > 0 && payload.visuals.length <= LATENCY_BATCH_LIMITS.visuals,
    "packing emits a non-empty visual prefix without splitting an entry");
  assert.match(payload.page.userAgent, /測定/);
  sanitizeLatencyBatch(payload);
}
assert.deepEqual(wireBudgeted.uploads.flatMap(({ options }) => JSON.parse(options.body).visuals.map((entry) => entry.sequence)),
  Array.from({ length: 140 }, (_, index) => index + 1), "byte-trimmed batches preserve maximal visual sequences");
assert.equal(wireBudgeted.maximumConcurrentUploads(), 1);
wireBudgeted.api.stop();

const pendingUnload = fixture({ endpoint: "/qq/ui-latency" });
const pendingUnloadTarget = new FakeElement("div", { id: "transcript-stream" });
for (let index = 0; index < 128; index += 1) {
  pendingUnload.api.markStreamPaint(pendingUnloadTarget);
  pendingUnload.document.dispatch("htmx:sseBeforeMessage", {
    target: pendingUnloadTarget,
    detail: { elt: pendingUnloadTarget },
  });
}
assert.equal(pendingUnload.api.snapshot().visuals.length, 128);
assert.equal(pendingUnload.api.snapshot().stages.length, 128,
  "the unload regression fills the visual and SSE-stage candidate ceilings");
assert.equal(pendingUnload.api.snapshot().upload.unloadWireBudgetBytes, 60 * 1024);
pendingUnload.host.dispatch("pagehide");
assert.equal(pendingUnload.beacons.length, 1, "a full pending candidate still queues one unload beacon");
const pendingUnloadBody = await pendingUnload.beacons[0].body.text();
assert.ok(Buffer.byteLength(pendingUnloadBody) <= 60 * 1024,
  "pagehide repacks pending data below the unload transport budget");
const pendingUnloadPayload = JSON.parse(pendingUnloadBody);
assert.ok(pendingUnloadPayload.visuals.length < 128,
  "the unload body trims whole entries rather than reusing the normal candidate");
assert.equal(pendingUnloadPayload.stages.length, 128,
  "unload packing retains a fitting SSE-stage prefix while trimming visuals");
sanitizeLatencyBatch(pendingUnloadPayload);
pendingUnload.api.stop();

const retryingUnload = fixture({
  endpoint: "/qq/ui-latency",
  fetchPlan: ["network"],
  beaconResult: false,
});
for (let index = 0; index < 128; index += 1) emitMaximalVisual(retryingUnload);
await retryingUnload.fireTimer();
const retainedRetryBody = retryingUnload.uploads[0].options.body;
assert.ok(Buffer.byteLength(retainedRetryBody) > 60 * 1024,
  "the regression fixture retains a normal retry larger than the unload budget");
const retainedRetryId = JSON.parse(retainedRetryBody).batchId;
retryingUnload.host.dispatch("pagehide");
assert.equal(retryingUnload.beacons.length, 1, "the bounded retry prefix is offered to sendBeacon once");
const retryBeaconBody = await retryingUnload.beacons[0].body.text();
assert.ok(Buffer.byteLength(retryBeaconBody) <= 60 * 1024,
  "a large retained retry is separately repacked for sendBeacon");
assert.notEqual(JSON.parse(retryBeaconBody).batchId, retainedRetryId,
  "the unload prefix has its own identity and does not replace the byte-identical normal retry");
assert.equal(retryingUnload.uploads.length, 2, "a rejected beacon falls back to one keepalive fetch");
assert.equal(retryingUnload.uploads[1].options.keepalive, true);
assert.equal(retryingUnload.uploads[1].options.body, retryBeaconBody,
  "the keepalive fallback uses the same transport-safe unload body");
assert.ok(Buffer.byteLength(retryingUnload.uploads[1].options.body) <= 60 * 1024);
for (let spin = 0; spin < 8 && retryingUnload.api.snapshot().upload.inFlight; spin += 1) await Promise.resolve();
assert.equal(retryingUnload.api.snapshot().upload.retrying, true,
  "building the unload prefix preserves the normal retry for a resumed page");
assert.equal(retryingUnload.timerCount(), 0, "the one unload fallback does not start a teardown drain");
retryingUnload.api.markStreamPaint(new FakeElement("div", { id: "after-resume" }));
await retryingUnload.fireTimer();
assert.equal(retryingUnload.uploads[2].options.keepalive, false);
assert.equal(retryingUnload.uploads[2].options.body, retainedRetryBody,
  "normal collection resumes with the original byte-identical transient retry");
retryingUnload.api.stop();

const unloading = fixture({ endpoint: "/qq/ui-latency" });
const unloadButton = new FakeElement("button", { id: "unload" });
unloading.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: unloadButton });
assert.equal(unloading.timerCount(), 1);
unloading.host.dispatch("pagehide");
assert.equal(unloading.beacons.length, 1, "pagehide queues one best-effort beacon");
assert.equal(unloading.beacons[0].url, "/qq/ui-latency");
assert.equal(unloading.beacons[0].body.type, "application/json");
assert.equal(unloading.api.snapshot().upload.beaconsQueued, 1);
assert.equal(JSON.parse(await unloading.beacons[0].body.text()).origins[0].sequence, 1);
unloading.api.stop();

let releaseHeldUpload;
const heldUpload = fixture({
  endpoint: "/qq/ui-latency",
  fetchPlan: [async (payload) => {
    await new Promise((resolve) => { releaseHeldUpload = resolve; });
    const maximum = (entries) => entries.reduce((value, entry) => Math.max(value, entry.sequence), 0);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        schema: "qq.visual-latency-ack/v1",
        accepted: true,
        runId: payload.runId,
        batchId: payload.batchId,
        cursors: {
          origins: maximum(payload.origins),
          stages: maximum(payload.stages),
          visuals: maximum(payload.visuals),
        },
      }),
    };
  }],
});
heldUpload.document.dispatch("pointerdown", { isTrusted: true, button: 0, target: new FakeElement("button", { id: "held" }) });
await heldUpload.fireTimer();
assert.equal(heldUpload.api.snapshot().upload.inFlight, true);
heldUpload.host.dispatch("pagehide");
assert.equal(heldUpload.beacons.length, 0, "pagehide does not overlap an already in-flight bounded upload");
assert.equal(heldUpload.uploads.length, 1);
releaseHeldUpload();
for (let spin = 0; spin < 20 && heldUpload.api.snapshot().upload.inFlight; spin += 1) await Promise.resolve();
assert.equal(heldUpload.api.snapshot().upload.successes, 1);
heldUpload.api.stop();

const externalEndpoint = fixture({ endpoint: "https://telemetry.invalid/collect" });
assert.equal(externalEndpoint.api.snapshot().upload.enabled, false, "a non-same-origin data endpoint is ignored");
externalEndpoint.api.stop();

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


// Startup metadata refreshes fixed buffered navigation/paint fields without URLs,
// descriptions, or arbitrary Server-Timing names.
const navigationEntry = {
  type: "navigate",
  startTime: 0,
  redirectStart: 0,
  redirectEnd: 0,
  workerStart: 0,
  fetchStart: 0,
  domainLookupStart: 4,
  domainLookupEnd: 6,
  connectStart: 6,
  secureConnectionStart: 7,
  connectEnd: 9,
  requestStart: 10,
  responseStart: 1_210,
  responseEnd: 1_260,
  domInteractive: 0,
  domContentLoadedEventStart: 0,
  domContentLoadedEventEnd: 0,
  domComplete: 0,
  loadEventStart: 0,
  loadEventEnd: 0,
  duration: 0,
  transferSize: 4_096,
  encodedBodySize: 3_000,
  decodedBodySize: 9_000,
  serverTiming: [
    { name: "qq-view", duration: 1_100, description: "PRIVATE SERVER DETAIL" },
    { name: "qq-render", duration: 12 },
    { name: "private-phase", duration: 999 },
  ],
};
const startup = fixture({
  endpoint: "/qq/ui-latency",
  initialNow: 14_250,
  navigationEntries: [navigationEntry],
  paintEntries: [
    { name: "first-contentful-paint", startTime: 1_500 },
    { name: "first-paint", startTime: 1_450 },
    { name: "private-paint", startTime: 1 },
  ],
  userAgent: "proof-浏览器",
});
let startupSnapshot = startup.api.snapshot();
assert.equal(startupSnapshot.startedAt, 14_250, "collector start preserves the full navigation-relative pre-script delay");
assert.equal(startupSnapshot.navigation.responseStart, 1_210);
assert.equal(startupSnapshot.navigation.loadEventEnd, null, "zero incomplete load milestones stay missing");
assert.equal(startupSnapshot.navigation.serverViewDuration, 1_100);
assert.equal(startupSnapshot.navigation.serverRenderDuration, 12);
assert.equal(startupSnapshot.firstPaint, 1_450);
assert.equal(startupSnapshot.firstContentfulPaint, 1_500);
assert.doesNotMatch(JSON.stringify(startupSnapshot), /PRIVATE SERVER DETAIL|private-phase|private-paint/);
navigationEntry.domInteractive = 15_000;
navigationEntry.domContentLoadedEventStart = 15_010;
navigationEntry.domContentLoadedEventEnd = 15_020;
navigationEntry.domComplete = 15_100;
navigationEntry.loadEventStart = 15_110;
navigationEntry.loadEventEnd = 15_120;
navigationEntry.duration = 15_120;
startupSnapshot = startup.api.snapshot();
assert.equal(startupSnapshot.navigation.loadEventEnd, 15_120,
  "navigation metadata refreshes so milestones completed after collector installation populate");
startup.api.markStreamPaint(new FakeElement("div", { id: "startup-proof" }));
await startup.fireTimer(12_000);
assert.equal(JSON.parse(startup.uploads[0].options.body).page.navigation.loadEventEnd, 15_120,
  "upload-batch construction refreshes late navigation milestones for persistence");
startup.api.stop();

// A same-origin primary activation transfers a strict handoff once. Intercepted,
// stale, and external activations do not contaminate a later document.
const transferStorage = new Map();
const intentSource = fixture({
  sharedStorage: transferStorage,
  timeOrigin: 2_000_000,
  initialNow: 100,
  runId: "page-intent-source",
  href: "https://qq.invalid/session/source?private=old",
});
const internalLink = new FakeElement("a", {
  id: "open-session",
  attributes: { href: "https://qq.invalid/session/destination?private=secret" },
});
intentSource.document.dispatch("click", { isTrusted: true, button: 0, target: internalLink });
const storedIntent = JSON.parse(transferStorage.get("qq:latency-navigation-intent"));
assert.equal(storedIntent.action, "NAVIGATE /session/:id");
assert.doesNotMatch(JSON.stringify(storedIntent), /private|secret|destination\?/);
await intentSource.fireTimer(0);
assert.equal(transferStorage.has("qq:latency-navigation-intent"), true,
  "an unprevented native navigation keeps its handoff while a slow response leaves the source document alive");
const intentDestination = fixture({
  sharedStorage: transferStorage,
  timeOrigin: 2_000_150,
  initialNow: 14_000,
  runId: "page-intent-destination",
  href: "https://qq.invalid/session/destination?private=secret",
});
assert.deepEqual(intentDestination.api.snapshot().navigationIntent, {
  id: storedIntent.id,
  sourceRunId: "page-intent-source",
  action: "NAVIGATE /session/:id",
  target: "a#open-session",
  at: 2_000_100,
  intentToNavigationMs: 50,
  intentToCollectorMs: 14_050,
}, "same-origin handoff includes fixed intent-to-navigation and intent-to-collector timing");
assert.equal(transferStorage.has("qq:latency-navigation-intent"), false, "handoff is consumed and cleared once");
const consumeAgain = fixture({ sharedStorage: transferStorage, timeOrigin: 2_020_000, initialNow: 1 });
assert.equal(consumeAgain.api.snapshot().navigationIntent, null, "the next document cannot consume an old handoff twice");
consumeAgain.api.stop();
intentDestination.api.stop();
intentSource.api.stop();

const interceptedStorage = new Map();
const intercepted = fixture({ sharedStorage: interceptedStorage, timeOrigin: 3_000_000, initialNow: 10 });
intercepted.document.addEventListener("click", (event) => { event.defaultPrevented = true; });
intercepted.document.dispatch("click", { isTrusted: true, button: 0, target: internalLink });
assert.equal(interceptedStorage.has("qq:latency-navigation-intent"), true);
await intercepted.fireTimer(0);
assert.equal(interceptedStorage.has("qq:latency-navigation-intent"), false,
  "an intercepted click is cleared after event propagation in the surviving document");
const externalLink = new FakeElement("a", { attributes: { href: "https://external.invalid/private?q=secret" } });
intercepted.document.dispatch("click", { isTrusted: true, button: 0, target: externalLink });
assert.equal(interceptedStorage.has("qq:latency-navigation-intent"), false, "external navigation never writes a handoff");
interceptedStorage.set("qq:latency-navigation-intent", JSON.stringify({
  id: "intent-stale", sourceRunId: "page-old", action: "NAVIGATE /old", target: "a#old", at: 1,
}));
const staleIntent = fixture({ sharedStorage: interceptedStorage, timeOrigin: 4_000_000, initialNow: 1 });
assert.equal(staleIntent.api.snapshot().navigationIntent, null, "stale handoff is consumed but never recorded");
assert.equal(interceptedStorage.has("qq:latency-navigation-intent"), false);
staleIntent.api.stop();
intercepted.api.stop();

const promptRequest = (targetFixture, xhr, at, { successful = true } = {}) => {
  const promptForm = new FakeElement("form", {
    id: "composer",
    attributes: { action: "/qq/session/local/prompt", method: "post" },
  });
  targetFixture.setNow(at);
  targetFixture.document.dispatch("htmx:beforeRequest", {
    target: promptForm,
    detail: { elt: promptForm, xhr, requestConfig: { verb: "post", path: "/qq/session/local/prompt" } },
  });
  targetFixture.setNow(at + 1);
  targetFixture.document.dispatch("htmx:beforeSend", {
    target: promptForm,
    detail: { elt: promptForm, xhr, requestConfig: { verb: "post", path: "/qq/session/local/prompt" } },
  });
  targetFixture.setNow(at + 100);
  targetFixture.document.dispatch("htmx:afterRequest", {
    target: promptForm,
    detail: { elt: promptForm, xhr, successful, failed: !successful },
  });
  return promptForm;
};
const userNode = (sequence, parent = null) => new FakeElement("article", {
  classes: ["message", "message-user"],
  attributes: { "data-seq": String(sequence) },
  parent,
});

const admissionKinds = (targetFixture) => targetFixture.api.snapshot().stages.filter((stage) =>
  ["prompt-admitted", "prompt-admission-unmatched"].includes(stage.kind));
const postSwapSse = (targetFixture, type, target, userNodes) => {
  targetFixture.document.userNodes = userNodes;
  targetFixture.document.dispatch("htmx:sseMessage", { target, detail: { elt: target, type } });
};

// The first two composer turns arrive as ordinary live child insertions.
const foldAdmission = fixture({ initialUserSequences: [1] });
const transcriptReplacement = new FakeElement("div", { id: "transcript-settled" });
const knownOne = foldAdmission.document.userNodes[0];
const liveThree = userNode(3);
promptRequest(foldAdmission, {}, 10);
foldAdmission.setNow(200);
foldAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [liveThree],
}]);
foldAdmission.frame(216);
const liveFive = userNode(5);
promptRequest(foldAdmission, {}, 300);
foldAdmission.setNow(500);
foldAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [liveFive],
}]);
foldAdmission.frame(516);
let admittedStages = foldAdmission.api.snapshot().stages.filter((stage) => stage.kind === "prompt-admitted");
assert.deepEqual(admittedStages.map((stage) => [stage.requestId, stage.conversationSequence]), [
  ["request-1", 3], ["request-2", 5],
], "the first two live-insert user nodes are FIFO-correlated exactly once");
assert.deepEqual(foldAdmission.api.snapshot().visuals
  .filter((visual) => visual.activeRequestId)
  .map((visual) => visual.activeRequestId), ["request-1", "request-2"],
"each of the first two admissions owns exactly one presentation context");

// With CONSOLE_PAIRS=2, the third and later user turns commonly arrive inside
// a post-swap transcript-reset rather than as standalone live insertions.
const foldedSeven = userNode(7, transcriptReplacement);
promptRequest(foldAdmission, {}, 600);
foldAdmission.setNow(800);
postSwapSse(foldAdmission, "transcript-reset", transcriptReplacement, [liveThree, liveFive, foldedSeven]);
foldAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [liveThree, liveFive, foldedSeven],
}]);
foldAdmission.frame(816);
const foldedNine = userNode(9, transcriptReplacement);
promptRequest(foldAdmission, {}, 900);
foldAdmission.setNow(1_100);
postSwapSse(foldAdmission, "transcript-reset", transcriptReplacement, [liveFive, foldedSeven, foldedNine]);
foldAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [liveFive, foldedSeven, foldedNine],
}]);
foldAdmission.frame(1_116);
admittedStages = foldAdmission.api.snapshot().stages.filter((stage) => stage.kind === "prompt-admitted");
assert.deepEqual(admittedStages.map((stage) => [stage.requestId, stage.conversationSequence]), [
  ["request-1", 3], ["request-2", 5], ["request-3", 7], ["request-4", 9],
], "third and later fold-reset admissions retain FIFO request identity and emit once");
for (const requestId of ["request-3", "request-4"]) {
  assert.equal(foldAdmission.api.snapshot().visuals.filter((visual) =>
    visual.activeRequestId === requestId).length, 1,
  `${requestId} owns exactly one fold-reset admission presentation`);
}

// Re-rendering an evicted-but-known sequence proves that a same-session reset
// neither snapshots only the current fold nor clears historical identity.
const admissionCountBeforeKnownReset = admissionKinds(foldAdmission).length;
foldAdmission.setNow(1_200);
postSwapSse(foldAdmission, "transcript-reset", transcriptReplacement, [knownOne, foldedSeven, foldedNine]);
foldAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [knownOne, foldedSeven, foldedNine],
}]);
assert.equal(admissionKinds(foldAdmission).length, admissionCountBeforeKnownReset,
  "a same-session reset containing only known/re-rendered sequences emits no admission");
foldAdmission.frame(1_216);
foldAdmission.api.stop();

const failedAdmission = fixture({ initialUserSequences: [10] });
promptRequest(failedAdmission, {}, 10, { successful: false });
assert.equal(failedAdmission.api.snapshot().pendingAdmissions, 0, "failed prompt never remains pending");
const externalUser = userNode(11);
failedAdmission.setNow(500);
failedAdmission.observers[0].emit([{ type: "childList", target: transcriptReplacement, addedNodes: [externalUser] }]);
const failedStages = failedAdmission.api.snapshot().stages;
assert.equal(failedStages.filter((stage) => stage.kind === "prompt-admission-failed").length, 1);
assert.equal(failedStages.filter((stage) => stage.kind === "prompt-admitted").length, 0,
  "a later external user node is not assigned to the failed request");
assert.equal(failedStages.find((stage) => stage.kind === "prompt-admission-unmatched")?.requestId, null);
failedAdmission.api.stop();

// A different-session bootstrap swaps settled then live content before its
// validated switch-ready boundary. Neither pre-ready observer delivery nor
// queued delivery after the baseline snapshot may classify historical nodes.
const bootstrapAdmission = fixture({ initialUserSequences: [9] });
promptRequest(bootstrapAdmission, {}, 10);
assert.equal(bootstrapAdmission.api.snapshot().pendingAdmissions, 1);
const resetStream = new FakeElement("div", { id: "console-stream" });
bootstrapAdmission.setNow(200);
const bootstrapSwitchId = bootstrapAdmission.api.markSessionSwitch(
  "/qq/project/private/folder/session/private-id", resetStream);
assert.equal(bootstrapAdmission.api.snapshot().pendingAdmissions, 0,
  "switching away removes outgoing-session prompt candidates from the FIFO");
// Model an outgoing request whose completion races behind switch activation.
// It must not be consumed by incoming historical/bootstrap nodes.
promptRequest(bootstrapAdmission, {}, 210);
assert.equal(bootstrapAdmission.api.snapshot().pendingAdmissions, 1,
  "a late successful completion can enter the FIFO while bootstrap is pending");
const incomingHistorical = userNode(1, transcriptReplacement);
bootstrapAdmission.setNow(320);
postSwapSse(bootstrapAdmission, "transcript-reset", transcriptReplacement, [incomingHistorical]);
bootstrapAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [incomingHistorical],
}]);
const liveTarget = new FakeElement("div", { id: "transcript-live-nodes" });
const incomingSteering = new FakeElement("article", {
  classes: ["message", "message-user", "message-steering"],
  attributes: { "data-seq": "3" },
  parent: liveTarget,
});
bootstrapAdmission.setNow(400);
postSwapSse(bootstrapAdmission, "live", liveTarget, [incomingHistorical, incomingSteering]);
bootstrapAdmission.observers[0].emit([{
  type: "childList", target: liveTarget, addedNodes: [incomingSteering],
}]);
assert.equal(admissionKinds(bootstrapAdmission).length, 0,
  "incoming user and steering nodes are suppressed until switch-ready");
bootstrapAdmission.setNow(500);
bootstrapAdmission.document.dispatch("htmx:sseBeforeMessage", {
  target: new FakeElement("div", { id: "switch-ready" }),
  detail: { elt: new FakeElement("div", { id: "switch-ready" }), type: "switch-ready" },
});
assert.equal(bootstrapAdmission.api.markSessionSwitchReady(bootstrapSwitchId, resetStream), true);
bootstrapAdmission.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [incomingHistorical, incomingSteering],
}]);
assert.equal(admissionKinds(bootstrapAdmission).length, 0,
  "transcript-reset then live then switch-ready snapshots a complete baseline without unmatched/FIFO admission");
assert.equal(bootstrapAdmission.api.snapshot().pendingAdmissions, 0);
bootstrapAdmission.frame(516);
assert.equal(bootstrapAdmission.api.snapshot().stages.find((stage) =>
  stage.kind === "session-switch-start")?.action, "NAVIGATE /qq/project/:project/:folder/session/:id");
bootstrapAdmission.api.stop();

const oneAdmission = fixture();
promptRequest(oneAdmission, {}, 100);
oneAdmission.setNow(2_000);
const admittedNode = userNode(1);
oneAdmission.observers[0].emit([{ type: "childList", target: admittedNode, addedNodes: [admittedNode] }]);
assert.equal(oneAdmission.api.snapshot().activeRequest, null,
  "admission after afterRequest does not reactivate the global HTTP request");
oneAdmission.frame(2_016);
const admissionPresentation = oneAdmission.api.snapshot().visuals.at(-1);
assert.equal(admissionPresentation.activeRequestId, "request-1");
assert.equal(admissionPresentation.networkDispatchLatencyMs, 1_915);
oneAdmission.setNow(2_100);
oneAdmission.observers[0].emit([{ type: "attributes", target: admittedNode }]);
oneAdmission.frame(2_116);
assert.equal(oneAdmission.api.snapshot().visuals.at(-1).activeRequestId, null,
  "request context is retained for exactly the admission presentation");
oneAdmission.api.stop();

const switchStudy = fixture();
switchStudy.setNow(1_000);
const streamTarget = new FakeElement("div", { id: "console-stream" });
const switchId = switchStudy.api.markSessionSwitch("/qq/session/next?secret=value", streamTarget);
switchStudy.setNow(1_500);
assert.equal(switchStudy.api.markSessionSwitchResponse(switchId, streamTarget), true);
switchStudy.setNow(2_000);
switchStudy.document.dispatch("htmx:sseOpen", { target: streamTarget, detail: { source: {} } });
for (const [at, type, target] of [
  [3_000, "switch-meta", new FakeElement("div", { id: "switch-meta" })],
  [5_000, "transcript-reset", new FakeElement("div", { id: "transcript-settled" })],
  [6_000, "live", new FakeElement("div", { id: "transcript-live-nodes" })],
  [9_000, "switch-ready", new FakeElement("div", { id: "switch-ready" })],
]) {
  switchStudy.setNow(at);
  switchStudy.document.dispatch("htmx:sseBeforeMessage", { target, detail: { elt: target, type, data: "PRIVATE SSE PAYLOAD" } });
}
assert.equal(switchStudy.api.snapshot().activeSessionSwitch, switchId,
  "an SSE ready frame alone cannot commit an unvalidated session identity");
switchStudy.setNow(9_001);
assert.equal(switchStudy.api.markSessionSwitchReady(switchId, streamTarget), true,
  "validated live-switch completion commits readiness after bootstrap frames");
assert.equal(switchStudy.api.markSessionSwitchReady(switchId, streamTarget), false,
  "the incoming baseline cannot be recommissioned twice");
const switchStages = switchStudy.api.snapshot().stages.filter((stage) => stage.sessionSwitchId === switchId);
assert.deepEqual(switchStages.map((stage) => [stage.kind, stage.channel]), [
  ["session-switch-start", null], ["session-switch-response", null], ["sse-open", null],
  ["sse-message-before", "switch-meta"],
  ["sse-message-before", "transcript-reset"], ["sse-message-before", "live"],
  ["sse-message-before", "switch-ready"], ["session-switch-ready", null],
], "multi-second session bootstrap records fixed channels and a validated ready boundary");
assert.doesNotMatch(JSON.stringify(switchStudy.api.snapshot()), /PRIVATE SSE PAYLOAD|secret=value/);
assert.equal(switchStudy.api.snapshot().activeSessionSwitch, switchId,
  "validated switch-ready remains correlated until its first presentation opportunity");
switchStudy.observers[0].emit([{
  type: "attributes", target: new FakeElement("main", { id: "session-panel" }), addedNodes: [],
}]);
switchStudy.frame(9_016);
assert.equal(switchStudy.api.snapshot().visuals.at(-1).sessionSwitchId, switchId,
  "the first post-ready visual is explicitly correlated to the session switch");
assert.equal(switchStudy.api.snapshot().activeSessionSwitch, null,
  "the first post-ready presentation closes local switch correlation");
switchStudy.api.stop();

const adoptedSwitch = fixture({ initialUserSequences: [3] });
adoptedSwitch.setNow(100);
const adoptedSwitchId = adoptedSwitch.api.markSessionSwitch("/qq/session/private-id", streamTarget);
adoptedSwitch.setNow(600);
assert.equal(adoptedSwitch.api.markSessionSwitchResponse(adoptedSwitchId, streamTarget), true);
adoptedSwitch.setNow(1_000);
const adoptedHistorical = userNode(1);
adoptedSwitch.document.userNodes = [adoptedHistorical];
assert.equal(adoptedSwitch.api.markSessionSwitchReady(adoptedSwitchId, streamTarget), true);
adoptedSwitch.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [adoptedHistorical],
}]);
assert.equal(adoptedSwitch.api.snapshot().stages.some((stage) => stage.kind === "prompt-admission-unmatched"), false,
  "full-body adoption primes incoming historical user sequences before queued mutations");
assert.equal(adoptedSwitch.frameCount(), 1, "full-page adoption explicitly schedules its presentation sample");
adoptedSwitch.frame(1_016);
assert.deepEqual(adoptedSwitch.api.snapshot().stages.map((stage) => stage.kind), [
  "session-switch-start", "session-switch-response", "session-switch-ready",
]);
assert.equal(adoptedSwitch.api.snapshot().visuals.at(-1).sessionSwitchId, adoptedSwitchId);
assert.equal(adoptedSwitch.api.snapshot().activeSessionSwitch, null);
promptRequest(adoptedSwitch, {}, 1_100);
adoptedSwitch.setNow(1_300);
adoptedSwitch.observers[0].emit([{
  type: "childList", target: transcriptReplacement, addedNodes: [userNode(3)],
}]);
assert.equal(adoptedSwitch.api.snapshot().stages.find((stage) => stage.kind === "prompt-admitted")?.conversationSequence, 3,
  "full-body adoption resets the outgoing session's sequence namespace");
adoptedSwitch.api.stop();

const fallbackStorage = new Map();
const fallbackSource = fixture({
  sharedStorage: fallbackStorage, timeOrigin: 5_000_000, initialNow: 100, runId: "page-fallback-source",
});
const fallbackSwitchId = fallbackSource.api.markSessionSwitch("/qq/session/private-id", streamTarget);
fallbackSource.setNow(5_100);
fallbackSource.api.markNavigationIntent("https://qq.invalid/qq/session/private-id?secret=yes", null, fallbackSwitchId);
const fallbackHandoff = JSON.parse(fallbackStorage.get("qq:latency-navigation-intent"));
assert.equal(fallbackHandoff.at, 5_000_100,
  "a cross-document fallback retains the original in-document switch start");
assert.equal(fallbackHandoff.action, "NAVIGATE /qq/session/:id");
assert.doesNotMatch(JSON.stringify(fallbackHandoff), /private-id|secret/);
fallbackSource.api.stop();

console.log("visual latency study proof passed");
