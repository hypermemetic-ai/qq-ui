import hljs from "highlight.js";
import MarkdownIt from "markdown-it";

/** HTML-escape untrusted text. Shared by literal text and code fallbacks. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLink(value) {
  const target = String(value ?? "").trim();
  try {
    const protocol = new URL(target).protocol;
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function highlighted(source, language) {
  const name = String(language ?? "").trim().toLocaleLowerCase("en-US");
  if (!name || !hljs.getLanguage(name)) return escapeHtml(source);
  try {
    return hljs.highlight(String(source), { language: name, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(source);
  }
}

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
  highlight(source, language) {
    return highlighted(source, language);
  },
});

// Let the maintained parser tokenize every destination, then make emission an
// explicit allowlist. Unsafe and relative links unwrap to their readable label.
markdown.validateLink = () => true;
markdown.renderer.rules.link_open = (tokens, index, _options, _env, renderer) => {
  const token = tokens[index];
  const href = token.attrGet("href") ?? "";
  token.meta = { ...(token.meta ?? {}), safeHref: safeLink(href) };
  if (!token.meta.safeHref) return "";
  if (/^https?:/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return renderer.renderToken(tokens, index, _options);
};
markdown.renderer.rules.link_close = (tokens, index, options, _env, renderer) => {
  let nesting = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].type === "link_close") nesting += 1;
    if (tokens[cursor].type !== "link_open") continue;
    if (nesting > 0) {
      nesting -= 1;
      continue;
    }
    return tokens[cursor].meta?.safeHref ? renderer.renderToken(tokens, index, options) : "";
  }
  return "";
};
markdown.renderer.rules.image = (tokens, index) => escapeHtml(tokens[index].content ?? "");
markdown.renderer.rules.s_open = () => "<del>";
markdown.renderer.rules.s_close = () => "</del>";

/** Literal user / tool / reasoning text. Matches DSH Web MessageText. */
export function renderMessageText(text) {
  return `<div class="message-text">${escapeHtml(text ?? "")}</div>`;
}

/**
 * Maintained Markdown-It rendering with raw HTML disabled and allowlisted
 * absolute links. No project file or transcript text is interpreted as HTML.
 */
export function renderMarkdownText(text, className = "") {
  const extra = String(className ?? "").trim();
  const classes = `message-text message-markdown${extra ? ` ${escapeHtml(extra)}` : ""}`;
  return `<div class="${classes}">${markdown.render(String(text ?? ""))}</div>`;
}

/** Deterministic syntax highlighting; no auto-detection is ever performed. */
export function renderHighlightedCode(text, language) {
  const name = String(language ?? "").trim().toLocaleLowerCase("en-US");
  const known = name && hljs.getLanguage(name);
  const className = known ? `hljs language-${escapeHtml(name)}` : "hljs language-plaintext";
  return `<pre class="document-code"><code class="${className}">${known ? highlighted(text, name) : escapeHtml(text)}</code></pre>`;
}

export const internals = Object.freeze({ safeLink, highlighted, markdown });
