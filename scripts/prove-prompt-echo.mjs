#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConsoleHandler, PROMPT_MESSAGE_ID_HEADER, PROMPT_OUTCOME_HEADER } from "../src/http-app.mjs";
import { sanitizeLatencyBatch } from "../src/latency-store.mjs";
import { regionFingerprints, renderSessionContent, renderTranscript } from "../src/render.mjs";
import { safeClientMessageId } from "../src/client-message-id.mjs";

const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const consoleCss = readFileSync(new URL("../assets/console.css", import.meta.url), "utf8");
const factoryStart = "/* qq-prompt-echo-factory:start */";
const factoryEnd = "/* qq-prompt-echo-factory:end */";
const start = browserSource.indexOf(factoryStart);
const end = browserSource.indexOf(factoryEnd);
assert.ok(start >= 0 && end > start, "browser asset exposes the prompt-echo controller factory");
const factoryBody = browserSource.slice(start + factoryStart.length, end);
assert.doesNotMatch(factoryBody, /innerHTML/, "the prompt-echo implementation never uses innerHTML");
assert.match(factoryBody, /parameters\.get\("prompt"\)/, "the echo reads HTMX's already-captured parameters");
assert.match(factoryBody, /const configRequest = [\s\S]*writeClientMessageId\(request\.requestConfig\.parameters, clientMessageId\)/,
  "configRequest adds correlation before HTMX captures transport FormData");
assert.match(factoryBody, /configuredClientMessageIds\.get\(request\.requestConfig\)/,
  "beforeRequest reads the identity configured for that exact request object");
assert.match(browserSource,
  /addEventListener\("htmx:configRequest"[\s\S]{0,160}promptEchoes\.configRequest[\s\S]{0,160}addEventListener\("htmx:beforeRequest"/,
  "production registers correlation configuration before provisional creation");
assert.match(factoryBody, /host\.crypto\?\.randomUUID/, "correlation identity is born from browser cryptographic randomness");
assert.match(factoryBody, /new WeakMap\(\)/, "concrete XHR identity owns each prompt echo");
assert.match(browserSource, /admissionCandidates\.findIndex\(\(candidate\) => candidate\.messageId === messageId\)/,
  "authoritative admission timing selects out-of-order requests by exact in-memory ID");
assert.doesNotMatch(factoryBody, /shift\(\).*(?:message-user|queue-item)|(?:message-user|queue-item)[\s\S]{0,120}shift\(/,
  "authoritative reconciliation has no text/position/FIFO fallback");
assert.match(factoryBody, /\.queue-item\[data-client-message-id\]/,
  "safe authoritative queue correlations participate in exact pre-response reconciliation");
assert.match(factoryBody, /\.queue-item\[data-message-id\]/,
  "durable queue identities remain an exact old-core fallback");
assert.doesNotMatch(factoryBody, /replaceChildren/,
  "prompt reconciliation and cleanup remove only owned echo nodes");
assert.match(browserSource,
  /touchesPromptTruth[\s\S]{0,180}transcript-settled[\s\S]{0,100}session-queue/,
  "HTMX transcript-reset and queue swaps reconcile directly in their swap turn");
assert.doesNotMatch(browserSource,
  /const touchesTranscript = \(id\) =>[\s\S]{0,220}(?:transcript-settled|session-queue)/,
  "replacement truth does not add transcript capture/follow cycles");
const cssRule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return consoleCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
};
const sharedPromptGeometry = consoleCss.match(/\.message-user,\s*\.queue-item\s*\{([^}]*)\}/)?.[1] ?? "";
assert.match(sharedPromptGeometry, /width:\s*100%/, "queued and admitted prompts share full transcript width");
assert.match(sharedPromptGeometry, /padding:\s*\.7rem 2\.65rem \.7rem \.82rem/,
  "queued and admitted prompts share one desktop content inset");
assert.doesNotMatch(sharedPromptGeometry, /fit-content|margin-left:\s*auto/,
  "the shared prompt block cannot regress to compact right-aligned bubble geometry");
assert.doesNotMatch(cssRule(".queue-mark"), /display:\s*(?:grid|flex)|grid-template|margin(?:-left|-right)?:/,
  "the queue marker never reserves or indents a content column");
assert.match(cssRule(".queue-mark"), /position:\s*absolute/, "the queue marker overlays the shared block");
assert.match(cssRule(".queue-remove"), /position:\s*absolute/, "queue controls overlay the shared reserve");
for (const selector of [
  ".queue-edit textarea:focus", ".queue-edit textarea:focus-visible",
  ".queue-remove button:hover", ".queue-remove button:focus-visible",
]) {
  assert.doesNotMatch(cssRule(selector),
    /(?:^|;)\s*(?:display|position|inset|top|right|bottom|left|width|height|min-|max-|margin|padding|border(?:-(?:width|spacing))?|font(?:-size)?|line-height|letter-spacing|white-space|overflow|transform|transition|animation|flex|grid|gap)\s*:/,
    `${selector} cannot change queue layout`);
}
const statusCss = cssRule(".prompt-echo-status");
assert.match(statusCss, /position:\s*absolute/, "the accessible status is out of flow");
assert.match(statusCss, /clip(?:-path)?:/, "the status is visually hidden without consuming a row");
for (const state of ["pending", "accepted"]) {
  const rule = cssRule(`.queue-item[data-prompt-echo-state="${state}"]`);
  assert.ok(rule, `${state} has a non-geometric state decoration`);
  assert.doesNotMatch(rule,
    /(?:^|;)\s*(?:display|position|inset|top|right|bottom|left|width|height|min-|max-|margin|padding|border(?:-(?:width|spacing))?|font(?:-size)?|line-height|letter-spacing|white-space|overflow|transform|transition|animation|flex|grid|gap)\s*:/,
    `${state} decoration has no layout-affecting declarations`);
}
const createQQPromptEchoController = Function(`${factoryBody}\nreturn createQQPromptEchoController;`)();
assert.equal(typeof createQQPromptEchoController, "function");

function dataName(name) {
  return name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
function attributeName(name) {
  return `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  values() { return this.owner.className.split(/\s+/).filter(Boolean); }
  contains(name) { return this.values().includes(name); }
  add(...names) { this.owner.className = [...new Set([...this.values(), ...names])].join(" "); }
  remove(...names) { this.owner.className = this.values().filter((name) => !names.includes(name)).join(" "); }
}

let innerHtmlWrites = 0;
class FakeElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.id = "";
    this.className = "";
    this.classList = new FakeClassList(this);
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.value = "";
    this._text = "";
    this.blurred = false;
    this.blurCalls = 0;
    this.replaceChildrenCalls = 0;
    this.dataset = new Proxy({}, {
      get: (_target, name) => this.getAttribute(attributeName(String(name))) ?? undefined,
      set: (_target, name, value) => {
        this.setAttribute(attributeName(String(name)), String(value));
        return true;
      },
    });
  }
  set innerHTML(_value) { innerHtmlWrites += 1; throw new Error("innerHTML is forbidden in prompt echo proof"); }
  get innerHTML() { return ""; }
  set textContent(value) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._text = String(value ?? "");
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent ?? "").join(""); }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name === "id") this.id = text;
    if (name === "class") this.className = text;
  }
  getAttribute(name) {
    if (name === "id") return this.id || null;
    if (name === "class") return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof FakeElement)) continue;
      node.parentElement?.children.splice(node.parentElement.children.indexOf(node), 1);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.replaceChildrenCalls += 1;
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }
  blur() { this.blurred = true; this.blurCalls += 1; }
  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }
  matches(selector) {
    return String(selector).split(",").some((part) => {
      const candidate = part.trim();
      const clientIdentity = candidate.endsWith("[data-client-message-id]");
      const durableIdentity = candidate.endsWith("[data-message-id]");
      if (!clientIdentity && !durableIdentity) return false;
      const expectedClass = candidate.startsWith(".message-user") ? "message-user"
        : candidate.startsWith(".queue-item") ? "queue-item" : "";
      const attribute = clientIdentity ? "data-client-message-id" : "data-message-id";
      return Boolean(expectedClass)
        && this.classList.contains(expectedClass)
        && this.getAttribute(attribute) !== null;
    });
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    if (selector === "textarea[name='prompt']") {
      return this.children.find((child) => child.tagName === "TEXTAREA" && child.getAttribute("name") === "prompt") ?? null;
    }
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      if (this.id === id) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html");
  }
  createElement(tagName) { return new FakeElement(tagName); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
}

class FakeMutationObserver {
  static instances = [];
  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
  emit(records) { if (!this.disconnected) this.callback(records); }
}

class FakeXhr {
  constructor(messageId = "", status = 200, outcome = "") {
    this.messageId = messageId;
    this.status = status;
    this.outcome = outcome;
  }
  getResponseHeader(name) {
    if (name.toLowerCase() === PROMPT_MESSAGE_ID_HEADER.toLowerCase()) return this.messageId || null;
    if (name.toLowerCase() === PROMPT_OUTCOME_HEADER.toLowerCase()) return this.outcome || null;
    return null;
  }
}

function browserFixture({ maximumEchoes = 32 } = {}) {
  FakeMutationObserver.instances = [];
  const document = new FakeDocument();
  const body = new FakeElement("body");
  const transcript = new FakeElement("div");
  transcript.id = "transcript";
  const live = new FakeElement("div");
  live.id = "transcript-live";
  const liveNodes = new FakeElement("div");
  liveNodes.id = "transcript-live-nodes";
  const echoes = new FakeElement("ol");
  echoes.id = "prompt-echoes";
  echoes.setAttribute("data-session-id", "session-a");
  echoes.setAttribute("aria-live", "off");
  const queue = new FakeElement("div");
  queue.id = "session-queue";
  const form = new FakeElement("form");
  form.id = "composer";
  form.dataset.sessionId = "session-a";
  const input = new FakeElement("textarea");
  input.setAttribute("name", "prompt");
  form.append(input);
  live.append(liveNodes, queue, echoes);
  transcript.append(live);
  body.append(transcript, form);
  document.documentElement.append(body);

  const windowListeners = new Map();
  const marks = [];
  const persisted = [];
  const cleared = [];
  const fitted = [];
  const anchors = [];
  let sessionId = "session-a";
  let now = 0;
  let clientSequence = 0;
  const host = {
    document,
    crypto: {
      randomUUID: () => `00000000-0000-4000-8000-${String(++clientSequence).padStart(12, "0")}`,
    },
    MutationObserver: FakeMutationObserver,
    addEventListener(name, listener) { windowListeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (windowListeners.get(name) === listener) windowListeners.delete(name);
    },
  };
  const controller = createQQPromptEchoController(host, {
    maximumEchoes,
    currentSessionId: () => sessionId,
    composer: () => input,
    fitComposer: (...args) => fitted.push(args),
    clearComposerDraft: (id) => cleared.push(id),
    persistComposerDraft: (draft, id) => persisted.push([draft.value, id]),
    anchorTranscript: () => anchors.push(sessionId),
    markLocalEcho: (_xhr, echo) => marks.push({ at: now, target: echo.className }),
  });
  controller.commission(sessionId);
  const observer = FakeMutationObserver.instances.at(-1);
  const submit = (prompt, xhr = new FakeXhr(), { textareaValue = prompt } = {}) => {
    input.value = textareaValue;
    const parameters = new Map([["prompt", prompt]]);
    const requestConfig = { elt: form, parameters };
    const configEvent = { detail: requestConfig };
    assert.equal(controller.configRequest(configEvent), true);
    // This is HTMX 2.0's copy point: anything first written in beforeRequest
    // cannot enter this already-captured transport body.
    const transportParameters = new Map(parameters);
    const event = {
      detail: {
        elt: form,
        xhr,
        requestConfig,
      },
    };
    assert.equal(controller.beforeRequest(event), true);
    return {
      xhr,
      event,
      configEvent,
      clientMessageId: parameters.get("clientMessageId"),
      wireClientMessageId: transportParameters.get("clientMessageId"),
    };
  };
  const complete = ({ xhr, event }, successful = true) => controller.afterRequest({
    ...event,
    detail: { ...event.detail, successful, failed: !successful, xhr },
  });
  const authoritative = (messageId, { steering = false, text = "authoritative", clientMessageId = "" } = {}) => {
    const node = new FakeElement("article");
    node.className = `message message-user${steering ? " message-steering" : ""}`;
    if (messageId) node.setAttribute("data-message-id", messageId);
    if (clientMessageId) node.setAttribute("data-client-message-id", clientMessageId);
    const content = new FakeElement("div");
    content.className = "message-text";
    content.textContent = text;
    node.append(content);
    return node;
  };
  const queued = (messageId, text = "queued", { clientMessageId = "" } = {}) => {
    const node = new FakeElement("li");
    node.className = "queue-item message-queued";
    if (messageId) node.setAttribute("data-message-id", messageId);
    if (clientMessageId) node.setAttribute("data-client-message-id", clientMessageId);
    const content = new FakeElement("p");
    content.className = "queue-preview";
    content.textContent = text;
    node.append(content);
    return node;
  };
  return {
    document, transcript, liveNodes, echoes, queue, form, input, controller, observer,
    marks, persisted, cleared, fitted, anchors, submit, complete, authoritative, queued, windowListeners,
    setSession(value) { sessionId = value; form.dataset.sessionId = value; },
    setNow(value) { now = value; },
  };
}

assert.equal(safeClientMessageId("110ec58a-a0f2-4ac4-8393-c866d813b8d1"),
  "110ec58a-a0f2-4ac4-8393-c866d813b8d1");
assert.equal(safeClientMessageId("110EC58A-A0F2-4AC4-8393-C866D813B8D1"),
  "110ec58a-a0f2-4ac4-8393-c866d813b8d1", "safe UUIDs are canonicalized");
for (const invalid of ["", "not-a-uuid", "110ec58a-a0f2-3ac4-8393-c866d813b8d1",
  "110ec58a-a0f2-4ac4-7393-c866d813b8d1", "110ec58a-a0f2-4ac4-8393-c866d813b8d1-extra"]) {
  assert.equal(safeClientMessageId(invalid), "", `invalid client identity is rejected: ${invalid}`);
}

const browser = browserFixture();
const dangerous = '<script>window.pwned = true</script>\n  spaced & exact  ';
browser.setNow(12);
const first = browser.submit(dangerous, new FakeXhr("message-safe_1:part.2"), {
  textareaValue: "stale textarea value must not be echoed",
});
assert.match(first.clientMessageId, /^00000000-0000-4000-8000-\d{12}$/);
assert.equal(first.configEvent.detail.parameters.get("clientMessageId"), first.clientMessageId,
  "configRequest and the provisional share identity from birth");
assert.equal(first.wireClientMessageId, first.clientMessageId,
  "the exact UUID is present at HTMX's pre-beforeRequest transport copy point");
assert.equal(browser.echoes.children.length, 1);
let echo = browser.echoes.children[0];
const [mark, content, control, status] = echo.children;
assert.equal(echo.tagName, "LI");
assert.equal(echo.className, "queue-item message-queued",
  "the provisional outer box has authoritative queue-row classes");
assert.equal(echo.getAttribute("data-client-message-id"), first.clientMessageId);
assert.equal(echo.getAttribute("data-placement"), "queued");
assert.equal(mark.tagName, "SPAN");
assert.equal(mark.className, "queue-mark");
assert.equal(content.tagName, "P");
assert.equal(content.className, "queue-preview",
  "the provisional literal text uses queue-row geometry");
assert.equal(content.textContent, dangerous, "script-looking prompt is inserted as exact text");
assert.equal(control.className, "queue-remove");
assert.equal(control.children[0].tagName, "BUTTON");
assert.notEqual(control.children[0].getAttribute("disabled"), null,
  "provisional queue controls remain disabled until authority");
assert.equal(status.className, "prompt-echo-status");
assert.equal(status.textContent, "Message pending admission");
assert.equal(status.textContent.includes(dangerous), false,
  "the live status announces state without announcing prompt content again");
assert.equal(status.getAttribute("role"), "status");
assert.equal(status.getAttribute("aria-live"), "polite");
assert.equal(status.getAttribute("aria-atomic"), "true");
assert.equal(echo.getAttribute("aria-label"), "Queued message");
assert.equal(browser.echoes.getAttribute("aria-live"), "off", "raw content is not its own live announcement");
assert.equal(browser.input.value, "", "composer clears only after HTMX captured prompt and correlation");
assert.equal(innerHtmlWrites, 0);
assert.equal(browser.marks[0].at, 12);
assert.ok(browser.marks[0].at < 50, "deterministic interaction-to-local-row target is below 50ms");
assert.deepEqual(browser.anchors, ["session-a"], "submit performs exactly the original follow-anchor action");
assert.equal(browser.input.blurCalls, 1, "submit performs exactly the original composer blur");
const pendingGeometry = {
  outerClass: echo.className,
  outerStyle: echo.getAttribute("style"),
  childIdentity: [...echo.children],
  childShape: echo.children.map((node) => [node.tagName, node.className, node.getAttribute("style")]),
};

browser.complete(first);
echo = browser.echoes.children[0];
assert.equal(echo.getAttribute("data-message-id"), "message-safe_1:part.2");
assert.equal(echo.getAttribute("data-client-message-id"), first.clientMessageId);
assert.equal(echo.getAttribute("data-prompt-echo-state"), "accepted");
assert.equal(status.textContent, "Message accepted");
assert.equal(echo.className, pendingGeometry.outerClass);
assert.equal(echo.getAttribute("style"), pendingGeometry.outerStyle);
assert.deepEqual(echo.children, pendingGeometry.childIdentity,
  "pending to accepted preserves every layout node's identity and order");
assert.deepEqual(echo.children.map((node) => [node.tagName, node.className, node.getAttribute("style")]),
  pendingGeometry.childShape, "pending to accepted changes no layout-affecting markup or inline style");
assert.deepEqual(browser.anchors, ["session-a"], "response does not add a follow-anchor cycle");
assert.equal(browser.input.blurCalls, 1, "response does not add a focus/blur cycle");

// Old core/backend fallback: no correlation is projected, but the durable ID
// returned by POST still removes exactly the matching provisional.
const queueCopy = browser.queued("message-safe_1:part.2", dangerous, {
  clientMessageId: first.clientMessageId,
});
browser.queue.append(queueCopy);
browser.controller.reconcile(browser.queue);
assert.equal(browser.echoes.children.length, 0,
  "response-before-queue correlation leaves only authoritative queue truth");
assert.equal(queueCopy.parentElement, browser.queue);
assert.equal(browser.echoes.replaceChildrenCalls, 0, "reconciliation removes only the owned provisional node");

// The field-rejected ordering: queue authority arrives while durable POST is
// unresolved. Correlation must remove the provisional in this same mutation turn.
const queueFirst = browserFixture();
const queueFirstRequest = queueFirst.submit("queue arrived first", new FakeXhr("queue-first-core"));
const queueFirstTruth = queueFirst.queued("queue-first-core", "queue arrived first", {
  clientMessageId: queueFirstRequest.clientMessageId,
});
queueFirst.queue.append(queueFirstTruth);
queueFirst.observer.emit([{ type: "childList", target: queueFirst.queue, addedNodes: [queueFirstTruth] }]);
assert.equal(queueFirst.echoes.children.length, 0,
  "queue-before-response correlation atomically removes the provisional before paint");
assert.equal(queueFirst.queue.children.length, 1, "queue-before-response immediately has exactly one representation");
queueFirst.complete(queueFirstRequest);
assert.equal(queueFirst.echoes.children.length, 0, "late durable completion cannot recreate a removed provisional");

// Core authority handoff is continuous in either SSE order. A user node retires
// only its exact server queue row; if an old queue payload arrives afterwards it
// retires itself in the same observer turn.
const admittedHandoff = browserFixture();
const admittedRequest = admittedHandoff.submit("queue to admitted", new FakeXhr("admitted-core"));
const admittedQueue = admittedHandoff.queued("admitted-core", "queue to admitted", {
  clientMessageId: admittedRequest.clientMessageId,
});
const unrelatedQueue = admittedHandoff.queued("unrelated-core", "same text is irrelevant", {
  clientMessageId: "00000000-0000-4000-8000-999999999991",
});
admittedHandoff.queue.append(admittedQueue, unrelatedQueue);
admittedHandoff.observer.emit([{ type: "childList", target: admittedHandoff.queue, addedNodes: [admittedQueue, unrelatedQueue] }]);
assert.equal(admittedHandoff.echoes.children.length, 0);
const admittedUser = admittedHandoff.authoritative("admitted-core", {
  clientMessageId: admittedRequest.clientMessageId,
  text: "queue to admitted",
});
admittedHandoff.liveNodes.append(admittedUser);
admittedHandoff.observer.emit([{ type: "childList", target: admittedHandoff.liveNodes, addedNodes: [admittedUser] }]);
assert.deepEqual(admittedHandoff.queue.children, [unrelatedQueue],
  "admitted user authority retires only its exact server queue row");
assert.equal(admittedUser.parentElement, admittedHandoff.liveNodes,
  "the admitted transcript user remains authoritative");
const staleAdmittedQueue = admittedHandoff.queued("admitted-core", "queue to admitted", {
  clientMessageId: admittedRequest.clientMessageId,
});
admittedHandoff.queue.append(staleAdmittedQueue);
admittedHandoff.observer.emit([{ type: "childList", target: admittedHandoff.queue, addedNodes: [staleAdmittedQueue] }]);
assert.deepEqual(admittedHandoff.queue.children, [unrelatedQueue],
  "a stale exact queue insertion self-retires when its user already exists");

const durableHandoff = browserFixture();
const durableQueue = durableHandoff.queued("durable-handoff", "old projection queue");
durableHandoff.queue.append(durableQueue);
const correlatedUser = durableHandoff.authoritative("durable-handoff", {
  clientMessageId: "00000000-0000-4000-8000-999999999992",
  text: "old projection queue",
});
durableHandoff.liveNodes.append(correlatedUser);
durableHandoff.observer.emit([{ type: "childList", target: durableHandoff.liveNodes, addedNodes: [correlatedUser] }]);
assert.equal(durableHandoff.queue.children.length, 0,
  "exact durable ID bridges a handoff when one old projection omits correlation");
const conflictingQueue = durableHandoff.queued("durable-handoff", "conflicting correlation", {
  clientMessageId: "00000000-0000-4000-8000-999999999993",
});
durableHandoff.queue.append(conflictingQueue);
durableHandoff.observer.emit([{ type: "childList", target: durableHandoff.queue, addedNodes: [conflictingQueue] }]);
assert.equal(conflictingQueue.parentElement, durableHandoff.queue,
  "conflicting client identities never collapse through durable fallback");

const liveInsert = browserFixture();
const liveRequest = liveInsert.submit("live exact", new FakeXhr("live-core"));
const liveTruth = liveInsert.authoritative("live-core", {
  text: "live exact",
  clientMessageId: liveRequest.clientMessageId,
});
liveInsert.liveNodes.append(liveTruth);
liveInsert.observer.emit([{ type: "childList", target: liveInsert.liveNodes, addedNodes: [liveTruth] }]);
assert.equal(liveInsert.echoes.children.length, 0,
  "user authority can reconcile correlation before POST completion too");
assert.equal(liveTruth.parentElement, liveInsert.liveNodes);
liveInsert.complete(liveRequest);

const resetInsert = browserFixture();
const resetRequest = resetInsert.submit("reset exact", new FakeXhr("reset-core"));
const resetTruth = resetInsert.authoritative("reset-core", {
  steering: true,
  text: "reset exact",
  clientMessageId: resetRequest.clientMessageId,
});
const reset = new FakeElement("div");
reset.id = "transcript-settled";
reset.append(resetTruth);
resetInsert.transcript.append(reset);
resetInsert.observer.emit([{ type: "childList", target: resetInsert.transcript, addedNodes: [reset] }]);
assert.equal(resetInsert.echoes.children.length, 0,
  "matching transcript-reset subtree leaves only authoritative truth before completion");
resetInsert.complete(resetRequest);

const unmatched = browserFixture();
const unmatchedRequest = unmatched.submit("local exact only", new FakeXhr("local-exact"));
const externalQueue = unmatched.queued("external-queue", "same text is irrelevant", {
  clientMessageId: "00000000-0000-4000-8000-999999999999",
});
const externalUser = unmatched.authoritative("external-user", {
  text: "local exact only",
  clientMessageId: "00000000-0000-4000-8000-999999999998",
});
unmatched.queue.append(externalQueue);
unmatched.liveNodes.append(externalUser);
unmatched.observer.emit([
  { type: "childList", target: unmatched.queue, addedNodes: [externalQueue] },
  { type: "childList", target: unmatched.liveNodes, addedNodes: [externalUser] },
]);
assert.equal(unmatched.echoes.children.length, 1,
  "unmatched authority and identical text never consume a local provisional");
assert.equal(unmatched.echoes.children[0].getAttribute("data-client-message-id"), unmatchedRequest.clientMessageId);

// Multiple rapid identical submissions reconcile individually, in reverse queue
// order, without waiting for any POST and without text/FIFO/position matching.
const ordered = browserFixture();
const orderedRequests = [
  ordered.submit("identical concurrent", new FakeXhr("ordered-one")),
  ordered.submit("identical concurrent", new FakeXhr("ordered-two")),
  ordered.submit("identical concurrent", new FakeXhr("ordered-three")),
];
assert.equal(new Set(orderedRequests.map((request) => request.clientMessageId)).size, 3,
  "each rapid identical submission gets a distinct cryptographic correlation");
const [firstEcho, middleEcho, lastEcho] = ordered.echoes.children;
const lastTruth = ordered.queued("ordered-three", "identical concurrent", {
  clientMessageId: orderedRequests[2].clientMessageId,
});
ordered.queue.append(lastTruth);
ordered.observer.emit([{ type: "childList", target: ordered.queue, addedNodes: [lastTruth] }]);
assert.deepEqual(ordered.echoes.children, [firstEcho, middleEcho], "last correlation removes only last provisional");
const firstTruth = ordered.queued("ordered-one", "identical concurrent", {
  clientMessageId: orderedRequests[0].clientMessageId,
});
ordered.queue.append(firstTruth);
ordered.observer.emit([{ type: "childList", target: ordered.queue, addedNodes: [firstTruth] }]);
assert.deepEqual(ordered.echoes.children, [middleEcho], "first correlation removes only first provisional");
const middleTruth = ordered.queued("ordered-two", "identical concurrent", {
  clientMessageId: orderedRequests[1].clientMessageId,
});
ordered.queue.append(middleTruth);
ordered.observer.emit([{ type: "childList", target: ordered.queue, addedNodes: [middleTruth] }]);
assert.equal(ordered.echoes.children.length, 0, "all identical prompts converge independently before responses");
for (const request of orderedRequests.reverse()) ordered.complete(request);
assert.equal(middleEcho.parentElement, null);
assert.equal(ordered.echoes.replaceChildrenCalls, 0);
assert.deepEqual(ordered.anchors, ["session-a", "session-a", "session-a"],
  "authority and responses add no follow-anchor cycles");

const oldCore = browserFixture();
const oldCoreRequest = oldCore.submit("projection omits correlation", new FakeXhr("old-core-durable"));
const oldCoreTruth = oldCore.queued("old-core-durable", "projection omits correlation");
oldCore.queue.append(oldCoreTruth);
oldCore.observer.emit([{ type: "childList", target: oldCore.queue, addedNodes: [oldCoreTruth] }]);
assert.equal(oldCore.echoes.children.length, 1,
  "without projected correlation the controller refuses unsafe early matching");
oldCore.complete(oldCoreRequest);
assert.equal(oldCore.echoes.children.length, 0,
  "an old core still converges through the later exact durable-ID fallback");

const cleanupBrowser = browserFixture();
const failed = cleanupBrowser.submit("restore this exact failed draft", new FakeXhr("", 503));
cleanupBrowser.complete(failed, false);
assert.equal(cleanupBrowser.echoes.children.length, 0, "failure removes only that request's provisional");
assert.equal(cleanupBrowser.input.value, "restore this exact failed draft");
assert.deepEqual(cleanupBrowser.persisted.at(-1), ["restore this exact failed draft", "session-a"]);
cleanupBrowser.input.value = "";
const semanticFailure = cleanupBrowser.submit("restore a 200 OOB failure", new FakeXhr("", 200, "failed"));
cleanupBrowser.complete(semanticFailure, true);
assert.equal(cleanupBrowser.echoes.children.length, 0);
assert.equal(cleanupBrowser.input.value, "restore a 200 OOB failure",
  "fixed failure outcome overrides successful HTTP status");

cleanupBrowser.input.value = "";
const oldSession = cleanupBrowser.submit("must not cross sessions", new FakeXhr("late-old-id"));
cleanupBrowser.controller.reset();
cleanupBrowser.setSession("session-b");
cleanupBrowser.controller.commission("session-b");
assert.equal(cleanupBrowser.echoes.children.length, 0);
assert.equal(cleanupBrowser.echoes.dataset.sessionId, "session-b");
cleanupBrowser.complete(oldSession);
assert.equal(cleanupBrowser.echoes.children.length, 0,
  "late old-session completion has no mapping in the adopted session");
assert.notEqual(cleanupBrowser.input.value, "must not cross sessions");
const reused = cleanupBrowser.submit("new session correlation", new FakeXhr("new-session-id"));
const currentAuthoritative = cleanupBrowser.authoritative("new-session-id", {
  clientMessageId: reused.clientMessageId,
});
cleanupBrowser.liveNodes.append(currentAuthoritative);
cleanupBrowser.observer.emit([{ type: "childList", target: cleanupBrowser.liveNodes, addedNodes: [currentAuthoritative] }]);
assert.equal(cleanupBrowser.echoes.children.length, 0, "current-session correlation still reconciles exactly");
const cleanup = cleanupBrowser.submit("cleanup", new FakeXhr("cleanup-id"));
assert.ok(cleanup);
cleanupBrowser.windowListeners.get("pagehide")?.();
assert.equal(cleanupBrowser.echoes.children.length, 0, "page cleanup removes all in-memory and DOM provisionals");
assert.equal(cleanupBrowser.echoes.replaceChildrenCalls, 0);

for (const fixture of [
  browser, queueFirst, admittedHandoff, durableHandoff, liveInsert, resetInsert,
  unmatched, ordered, oldCore, cleanupBrowser,
]) {
  fixture.controller.dispose();
}
const nonAdmitting = browserFixture();
const noIdSuccess = nonAdmitting.submit("/find resolved without admission", new FakeXhr("", 200, "accepted"));
assert.equal(nonAdmitting.echoes.children.length, 1);
nonAdmitting.complete(noIdSuccess);
assert.equal(nonAdmitting.echoes.children.length, 0,
  "a successful prompt route with no authoritative message ID removes its provisional");
const unrelatedNoIdNode = nonAdmitting.authoritative("some-external-id");
nonAdmitting.liveNodes.append(unrelatedNoIdNode);
nonAdmitting.controller.reconcile(unrelatedNoIdNode);
assert.equal(nonAdmitting.echoes.children.length, 0,
  "no-ID completion leaves no accepted ghost and never consumes unrelated authority");
nonAdmitting.controller.dispose();
assert.equal(innerHtmlWrites, 0);

const sessionId = "session-1a111111-1111-4111-8111-111111111111";
const paths = {
  canonical: `/qq/session/${sessionId}`,
  events: `/qq/session/${sessionId}/events`,
  interrupt: `/qq/session/${sessionId}/interrupt`,
  prompt: `/qq/session/${sessionId}/prompt`,
  queue: `/qq/session/${sessionId}/queue`,
  close: `/qq/session/${sessionId}/close`,
};
const userCorrelation = "110ec58a-a0f2-4ac4-8393-c866d813b8d1";
const steeringCorrelation = "220ec58a-a0f2-4ac4-9393-c866d813b8d2";
const pendingCorrelation = "330ec58a-a0f2-4ac4-a393-c866d813b8d3";
const renderSnapshot = {
  id: sessionId,
  conversation: {
    nodes: [
      {
        seq: 1, kind: "user", messageId: "valid-user_1", clientMessageId: userCorrelation,
        content: [{ type: "text", text: "<script>literal</script>" }],
      },
      {
        seq: 2, kind: "steering", messageId: "valid-steering:2",
        source: { kind: "user", clientMessageId: steeringCorrelation },
        content: [{ type: "text", text: "steer" }],
      },
      {
        seq: 3, kind: "user", messageId: 'invalid" onclick="bad', clientMessageId: 'bad" onmouseover="bad',
        content: [{ type: "text", text: "invalid id" }],
      },
    ],
    pending: [{
      id: "pending-core-id", placement: "queued", text: "pending exact", editable: true,
      message: { source: { kind: "user", clientMessageId: pendingCorrelation } },
    }],
  },
};
const transcriptHtml = renderTranscript(renderSnapshot, paths);
assert.match(transcriptHtml,
  /<article class="message message-user"[^>]*data-message-id="valid-user_1"[^>]*data-client-message-id="110ec58a-a0f2-4ac4-8393-c866d813b8d1"[^>]*>[\s\S]*?<div class="message-text">&lt;script&gt;literal&lt;\/script&gt;<\/div>[\s\S]*?<\/article>/,
  "durable user nodes expose safe explicit correlation independently of core identity");
assert.match(transcriptHtml,
  /class="message message-user message-steering"[^>]*data-message-id="valid-steering:2"[^>]*data-client-message-id="220ec58a-a0f2-4ac4-9393-c866d813b8d2"/,
  "steering nodes expose safe source correlation");
assert.match(transcriptHtml,
  /class="queue-item message-queued"[^>]*data-message-id="pending-core-id"[^>]*data-client-message-id="330ec58a-a0f2-4ac4-a393-c866d813b8d3"/,
  "pending queue rows expose correlation retained on their raw message source");
assert.doesNotMatch(transcriptHtml, /invalid&quot;|onclick=|onmouseover=/,
  "invalid authoritative and correlation IDs are omitted, not escaped into identity attributes");
assert.match(transcriptHtml, /&lt;script&gt;literal&lt;\/script&gt;/, "authoritative prompt text remains escaped");
const liveNodesAt = transcriptHtml.indexOf('id="transcript-live-nodes"');
const queueAt = transcriptHtml.indexOf('id="session-queue"');
const echoesAt = transcriptHtml.indexOf('id="prompt-echoes"');
assert.ok(liveNodesAt >= 0 && liveNodesAt < queueAt && queueAt < echoesAt,
  "the browser-owned tail follows the SSE queue, matching direct-prompt admission order");
const echoesTag = transcriptHtml.match(/<ol id="prompt-echoes"[^>]*>/)?.[0] ?? "";
assert.doesNotMatch(echoesTag, /sse-swap|hx-swap/, "the provisional container is not an SSE swap target");
assert.match(echoesTag, /aria-live="off"/);
const baseFingerprints = regionFingerprints(renderSnapshot);
const changedPendingCorrelation = structuredClone(renderSnapshot);
changedPendingCorrelation.conversation.pending[0].message.source.clientMessageId =
  "440ec58a-a0f2-4ac4-b393-c866d813b8d4";
assert.notEqual(regionFingerprints(changedPendingCorrelation).queue, baseFingerprints.queue,
  "a pending correlation-only change cannot be suppressed by the SSE queue fingerprint");
const changedNodeCorrelation = structuredClone(renderSnapshot);
changedNodeCorrelation.conversation.nodes.at(-1).clientMessageId =
  "550ec58a-a0f2-4ac4-8393-c866d813b8d5";
assert.notEqual(regionFingerprints(changedNodeCorrelation).transcript, baseFingerprints.transcript,
  "a durable correlation-only change invalidates transcript rendering");
const pageContent = renderSessionContent({
  id: sessionId,
  project: "proof",
  conversation: { nodes: [], pending: [] },
  children: [],
  sessions: [{ id: sessionId, project: "proof" }],
  agentStatus: "idle",
}, paths);
assert.match(pageContent, /id="prompt-echoes"/, "full-page session render recommissions the stable container");

const validHttpCorrelation = "660EC58A-A0F2-4AC4-8393-C866D813B8D6";
const canonicalHttpCorrelation = validHttpCorrelation.toLowerCase();
const resultQueue = [
  { kind: "accepted", messageId: "accepted-http_1" },
  { kind: "accepted", messageId: "progressive-http:2" },
  { kind: "accepted", messageId: "repeat-authority-a" },
  { kind: "accepted", messageId: "repeat-authority-b" },
  { kind: "accepted", messageId: 'bad\r\nInjected: yes' },
  { kind: "other", messageId: "must-not-leak" },
  new Error("backend refused PRIVATE prompt"),
];
const backendCalls = [];
const snapshot = () => ({
  id: sessionId,
  project: "proof",
  events: [],
  sessions: [{ id: sessionId, project: "proof" }],
  conversation: { nodes: [], pending: [] },
  children: [],
  agentStatus: "idle",
});
const backend = {
  defaultSessionId: sessionId,
  read: async () => snapshot(),
  list: async () => [{ id: sessionId, project: "proof" }],
  create: async () => snapshot(),
  // Declared as a legacy two-argument function on purpose. JavaScript safely
  // ignores the optional third argument while the spy proves what UI supplied.
  prompt: async function legacyPrompt(session, prompt) {
    backendCalls.push([...arguments]);
    const result = resultQueue.shift();
    if (result instanceof Error) throw result;
    return result;
  },
  interrupt: async () => snapshot(),
  close: async () => ({ id: null }),
};
const handler = createConsoleHandler(backend, { basePath: "/qq", latencyPersistence: false });
const server = createServer(handler);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const promptUrl = `${base}/qq/session/${sessionId}/prompt`;
const postParameters = (prompt, clientMessageId) => {
  const parameters = new URLSearchParams({ prompt });
  if (clientMessageId !== undefined) parameters.set("clientMessageId", clientMessageId);
  return parameters;
};
const postPrompt = (prompt, htmx, clientMessageId) => fetch(promptUrl, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(htmx ? { "HX-Request": "true" } : {}),
  },
  body: postParameters(prompt, clientMessageId),
});
try {
  const accepted = await postPrompt("PRIVATE <script> prompt", true, validHttpCorrelation);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get(PROMPT_MESSAGE_ID_HEADER), "accepted-http_1");
  assert.equal(accepted.headers.get(PROMPT_OUTCOME_HEADER), "accepted");
  assert.deepEqual(backendCalls[0], [sessionId, "PRIVATE <script> prompt", {
    clientMessageId: canonicalHttpCorrelation,
  }], "valid correlation is canonicalized and passed only as optional metadata");
  assert.notEqual(backendCalls[0][2].clientMessageId, accepted.headers.get(PROMPT_MESSAGE_ID_HEADER),
    "browser correlation never controls or replaces authoritative core identity");
  const acceptedBody = await accepted.text();
  assert.doesNotMatch(acceptedBody, /PRIVATE|accepted-http_1/, "prompt and accepted ID never enter unrelated mutation HTML");

  const progressive = await postPrompt("ordinary fallback", false);
  assert.equal(progressive.status, 303);
  assert.equal(progressive.headers.get("location"), `/qq/project/proof/session/${sessionId}`);
  assert.equal(progressive.headers.get(PROMPT_MESSAGE_ID_HEADER), "progressive-http:2");
  assert.equal(progressive.headers.get(PROMPT_OUTCOME_HEADER), "accepted");
  assert.equal(await progressive.text(), "See other\n", "progressive fallback remains an ordinary redirect");
  assert.deepEqual(backendCalls[1], [sessionId, "ordinary fallback"],
    "absent token preserves the exact two-argument backend call");

  const callsBeforeInvalid = backendCalls.length;
  const invalidCorrelation = await postPrompt("malformed correlation", true, "not-a-uuid");
  assert.equal(invalidCorrelation.status, 200, "HTMX validation failure remains an OOB-swappable response");
  assert.equal(invalidCorrelation.headers.get(PROMPT_OUTCOME_HEADER), "failed");
  assert.equal(backendCalls.length, callsBeforeInvalid, "malformed correlation never reaches backend admission");
  const progressiveInvalid = await postPrompt("malformed progressive", false, "not-a-uuid");
  assert.equal(progressiveInvalid.status, 422);
  assert.equal(backendCalls.length, callsBeforeInvalid);
  const duplicateParameters = postParameters("duplicate correlation fields", canonicalHttpCorrelation);
  duplicateParameters.append("clientMessageId", "770ec58a-a0f2-4ac4-9393-c866d813b8d7");
  const duplicateCorrelation = await fetch(promptUrl, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "HX-Request": "true" },
    body: duplicateParameters,
  });
  assert.equal(duplicateCorrelation.headers.get(PROMPT_OUTCOME_HEADER), "failed");
  assert.equal(backendCalls.length, callsBeforeInvalid, "parameter pollution is rejected before admission");

  const repeatedA = await postPrompt("metadata is not idempotency a", true, canonicalHttpCorrelation);
  const repeatedB = await postPrompt("metadata is not idempotency b", true, canonicalHttpCorrelation);
  assert.equal(repeatedA.headers.get(PROMPT_MESSAGE_ID_HEADER), "repeat-authority-a");
  assert.equal(repeatedB.headers.get(PROMPT_MESSAGE_ID_HEADER), "repeat-authority-b");
  assert.equal(backendCalls.at(-2)[2].clientMessageId, canonicalHttpCorrelation);
  assert.equal(backendCalls.at(-1)[2].clientMessageId, canonicalHttpCorrelation);
  assert.equal(backendCalls.length, callsBeforeInvalid + 2,
    "correlation metadata alone provides no authorization or idempotency behavior");

  const invalid = await postPrompt("invalid authoritative id", true, canonicalHttpCorrelation);
  assert.equal(invalid.status, 200);
  assert.equal(invalid.headers.get(PROMPT_MESSAGE_ID_HEADER), null, "invalid accepted core ID is safely omitted");
  const wrongKind = await postPrompt("wrong kind", true, canonicalHttpCorrelation);
  assert.equal(wrongKind.status, 200);
  assert.equal(wrongKind.headers.get(PROMPT_MESSAGE_ID_HEADER), null,
    "a non-accepted backend result cannot attach a message ID");
  assert.equal(wrongKind.headers.get(PROMPT_OUTCOME_HEADER), "accepted",
    "a legacy backend success gets only a fixed acceptance signal");
  const refused = await postPrompt("PRIVATE refused prompt", true, canonicalHttpCorrelation);
  assert.equal(refused.status, 200, "existing OOB error notice behavior remains swappable");
  assert.equal(refused.headers.get(PROMPT_OUTCOME_HEADER), "failed");
  assert.equal(refused.headers.get(PROMPT_MESSAGE_ID_HEADER), null);
  assert.doesNotMatch(refused.headers.get(PROMPT_OUTCOME_HEADER) ?? "", /PRIVATE|backend|refused/);
} finally {
  handler.dispose();
  await new Promise((resolve) => server.close(resolve));
}

const latencyBatch = {
  schema: "qq.visual-latency-batch/v1",
  runId: "page-prompt-echo-proof",
  batchId: "page-prompt-echo-proof-1",
  page: {
    timeOrigin: 1_700_000_000_000,
    startedAt: 1,
    startedAtISO: "2023-11-14T22:13:20.001Z",
    ui: { generation: "proof", revision: "proof" },
    viewport: { width: 800, height: 600, devicePixelRatio: 1, visual: { width: 800, height: 600, scale: 1 } },
    userAgent: "proof",
  },
  health: {
    generated: { origins: 1, stages: 1, visuals: 0 },
    acknowledged: { origins: 0, stages: 0, visuals: 0 },
    ringBufferDrops: { origins: 0, stages: 0, visuals: 0 },
    uploadDrops: { origins: 0, stages: 0, visuals: 0 },
    quarantineCount: 0,
  },
  origins: [{
    sequence: 1, id: "interaction-1", at: 1, type: "submit",
    action: `POST /qq/session/${sessionId}/prompt`, target: "form#composer",
  }],
  stages: [{
    sequence: 1, at: 12, event: "qq:promptAdmission", kind: "prompt-local-echo",
    requestId: "request-1", originId: "interaction-1", originLatencyMs: 11,
    dispatchLatencyMs: null, requestCompleteLatencyMs: null, conversationSequence: null,
    channel: null, sessionSwitchId: null, target: "article.message.message-user",
    action: `POST /qq/session/${sessionId}/prompt`,
  }],
  visuals: [],
};
const sanitized = sanitizeLatencyBatch(latencyBatch);
assert.equal(sanitized.stages[0].kind, "prompt-local-echo");
assert.equal(JSON.stringify(sanitized).includes("PRIVATE"), false);
assert.throws(() => sanitizeLatencyBatch({
  ...latencyBatch,
  stages: [{ ...latencyBatch.stages[0], messageId: "accepted-http_1" }],
}), /recognized|field|key|schema|property|not allowed/i, "message ID cannot enter persisted latency records");
assert.throws(() => sanitizeLatencyBatch({
  ...latencyBatch,
  stages: [{ ...latencyBatch.stages[0], prompt: "PRIVATE" }],
}), /recognized|field|key|schema|property|not allowed/i, "prompt text cannot enter persisted latency records");

console.log("prompt echo proof passed");
