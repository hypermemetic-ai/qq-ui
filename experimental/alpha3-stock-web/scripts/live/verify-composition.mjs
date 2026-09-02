#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PACKAGE = "@hypermemetic-ai/qq-ui-alpha3-spike";
const [profileArg, spikeArg, stockDumpArg, patchedDumpArg] = process.argv.slice(2);
if ([profileArg, spikeArg, stockDumpArg, patchedDumpArg].some((value) => value === undefined)) {
  console.error("usage: node scripts/live/verify-composition.mjs <profile-package.json> <writable-spike> <stock-dump.yml> <patched-dump.yml>");
  process.exit(2);
}
const profilePath = resolve(profileArg);
const spike = realpathSync(spikeArg);
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
assert.deepEqual(profile.dsh?.profile?.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], "Web profile bundle roster is not stock");
assert.equal(typeof profile.dependencies?.[PACKAGE], "string", "profile does not declare the QQ package dependency");
const installed = join(dirname(profilePath), "node_modules", ...PACKAGE.split("/"));
assert.ok(existsSync(installed), `profile QQ dependency is not installed at ${installed}`);
assert.equal(realpathSync(installed), spike, "profile QQ dependency is not linked to the writable spike; HMR source edits would target the wrong artifact");
const stock = readFileSync(resolve(stockDumpArg), "utf8");
const patched = readFileSync(resolve(patchedDumpArg), "utf8");
assert.equal(stock.includes(PACKAGE), false, "QQ row unexpectedly exists in the stock config dump");
assert.equal((patched.match(/id: qq-ui-alpha3-spike/gu) ?? []).length, 1, "patched dump must contain exactly one QQ Loader id");
assert.equal((patched.match(/name: '@hypermemetic-ai\/qq-ui-alpha3-spike'/gu) ?? []).length, 1, "patched dump must contain exactly one QQ package row");
console.log("alpha3 composition verification passed: stock bundles intact, writable link, one additive QQ dump row");
