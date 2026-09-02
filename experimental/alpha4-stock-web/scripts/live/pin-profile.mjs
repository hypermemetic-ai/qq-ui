#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAlpha4Source } from "../alpha4-source.mjs";

const [profileArg, sourceArg] = process.argv.slice(2);
if (profileArg === undefined || sourceArg === undefined) {
  console.error("usage: node scripts/live/pin-profile.mjs <isolated-profile-package.json> <authoritative-alpha4-source>");
  process.exit(2);
}
const profilePath = resolve(profileArg);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
assert.deepEqual(profile.dsh?.profile?.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "refusing to pin a non-stock initial Web profile roster");
const closure = readAlpha4Source(resolve(sourceArg));
profile.pnpm = { ...(profile.pnpm ?? {}), overrides: closure.overrides };
writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
console.log(`pinned ${Object.keys(closure.overrides).length} exact alpha.4 DSH packages without changing the initial stock Web bundle roster`);
