#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const render = readFileSync(new URL("../src/render.mjs", import.meta.url), "utf8");
const css = readFileSync(new URL("../assets/console.css", import.meta.url), "utf8");
const browser = readFileSync(new URL("../assets/browser-v9.js", import.meta.url), "utf8");
const agents = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");

const settledRenderer = render.match(/function renderConversationNode\(node\) \{([\s\S]*?)\n\}/);
assert.ok(settledRenderer, "settled conversation renderer must exist");
assert.match(settledRenderer[1], /block\?\.type === "reasoning"/);
assert.match(settledRenderer[1], /class="assistant-reasoning"/);
assert.match(settledRenderer[1], /renderMarkdownText\(block\.text\)/);
assert.doesNotMatch(settledRenderer[1], /renderMessageText\(block\.text\)/);

const liveRenderer = render.match(/function renderLiveAssistantBlock\(node, block, index, key\) \{([\s\S]*?)\n\}/);
assert.ok(liveRenderer, "live assistant renderer must exist");
assert.match(liveRenderer[1], /type === "reasoning"/);
assert.match(liveRenderer[1], /class="assistant-reasoning"/);
assert.match(liveRenderer[1], /aria-busy="true"/);
assert.match(liveRenderer[1], /class="message-text message-live-text"/);
assert.match(liveRenderer[1], /\$\{escapeHtml\(text\)\}/);
assert.doesNotMatch(liveRenderer[1], /renderMarkdownText/);

// Reasoning visibility is based only on reasoning text being rendered. Sealing a
// node, moving it to settled, or dropping aria-busy must not hide it.
assert.doesNotMatch(css, /\.assistant-reasoning[^{]*\{[^}]*display\s*:\s*none/s);
assert.match(css, /\.assistant-reasoning \.message-markdown[\s\S]*?color:\s*inherit/);
assert.match(css, /\.assistant-reasoning \.message-markdown :where\(h1, h2, h3, h4, h5, h6\)[^{]*\{[^}]*font-size:\s*1em/);
assert.match(agents, /Reasoning is shown whenever its node has reasoning text/);
assert.doesNotMatch(agents, /settled reasoning is not shown/i);

const blocker = browser.match(/const surfaceGestureBlocked = \(target\) => \{([\s\S]*?)\n  \};/);
assert.ok(blocker, "surfaceGestureBlocked must remain the single surface gesture target filter");
const policy = blocker[1];

// Transcript chrome stays tap-capable and can also seed the existing locked
// horizontal gesture. Generic interactive blocking applies only off transcript.
assert.match(policy, /target\.closest\("#transcript"\)/);
assert.match(policy, /#session-chrome/);
assert.match(policy, /#composer/);
assert.match(policy, /#project-drawer/);
assert.match(policy, /#project-rail/);
assert.match(policy, /\.document-viewer/);
assert.match(policy, /summary/);
assert.match(policy, /\[role=button\]/);
assert.match(policy, /overflowX[\s\S]*scrollWidth > node\.clientWidth/);
assert.doesNotMatch(policy, /if \(target\.closest\("[^"]*summary/);

class FakeElement {
  constructor(selectors = [], parentElement = null, options = {}) {
    this.selectors = new Set(selectors);
    this.parentElement = parentElement;
    this.overflowX = options.overflowX ?? "visible";
    this.overflowY = options.overflowY ?? "visible";
    this.scrollWidth = options.scrollWidth ?? 100;
    this.clientWidth = options.clientWidth ?? 100;
  }

  closest(selectorList) {
    const selectors = selectorList.split(",").map((selector) => selector.trim());
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some((selector) => node.selectors.has(selector))) return node;
    }
    return null;
  }
}

const makeBlocker = (viewerOpen = false) => Function(
  "documentViewerIsOpen",
  "HTMLElement",
  "getComputedStyle",
  `${blocker[0]}; return surfaceGestureBlocked;`,
)(
  () => viewerOpen,
  FakeElement,
  (node) => ({ overflowX: node.overflowX, overflowY: node.overflowY }),
);
const blocked = makeBlocker();
const transcript = new FakeElement(["#transcript"]);

assert.equal(blocked(new FakeElement(["summary"], transcript)), false, "tool summaries seed surface gestures");
assert.equal(blocked(new FakeElement(["button", "[role=button]"], transcript)), false, "transcript buttons seed surface gestures");
assert.equal(blocked(new FakeElement(["a"], transcript)), false, "transcript links seed surface gestures");
assert.equal(blocked(new FakeElement(["summary"])), true, "non-transcript summaries remain exclusive");
assert.equal(blocked(new FakeElement(["button"], new FakeElement(["#composer"]))), true, "composer controls remain exclusive");
assert.equal(blocked(new FakeElement([], new FakeElement(["#session-chrome"]))), true, "session chrome remains exclusive");
assert.equal(blocked(new FakeElement([], new FakeElement([".session-children"]))), true, "session navigation remains exclusive");
assert.equal(blocked(new FakeElement([], new FakeElement(["#project-rail"]))), true, "project rail remains exclusive");
assert.equal(makeBlocker(true)(new FakeElement([], transcript)), true, "open document viewers remain exclusive");

const overflowingPre = new FakeElement(["pre"], transcript, {
  overflowX: "auto",
  overflowY: "auto",
  scrollWidth: 300,
  clientWidth: 100,
});
assert.equal(blocked(new FakeElement(["code"], overflowingPre)), true, "horizontal code scrollers remain exclusive");
const fittingPre = new FakeElement(["pre"], transcript, {
  overflowX: "auto",
  overflowY: "auto",
  scrollWidth: 100,
  clientWidth: 100,
});
assert.equal(blocked(new FakeElement(["code"], fittingPre)), false, "non-overflowing code does not consume rail gestures");

console.log("prove-reasoning-transcript-gestures: pass");
