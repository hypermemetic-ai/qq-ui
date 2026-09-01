#!/usr/bin/env node
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let building = false;
let queued = false;
let timer;

function build() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const child = spawn(process.execPath, [resolve(root, "scripts/build.mjs")], { stdio: "inherit" });
  child.once("exit", (code) => {
    building = false;
    if (code !== 0) process.stderr.write(`alpha3 spike build failed with status ${code}\n`);
    if (queued) {
      queued = false;
      build();
    }
  });
}

build();
const watcher = watch(resolve(root, "src"), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(build, 40);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    watcher.close();
    process.exit(0);
  });
}
console.log("alpha3 spike watcher: src -> lib/client.js (stock DSH client-hmr polls the artifact)");
