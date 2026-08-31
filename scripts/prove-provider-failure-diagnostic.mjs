#!/usr/bin/env node
import assert from "node:assert/strict";

import { renderTurnFailure } from "../src/render.mjs";

const html = renderTurnFailure({
  seq: 44,
  code: "PROVIDER",
  detail: "Responses failed (http_status=503, provider_code=server_error, request_id=req_safe): temporary <failure>",
});
assert.match(html, /Turn failed/);
assert.match(html, /bounded retry may run automatically/);
assert.match(html, /Provider diagnostic:/);
assert.match(html, /http_status=503/);
assert.match(html, /provider_code=server_error/);
assert.match(html, /request_id=req_safe/);
assert.match(html, /&lt;failure&gt;/);
assert.doesNotMatch(html, /temporary <failure>/);

const hidden = renderTurnFailure({ seq: 45, code: "INTERNAL" });
assert.doesNotMatch(hidden, /Provider diagnostic:/);

console.log("provider failure diagnostic rendering: ok");
