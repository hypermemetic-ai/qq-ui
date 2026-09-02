import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const PREFIX = "/tmp/qq-alpha3-live-";

function assertCanonicalExisting(path, label) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || realpathSync(path) !== path) {
    throw new Error(`refusing symlinked or non-canonical ${label}: ${path}`);
  }
  if (!stats.isDirectory()) throw new Error(`refusing non-directory ${label}: ${path}`);
}

export function disposableRunRoot(pathArg, { create = false } = {}) {
  const runRoot = resolve(pathArg);
  if (!runRoot.startsWith(PREFIX) || runRoot === PREFIX) {
    throw new Error(`refusing non-disposable run root: ${runRoot}`);
  }

  // Validate before mkdir: an existing symlink anywhere in the missing path's
  // ancestry must not redirect task state outside the disposable namespace.
  let ancestor = runRoot;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`cannot find an existing ancestor for run root: ${runRoot}`);
    ancestor = parent;
  }
  assertCanonicalExisting(ancestor, "run-root ancestor");

  if (create) mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  if (!existsSync(runRoot)) throw new Error(`disposable run root does not exist: ${runRoot}`);
  assertCanonicalExisting(runRoot, "disposable run root");
  return runRoot;
}

export function disposableRootForPath(pathArg) {
  const path = resolve(pathArg);
  const match = path.match(/^\/tmp\/qq-alpha3-live-[^/]+/u);
  if (match === null) throw new Error(`path is outside /tmp/qq-alpha3-live-*: ${path}`);
  return match[0];
}

export function assertCanonicalRunPath(pathArg, runRoot, label) {
  const path = resolve(pathArg);
  if (path !== runRoot && !path.startsWith(`${runRoot}${sep}`)) {
    throw new Error(`refusing ${label} outside run root ${runRoot}: ${path}`);
  }
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  assertCanonicalExisting(path, label);
  return path;
}
