/** HTML-escape untrusted text. Shared by literal MessageText and MarkdownText. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Literal user / tool / reasoning text. Matches DSH Web MessageText. */
export function renderMessageText(text) {
  return `<div class="message-text">${escapeHtml(text ?? "")}</div>`;
}

/**
 * Allowlisted assistant Markdown. Matches the DSH Web MarkdownText contract:
 * raw HTML stays literal, relative and unsafe-protocol destinations unwrap,
 * and only http(s)/mailto links are emitted.
 */
export function renderMarkdownText(text) {
  return `<div class="message-text message-markdown">${renderBlocks(String(text ?? ""))}</div>`;
}

const ASCII_PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch) {
  return WORD_CHAR.test(ch);
}

function sanitizeUrl(url) {
  const trimmed = String(url ?? "").trim();
  try {
    switch (new URL(trimmed).protocol) {
      case "http:":
      case "https:":
      case "mailto:":
        return trimmed;
      default:
        return "";
    }
  } catch {
    return "";
  }
}

function renderAnchor(url, children) {
  const href = sanitizeUrl(url);
  if (!href) return children;
  const external = /^https?:/i.test(href);
  const extra = external ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a href="${escapeHtml(href)}"${extra}>${children}</a>`;
}

function parseInlineLink(source, start) {
  if (source[start] !== "[") return null;
  let i = start + 1;
  let depth = 1;
  let label = "";
  while (i < source.length && depth > 0) {
    if (source[i] === "\\" && i + 1 < source.length) {
      label += source[i] + source[i + 1];
      i += 2;
      continue;
    }
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
    if (depth > 0) label += source[i];
    i += 1;
  }
  if (depth !== 0 || source[i] !== "(") return null;
  i += 1;
  while (source[i] === " ") i += 1;
  let url = "";
  if (source[i] === "<") {
    const end = source.indexOf(">", i + 1);
    if (end === -1) return null;
    url = source.slice(i + 1, end);
    i = end + 1;
  } else {
    let paren = 1;
    while (i < source.length && paren > 0) {
      if (source[i] === "\n") return null;
      if (source[i] === "(") paren += 1;
      else if (source[i] === ")") {
        paren -= 1;
        if (paren === 0) break;
      } else if (source[i] === " " && paren === 1) break;
      if (paren > 0) url += source[i];
      i += 1;
    }
  }
  while (source[i] === " ") i += 1;
  if (source[i] === '"' || source[i] === "'") {
    const quote = source[i];
    const end = source.indexOf(quote, i + 1);
    if (end === -1) return null;
    i = end + 1;
  }
  while (source[i] === " ") i += 1;
  if (source[i] !== ")") return null;
  return { label, url, end: i + 1 };
}

function findClosing(source, from, marker) {
  let idx = source.indexOf(marker, from);
  while (idx !== -1) {
    if (idx > from) return idx;
    idx = source.indexOf(marker, idx + marker.length);
  }
  return -1;
}

function findEmphasisClose(source, from, marker) {
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i += 1;
      continue;
    }
    if (source[i] === "`") {
      const ticks = /^`+/.exec(source.slice(i))?.[0] ?? "`";
      const close = source.indexOf(ticks, i + ticks.length);
      if (close === -1) continue;
      i = close + ticks.length - 1;
      continue;
    }
    if (source[i] === marker && i > from) {
      if (marker === "_" && i + 1 < source.length && isWordChar(source[i + 1])) continue;
      return i;
    }
  }
  return -1;
}

function renderInline(source) {
  let i = 0;
  let out = "";
  while (i < source.length) {
    const rest = source.slice(i);

    if (source[i] === "\\" && i + 1 < source.length && ASCII_PUNCT.test(source[i + 1])) {
      out += escapeHtml(source[i + 1]);
      i += 2;
      continue;
    }

    if (source[i] === "`") {
      const ticks = /^`+/.exec(rest)?.[0] ?? "`";
      const close = source.indexOf(ticks, i + ticks.length);
      if (close !== -1) {
        out += `<code>${escapeHtml(source.slice(i + ticks.length, close))}</code>`;
        i = close + ticks.length;
        continue;
      }
    }

    const autolink = /^(<(https?:\/\/[^>\s]+|mailto:[^>\s]+)>)/i.exec(rest);
    if (autolink) {
      out += renderAnchor(autolink[2], escapeHtml(autolink[2]));
      i += autolink[1].length;
      continue;
    }

    if (source.startsWith("![", i)) {
      const parsed = parseInlineLink(source, i + 1);
      if (parsed) {
        out += escapeHtml(parsed.label);
        i = parsed.end;
        continue;
      }
    }

    if (source[i] === "[") {
      const parsed = parseInlineLink(source, i);
      if (parsed) {
        const children = renderInline(parsed.label);
        out += renderAnchor(parsed.url, children);
        i = parsed.end;
        continue;
      }
    }

    if (source.startsWith("**", i) || source.startsWith("__", i)) {
      const marker = source.slice(i, i + 2);
      const close = findClosing(source, i + 2, marker);
      if (close !== -1) {
        out += `<strong>${renderInline(source.slice(i + 2, close))}</strong>`;
        i = close + 2;
        continue;
      }
    }

    if (source.startsWith("~~", i)) {
      const close = findClosing(source, i + 2, "~~");
      if (close !== -1) {
        out += `<del>${renderInline(source.slice(i + 2, close))}</del>`;
        i = close + 2;
        continue;
      }
    }

    if (source[i] === "*" || source[i] === "_") {
      const marker = source[i];
      if (marker === "_" && i > 0 && isWordChar(source[i - 1])) {
        out += marker;
        i += 1;
        continue;
      }
      const close = findEmphasisClose(source, i + 1, marker);
      if (close !== -1) {
        out += `<em>${renderInline(source.slice(i + 1, close))}</em>`;
        i = close + 1;
        continue;
      }
    }

    out += escapeHtml(source[i]);
    i += 1;
  }
  return out;
}

function isFenceOpen(line) {
  return /^(?:`{3,}|~{3,})/.test(line);
}

const ATX_HEADING = /^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

function isAtxHeading(line) {
  return ATX_HEADING.test(line);
}

function isQuote(line) {
  return /^\s{0,3}>/.test(line);
}

function isListItem(line) {
  return /^\s{0,3}(?:[-*+]|\d+[.)])[ \t]+/.test(line);
}

function isThematicBreak(line) {
  return /^\s{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line) && !isListItem(line);
}

function isBlockStart(line) {
  return isFenceOpen(line) || isAtxHeading(line) || isQuote(line) || isThematicBreak(line) || isListItem(line);
}

function renderParagraph(lines) {
  const html = lines
    .map((line, index) => {
      const hard = / {2}$/.test(line);
      const text = hard ? line.slice(0, -2) : line;
      const rendered = renderInline(text);
      if (index === lines.length - 1) return rendered;
      return hard ? `${rendered}<br>` : `${rendered} `;
    })
    .join("");
  return `<p>${html}</p>`;
}

function renderBlocks(source) {
  const lines = source.split(/\r\n|\n|\r/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    const fence = /^(?<marker>`{3,}|~{3,})(?<info>.*)$/.exec(line);
    if (fence) {
      const marker = fence.groups.marker;
      const closer = new RegExp(`^${marker[0]}{${marker.length},}\\s*$`);
      const body = [];
      i += 1;
      while (i < lines.length && !closer.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const lang = /^[\w-]+/.exec(fence.groups.info.trim())?.[0];
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (isThematicBreak(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (isQuote(line)) {
      const quoted = [];
      while (i < lines.length && isQuote(lines[i])) {
        quoted.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])[ \t]+(.*)$/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const start = ordered ? Number.parseInt(list[2], 10) : undefined;
      const items = [];
      while (i < lines.length) {
        const item = /^(\s*)([-*+]|\d+[.)])[ \t]+(.*)$/.exec(lines[i]);
        if (!item || /\d/.test(item[2]) !== ordered) break;
        const chunks = [item[3]];
        i += 1;
        while (
          i < lines.length
          && /^\s{2,}\S/.test(lines[i])
          && !/^(\s*)([-*+]|\d+[.)])[ \t]+/.test(lines[i])
        ) {
          chunks.push(lines[i].trim());
          i += 1;
        }
        items.push(renderInline(chunks.join(" ")));
      }
      const tag = ordered ? "ol" : "ul";
      const startAttr = start && start !== 1 ? ` start="${start}"` : "";
      out.push(`<${tag}${startAttr}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length === 0) {
      out.push(renderParagraph([line]));
      i += 1;
      continue;
    }
    out.push(renderParagraph(para));
  }
  return out.join("");
}
