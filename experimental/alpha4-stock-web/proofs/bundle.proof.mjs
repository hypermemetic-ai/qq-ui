#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import * as hostPlugin from "../lib/index.js";
import { fakeReact } from "./helpers.mjs";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const expectedVersion = "0.1.2-alpha.4";
const dshPins = Object.entries(packageJson.devDependencies).filter(([name]) => name.startsWith("@deepseek-ai/dsh-"));
assert.ok(dshPins.length >= 8, "expected an explicit alpha.4 public package set");
for (const [name, version] of dshPins) assert.equal(version, expectedVersion, `${name} must be exactly pinned`);
assert.equal(packageJson.devDependencies["@deepseek-ai/cordis"], "4.0.2");
assert.equal(packageJson.dsh.client.platform, "web");
assert.ok(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-conversation"));
assert.deepEqual(Object.keys(hostPlugin).sort(), ["apply", "name"]);
assert.equal(hostPlugin.name, "qq-ui-alpha4-spike");
assert.equal(hostPlugin.apply(), undefined, "presentation-only host half must install nothing");
const hostPatch = await readFile(new URL("host/cordis.patch.yml", root), "utf8");
assert.equal((hostPatch.match(/name: '@hypermemetic-ai\/qq-ui-alpha4-spike'/gu) ?? []).length, 1);
for (const forbidden of ["webServer", "qq-core", "dsh-web-app", "WebSocket", "auth"]) {
  assert.equal(hostPatch.includes(forbidden), false, `host patch contains prohibited ownership term ${forbidden}`);
}

const before = await readFile(new URL("lib/client.js", root), "utf8");
const build = spawnSync(process.execPath, [new URL("scripts/build.mjs", root).pathname], { encoding: "utf8" });
assert.equal(build.status, 0, build.stderr);
const after = await readFile(new URL("lib/client.js", root), "utf8");
assert.equal(after, before, "bundle rebuild must be deterministic");

const registrations = [];
const context = vm.createContext({
  window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
});
new vm.Script(after, { filename: "lib/client.js" }).runInContext(context);
assert.equal(registrations.length, 1);
assert.equal(registrations[0].id, packageJson.name);
assert.equal(typeof registrations[0].factory, "function");
const requests = [];
const plugin = registrations[0].factory((id) => {
  requests.push(id);
  if (id === "react") return fakeReact;
  throw new Error(`unexpected stock module-table request: ${id}`);
});
assert.deepEqual(requests, ["react"]);
assert.equal(plugin.name, "qq-ui-alpha4-spike-client");
assert.equal(typeof plugin.apply, "function");
assert.deepEqual([...plugin.inject], ["slots", "theme", "sessions", "commandUi"]);

for (const forbidden of ["WebSocket(", "EventSource(", "fetch(", "querySelector", "/src/", "dsh-client-runtime"]) {
  assert.equal(after.includes(forbidden), false, `bundle contains prohibited path ${forbidden}`);
}
const digest = createHash("sha256").update(after).digest("hex");
console.log(`alpha4 stock-module composition proof passed: one ${packageJson.name} factory, sha256:${digest}`);
