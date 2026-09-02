#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readAlpha4Source } from "./alpha4-source.mjs";

const [sourceArg, manifestArg] = process.argv.slice(2);
if (sourceArg === undefined) {
  console.error("usage: node scripts/sync-alpha4-overrides.mjs <authoritative-alpha4-source> [package.json]");
  process.exit(2);
}
const manifestPath = resolve(manifestArg ?? new URL("../package.json", import.meta.url).pathname);
const closure = readAlpha4Source(resolve(sourceArg));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.overrides = closure.overrides;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`synchronized ${Object.keys(closure.overrides).length} DSH overrides from ${closure.tag} / ${closure.commit}; sha256:${closure.digest}`);
