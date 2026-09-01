#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const id = packageJson.name;
const sourcePath = resolve(root, "src/client.cjs");
const source = await readFile(sourcePath, "utf8");
const prohibited = [
  [/(?:WebSocket|EventSource)\s*\(/u, "parallel connection"],
  [/\bfetch\s*\(/u, "presentation fetch/transport"],
  [/querySelector|closest\s*\(|getElementById/u, "private DOM lookup"],
  [/@deepseek-ai\/[^"']+\/src\//u, "DSH deep import"],
  [/\b(?:retry|reconnect|reconcile|dedup)\b/iu, "operational repair logic"],
];
for (const [pattern, description] of prohibited) {
  if (pattern.test(source)) throw new Error(`prohibited ${description} found in src/client.cjs`);
}
if (!source.includes('require("react")')) throw new Error("client source must request React from the stock module table");

const prefix = `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(id)},\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n`;
const indented = source.split("\n").map((line) => line === "" ? "" : `    ${line}`).join("\n");
const suffix = "\n    return module.exports;\n  }\n});\n";
const bundle = `${prefix}${indented}${suffix}`;
const hash = createHash("sha256").update(bundle).digest("hex");
const map = {
  version: 3,
  file: "client.js",
  sources: ["../src/client.cjs"],
  sourcesContent: [source],
  names: [],
  mappings: "",
};

await mkdir(resolve(root, "lib"), { recursive: true });
await writeFile(resolve(root, "lib/client.js"), `${bundle}//# sourceMappingURL=client.js.map\n`);
await writeFile(resolve(root, "lib/client.js.map"), `${JSON.stringify(map)}\n`);
await writeFile(resolve(root, "lib/client.d.ts"), await readFile(resolve(root, "src/client.d.ts"), "utf8"));
await writeFile(resolve(root, "lib/index.js"), await readFile(resolve(root, "src/index.mjs"), "utf8"));
await writeFile(resolve(root, "lib/index.d.ts"), 'export declare const name = "qq-ui-alpha3-spike";\nexport declare function apply(): void;\n');
console.log(`alpha3 spike bundle built: ${bundle.length} bytes sha256:${hash}`);
