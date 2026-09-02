#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";

const [runArg, command, ...args] = process.argv.slice(2);
if (runArg === undefined || command === undefined) {
  console.error("usage: node scripts/live/isolated-exec.mjs </tmp/qq-alpha4-live-id> <command> [...args]");
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
const dshHome = join(runRoot, "dsh-home");
const qqDshHome = join(runRoot, "qq-dsh-home");
const tmp = join(runRoot, "tmp");
const cache = join(home, ".cache");
const config = join(home, ".config");
const data = join(home, ".local", "share");
for (const directory of [home, dshHome, qqDshHome, tmp, cache, config, data, join(runRoot, "npm-cache")]) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const npmrc = join(runRoot, "npmrc");
writeFileSync(npmrc, "audit=false\nfund=false\nupdate-notifier=false\n", { flag: "a", mode: 0o600 });
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: home,
  DSH_HOME: dshHome,
  QQ_DSH_HOME: qqDshHome,
  XDG_CACHE_HOME: cache,
  XDG_CONFIG_HOME: config,
  XDG_DATA_HOME: data,
  TMPDIR: tmp,
  LANG: process.env.LANG ?? "C.UTF-8",
  LC_ALL: process.env.LC_ALL ?? "C.UTF-8",
  npm_config_cache: join(runRoot, "npm-cache"),
  npm_config_userconfig: npmrc,
};
const child = spawn(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
let forwarded;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    forwarded = signal;
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}
child.once("error", (error) => {
  console.error(`isolated command failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (code !== null) process.exitCode = code;
  else if ((signal ?? forwarded) === "SIGINT") process.exitCode = 130;
  else if ((signal ?? forwarded) === "SIGTERM") process.exitCode = 143;
  else process.exitCode = 1;
});
