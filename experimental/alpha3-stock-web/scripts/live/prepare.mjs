#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { disposableRunRoot } from "./run-root.mjs";

const EXPECTED_COMMIT = "dd6322d604e00eec1ba5e0c8541159906a21094a";
const EXPECTED_TAG = "dsh-v0.1.2-alpha.3";
const EXPECTED_VERSION = "0.1.2-alpha.3";
function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/live/prepare.mjs --run-root /tmp/qq-alpha3-live-<id> --source <authoritative-alpha3-source>");
  process.exit(2);
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) usage("options require name/value pairs");
  options[key.slice(2)] = value;
}
if (!options["run-root"] || !options.source) usage();
let runRoot;
try {
  runRoot = disposableRunRoot(options["run-root"], { create: true });
} catch (error) {
  usage(error.message);
}
const source = realpathSync(options.source);
if (readdirSync(runRoot).length > 0) usage(`refusing non-empty run root: ${runRoot}`);
const gitEnv = { ...process.env };
delete gitEnv.GIT_DIR;
delete gitEnv.GIT_WORK_TREE;
const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", env: gitEnv }).trim();
assert.equal(git("rev-parse", "HEAD"), EXPECTED_COMMIT, "source commit mismatch");
assert.equal(git("describe", "--tags", "--exact-match", "HEAD"), EXPECTED_TAG, "source tag mismatch");

const packageRoot = resolve(new URL("../../", import.meta.url).pathname);
for (const directory of ["artifacts", "dsh-home", "host", "npm-cache", "os-home", "profile-cache", "spike", "workspace"]) {
  mkdirSync(join(runRoot, directory), { recursive: true, mode: 0o700 });
}
cpSync(packageRoot, join(runRoot, "spike"), {
  recursive: true,
  filter: (item) => !item.includes("node_modules") && !item.includes(`${join(packageRoot, "evidence")}`),
});

const overrides = {};
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const item = join(directory, entry.name);
    if (entry.isDirectory()) walk(item);
    else if (entry.name === "package.json") {
      const row = JSON.parse(readFileSync(item, "utf8"));
      if (!row.name?.startsWith("@deepseek-ai/dsh")) continue;
      assert.equal(row.version, EXPECTED_VERSION, `${row.name} source version mismatch`);
      overrides[row.name] = row.version;
    }
  }
}
walk(source);
const sortedOverrides = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(runRoot, "host", "package.json"), `${JSON.stringify({
  name: "qq-alpha3-live-host",
  private: true,
  dependencies: { "@deepseek-ai/dsh": EXPECTED_VERSION },
  overrides: sortedOverrides,
}, null, 2)}\n`);
const metadata = {
  preparedAt: new Date().toISOString(),
  source: { path: source, commit: EXPECTED_COMMIT, tag: EXPECTED_TAG },
  runRoot,
  isolation: {
    HOME: join(runRoot, "os-home"),
    DSH_HOME: join(runRoot, "dsh-home"),
    npmCache: join(runRoot, "npm-cache"),
    host: "127.0.0.1",
    port: 0,
    openBrowser: false,
  },
  overrides: Object.keys(sortedOverrides).length,
};
writeFileSync(join(runRoot, "artifacts", "preflight.json"), `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(join(runRoot, "artifacts", "environment-policy.json"), `${JSON.stringify({
  inherited: ["PATH", "LANG", "LC_ALL"],
  generated: ["HOME", "DSH_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "TMPDIR", "npm_config_cache"],
  allOtherVariables: "removed",
}, null, 2)}\n`);
writeFileSync(join(runRoot, "COMMANDS.md"), `# Isolated alpha.3 live-gate commands

Run only inside this disposable root. Do not add credentials copied from another profile.

\`\`\`sh
iso() { node ${runRoot}/spike/scripts/live/isolated-exec.mjs ${runRoot} "$@"; }
cd ${runRoot}/spike
if test -f package-lock.json; then iso npm ci --ignore-scripts; else iso npm install --ignore-scripts --no-audit --no-fund; fi
iso npm run build && iso npm run check && iso npm run prove
cd ${runRoot}/host
if test -f package-lock.json; then iso npm ci --ignore-scripts; else iso npm install --ignore-scripts --no-audit --no-fund; fi
iso node ${runRoot}/spike/scripts/audit-alpha3-closure.mjs ${runRoot}/host
# Review installed script manifests, then narrowly run only required native builds:
iso npm rebuild @deepseek-ai/dsh-subprocess-local koffi node-pty
cd ${runRoot}/workspace
iso ${runRoot}/host/node_modules/.bin/dsh web --dump-config > ${runRoot}/artifacts/stock-config.yml
iso node ${runRoot}/spike/scripts/live/pin-profile.mjs ${runRoot}/dsh-home/profiles/web/package.json ${source}
iso ${runRoot}/host/node_modules/.bin/dsh plugin --profile web add ${runRoot}/spike
iso node ${runRoot}/spike/scripts/live/inventory.mjs ${runRoot}/artifacts/installed-versions.json ${runRoot}/host ${runRoot}/dsh-home/profiles/web
iso ${runRoot}/host/node_modules/.bin/dsh web --patch ${runRoot}/spike/host/cordis.patch.yml --dump-config > ${runRoot}/artifacts/patched-config.yml
iso node ${runRoot}/spike/scripts/live/verify-composition.mjs ${runRoot}/dsh-home/profiles/web/package.json ${runRoot}/spike ${runRoot}/artifacts/stock-config.yml ${runRoot}/artifacts/patched-config.yml
iso ${runRoot}/host/node_modules/.bin/dsh web --patch ${runRoot}/spike/host/cordis.patch.yml --host 127.0.0.1 --port 0 --no-open 2>&1 | tee ${runRoot}/artifacts/host.log
# In another isolated shell, pass the ephemeral URL printed above:
node ${runRoot}/spike/scripts/live/isolated-exec.mjs ${runRoot} node ${runRoot}/spike/scripts/live/browser.mjs --url '<printed-launch-url>' --spike ${runRoot}/spike --workspace ${runRoot}/workspace --artifacts ${runRoot}/artifacts --playwright '<playwright-module-dir>' --executable '<chromium-executable>'
\`\`\`
`);
console.log(JSON.stringify(metadata, null, 2));
