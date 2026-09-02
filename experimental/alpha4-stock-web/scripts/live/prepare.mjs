#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readAlpha4Source } from "../alpha4-source.mjs";
import { verifyPackedPrerequisites } from "./packed-prerequisites.mjs";
import { disposableRunRoot } from "./run-root.mjs";

function usage(message) {
  if (message) console.error(message);
  console.error("usage: node scripts/live/prepare.mjs --run-root /tmp/qq-alpha4-live-<id> --source <exact-tagged-alpha4-source> --ui-pack <clean-ui.tgz> --ui-provenance <json> --qq-models-pack <clean-models.tgz> --qq-models-provenance <json>");
  process.exit(2);
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key?.startsWith("--") || value === undefined) usage("options require name/value pairs");
  options[key.slice(2)] = value;
}
for (const required of ["run-root", "source", "ui-pack", "ui-provenance", "qq-models-pack", "qq-models-provenance"]) {
  if (!options[required]) usage(`missing --${required}`);
}
let runRoot;
try {
  runRoot = disposableRunRoot(options["run-root"], { create: true });
} catch (error) {
  usage(error.message);
}
if (readdirSync(runRoot).length > 0) usage(`refusing non-empty run root: ${runRoot}`);
const closure = readAlpha4Source(options.source);
const packageRoot = resolve(new URL("../../", import.meta.url).pathname);
for (const directory of [
  "artifacts", "browser-profile", "dsh-home", "harness", "host", "npm-cache", "os-home",
  "os-home/.cache", "os-home/.config", "os-home/.local/share", "packs", "patches", "profile-cache",
  "qq-dsh-home", "tmp", "workspace", "workspace/workspace",
]) mkdirSync(join(runRoot, directory), { recursive: true, mode: 0o700 });
writeFileSync(join(runRoot, "npmrc"), "audit=false\nfund=false\nupdate-notifier=false\n", { mode: 0o600 });

const prerequisite = verifyPackedPrerequisites(options, join(runRoot, "packs"));
cpSync(packageRoot, join(runRoot, "harness"), {
  recursive: true,
  filter: (item) => !item.includes("node_modules") && !item.includes(`${join(packageRoot, "evidence")}`) && !item.includes(".git"),
});
writeFileSync(join(runRoot, "host", "package.json"), `${JSON.stringify({
  name: "qq-alpha4-live-host",
  private: true,
  type: "module",
  dependencies: { "@deepseek-ai/dsh": closure.version },
  overrides: closure.overrides,
}, null, 2)}\n`);
writeFileSync(join(runRoot, "patches", "grok-default.patch.yml"), `# Non-secret isolated live-gate defaults.\n- id: agent-default-model\n  config:\n    provider: xai-auth\n    model: grok-4.6\n- id: session-persistence-jsonl\n  config:\n    compression: none\n    packChunks: false\n`);

const metadata = {
  preparedAt: new Date().toISOString(),
  status: "PREPARED_AWAITING_INSTALL_AND_FRESH_GROK_LOGIN",
  source: { commit: closure.commit, tag: closure.tag, packageCount: Object.keys(closure.overrides).length, setSha256: closure.digest },
  packages: {
    ui: { package: prerequisite.ui.package, version: prerequisite.ui.version, commit: prerequisite.ui.commit, sha256: prerequisite.ui.sha256, tarball: basename(prerequisite.ui.tarball) },
    models: { package: prerequisite.models.package, version: prerequisite.models.version, commit: prerequisite.models.commit, sha256: prerequisite.models.sha256, tarball: basename(prerequisite.models.tarball) },
  },
  runRoot,
  isolation: {
    HOME: join(runRoot, "os-home"), DSH_HOME: join(runRoot, "dsh-home"), QQ_DSH_HOME: join(runRoot, "qq-dsh-home"),
    npmCache: join(runRoot, "npm-cache"), browserProfile: join(runRoot, "browser-profile"), workspace: join(runRoot, "workspace/workspace"),
    host: "127.0.0.1", port: 0, openBrowser: false, protectedPort: 3082,
  },
  modelDefault: { provider: "xai-auth", model: "grok-4.6", secret: false },
};
writeFileSync(join(runRoot, "artifacts", "preflight.json"), `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(join(runRoot, "artifacts", "environment-policy.json"), `${JSON.stringify({
  inherited: ["PATH", "LANG", "LC_ALL"],
  generated: ["HOME", "DSH_HOME", "QQ_DSH_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TMPDIR", "npm_config_cache", "npm_config_userconfig"],
  explicitlyAbsent: ["provider keys", "proxy credentials", "production HOME", "production QQ_DSH_HOME", "NODE_OPTIONS", "dotenv discovery roots"],
  allOtherVariables: "removed by the isolated executor",
}, null, 2)}\n`);

const uiTar = prerequisite.ui.tarball;
const modelsTar = prerequisite.models.tarball;
writeFileSync(join(runRoot, "COMMANDS.md"), `# Isolated alpha.4 stock-Web live gate\n\nThe tarballs were accepted only with clean-commit provenance. Never substitute a directory/link or copy auth.\n\n\`\`\`sh\niso() { node ${runRoot}/harness/scripts/live/isolated-exec.mjs ${runRoot} "$@"; }\n\n# Repository/strict-type closure from the immutable harness snapshot.\ncd ${runRoot}/harness\niso npm ci --ignore-scripts --no-audit --no-fund\niso npm run build\niso npm run check\niso npm run prove\n\n# Exact host closure; hooks remain disabled until the five named manifests are reviewed.\ncd ${runRoot}/host\niso npm install --ignore-scripts --no-audit --no-fund\ncp package-lock.json ${runRoot}/artifacts/host-package-lock.json\niso node ${runRoot}/harness/scripts/live/install-script-inventory.mjs ${runRoot}/artifacts/install-scripts.json ${runRoot}/host\niso npm rebuild @deepseek-ai/dsh-subprocess-local @google/genai koffi node-pty protobufjs\niso node ${runRoot}/harness/scripts/audit-alpha4-closure.mjs ${runRoot}/host\niso node ${runRoot}/harness/scripts/live/inventory.mjs ${runRoot}/artifacts/host-installed-versions.json ${runRoot}/host\niso ${runRoot}/host/node_modules/.bin/dsh --version > ${runRoot}/artifacts/version.log\niso ${runRoot}/host/node_modules/.bin/dsh --help > ${runRoot}/artifacts/launcher-help.log\niso ${runRoot}/host/node_modules/.bin/dsh web --help > ${runRoot}/artifacts/web-help.log\n\n# Initialize stock profile, exact-pin it, install packed models Bundle + plain UI dependency.\ncd ${runRoot}/workspace\niso ${runRoot}/host/node_modules/.bin/dsh web --dump-default-config > ${runRoot}/artifacts/stock-default-config.yml\niso ${runRoot}/host/node_modules/.bin/dsh web --dump-config > ${runRoot}/artifacts/stock-config.yml\niso node ${runRoot}/harness/scripts/live/pin-profile.mjs ${runRoot}/dsh-home/profiles/web/package.json ${closure.source}\niso ${runRoot}/host/node_modules/.bin/dsh plugin --profile web add file:${modelsTar} file:${uiTar}\ncp ${runRoot}/dsh-home/profiles/web/package.json ${runRoot}/artifacts/profile-package.json\ncp ${runRoot}/dsh-home/profiles/web/pnpm-lock.yaml ${runRoot}/artifacts/profile-pnpm-lock.yaml\niso ${runRoot}/host/node_modules/.bin/dsh web --dump-config > ${runRoot}/artifacts/additive-config.yml\niso ${runRoot}/host/node_modules/.bin/dsh web --patch ${runRoot}/patches/grok-default.patch.yml --patch ${runRoot}/harness/host/cordis.patch.yml --dump-config > ${runRoot}/artifacts/patched-config.yml\niso node ${runRoot}/harness/scripts/live/verify-composition.mjs ${runRoot}/dsh-home/profiles/web/package.json ${runRoot}/artifacts/stock-config.yml ${runRoot}/artifacts/additive-config.yml ${runRoot}/artifacts/patched-config.yml\niso node ${runRoot}/harness/scripts/live/inventory.mjs ${runRoot}/artifacts/all-installed-versions.json ${runRoot}/host ${runRoot}/dsh-home/profiles/web\n\n# Stop here for operator approval. Fresh device login is interactive and MUST NOT be piped/recorded.\ncd ${runRoot}/workspace\niso ${runRoot}/dsh-home/profiles/web/node_modules/.bin/qq-models-login grok\n# After approval, retain only readiness and file-mode facts (never code/token/content):\niso node ${runRoot}/harness/scripts/live/auth-facts.mjs ${runRoot}\n\n# Supervised stock host + browser + persisted-turn proof. No raw launch URL is retained.\niso node ${runRoot}/harness/scripts/live/supervise.mjs --run-root ${runRoot} --playwright '<playwright-module-dir>' --executable '<chromium-executable>'\n\`\`\`\n`);
console.log(JSON.stringify(metadata, null, 2));
