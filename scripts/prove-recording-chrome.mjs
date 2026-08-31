#!/usr/bin/env node
import assert from "node:assert/strict";
import { renderSessionContent } from "../src/render.mjs";

const liveId = "session-63a11000-0000-4000-8000-0000000000aa";
const paths = {
  canonical: `/qq/project/qq/session/${liveId}`,
  prompt: `/qq/project/qq/session/${liveId}/prompt`,
  workflow: `/qq/project/qq/session/${liveId}/workflow`,
  interrupt: `/qq/project/qq/session/${liveId}/interrupt`,
  createSession: "/qq/project/qq/sessions",
  switchSession: "/qq/sessions/open",
  home: "/qq/home",
};

const idle = renderSessionContent({
  id: liveId,
  events: [],
  sessionMode: "find",
  project: "qq",
  projectLabel: "qq",
  workflows: ["architect", "iterate", "find", "base"],
}, paths);

assert.match(idle, /id="session-chrome"[^>]*sse-swap="chrome"/);
assert.match(idle, /class="session-heading-start"/);
assert.match(idle, /class="workflows-menu" data-mode="find"/);
assert.match(idle, /<summary aria-label="Choose workflow"[^>]*>find<\/summary>/);
assert.match(idle, /class="session-project">qq</);
assert.match(idle, /class="session-heading-start"[\s\S]*class="session-project">qq</);
assert.match(idle, /class="session-heading-start"[\s\S]*class="session-id"/);
assert.match(idle, /class="session-heading-end"/);
assert.doesNotMatch(idle, /value="\/workflows none"/);
assert.doesNotMatch(idle, /value="\/workflows base"/);
assert.doesNotMatch(idle, /Message this DSH session/);
assert.doesNotMatch(idle, /Enter to send/);
assert.match(idle, /id="composer-submit"[^>]*aria-label="Send"/);
assert.match(idle, /class="composer-enter"/);
assert.doesNotMatch(idle, /<label for="prompt">Message<\/label>\s*<div class="composer-row">[\s\S]*placeholder=/);

const running = renderSessionContent({
  id: liveId,
  events: [{ type: "turn/start", data: { turn: 1 } }],
  agentStatus: "running",
  sessionMode: "architect",
  project: "qq",
}, paths);
assert.match(running, /class="composer-row"[\s\S]*id="interrupt-submit"/);
assert.doesNotMatch(running, /class="composer-meta"/);
assert.match(running, /class="session-mode" data-mode="architect">Architect/);

const home = renderSessionContent({
  id: liveId,
  events: [],
  scope: "home",
}, { ...paths });
assert.match(home, /class="session-project">home</);
assert.doesNotMatch(home, /class="session-home"/);

console.log("prove-recording-chrome: pass");
