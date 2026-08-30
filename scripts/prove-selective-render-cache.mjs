#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const renderPath = join(root, "src", "render.mjs");
const temporaryModules = [];
let moduleSerial = 0;

async function instrumentedRender(limits = {}) {
  let source = await readFile(renderPath, "utf8");
  const counterNeedle = "function renderConversationNode(node) {\n";
  assert.ok(source.includes(counterNeedle), "proof seam must find the conversation renderer");
  source = source.replace(counterNeedle, `let __proofConversationRenderCalls = 0;
export function __proofResetConversationRenderCalls() { __proofConversationRenderCalls = 0; }
export function __proofConversationRenderCallCount() { return __proofConversationRenderCalls; }
function renderConversationNode(node) {
  __proofConversationRenderCalls += 1;
`);

  const cacheNeedle = "let settledRenderCacheUtf16Bytes = 0;\n";
  assert.ok(source.includes(cacheNeedle), "proof seam must find settled cache accounting");
  source = source.replace(cacheNeedle, `${cacheNeedle}
export function __proofSettledCacheState() {
  return {
    size: settledRenderCache.size,
    utf16Bytes: settledRenderCacheUtf16Bytes,
    entries: [...settledRenderCache.values()].map((entry) => ({ bytes: entry.bytes, html: entry.html })),
  };
}
`);

  const constants = {
    SETTLED_CACHE_MAX_ENTRIES: limits.entries,
    SETTLED_CACHE_MAX_UTF16_BYTES: limits.bytes,
    SETTLED_CACHE_MAX_RESULT_UTF16_BYTES: limits.resultBytes,
  };
  for (const [name, value] of Object.entries(constants)) {
    if (value === undefined) continue;
    const expression = new RegExp(`const ${name} = [^;]+;`);
    assert.match(source, expression, `proof seam must find ${name}`);
    source = source.replace(expression, `const ${name} = ${value};`);
  }

  moduleSerial += 1;
  const filename = join(root, "src", `.prove-render-${process.pid}-${moduleSerial}.mjs`);
  temporaryModules.push(filename);
  await writeFile(filename, source);
  return import(`${pathToFileURL(filename).href}?proof=${moduleSerial}`);
}

const snapshot = (id, nodes, events = []) => ({ id, conversation: { nodes, pending: [] }, events });
const textBlock = (text) => ({ type: "text", text });
const user = (seq, text, extra = {}) => ({
  kind: "user", key: `user:${seq}`, seq, time: `2026-01-01T00:00:${String(seq).padStart(2, "0")}Z`,
  content: [textBlock(text)], ...extra,
});
const assistant = (seq, text, status = "complete", extra = {}) => ({
  kind: "assistant", key: `assistant:${seq}`, seq, turn: 1, step: seq, status,
  time: `2026-01-01T00:01:${String(seq).padStart(2, "0")}Z`,
  blocks: [textBlock(text)], ...extra,
});
const tool = (seq, argumentsText, status = "running", extra = {}) => ({
  kind: "tool", key: `tool:${seq}`, seq, callId: `call-${seq}`, name: "bash",
  status, arguments: argumentsText, argumentSummary: argumentsText,
  callView: { card: "terminal", title: "Shell" }, resultView: null,
  expanded: false, content: [], ...extra,
});
const calls = (render) => render.__proofConversationRenderCallCount();
const resetCalls = (render) => render.__proofResetConversationRenderCalls();
const cache = (render) => render.__proofSettledCacheState();
const patch = (frame) => JSON.parse(frame.data);

try {
  const render = await instrumentedRender();

  // No previous state: key the complete transcript, but render only the live suffix.
  const settledHeavy = Array.from({ length: 80 }, (_, index) =>
    assistant(index + 1, `# Settled ${index}\n\n${"markdown **body** ".repeat(30)}`));
  resetCalls(render);
  const allSettled = render.liveTranscriptState(snapshot("selective", settledHeavy));
  assert.equal(calls(render), 0, "an all-settled transcript renders no discarded live islands");
  assert.equal(allSettled.allKeys.length, 80);
  assert.deepEqual(allSettled.nodes, []);
  assert.equal(allSettled.reset, false);

  const running = tool(81, '{"command":"printf one"}');
  resetCalls(render);
  const initial = render.liveTranscriptState(snapshot("selective", [...settledHeavy, running]));
  assert.equal(calls(render), 1, "a settled-heavy transcript renders only its tiny live suffix");
  assert.equal(initial.allKeys.length, 81, "stable keys still cover every transcript node");
  assert.deepEqual(initial.nodes.map((island) => island.key), ["tool-call-81"]);
  assert.doesNotMatch(initial.nodes[0].html, /Settled 79/, "settled HTML is absent from live state");

  // Prefix growth retains the former live island and renders only retained/new islands.
  const appendedUser = user(82, "after the tool", { key: "after-tool" });
  resetCalls(render);
  const grown = render.liveTranscriptState(
    snapshot("selective", [...settledHeavy, running, appendedUser]), initial);
  assert.equal(calls(render), 2, "prefix growth renders the held node and newly appended node only");
  assert.deepEqual(grown.nodes.map((island) => island.key), ["tool-call-81", "user-after-tool"]);
  assert.equal(grown.reset, false);

  const closed = { ...running, status: "success", resultView: { card: "terminal", title: "Shell", output: "one", exitCode: 0 } };
  resetCalls(render);
  const held = render.liveTranscriptState(
    snapshot("selective", [...settledHeavy, closed, appendedUser]), grown);
  assert.equal(calls(render), 2, "settled former-live islands remain held without recommissioning old settled nodes");
  assert.deepEqual(held.nodes.map((island) => island.key), ["tool-call-81", "user-after-tool"]);

  // A non-prefix snapshot resets to only that snapshot's current live suffix.
  const replacementSettled = [assistant(901, "replacement history")];
  const replacementTool = tool(902, "replacement args");
  resetCalls(render);
  const reset = render.liveTranscriptState(snapshot("selective", [...replacementSettled, replacementTool]), held);
  assert.equal(calls(render), 1, "reset does not render replacement settled history");
  assert.equal(reset.reset, true);
  assert.deepEqual(reset.nodes.map((island) => island.key), ["tool-call-902"]);

  // Duplicate base keys keep occurrence-aware key overrides and DOM ids.
  const duplicateOne = user(1, "first", { key: "duplicate", status: "running" });
  const duplicateTwo = user(1, "second", { key: "duplicate" });
  resetCalls(render);
  const duplicates = render.liveTranscriptState(snapshot("duplicates", [duplicateOne, duplicateTwo]));
  assert.equal(calls(render), 2);
  assert.deepEqual(duplicates.allKeys, ["user-duplicate", "user-duplicate-occurrence-1"]);
  assert.deepEqual(duplicates.nodes.map(({ key, id }) => [key, id]), [
    ["user-duplicate", "live-node-user-duplicate"],
    ["user-duplicate-occurrence-1", "live-node-user-duplicate-occurrence-1"],
  ]);
  assert.match(duplicates.nodes[1].html, /^<div id="live-node-user-duplicate-occurrence-1"/);

  const firstDuplicate = render.liveTranscriptState(snapshot("duplicates", [duplicateOne]));
  const duplicateUpdate = render.liveTranscriptUpdate(firstDuplicate, snapshot("duplicates", [duplicateOne, duplicateTwo]));
  assert.equal(duplicateUpdate.frames.length, 1);
  assert.equal(patch(duplicateUpdate.frames[0]).op, "qq-live-insert");
  assert.equal(patch(duplicateUpdate.frames[0]).key, "live-node-user-duplicate-occurrence-1");

  // Assistant/tool segmentation, append/replace choice, junction, and frame order.
  const streaming = assistant(100, "hel", "streaming", {
    blocks: [{ type: "reasoning", text: "think" }, textBlock("hel")],
  });
  const firstFrames = render.liveTranscriptUpdate(null, snapshot("frames", [streaming, tool(101, "a")]));
  assert.deepEqual(firstFrames.frames.map((frame) => frame.event), ["live-append", "live-tool-append"]);
  assert.deepEqual(firstFrames.frames.map((frame) => patch(frame).op), ["qq-live-insert", "qq-live-insert"]);
  assert.equal(firstFrames.junction, true);

  const streamed = { ...streaming, blocks: [{ type: "reasoning", text: "think" }, textBlock("hello")] };
  const tokenFrames = render.liveTranscriptUpdate(firstFrames.state, snapshot("frames", [streamed, tool(101, "a")]));
  assert.equal(tokenFrames.frames.length, 1);
  assert.equal(tokenFrames.frames[0].event, "live-append");
  assert.deepEqual(patch(tokenFrames.frames[0]), {
    op: "qq-live-append",
    key: "live-assistant-1-100-100-1-text",
    from: 3,
    text: "lo",
  });
  assert.equal(tokenFrames.junction, false);

  const sealed = { ...streamed, status: "complete" };
  const sealFrames = render.liveTranscriptUpdate(tokenFrames.state, snapshot("frames", [sealed, tool(101, "a")]));
  assert.equal(sealFrames.frames.length, 1);
  assert.equal(sealFrames.frames[0].event, "live-append");
  assert.equal(patch(sealFrames.frames[0]).op, "qq-live-replace");
  assert.equal(patch(sealFrames.frames[0]).key, "live-node-assistant-1-100-100");
  assert.equal(sealFrames.junction, true);

  const toolGrowth = render.liveTranscriptUpdate(sealFrames.state, snapshot("frames", [sealed, tool(101, "abcd")]));
  assert.equal(toolGrowth.frames.length, 1);
  assert.equal(toolGrowth.frames[0].event, "live-tool-append");
  assert.deepEqual(patch(toolGrowth.frames[0]), {
    op: "qq-live-append",
    key: "live-tool-call-101-args-text",
    from: 1,
    text: "bcd",
  });
  assert.equal(toolGrowth.junction, false);

  const finishedTool = tool(101, "abcd", "success", {
    resultView: { card: "terminal", title: "Shell", output: "done", exitCode: 0 },
  });
  const toolSeal = render.liveTranscriptUpdate(toolGrowth.state, snapshot("frames", [sealed, finishedTool]));
  assert.equal(toolSeal.frames.length, 1);
  assert.equal(toolSeal.frames[0].event, "live-tool-append");
  assert.equal(patch(toolSeal.frames[0]).op, "qq-live-replace");
  assert.equal(toolSeal.junction, true);

  // Full settled rendering: equivalent immutable values hit and output is byte-identical.
  const cacheRender = await instrumentedRender();
  const cacheNode = assistant(1, "# Cached\n\nA [safe](https://example.test) paragraph.");
  const cacheSnapshot = snapshot("session-a", [cacheNode]);
  resetCalls(cacheRender);
  const firstHtml = cacheRender.renderTranscriptSettled(cacheSnapshot);
  assert.equal(calls(cacheRender), 1);
  resetCalls(cacheRender);
  const hitHtml = cacheRender.renderTranscriptSettled(structuredClone(cacheSnapshot));
  assert.equal(calls(cacheRender), 0, "an immutable settled node hits the cache");
  assert.equal(hitHtml, firstHtml, "a cache hit is byte-identical to direct rendering");
  assert.equal(cache(cacheRender).size, 1);

  const reorderedNode = {
    blocks: [{ text: cacheNode.blocks[0].text, type: "text" }],
    time: cacheNode.time, status: cacheNode.status, step: cacheNode.step,
    turn: cacheNode.turn, seq: cacheNode.seq, key: cacheNode.key, kind: cacheNode.kind,
  };
  resetCalls(cacheRender);
  assert.equal(cacheRender.renderTranscriptSettled(snapshot("session-a", [reorderedNode])), firstHtml);
  assert.equal(calls(cacheRender), 0, "canonical full fingerprints ignore harmless property insertion order");

  const changedNode = { ...cacheNode, blocks: [textBlock("# Cached\n\nChanged complete content.")] };
  resetCalls(cacheRender);
  const changedHtml = cacheRender.renderTranscriptSettled(snapshot("session-a", [changedNode]));
  assert.equal(calls(cacheRender), 1, "full content mutation cannot reuse stale HTML");
  assert.notEqual(changedHtml, firstHtml);

  resetCalls(cacheRender);
  const otherSessionHtml = cacheRender.renderTranscriptSettled(snapshot("session-b", [cacheNode]));
  assert.equal(calls(cacheRender), 1, "session id isolates otherwise identical cache identities");
  assert.equal(otherSessionHtml, firstHtml);

  // Unsupported/cyclic protocol shapes decline caching instead of using an incomplete fingerprint.
  const cyclicNode = user(9, "cycle");
  cyclicNode.extra = cyclicNode;
  const cyclicSnapshot = snapshot("cycles", [cyclicNode]);
  const beforeCycleEntries = cache(cacheRender).size;
  resetCalls(cacheRender);
  cacheRender.renderTranscriptSettled(cyclicSnapshot);
  cacheRender.renderTranscriptSettled(cyclicSnapshot);
  assert.equal(calls(cacheRender), 2);
  assert.equal(cache(cacheRender).size, beforeCycleEntries);

  // Live/running nodes and transcript notices never enter the settled cache.
  const liveSnapshot = snapshot("live-only", [tool(55, "streaming arguments")]);
  const beforeLiveEntries = cache(cacheRender).size;
  resetCalls(cacheRender);
  const liveOne = cacheRender.renderLiveNodes(liveSnapshot);
  const liveTwo = cacheRender.renderLiveNodes(liveSnapshot);
  assert.equal(liveTwo, liveOne);
  assert.equal(calls(cacheRender), 2, "live node rendering is never served from settled cache");
  assert.equal(cache(cacheRender).size, beforeLiveEntries);

  const noticeNode = {
    kind: "context", key: "notice:1", seq: 60,
    source: { form: "notice", summary: "Operator notice" },
    content: [textBlock("Mutable notice body")],
  };
  resetCalls(cacheRender);
  cacheRender.renderTranscriptSettled(snapshot("notices", [noticeNode]));
  cacheRender.renderTranscriptSettled(snapshot("notices", [noticeNode]));
  assert.equal(calls(cacheRender), 2, "notice/context cards explicitly bypass settled caching");
  assert.equal(cache(cacheRender).size, beforeLiveEntries);

  // Oversized rendered values are never retained.
  const oversizeRender = await instrumentedRender({ entries: 8, bytes: 100_000, resultBytes: 300 });
  const oversizeSnapshot = snapshot("oversize", [user(1, "x".repeat(500))]);
  resetCalls(oversizeRender);
  const oversizeOne = oversizeRender.renderTranscriptSettled(oversizeSnapshot);
  const oversizeTwo = oversizeRender.renderTranscriptSettled(oversizeSnapshot);
  assert.equal(oversizeTwo, oversizeOne);
  assert.equal(calls(oversizeRender), 2, "a single oversized result is rerendered rather than cached");
  assert.deepEqual(cache(oversizeRender), { size: 0, utf16Bytes: 0, entries: [] });

  // Entry-count LRU: a read refreshes recency and exact oldest entries are evicted.
  const countRender = await instrumentedRender({ entries: 2, bytes: 1_000_000, resultBytes: 100_000 });
  const countA = snapshot("count-lru", [user(1, "A")]);
  const countB = snapshot("count-lru", [user(2, "B")]);
  const countC = snapshot("count-lru", [user(3, "C")]);
  countRender.renderTranscriptSettled(countA);
  countRender.renderTranscriptSettled(countB);
  resetCalls(countRender);
  countRender.renderTranscriptSettled(countA);
  assert.equal(calls(countRender), 0, "LRU read refresh is a hit");
  countRender.renderTranscriptSettled(countC);
  assert.equal(cache(countRender).size, 2);
  resetCalls(countRender);
  countRender.renderTranscriptSettled(countA);
  assert.equal(calls(countRender), 0, "refreshed entry survives count eviction");
  countRender.renderTranscriptSettled(countB);
  assert.equal(calls(countRender), 1, "least-recently used entry is evicted by count");
  const countState = cache(countRender);
  assert.equal(countState.utf16Bytes,
    countState.entries.reduce((total, entry) => total + entry.bytes, 0),
    "entry eviction keeps exact byte accounting");

  // Byte LRU: derive an exact one-byte-below-two-entries boundary from a probe generation.
  const byteProbe = await instrumentedRender({ entries: 20, bytes: 1_000_000, resultBytes: 100_000 });
  const byteA = snapshot("byte-lru", [user(4, "same-sized-A")]);
  const byteB = snapshot("byte-lru", [user(5, "same-sized-B")]);
  byteProbe.renderTranscriptSettled(byteA);
  const bytesA = cache(byteProbe).entries[0].bytes;
  byteProbe.renderTranscriptSettled(byteB);
  const bytesB = cache(byteProbe).entries[1].bytes;
  const byteLimit = bytesA + bytesB - 1;
  assert.ok(bytesA < byteLimit && bytesB < byteLimit, "each byte-LRU entry fits independently");

  const byteRender = await instrumentedRender({ entries: 20, bytes: byteLimit, resultBytes: 100_000 });
  byteRender.renderTranscriptSettled(byteA);
  byteRender.renderTranscriptSettled(byteB);
  const byteState = cache(byteRender);
  assert.equal(byteState.size, 1, "aggregate UTF-16 byte limit evicts despite spare entry capacity");
  assert.equal(byteState.utf16Bytes, byteState.entries[0].bytes);
  assert.ok(byteState.utf16Bytes <= byteLimit);
  resetCalls(byteRender);
  byteRender.renderTranscriptSettled(byteA);
  assert.equal(calls(byteRender), 1, "byte eviction removes the exact oldest entry");

  // Append, duplicate occurrence, full render, and reset all share cached settled bytes.
  const pathRender = await instrumentedRender();
  const settledA = user(10, "settled A", { key: "settled:a" });
  const settledB = assistant(11, "**settled B**", "complete", { key: "settled:b" });
  const oneSettled = snapshot("paths", [settledA]);
  const twoSettled = snapshot("paths", [settledA, settledB]);
  const cursor = pathRender.renderSettledTranscriptAppend(null, oneSettled);
  assert.deepEqual(cursor, { keys: ["settled:a"], html: "", reset: false });

  resetCalls(pathRender);
  const firstAppend = pathRender.renderSettledTranscriptAppend([], oneSettled);
  assert.equal(calls(pathRender), 1);
  assert.match(firstAppend.html, /settled A/);
  assert.match(firstAppend.html, /id="transcript-empty" hx-swap-oob="delete"/);
  resetCalls(pathRender);
  assert.equal(pathRender.renderSettledTranscriptAppend([], oneSettled).html, firstAppend.html);
  assert.equal(calls(pathRender), 0, "settled append reuses cached immutable HTML");

  resetCalls(pathRender);
  const secondAppend = pathRender.renderSettledTranscriptAppend(cursor.keys, twoSettled);
  assert.equal(calls(pathRender), 1);
  assert.doesNotMatch(secondAppend.html, /settled A/);
  assert.match(secondAppend.html, /<strong>settled B<\/strong>/);
  assert.deepEqual(secondAppend.keys, ["settled:a", "settled:b"]);

  resetCalls(pathRender);
  const fullSettled = pathRender.renderTranscriptSettled(twoSettled);
  assert.equal(calls(pathRender), 0, "full settled rendering reuses append-populated entries");
  resetCalls(pathRender);
  const resetSettled = pathRender.renderSettledTranscriptAppend(["wrong-prefix"], twoSettled);
  assert.equal(calls(pathRender), 0, "fold/reset rendering reuses the same settled cache");
  assert.equal(resetSettled.reset, true);
  assert.equal(resetSettled.html, `${fullSettled}\n<div id="transcript-anchor" class="transcript-anchor" hx-ext="sse" sse-swap="transcript" hx-swap="beforebegin"></div>`);

  const duplicateSettledOne = user(20, "duplicate first", { key: "settled:duplicate" });
  const duplicateSettledTwo = user(20, "duplicate second", { key: "settled:duplicate" });
  const duplicateCursor = pathRender.renderSettledTranscriptAppend(
    null, snapshot("duplicate-settled", [duplicateSettledOne]));
  resetCalls(pathRender);
  const duplicateAppend = pathRender.renderSettledTranscriptAppend(
    duplicateCursor.keys, snapshot("duplicate-settled", [duplicateSettledOne, duplicateSettledTwo]));
  assert.equal(calls(pathRender), 1);
  assert.deepEqual(duplicateAppend.keys, ["settled:duplicate", "settled:duplicate-occurrence-1"]);
  assert.doesNotMatch(duplicateAppend.html, /duplicate first/);
  assert.match(duplicateAppend.html, /duplicate second/);

  const emptyReset = pathRender.renderSettledTranscriptAppend(
    ["removed"], snapshot("paths", []));
  assert.equal(emptyReset.reset, true);
  assert.match(emptyReset.html, /id="transcript-empty" class="empty-transcript"/);
  assert.match(emptyReset.html, /id="transcript-anchor"/);

  // Cache lifetime is exactly one loaded render-module generation.
  const generationA = await instrumentedRender();
  const generationB = await instrumentedRender();
  const generationSnapshot = snapshot("generation", [assistant(70, "generation local")]);
  resetCalls(generationA);
  generationA.renderTranscriptSettled(generationSnapshot);
  generationA.renderTranscriptSettled(generationSnapshot);
  assert.equal(calls(generationA), 1);
  resetCalls(generationB);
  generationB.renderTranscriptSettled(generationSnapshot);
  assert.equal(calls(generationB), 1, "a separately loaded module starts with an empty cache");

  console.log("selective live rendering and settled cache proof passed");
} finally {
  await Promise.all(temporaryModules.map((filename) => rm(filename, { force: true })));
}
