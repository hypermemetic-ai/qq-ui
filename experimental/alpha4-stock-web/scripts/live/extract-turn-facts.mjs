#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";

const [runArg, nonceArg] = process.argv.slice(2);
if (runArg === undefined || nonceArg === undefined) {
  console.error("usage: node scripts/live/extract-turn-facts.mjs </tmp/qq-alpha4-live-id> <random-nonce>");
  process.exit(2);
}
assert.match(nonceArg, /^QQ_ALPHA4_[0-9A-F]{24}$/u, "nonce has an unexpected shape");
const runRoot = disposableRunRoot(runArg);
const sessionsRoot = resolve(runRoot, "dsh-home", "sessions");
assert.ok(existsSync(sessionsRoot), "isolated DSH session persistence root does not exist");
assert.ok(realpathSync(sessionsRoot).startsWith(`${runRoot}${sep}`));
const logs = [];
function walk(directory) {
  const stats = lstatSync(directory);
  assert.equal(stats.isSymbolicLink(), false, `refusing symlink in isolated session evidence: ${directory}`);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(directory)) walk(join(directory, entry));
  } else if (stats.isFile() && directory.endsWith("session.jsonl")) logs.push(directory);
}
walk(sessionsRoot);
assert.ok(logs.length > 0, "no plaintext stock Session JSONL artifacts found");

function parseLog(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`invalid JSONL record ${index} in isolated Session log: ${error.message}`); }
  });
}
function textFragments(value, output = []) {
  if (Array.isArray(value)) for (const item of value) textFragments(item, output);
  else if (value && typeof value === "object") {
    if (typeof value.text === "string") output.push(value.text);
    for (const [key, item] of Object.entries(value)) if (key !== "text") textFragments(item, output);
  }
  return output;
}
const candidates = [];
for (const path of logs) {
  const records = parseLog(path);
  const events = records.filter((row) => row && typeof row === "object" && typeof row.type === "string" && Number.isSafeInteger(row.seq));
  const nonceUsers = events.filter((event) => event.type === "user/message" && JSON.stringify(event.data).includes(nonceArg));
  if (nonceUsers.length > 0) candidates.push({ path, events, nonceUsers });
}
assert.equal(candidates.length, 1, "nonce must identify exactly one real stock Session artifact");
const candidate = candidates[0];
assert.equal(candidate.nonceUsers.length, 1, "nonce must identify exactly one submitted user message");
const user = candidate.nonceUsers[0];
const starts = candidate.events.filter((event) => event.type === "turn/start" && event.seq <= user.seq);
assert.ok(starts.length > 0, "nonce user message is not enclosed by a turn/start");
const start = starts.at(-1);
const turn = start.data?.turn;
assert.ok(Number.isSafeInteger(turn) && turn > 0, "enclosing turn/start lacks a valid turn number");
const ends = candidate.events.filter((event) => event.type === "turn/end" && event.data?.turn === turn && event.seq > user.seq);
assert.equal(ends.length, 1, "turn must have exactly one terminal turn/end after the nonce user message");
const turnEvents = candidate.events.filter((event) => event.seq >= start.seq && event.seq <= ends[0].seq);
const headers = turnEvents.filter((event) => event.type === "request/header");
assert.ok(headers.length >= 1, "turn has no persisted request/header");
const header = headers[0].data?.header?.config;
assert.equal(header?.provider, "xai-auth", "request/header selected the wrong provider");
assert.equal(header?.model, "grok-4.6", "request/header selected the wrong model");
const chunks = turnEvents.filter((event) => event.type === "assistant/chunk" && event.data?.turn === turn);
assert.ok(chunks.length > 0, "turn has no persisted streamed assistant chunks");
const messages = turnEvents.filter((event) => event.type === "assistant/message" && event.data?.turn === turn);
assert.ok(messages.length > 0, "turn has no final assistant message");
const assistantText = messages.flatMap((event) => textFragments(event.data?.message)).join("");
assert.ok(assistantText.length > 0, "final assistant message is empty");
assert.ok(assistantText.includes(nonceArg), "final assistant message does not contain the random nonce");
assert.equal(messages.some((event) => event.data?.interrupted === true), false, "assistant message was interrupted");
assert.equal(ends[0].data?.reason?.kind, "completed", "turn/end is not completed");
const tools = candidate.events.filter((event) => event.type === "tool/call");
assert.equal(tools.length, 0, "no-tools live prompt produced a tool call");
const report = {
  status: "PASS",
  sessionArtifactCount: 1,
  sessionIdSha256: createHash("sha256").update(candidate.path).digest("hex"),
  turn,
  nonce: nonceArg,
  requestHeader: { provider: header.provider, model: header.model, count: headers.length },
  assistant: { streamedChunkCount: chunks.length, messageCount: messages.length, characters: assistantText.length, containsNonce: true, sha256: createHash("sha256").update(assistantText).digest("hex") },
  terminal: { type: "turn/end", reason: "completed", count: ends.length },
  toolCallCount: 0,
  retainedTranscript: false,
};
writeFileSync(join(runRoot, "artifacts", "turn-facts.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
