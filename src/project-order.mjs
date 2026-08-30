/**
 * A project place is identified by its authoritative project name and folder.
 * Human labels determine the calm visual sequence; authoritative names break
 * label ties so duplicate labels and folders can never collapse or drift.
 */
export function projectPlaceIdentity(entry) {
  const project = String(entry?.project ?? entry?.name ?? "").trim();
  const folder = String(entry?.folder ?? "").trim();
  return project ? `${project}\n${folder}` : "";
}

function projectName(entry) {
  return String(entry?.project ?? entry?.name ?? "").trim();
}

function projectLabel(entry) {
  return String(entry?.projectLabel ?? entry?.label ?? projectName(entry)).trim();
}

function folderName(entry) {
  return String(entry?.folder ?? "").trim();
}

function folderLabel(entry) {
  return String(entry?.folderLabel ?? folderName(entry)).trim();
}

function compareText(left, right) {
  const primary = left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
  return primary || left.localeCompare(right, "en", { numeric: true, sensitivity: "variant" });
}

/** Stable, activity-independent order shared by the project rail and tracker. */
export function compareProjectPlaces(left, right) {
  const byProjectLabel = compareText(projectLabel(left), projectLabel(right));
  if (byProjectLabel) return byProjectLabel;
  const byProjectIdentity = compareText(projectName(left), projectName(right));
  if (byProjectIdentity) return byProjectIdentity;
  const leftFolder = folderName(left);
  const rightFolder = folderName(right);
  if (!leftFolder && rightFolder) return -1;
  if (leftFolder && !rightFolder) return 1;
  const byFolderLabel = compareText(folderLabel(left), folderLabel(right));
  if (byFolderLabel) return byFolderLabel;
  const byFolderIdentity = compareText(leftFolder, rightFolder);
  if (byFolderIdentity) return byFolderIdentity;
  return compareText(String(left?.key ?? ""), String(right?.key ?? ""));
}

export function orderedProjectPlaces(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => compareProjectPlaces(left.entry, right.entry) || left.index - right.index)
    .map(({ entry }) => entry);
}
