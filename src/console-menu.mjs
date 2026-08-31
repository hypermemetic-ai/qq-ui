const ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_LABEL_LENGTH = 80;
const MAX_HREF_LENGTH = 2048;
const MIN_ORDER = -10_000;
const MAX_ORDER = 10_000;
const MENU_ORIGIN = "http://qq-ui.invalid";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeId(value) {
  if (typeof value !== "string") throw new TypeError("qq-ui console menu item id must be a string");
  const id = value.trim();
  if (!ID_PATTERN.test(id)) {
    throw new TypeError("qq-ui console menu item id must be a stable lowercase token");
  }
  return id;
}

function normalizeLabel(value) {
  if (typeof value !== "string") throw new TypeError("qq-ui console menu item label must be a string");
  const label = value.trim();
  if (!label || label.length > MAX_LABEL_LENGTH || CONTROL_PATTERN.test(label)) {
    throw new TypeError(`qq-ui console menu item label must contain 1-${MAX_LABEL_LENGTH} safe characters`);
  }
  return label;
}

function normalizeHref(value) {
  if (typeof value !== "string") throw new TypeError("qq-ui console menu item href must be a string");
  const href = value.trim();
  if (!href || href.length > MAX_HREF_LENGTH || href !== value || !href.startsWith("/")
      || href.startsWith("//") || href.includes("\\") || CONTROL_PATTERN.test(href)) {
    throw new TypeError("qq-ui console menu item href must be a safe same-origin absolute path");
  }
  let parsed;
  try {
    parsed = new URL(href, MENU_ORIGIN);
  } catch {
    throw new TypeError("qq-ui console menu item href must be a safe same-origin absolute path");
  }
  if (parsed.origin !== MENU_ORIGIN || `${parsed.pathname}${parsed.search}${parsed.hash}` !== href) {
    throw new TypeError("qq-ui console menu item href must be a safe same-origin absolute path");
  }
  return href;
}

function normalizeOrder(value) {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_ORDER || value > MAX_ORDER) {
    throw new TypeError(`qq-ui console menu item order must be an integer from ${MIN_ORDER} to ${MAX_ORDER}`);
  }
  return value;
}

function normalizeItem(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("qq-ui console menu item must be an object");
  }
  if (spec.kind !== "navigation") {
    throw new TypeError('qq-ui console menu item kind must be "navigation"');
  }
  return Object.freeze({
    kind: "navigation",
    id: normalizeId(spec.id),
    label: normalizeLabel(spec.label),
    href: normalizeHref(spec.href),
    order: normalizeOrder(spec.order),
  });
}

/** Create the validated, presentation-neutral registry exposed by the qq-ui service. */
export function createConsoleMenuRegistry() {
  const entries = new Map();

  function register(spec) {
    const item = normalizeItem(spec);
    if (entries.has(item.id)) throw new Error(`qq-ui console menu item is already registered: ${item.id}`);
    entries.set(item.id, item);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (entries.get(item.id) === item) entries.delete(item.id);
    };
  }

  function items() {
    return Object.freeze([...entries.values()].sort((left, right) => (
      left.order - right.order
      || compareText(left.label, right.label)
      || compareText(left.id, right.id)
    )));
  }

  return Object.freeze({ register, items });
}
