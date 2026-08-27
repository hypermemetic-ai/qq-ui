#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderCaseRegion } from "../src/render.mjs";

const css = readFileSync(new URL("../assets/console.css", import.meta.url), "utf8");

const ruleBodies = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))]
    .map((match) => match[1]);
};

assert.match(
  css,
  /--case-rail-width\s*:\s*clamp\(14rem\s*,\s*18vw\s*,\s*20rem\s*\)/,
  "desktop chrome defines the architect case rail width",
);

const caseOpenMainRules = ruleBodies("body.case-open main");
assert.equal(caseOpenMainRules.length, 1, "case-open main has one authoritative rule");
for (const declarations of caseOpenMainRules) {
  assert.match(declarations, /width\s*:\s*min\(90ch\s*,/, "case-open main remains capped at 90ch");
  assert.doesNotMatch(declarations, /90ch\s*\+/, "case-open main never widens beyond the session column");
  assert.match(declarations, /var\(--project-rail-width\)/, "case-open main clears the project rail");
  assert.match(declarations, /var\(--case-rail-width\)/, "case-open main clears the case rail");
  assert.match(declarations, /margin-right\s*:\s*auto/, "case-open main keeps an automatic right margin");
}

const sessionCaseRule = ruleBodies("#session-case").find((body) => /position\s*:\s*fixed/.test(body));
assert.ok(sessionCaseRule, "the SSE case region is removed from main flow on desktop");
assert.match(sessionCaseRule, /inset\s*:\s*0\s+0\s+0\s+auto/);
assert.match(sessionCaseRule, /width\s*:\s*var\(--case-rail-width\)/);

const desktopCasePanel = ruleBodies(".case-panel").find((body) => /position\s*:\s*fixed/.test(body));
assert.ok(desktopCasePanel, "the desktop case panel is a fixed right rail");
assert.match(desktopCasePanel, /inset\s*:\s*0\s+0\s+0\s+auto/);
assert.match(desktopCasePanel, /width\s*:\s*var\(--case-rail-width\)/);
assert.match(desktopCasePanel, /background\s*:\s*#000(?:\s|;|$)/, "case rail uses black chrome");
assert.doesNotMatch(css, /#050505/i, "document-pane gray is absent from the live chrome");

assert.ok(
  ruleBodies(".case-panel").some((body) => /display\s*:\s*none/.test(body)),
  "the inline case rail remains hidden on mobile",
);

const renderedCase = renderCaseRegion({
  caseFile: { title: "Proof", identity: "proof identity", text: "# Rail proof\n\nBody" },
});
const renderedPanel = renderedCase.match(/^<aside class="case-panel"[\s\S]*?<\/aside>/)?.[0] ?? "";
assert.ok(renderedPanel, "case region renders its desktop aside");
assert.match(
  renderedPanel,
  /class="message-text message-markdown case-prose"/,
  "case body uses shared transcript markdown styling",
);
assert.doesNotMatch(renderedPanel, /document-prose/, "case rail does not use document-viewer prose");
assert.match(renderedPanel, /<p class="case-identity">working memory<\/p>/, "rail has a quiet lowercase identity");

console.log("prove-desktop-case-rail: pass");
