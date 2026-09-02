#!/usr/bin/env node
import { resolve } from "node:path";
import { verifyPackedPrerequisites } from "./packed-prerequisites.mjs";
const [uiPack, uiProvenance, modelsPack, modelsProvenance, packsDirectory] = process.argv.slice(2);
if ([uiPack, uiProvenance, modelsPack, modelsProvenance, packsDirectory].some((value) => value === undefined)) {
  console.error("usage: node scripts/live/verify-packed-prerequisites.mjs <ui.tgz> <ui.provenance.json> <models.tgz> <models.provenance.json> <packs-directory>");
  process.exit(2);
}
const result = verifyPackedPrerequisites({ "ui-pack": uiPack, "ui-provenance": uiProvenance, "qq-models-pack": modelsPack, "qq-models-provenance": modelsProvenance }, resolve(packsDirectory));
console.log(JSON.stringify(result, null, 2));
