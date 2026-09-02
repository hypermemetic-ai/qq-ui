#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";

const [runArg, command, ...args] = process.argv.slice(2);
if (runArg === undefined || command === undefined) {
  console.error("usage: node scripts/live/isolated-exec.mjs </tmp/qq-alpha3-live-id> <command> [...args]");
  process.exit(2);
}
let runRoot;
try {
  runRoot = disposableRunRoot(runArg, { create: true });
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const home = join(runRoot, "os-home");
const tmp = join(runRoot, "tmp");
for (const directory of [home, tmp, join(home, ".cache"), join(home, ".config")]) mkdirSync(directory, { recursive: true, mode: 0o700 });
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  DSH_HOME: join(runRoot, "dsh-home"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_CONFIG_HOME: join(home, ".config"),
  TMPDIR: tmp,
  LANG: process.env.LANG ?? "C.UTF-8",
  LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  npm_config_cache: join(runRoot, "npm-cache"),
};
const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(`isolated command failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
