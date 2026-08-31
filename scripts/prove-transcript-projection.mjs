#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConsoleHandler } from "../src/http-app.mjs";

const sessionId = "session-71000000-0000-4000-8000-000000000001";
const canonical = `/qq/session/${sessionId}`;
const marker = (turn) => `projection-turn-${turn}`;

function user(seq, turn, kind = "user") {
  return {
    key: `${kind}:${seq}`,
    seq,
    kind,
    messageId: `projection-message-${seq}`,
    content: [{ type: "text", text: marker(turn) }],
  };
}

function assistant(seq, status, text) {
  return {
    key: `assistant:${seq}`,
    seq,
    kind: "assistant",
    turn: seq,
    step: 1,
    status,
    blocks: [{ type: "text", text }],
  };
}

function baseSnapshot() {
  return {
    id: sessionId,
    project: "projection-proof",
    events: [],
    agentStatus: "idle",
    sessions: [{ id: sessionId, project: "projection-proof", alias: "projection proof" }],
    children: [],
    conversation: {
      nodes: [user(1, "one"), user(2, "two"), user(3, "three"), user(4, "four")],
      pending: [],
    },
  };
}

function parseSse(text) {
  return text.replaceAll("\r", "").split("\n\n").flatMap((block) => {
    const lines = block.split("\n");
    const event = lines.find((line) => line.startsWith("event: "))?.slice(7);
    if (!event) return [];
    return [{
      event,
      data: lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
    }];
  });
}

function eventPath(html) {
  const encoded = html.match(/id="console-stream"[^>]*sse-connect="([^"]+)"/)?.[1];
  assert.ok(encoded, "rendered session page includes an EventSource URL");
  return encoded.replaceAll("&amp;", "&");
}

async function openSse(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  if (response.status !== 200) {
    const detail = await response.text();
    assert.equal(response.status, 200, `SSE ${url} failed: ${detail}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let readError = null;
  const pump = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        body += decoder.decode(value, { stream: true });
      }
    } catch (error) {
      if (!controller.signal.aborted) readError = error;
    }
  })();
  return {
    frames: () => parseSse(body),
    async waitFor(predicate, message, timeoutMs = 1_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        if (readError) throw readError;
        const frames = parseSse(body);
        if (predicate(frames)) return frames;
        if (Date.now() >= deadline) assert.fail(message);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async close() {
      controller.abort();
      try { await reader.cancel(); } catch {}
      await pump;
    },
  };
}

let snapshot = baseSnapshot();
let observer = null;
const publish = () => observer?.(null, structuredClone(snapshot));
const backend = {
  defaultSessionId: sessionId,
  defaultProject: "projection-proof",
  defaultFolder: "",
  listProjects: () => [{ name: "projection-proof", label: "projection proof" }],
  read: async (id) => {
    assert.equal(id, sessionId);
    return structuredClone(snapshot);
  },
  list: async () => structuredClone(snapshot.sessions),
  create: async () => structuredClone(snapshot),
  observe(id, listener) {
    assert.equal(id, sessionId);
    observer = listener;
    listener(null, structuredClone(snapshot));
    return () => {
      if (observer === listener) observer = null;
    };
  },
  async prompt(id, text) {
    assert.equal(id, sessionId);
    if (text === marker("five")) {
      snapshot.conversation.nodes.push(user(5, "five"), assistant(6, "streaming", "first live answer"));
      snapshot.agentStatus = "running";
    } else if (text === marker("six")) {
      snapshot.conversation.nodes.push(user(7, "six"), assistant(8, "streaming", "second live answer"));
      snapshot.agentStatus = "running";
    } else if (text === marker("steering")) {
      snapshot.conversation.nodes.push(user(9, "steering", "steering"));
    } else {
      assert.fail(`unexpected proof prompt: ${text}`);
    }
    publish();
    return { messageId: `projection-accepted-${snapshot.conversation.nodes.at(-1).seq}` };
  },
  async interrupt(id) {
    assert.equal(id, sessionId);
    const live = snapshot.conversation.nodes.find((node) => node.kind === "assistant" && node.status === "streaming");
    assert.ok(live, "proof interrupt has a running assistant node");
    live.status = "interrupted";
    snapshot.agentStatus = "idle";
    publish();
    return true;
  },
  close: async () => ({ id: "", project: "projection-proof" }),
};

const handler = createConsoleHandler(backend, {
  basePath: "/qq",
  latencyPersistence: false,
  ssePollMs: 10_000,
});
const server = createServer(handler);
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
const post = (path, prompt = null) => fetch(`${base}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", "HX-Request": "true" },
  body: prompt === null ? "" : new URLSearchParams({ prompt }),
});

let ordinaryStream = null;
let bootstrapStream = null;
try {
  const initialPage = await fetch(`${base}${canonical}`);
  assert.equal(initialPage.status, 200);
  const initialHtml = await initialPage.text();
  for (const turn of ["one", "two", "three", "four"]) {
    assert.match(initialHtml, new RegExp(marker(turn)),
      `initial page preserves core-projected user turn ${turn}`);
  }

  const firstPrompt = await post(`${canonical}/prompt`, marker("five"));
  assert.equal(firstPrompt.status, 200);
  await firstPrompt.text();
  const promptPage = await fetch(`${base}${canonical}`);
  const promptHtml = await promptPage.text();
  for (const turn of ["one", "two", "three", "four", "five"]) {
    assert.match(promptHtml, new RegExp(marker(turn)),
      `page after prompt preserves core-projected user turn ${turn}`);
  }

  const promptEvents = eventPath(promptHtml);
  const bootstrapEvents = `${promptEvents.split("?", 1)[0]}?bootstrap=session&switch=projection-proof`;
  bootstrapStream = await openSse(`${base}${bootstrapEvents}`);
  const bootstrapFrames = await bootstrapStream.waitFor(
    (frames) => frames.some((frame) => frame.event === "switch-ready"),
    "switch bootstrap did not become ready",
  );
  const bootstrapReset = bootstrapFrames.find((frame) => frame.event === "transcript-reset");
  assert.ok(bootstrapReset, "switch bootstrap recommissions the destination transcript");
  for (const turn of ["one", "two", "three", "four", "five"]) {
    assert.match(bootstrapReset.data, new RegExp(marker(turn)),
      `switch bootstrap preserves core-projected user turn ${turn}`);
  }
  await bootstrapStream.close();
  bootstrapStream = null;

  ordinaryStream = await openSse(`${base}${promptEvents}`);
  await ordinaryStream.waitFor(
    (frames) => frames.some((frame) => frame.event === "ui"),
    "ordinary stream did not open",
  );

  let before = ordinaryStream.frames().length;
  const interrupted = await post(`${canonical}/interrupt`);
  assert.equal(interrupted.status, 200);
  await interrupted.text();
  let frames = await ordinaryStream.waitFor(
    (items) => items.slice(before).some((frame) => frame.event.startsWith("live")),
    "interrupt projection did not reach the live transcript",
  );
  assert.equal(frames.slice(before).some((frame) => frame.event === "transcript-reset"), false,
    "interrupt status growth does not manufacture a transcript cut");

  before = frames.length;
  const postInterrupt = await post(`${canonical}/prompt`, marker("six"));
  assert.equal(postInterrupt.status, 200);
  await postInterrupt.text();
  frames = await ordinaryStream.waitFor(
    (items) => items.slice(before).some((frame) => frame.data.includes(marker("six"))),
    "post-interrupt user message did not reach the transcript",
  );
  assert.equal(frames.slice(before).some((frame) => frame.event === "transcript-reset"), false,
    "a post-interrupt user message does not evict older projected turns");

  before = frames.length;
  const steered = await post(`${canonical}/prompt`, marker("steering"));
  assert.equal(steered.status, 200);
  await steered.text();
  frames = await ordinaryStream.waitFor(
    (items) => items.slice(before).some((frame) => frame.data.includes(marker("steering"))),
    "steering node did not reach the transcript",
  );
  assert.equal(frames.slice(before).some((frame) => frame.event === "transcript-reset"), false,
    "steering does not manufacture a transcript cut");

  before = frames.length;
  snapshot.conversation.nodes = snapshot.conversation.nodes.slice(4);
  publish();
  frames = await ordinaryStream.waitFor(
    (items) => items.slice(before).some((frame) => frame.event === "transcript-reset"),
    "authoritative projected replacement did not reset the transcript",
  );
  const authoritativeReset = frames.slice(before).find((frame) => frame.event === "transcript-reset");
  assert.match(authoritativeReset.data, new RegExp(marker("five")),
    "authoritative replacement renders its retained projected prefix");
  assert.doesNotMatch(authoritativeReset.data, new RegExp(marker("one")),
    "authoritative replacement removes history absent from the core projection");
} finally {
  await ordinaryStream?.close();
  await bootstrapStream?.close();
  handler.dispose();
  await new Promise((resolve) => server.close(resolve));
}

console.log("transcript projection proof passed");
