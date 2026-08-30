#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConsoleHandler, PROMPT_MESSAGE_ID_HEADER, PROMPT_OUTCOME_HEADER } from "../src/http-app.mjs";
import { sanitizeLatencyBatch } from "../src/latency-store.mjs";
import { renderSessionContent, renderTranscript } from "../src/render.mjs";

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
assert.match(factoryBody, /new WeakMap\(\)/, "concrete XHR identity owns each prompt echo");
assert.match(browserSource, /admissionCandidates\.findIndex\(\(candidate\) => candidate\.messageId === messageId\)/,
  "authoritative admission timing selects out-of-order requests by exact in-memory ID");
assert.doesNotMatch(factoryBody, /shift\(\).*(?:message-user|queue-item)|(?:message-user|queue-item)[\s\S]{0,120}shift\(/,
  "authoritative reconciliation has no text/position/FIFO fallback");
assert.match(factoryBody, /\.queue-item\[data-message-id\]/,
  "safe authoritative queue identities participate in exact reconciliation");
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
const statusCss = cssRule(".prompt-echo-status");
assert.match(statusCss, /position:\s*absolute/, "the accessible status is out of flow");
assert.match(statusCss, /clip(?:-path)?:/, "the status is visually hidden without consuming a row");
for (const state of ["pending", "accepted", "accepted-legacy"]) {
  const rule = cssRule(`.message-user[data-prompt-echo-state="${state}"]`);
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
      if (candidate === ".message-user[data-message-id]") {
        return this.classList.contains("message-user") && this.getAttribute("data-message-id") !== null;
      }
      if (candidate === ".queue-item[data-message-id]") {
        return this.classList.contains("queue-item") && this.getAttribute("data-message-id") !== null;
      }
      return false;
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
  const echoes = new FakeElement("div");
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
  live.append(liveNodes, echoes, queue);
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
  const host = {
    document,
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
    const event = {
      detail: {
        elt: form,
        xhr,
        requestConfig: { parameters: new Map([["prompt", prompt]]) },
      },
    };
    assert.equal(controller.beforeRequest(event), true);
    return { xhr, event };
  };
  const complete = ({ xhr, event }, successful = true) => controller.afterRequest({
    ...event,
    detail: { ...event.detail, successful, failed: !successful, xhr },
  });
  const authoritative = (messageId, { steering = false, text = "authoritative" } = {}) => {
    const node = new FakeElement("article");
    node.className = `message message-user${steering ? " message-steering" : ""}`;
    node.setAttribute("data-message-id", messageId);
    const content = new FakeElement("div");
    content.className = "message-text";
    content.textContent = text;
    node.append(content);
    return node;
  };
  const queued = (messageId, text = "queued") => {
    const node = new FakeElement("li");
    node.className = "queue-item message-queued";
    node.setAttribute("data-message-id", messageId);
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

const browser = browserFixture();
const dangerous = '<script>window.pwned = true</script>\n  spaced & exact  ';
browser.setNow(12);
const first = browser.submit(dangerous, new FakeXhr("message-safe_1:part.2"), {
  textareaValue: "stale textarea value must not be echoed",
});
assert.equal(browser.echoes.children.length, 1);
let echo = browser.echoes.children[0];
const content = echo.children[0];
const status = echo.children[1];
assert.equal(echo.tagName, "ARTICLE");
assert.equal(echo.className, "message message-user",
  "the optimistic outer box has exactly the authoritative user classes");
assert.equal(content.tagName, "DIV");
assert.equal(content.className, "message-text",
  "the optimistic literal-text element has authoritative tag/classes");
assert.equal(content.textContent, dangerous, "script-looking prompt is inserted as exact text");
assert.equal(status.tagName, "SPAN");
assert.equal(status.className, "prompt-echo-status");
assert.equal(status.textContent, "Message pending admission");
assert.equal(status.textContent.includes(dangerous), false,
  "the live status announces state without announcing prompt content again");
assert.equal(status.getAttribute("role"), "status");
assert.equal(status.getAttribute("aria-live"), "polite");
assert.equal(status.getAttribute("aria-atomic"), "true");
assert.equal(echo.getAttribute("aria-label"), "Your message");
assert.equal(browser.echoes.getAttribute("aria-live"), "off", "raw content is not its own live announcement");
assert.equal(browser.input.value, "", "composer clears only after HTMX captured the prompt");
assert.equal(innerHtmlWrites, 0);
assert.equal(browser.marks[0].at, 12);
assert.ok(browser.marks[0].at < 50, "deterministic interaction-to-local-echo target is below 50ms");
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

const queueCopy = browser.queued("message-safe_1:part.2", dangerous);
browser.queue.append(queueCopy);
browser.controller.reconcile(browser.queue);
assert.equal(browser.echoes.children.length, 0, "response-before-queue removes the exact accepted echo");
assert.equal(queueCopy.parentElement, browser.queue, "the authoritative queue row remains as the one representation");
assert.equal(browser.echoes.replaceChildrenCalls, 0, "ordinary queue reconciliation never replaces the echo container");

const queueFirst = browserFixture();
const queueFirstRequest = queueFirst.submit("queue arrived first", new FakeXhr("queue-first"));
const queueFirstTruth = queueFirst.queued("queue-first", "queue arrived first");
queueFirst.queue.append(queueFirstTruth);
queueFirst.observer.emit([{ type: "childList", target: queueFirst.queue, addedNodes: [queueFirstTruth] }]);
assert.equal(queueFirst.echoes.children.length, 1,
  "queue-before-response is remembered without guessing which pending request it owns");
queueFirst.complete(queueFirstRequest);
assert.equal(queueFirst.echoes.children.length, 0,
  "binding the response ID immediately removes an echo whose queue truth arrived first");
assert.equal(queueFirst.queue.children.length, 1, "queue-before-response converges to exactly one object");

const liveInsert = browserFixture();
const liveRequest = liveInsert.submit("live exact", new FakeXhr("live-exact"));
liveInsert.complete(liveRequest);
const liveTruth = liveInsert.authoritative("live-exact", { text: "live exact" });
liveInsert.liveNodes.append(liveTruth);
liveInsert.observer.emit([{ type: "childList", target: liveInsert.liveNodes, addedNodes: [liveTruth] }]);
assert.equal(liveInsert.echoes.children.length, 0, "matching user live insert leaves only authoritative truth");
assert.equal(liveTruth.parentElement, liveInsert.liveNodes);

const resetInsert = browserFixture();
const resetRequest = resetInsert.submit("reset exact", new FakeXhr("reset-exact"));
resetInsert.complete(resetRequest);
const resetTruth = resetInsert.authoritative("reset-exact", { steering: true, text: "reset exact" });
const reset = new FakeElement("div");
reset.id = "transcript-settled";
reset.append(resetTruth);
resetInsert.transcript.append(reset);
resetInsert.observer.emit([{ type: "childList", target: resetInsert.transcript, addedNodes: [reset] }]);
assert.equal(resetInsert.echoes.children.length, 0, "matching transcript-reset subtree leaves only authoritative truth");
assert.equal(resetTruth.parentElement, reset);

const unmatched = browserFixture();
const unmatchedRequest = unmatched.submit("local exact only", new FakeXhr("local-exact"));
unmatched.complete(unmatchedRequest);
const externalQueue = unmatched.queued("external-queue");
const externalUser = unmatched.authoritative("external-user");
unmatched.queue.append(externalQueue);
unmatched.liveNodes.append(externalUser);
unmatched.observer.emit([
  { type: "childList", target: unmatched.queue, addedNodes: [externalQueue] },
  { type: "childList", target: unmatched.liveNodes, addedNodes: [externalUser] },
]);
assert.equal(unmatched.echoes.children.length, 1,
  "unmatched authoritative queue/user objects never consume a local echo");
assert.equal(unmatched.echoes.children[0].getAttribute("data-message-id"), "local-exact");

const ordered = browserFixture();
const orderedRequests = [
  ordered.submit("first concurrent", new FakeXhr("ordered-one")),
  ordered.submit("middle concurrent", new FakeXhr("ordered-two")),
  ordered.submit("last concurrent", new FakeXhr("ordered-three")),
];
// Deliberately bind response IDs out of order; concrete XHR identity must win.
ordered.complete(orderedRequests[2]);
ordered.complete(orderedRequests[0]);
ordered.complete(orderedRequests[1]);
const [firstEcho, middleEcho, lastEcho] = ordered.echoes.children;
assert.deepEqual(ordered.echoes.children.map((node) => node.getAttribute("data-message-id")),
  ["ordered-one", "ordered-two", "ordered-three"]);
const middleTruth = ordered.queued("ordered-two");
ordered.queue.append(middleTruth);
ordered.observer.emit([{ type: "childList", target: ordered.queue, addedNodes: [middleTruth] }]);
assert.deepEqual(ordered.echoes.children, [firstEcho, lastEcho],
  "resolving the middle echo preserves sibling order and node identity");
assert.equal(middleEcho.parentElement, null);
assert.equal(ordered.echoes.replaceChildrenCalls, 0,
  "middle reconciliation removes one node rather than recreating the container");
assert.deepEqual(ordered.anchors, ["session-a", "session-a", "session-a"],
  "responses and reconciliation add no follow-anchor cycles");

const cleanupBrowser = browserFixture();
const failed = cleanupBrowser.submit("restore this exact failed draft", new FakeXhr("", 503));
cleanupBrowser.complete(failed, false);
assert.equal(cleanupBrowser.echoes.children.length, 0, "failure removes only that request's echo");
assert.equal(cleanupBrowser.input.value, "restore this exact failed draft");
assert.deepEqual(cleanupBrowser.persisted.at(-1), ["restore this exact failed draft", "session-a"]);
cleanupBrowser.input.value = "";
const semanticFailure = cleanupBrowser.submit("restore a 200 OOB failure", new FakeXhr("", 200, "failed"));
cleanupBrowser.complete(semanticFailure, true);
assert.equal(cleanupBrowser.echoes.children.length, 0);
assert.equal(cleanupBrowser.input.value, "restore a 200 OOB failure",
  "fixed failure outcome overrides successful HTTP status");

cleanupBrowser.input.value = "";
const staleDetached = cleanupBrowser.authoritative("late-old-id");
const oldSession = cleanupBrowser.submit("must not cross sessions", new FakeXhr("late-old-id"));
cleanupBrowser.controller.reset();
cleanupBrowser.setSession("session-b");
cleanupBrowser.controller.commission("session-b");
cleanupBrowser.observer.emit([{ type: "childList", addedNodes: [staleDetached] }]);
assert.equal(cleanupBrowser.echoes.children.length, 0);
assert.equal(cleanupBrowser.echoes.dataset.sessionId, "session-b");
cleanupBrowser.complete(oldSession);
assert.equal(cleanupBrowser.echoes.children.length, 0,
  "late old-session completion has no mapping in the adopted session");
assert.notEqual(cleanupBrowser.input.value, "must not cross sessions");
const reusedId = cleanupBrowser.submit("new session may reuse a backend ID namespace", new FakeXhr("late-old-id"));
cleanupBrowser.complete(reusedId);
assert.equal(cleanupBrowser.echoes.children.length, 1,
  "detached old-session mutation cannot pre-consume a new-session echo");
const currentAuthoritative = cleanupBrowser.authoritative("late-old-id");
cleanupBrowser.liveNodes.append(currentAuthoritative);
cleanupBrowser.observer.emit([{ type: "childList", target: cleanupBrowser.liveNodes, addedNodes: [currentAuthoritative] }]);
assert.equal(cleanupBrowser.echoes.children.length, 0, "the connected current-session node still reconciles exactly");
const cleanup = cleanupBrowser.submit("cleanup", new FakeXhr("cleanup-id"));
assert.ok(cleanup);
cleanupBrowser.windowListeners.get("pagehide")?.();
assert.equal(cleanupBrowser.echoes.children.length, 0, "page cleanup removes all in-memory and DOM echoes");
assert.equal(cleanupBrowser.echoes.replaceChildrenCalls, 0, "cleanup removes owned nodes without container replacement");

for (const fixture of [browser, queueFirst, liveInsert, resetInsert, unmatched, ordered, cleanupBrowser]) {
  fixture.controller.dispose();
}
const legacy = browserFixture({ maximumEchoes: 2 });
for (const text of ["legacy one", "legacy two", "legacy three"]) {
  const request = legacy.submit(text, new FakeXhr());
  legacy.complete(request);
}
assert.equal(legacy.echoes.children.length, 2, "legacy missing-ID echoes have an explicit session bound");
assert.ok(legacy.echoes.children.every((node) => node.getAttribute("data-prompt-echo-state") === "accepted-legacy"));
assert.ok(legacy.echoes.children.every((node) => node.children[1].textContent === "Message accepted; awaiting authoritative identity"));
const unrelatedLegacyNode = legacy.authoritative("some-external-id");
legacy.liveNodes.append(unrelatedLegacyNode);
legacy.controller.reconcile(unrelatedLegacyNode);
assert.equal(legacy.echoes.children.length, 2, "legacy echoes never use unsafe FIFO reconciliation");
legacy.controller.dispose();
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
const transcriptHtml = renderTranscript({
  id: sessionId,
  conversation: {
    nodes: [
      { seq: 1, kind: "user", messageId: "valid-user_1", content: [{ type: "text", text: "<script>literal</script>" }] },
      { seq: 2, kind: "steering", messageId: "valid-steering:2", content: [{ type: "text", text: "steer" }] },
      { seq: 3, kind: "user", messageId: 'invalid" onclick="bad', content: [{ type: "text", text: "invalid id" }] },
    ],
    pending: [],
  },
}, paths);
assert.match(transcriptHtml,
  /<article class="message message-user"[^>]*data-message-id="valid-user_1"[^>]*>\s*<div class="message-text">&lt;script&gt;literal&lt;\/script&gt;<\/div>\s*<\/article>/,
  "authoritative literal user text uses the exact outer and text tag/classes pinned for the echo");
assert.match(transcriptHtml, /class="message message-user message-steering"[^>]*data-message-id="valid-steering:2"/);
assert.doesNotMatch(transcriptHtml, /invalid&quot;|onclick=/, "invalid authoritative IDs are omitted, not escaped into an identity");
assert.match(transcriptHtml, /&lt;script&gt;literal&lt;\/script&gt;/, "authoritative prompt text remains escaped");
const liveNodesAt = transcriptHtml.indexOf('id="transcript-live-nodes"');
const echoesAt = transcriptHtml.indexOf('id="prompt-echoes"');
const queueAt = transcriptHtml.indexOf('id="session-queue"');
assert.ok(liveNodesAt >= 0 && liveNodesAt < echoesAt && echoesAt < queueAt,
  "the stable browser-owned echo container sits between live nodes and the SSE queue");
const echoesTag = transcriptHtml.match(/<div id="prompt-echoes"[^>]*>/)?.[0] ?? "";
assert.doesNotMatch(echoesTag, /sse-swap|hx-swap/, "the echo container is not an SSE swap target");
assert.match(echoesTag, /aria-live="off"/);
const pageContent = renderSessionContent({
  id: sessionId,
  project: "proof",
  conversation: { nodes: [], pending: [] },
  children: [],
  sessions: [{ id: sessionId, project: "proof" }],
  agentStatus: "idle",
}, paths);
assert.match(pageContent, /id="prompt-echoes"/, "full-page session render recommissions the stable container");

const resultQueue = [
  { kind: "accepted", messageId: "accepted-http_1" },
  { kind: "accepted", messageId: "progressive-http:2" },
  { kind: "accepted", messageId: 'bad\r\nInjected: yes' },
  { kind: "other", messageId: "must-not-leak" },
  new Error("backend refused PRIVATE prompt"),
];
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
  prompt: async () => {
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
const postPrompt = (prompt, htmx) => fetch(promptUrl, {
  method: "POST",
  redirect: "manual",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    ...(htmx ? { "HX-Request": "true" } : {}),
  },
  body: new URLSearchParams({ prompt }),
});
try {
  const accepted = await postPrompt("PRIVATE <script> prompt", true);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get(PROMPT_MESSAGE_ID_HEADER), "accepted-http_1");
  assert.equal(accepted.headers.get(PROMPT_OUTCOME_HEADER), "accepted");
  const acceptedBody = await accepted.text();
  assert.doesNotMatch(acceptedBody, /PRIVATE|accepted-http_1/, "prompt and accepted ID never enter mutation HTML");

  const progressive = await postPrompt("ordinary fallback", false);
  assert.equal(progressive.status, 303);
  assert.equal(progressive.headers.get("location"), `/qq/project/proof/session/${sessionId}`);
  assert.equal(progressive.headers.get(PROMPT_MESSAGE_ID_HEADER), "progressive-http:2");
  assert.equal(progressive.headers.get(PROMPT_OUTCOME_HEADER), "accepted");
  assert.equal(await progressive.text(), "See other\n", "progressive fallback remains an ordinary redirect");

  const invalid = await postPrompt("invalid id", true);
  assert.equal(invalid.status, 200);
  assert.equal(invalid.headers.get(PROMPT_MESSAGE_ID_HEADER), null, "invalid accepted ID is safely omitted");
  const wrongKind = await postPrompt("wrong kind", true);
  assert.equal(wrongKind.status, 200);
  assert.equal(wrongKind.headers.get(PROMPT_MESSAGE_ID_HEADER), null,
    "a non-accepted backend result cannot attach a message ID");
  assert.equal(wrongKind.headers.get(PROMPT_OUTCOME_HEADER), "accepted",
    "a legacy backend success gets only a fixed acceptance signal");
  const refused = await postPrompt("PRIVATE refused prompt", true);
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
