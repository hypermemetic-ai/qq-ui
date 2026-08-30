#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createConsoleHandler, PROMPT_MESSAGE_ID_HEADER, PROMPT_OUTCOME_HEADER } from "../src/http-app.mjs";
import { sanitizeLatencyBatch } from "../src/latency-store.mjs";
import { renderSessionContent, renderTranscript } from "../src/render.mjs";

const browserSource = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
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
assert.doesNotMatch(factoryBody, /shift\(\).*message-user|message-user[\s\S]{0,120}shift\(/,
  "authoritative reconciliation has no user-node FIFO fallback");
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
  blur() { this.blurred = true; }
  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child.contains(candidate));
  }
  matches(selector) {
    if (selector === ".message-user[data-message-id]") {
      return this.classList.contains("message-user") && this.getAttribute("data-message-id") !== null;
    }
    return false;
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
    anchorTranscript: () => {},
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
  const authoritative = (messageId, { steering = false } = {}) => {
    const node = new FakeElement("article");
    node.className = `message message-user${steering ? " message-steering" : ""}`;
    node.setAttribute("data-message-id", messageId);
    return node;
  };
  return {
    document, transcript, liveNodes, echoes, queue, form, input, controller, observer,
    marks, persisted, cleared, fitted, submit, complete, authoritative, windowListeners,
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
assert.equal(echo.children[0].textContent, dangerous, "script-looking prompt is inserted as exact text");
assert.equal(echo.children[1].textContent, "Admitting…");
assert.equal(echo.children[1].getAttribute("role"), "status");
assert.equal(echo.children[1].getAttribute("aria-live"), "polite");
assert.equal(echo.children[1].getAttribute("aria-atomic"), "true");
assert.equal(echo.getAttribute("aria-label"), "Your message, pending admission");
assert.equal(browser.echoes.getAttribute("aria-live"), "off", "raw content is not its own live announcement");
assert.equal(browser.input.value, "", "composer clears only after HTMX captured the prompt");
assert.equal(innerHtmlWrites, 0);
assert.equal(browser.marks[0].at, 12);
assert.ok(browser.marks[0].at < 50, "deterministic interaction-to-local-echo target is below 50ms");

browser.complete(first);
echo = browser.echoes.children[0];
assert.equal(echo.getAttribute("data-message-id"), "message-safe_1:part.2");
assert.equal(echo.getAttribute("data-prompt-echo-state"), "accepted");
assert.equal(echo.children[1].textContent, "Accepted · queued");
assert.equal(echo.classList.contains("message-pending-admission"), false);
assert.equal(echo.classList.contains("message-accepted-queued"), true);

const queueCopy = new FakeElement("li");
queueCopy.className = "queue-item message-queued";
queueCopy.setAttribute("data-message-id", "message-safe_1:part.2");
browser.queue.append(queueCopy);
browser.controller.reconcile(browser.queue);
assert.equal(browser.echoes.children.length, 1, "queue ownership never removes an accepted echo");
const external = browser.authoritative("external-concurrent");
browser.liveNodes.append(external);
browser.observer.emit([{ type: "childList", target: browser.liveNodes, addedNodes: [external] }]);
assert.equal(browser.echoes.children.length, 1, "an external unmatched user node cannot consume a local echo");
const exact = browser.authoritative("message-safe_1:part.2", { steering: true });
const reset = new FakeElement("div");
reset.id = "transcript-settled";
reset.append(exact);
browser.transcript.append(reset);
browser.observer.emit([{ type: "childList", target: browser.transcript, addedNodes: [reset] }]);
assert.equal(browser.echoes.children.length, 0, "a reset subtree removes only the exact accepted message ID");

const queued = browser.submit("remain while queued", new FakeXhr("queued-2"));
browser.complete(queued);
browser.controller.reconcile(browser.queue);
assert.equal(browser.echoes.children.length, 1, "accepted followup survives queue swaps for an arbitrary duration");
const queuedAuthoritative = browser.authoritative("queued-2");
browser.liveNodes.append(queuedAuthoritative);
browser.observer.emit([{ type: "childList", target: browser.liveNodes, addedNodes: [queuedAuthoritative] }]);
assert.equal(browser.echoes.children.length, 0, "live insert reconciles an accepted followup exactly");

const requestOne = browser.submit("first concurrent", new FakeXhr("out-of-order-one"));
const requestTwo = browser.submit("second concurrent", new FakeXhr("out-of-order-two"));
browser.complete(requestTwo);
browser.complete(requestOne);
assert.deepEqual(browser.echoes.children.map((node) => node.getAttribute("data-message-id")), [
  "out-of-order-one", "out-of-order-two",
], "out-of-order responses update their concrete XHR-owned echoes");
const secondNode = browser.authoritative("out-of-order-two");
browser.liveNodes.append(secondNode);
browser.observer.emit([{ type: "childList", target: browser.liveNodes, addedNodes: [secondNode] }]);
assert.deepEqual(browser.echoes.children.map((node) => node.getAttribute("data-message-id")), ["out-of-order-one"]);
const firstNode = browser.authoritative("out-of-order-one");
browser.liveNodes.append(firstNode);
browser.observer.emit([{ type: "childList", target: browser.liveNodes, addedNodes: [firstNode] }]);
assert.equal(browser.echoes.children.length, 0);

const failed = browser.submit("restore this exact failed draft", new FakeXhr("", 503));
browser.complete(failed, false);
assert.equal(browser.echoes.children.length, 0, "failure removes only that request's echo");
assert.equal(browser.input.value, "restore this exact failed draft");
assert.deepEqual(browser.persisted.at(-1), ["restore this exact failed draft", "session-a"]);
const semanticFailure = browser.submit("restore a 200 OOB failure", new FakeXhr("", 200, "failed"));
browser.complete(semanticFailure, true);
assert.equal(browser.echoes.children.length, 0);
assert.equal(browser.input.value, "restore a 200 OOB failure", "fixed failure outcome overrides successful HTTP status");

const staleDetached = browser.authoritative("late-old-id");
const oldSession = browser.submit("must not cross sessions", new FakeXhr("late-old-id"));
browser.controller.reset();
browser.setSession("session-b");
browser.controller.commission("session-b");
browser.observer.emit([{ type: "childList", addedNodes: [staleDetached] }]);
assert.equal(browser.echoes.children.length, 0);
assert.equal(browser.echoes.dataset.sessionId, "session-b");
browser.complete(oldSession);
assert.equal(browser.echoes.children.length, 0, "late old-session completion has no mapping in the adopted session");
assert.notEqual(browser.input.value, "must not cross sessions");
const reusedId = browser.submit("new session may reuse a backend ID namespace", new FakeXhr("late-old-id"));
browser.complete(reusedId);
assert.equal(browser.echoes.children.length, 1, "detached old-session mutation cannot pre-consume a new-session echo");
const currentAuthoritative = browser.authoritative("late-old-id");
browser.liveNodes.append(currentAuthoritative);
browser.observer.emit([{ type: "childList", target: browser.liveNodes, addedNodes: [currentAuthoritative] }]);
assert.equal(browser.echoes.children.length, 0, "the connected current-session node still reconciles exactly");
const cleanup = browser.submit("cleanup", new FakeXhr("cleanup-id"));
assert.ok(cleanup);
browser.windowListeners.get("pagehide")?.();
assert.equal(browser.echoes.children.length, 0, "page cleanup removes all in-memory and DOM echoes");

browser.controller.dispose();
const legacy = browserFixture({ maximumEchoes: 2 });
for (const text of ["legacy one", "legacy two", "legacy three"]) {
  const request = legacy.submit(text, new FakeXhr());
  legacy.complete(request);
}
assert.equal(legacy.echoes.children.length, 2, "legacy missing-ID echoes have an explicit session bound");
assert.ok(legacy.echoes.children.every((node) => node.getAttribute("data-prompt-echo-state") === "accepted-legacy"));
assert.ok(legacy.echoes.children.every((node) => node.children[1].textContent === "Accepted · awaiting transcript"));
const unrelatedLegacyNode = legacy.authoritative("some-external-id");
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
assert.match(transcriptHtml, /data-message-id="valid-user_1"/);
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
    channel: null, sessionSwitchId: null, target: "article.message.message-user.prompt-local-echo",
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
