#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [mode, sourceArg, backupArg] = process.argv.slice(2);
if (!(["disable", "restore"].includes(mode)) || sourceArg === undefined || backupArg === undefined) {
  console.error("usage: node scripts/live/mutate-client.mjs disable|restore <src/client.cjs> <backup>");
  process.exit(2);
}
const source = resolve(sourceArg);
const backup = resolve(backupArg);
const marker = 'exports.apply = function apply(ctx) {';
if (mode === "restore") {
  const original = readFileSync(backup);
  assert.ok(original.includes(Buffer.from(marker)), "backup is not the expected QQ client source");
  writeFileSync(source, original);
  console.log("restored exact QQ client source");
} else {
  const original = readFileSync(source, "utf8");
  assert.equal((original.match(/exports\.apply = function apply\(ctx\) \{/gu) ?? []).length, 1, "apply marker must occur once");
  const start = original.indexOf(marker);
  const endMarker = "\n};\n";
  const end = original.indexOf(endMarker, start);
  assert.ok(end > start, "apply end marker missing");
  writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
  const disabled = `${original.slice(0, start)}exports.apply = function apply() {\n  // Live-gate disposal probe: intentionally no registrations.\n${original.slice(end)}`;
  writeFileSync(source, disabled);
  console.log("disabled QQ apply body for live HMR disposal probe");
}
