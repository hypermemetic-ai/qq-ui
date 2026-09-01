#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const required = Object.entries(packageJson.devDependencies ?? {});
const unavailable = [];

for (const [name, expected] of required) {
  const manifest = resolve(root, "node_modules", name, "package.json");
  if (!existsSync(manifest)) {
    unavailable.push(`${name} (missing; expected ${expected})`);
    continue;
  }
  let actual;
  try {
    actual = JSON.parse(readFileSync(manifest, "utf8")).version;
  } catch (error) {
    unavailable.push(`${name} (unreadable manifest; expected ${expected}: ${error.message})`);
    continue;
  }
  if (actual !== expected) unavailable.push(`${name} (${actual}; expected ${expected})`);
}

const tsc = resolve(root, "node_modules/typescript/bin/tsc");
if (unavailable.length > 0 || !existsSync(tsc)) {
  if (!existsSync(tsc) && !unavailable.some((item) => item.startsWith("typescript "))) {
    unavailable.push(`typescript executable (missing; expected ${packageJson.devDependencies?.typescript ?? "an exact pin"})`);
  }
  console.error(`BLOCKED public alpha.3 type check: install this package's exact devDependencies; unavailable ${unavailable.join(", ")}`);
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, [tsc, "--project", resolve(root, "tsconfig.json"), "--pretty", "false"], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}
