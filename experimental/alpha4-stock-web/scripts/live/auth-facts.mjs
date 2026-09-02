#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";
const [runArg] = process.argv.slice(2);
if (runArg === undefined) {
  console.error("usage: node scripts/live/auth-facts.mjs </tmp/qq-alpha4-live-id>");
  process.exit(2);
}
const runRoot = disposableRunRoot(runArg);
const authRoot = realpathSync(join(runRoot, "qq-dsh-home"));
assert.ok(authRoot === runRoot || authRoot.startsWith(`${runRoot}${sep}`));
assert.equal(process.env.QQ_DSH_HOME, authRoot, "QQ_DSH_HOME must be the isolated auth root");
assert.equal(process.env.DSH_HOME, join(runRoot, "dsh-home"));
assert.equal(process.env.HOME, join(runRoot, "os-home"));
const executable = join(runRoot, "dsh-home", "profiles", "web", "node_modules", ".bin", "qq-models-login");
const status = spawnSync(executable, ["status"], { encoding: "utf8", env: process.env });
assert.equal(status.status, 0, "qq-models status command failed");
const connectors = {};
for (const line of status.stdout.trim().split("\n")) {
  const [connector, provider, state] = line.split("\t", 3);
  if (!["grok", "codex", "qwen"].includes(connector)) continue;
  connectors[connector] = { provider, ready: /^(?:ready|logged-in)$/iu.test(state ?? "") };
}
assert.equal(connectors.grok?.provider, "xai-auth");
const rootMode = lstatSync(authRoot).mode & 0o777;
const files = [];
for (const entry of readdirSync(authRoot, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const stat = lstatSync(join(authRoot, entry.name));
  files.push({ mode: (stat.mode & 0o777).toString(8), ownerOnly: (stat.mode & 0o077) === 0, sizePositive: stat.size > 0 });
}
const report = {
  status: connectors.grok?.ready ? "READY" : "NOT_READY",
  connectors,
  authRoot: { isolated: true, mode: rootMode.toString(8), ownerOnly: (rootMode & 0o077) === 0 },
  regularFileCount: files.length,
  files,
  retainedSecretMaterial: false,
};
writeFileSync(join(runRoot, "artifacts", "auth-facts.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: report.status, connectors, authRoot: report.authRoot, regularFileCount: files.length }, null, 2));
