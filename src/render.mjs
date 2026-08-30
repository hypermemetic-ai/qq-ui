import { escapeHtml, renderHighlightedCode, renderMarkdownText, renderMessageText } from "./markdown.mjs";

export { escapeHtml };

/** One-line media-workflow download chip. Idle (missing/empty) renders nothing. */
export function renderProgressChip(progress) {
  if (!progress || typeof progress !== "object") return "";
  const title = String(progress.title ?? "").trim();
  if (!title) return "";
  const parts = [title];
  for (const key of ["percent", "rate", "eta"]) {
    const value = String(progress[key] ?? "").trim();
    if (value) parts.push(value);
  }
  return `<p class="download-chip" role="status">${escapeHtml(parts.join(" · "))}</p>`;
}

const TOOL_PREVIEW_LINES = 80;
const TOOL_PREVIEW_BYTES = 12 * 1024;

function safeType(value) {
  return typeof value === "string" ? value : "unknown";
}

function mediaAttachment(block) {
  return block?.attachment && typeof block.attachment === "object" ? block.attachment : {};
}

function declaredMediaType(block) {
  const attachment = mediaAttachment(block);
  const value = String(block?.mediaType ?? block?.mimeType ?? attachment.mediaType ?? attachment.mimeType ?? "").trim();
  if (/^(?:image|audio|video)\/[a-z0-9.+-]+$/i.test(value)) return value.toLowerCase();
  if (block?.type === "image") return "image/png";
  return "";
}

function safeMediaSource(block) {
  const attachment = mediaAttachment(block);
  const mediaType = declaredMediaType(block);
  const data = block?.data ?? attachment.data;
  if (mediaType && typeof data === "string" && data.trim()) {
    const base64 = data.replace(/\s+/g, "");
    if (/^[a-z0-9+/]+=*$/i.test(base64)) return `data:${mediaType};base64,${base64}`;
  }
  const candidate = String(
    block?.url ?? block?.src ?? attachment.url ?? attachment.src
      ?? (typeof block?.attachment === "string" ? block.attachment : ""),
  ).trim();
  if (!candidate || /^(?:javascript|vbscript):/i.test(candidate)) return "";
  if (/^data:/i.test(candidate)) {
    return /^data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(candidate) ? candidate : "";
  }
  return /^(?:https?:\/\/|\/|\.\.?\/)/i.test(candidate) ? candidate : "";
}

function mediaDimensions(block) {
  const attachment = mediaAttachment(block);
  const width = Number(block?.width ?? attachment.width);
  const height = Number(block?.height ?? attachment.height);
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
  };
}

function mediaBlock(block, scope = "attachment") {
  const type = block?.type === "audio" || block?.type === "video" ? block.type : "image";
  const source = safeMediaSource(block);
  const { width, height } = mediaDimensions(block);
  const dimensions = width && height ? ` ${width}×${height}` : "";
  if (!source) return `<p class="attachment ${escapeHtml(scope)}-media-unavailable">${escapeHtml(`${type[0].toUpperCase()}${type.slice(1)} attachment${dimensions}`)}</p>`;
  const dimensionAttrs = `${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""}`;
  const label = String(block?.name ?? mediaAttachment(block).name ?? `${type} attachment`);
  const content = type === "image"
    ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(label)}" decoding="async"${dimensionAttrs}>`
    : type === "video"
      ? `<video src="${escapeHtml(source)}" aria-label="${escapeHtml(label)}" controls preload="metadata" playsinline${dimensionAttrs}>${escapeHtml(label)}</video>`
      : `<audio src="${escapeHtml(source)}" aria-label="${escapeHtml(label)}" controls preload="metadata">${escapeHtml(label)}</audio>`;
  return `<figure class="attachment ${escapeHtml(scope)}-media ${escapeHtml(scope)}-media-${type}">${content}</figure>`;
}

function attachmentBlock(block) {
  const attachment = block?.attachment ?? {};
  const dimensions = Number.isFinite(attachment.width) && Number.isFinite(attachment.height)
    ? ` ${attachment.width}×${attachment.height}`
    : "";
  return `<p class="attachment">Image attachment${escapeHtml(dimensions)}</p>`;
}

function contentBlocks(blocks, { markdown = false, empty = true } = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return empty ? '<p class="empty-content">No displayable content</p>' : "";
  }
  return blocks.map((block) => {
    if (!block || typeof block !== "object") return '<p class="empty-content">Unsupported content</p>';
    if (block.type === "text") {
      return markdown ? renderMarkdownText(block.text ?? "") : renderMessageText(block.text ?? "");
    }
    if (block.type === "image") return attachmentBlock(block);
    return `<p class="empty-content">Unsupported content: ${escapeHtml(safeType(block.type))}</p>`;
  }).join("");
}

function eventTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function timeElement(value) {
  const time = eventTime(value);
  return time ? `<time datetime="${time}">${escapeHtml(time)}</time>` : "";
}

function utf8Prefix(value, maxBytes) {
  const text = String(value ?? "");
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;
  let kept = "";
  let bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    kept += character;
    bytes += size;
  }
  return kept;
}

export function truncateToolOutput(value, limits = {}) {
  const text = String(value ?? "");
  const maxLines = limits.maxLines ?? TOOL_PREVIEW_LINES;
  const maxBytes = limits.maxBytes ?? TOOL_PREVIEW_BYTES;
  const lines = text.split("\n");
  const linePreview = lines.slice(0, maxLines).join("\n");
  const preview = utf8Prefix(linePreview, maxBytes);
  const bytes = new TextEncoder().encode(text).length;
  return {
    text,
    preview,
    lines: lines.length,
    bytes,
    truncated: preview !== text,
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.ceil(bytes / 1024)} KiB`;
}

function renderToolText(text) {
  const output = truncateToolOutput(text);
  const preview = `<pre class="tool-output-preview">${escapeHtml(output.preview)}</pre>`;
  if (!output.truncated) return preview;
  return `${preview}<p class="tool-output-truncation">Preview · ${output.lines} lines · ${formatBytes(output.bytes)}</p>`;
}

function toolViewBlocks(view) {
  if (!view || typeof view !== "object") return [];
  if (view.card === "generic") return Array.isArray(view.content) ? view.content : [];
  if (view.card === "terminal") {
    return typeof view.output === "string" ? [{ type: "text", text: view.output }] : [];
  }
  if (view.card === "read") {
    const lines = Array.isArray(view.lines)
      ? view.lines.map((line) => `${line.number} │ ${line.text}`).join("\n")
      : "";
    return lines ? [{ type: "text", text: lines }] : [];
  }
  if (view.card === "diff") {
    const text = (Array.isArray(view.diffs) ? view.diffs : []).map((diff) => [
      `--- ${diff.path}`,
      `+++ ${diff.path}`,
      ...(typeof diff.oldText === "string" ? diff.oldText.split("\n").map((line) => `- ${line}`) : []),
      ...String(diff.newText ?? "").split("\n").map((line) => `+ ${line}`),
    ].join("\n")).join("\n\n");
    return text ? [{ type: "text", text }] : [];
  }
  if (view.card === "search") {
    const text = view.shape === "paths"
      ? (Array.isArray(view.paths) ? view.paths.join("\n") : "")
      : (Array.isArray(view.files) ? view.files.flatMap((file) =>
          (Array.isArray(file.matches) ? file.matches : []).map((match) =>
            `${file.path}:${match.lineNumber}: ${match.line}`)).join("\n") : "");
    return text ? [{ type: "text", text }] : [];
  }
  if (view.card === "web") {
    if (view.kind === "fetch") {
      return [{ type: "text", text: `${view.statusCode ?? ""} ${view.url ?? ""}`.trim() }];
    }
    const sources = Array.isArray(view.sources) ? view.sources : [];
    const text = [
      typeof view.answer === "string" ? view.answer : "",
      ...sources.map((source) => `${source.title || source.url}\n${source.url}${source.snippet ? `\n${source.snippet}` : ""}`),
    ].filter(Boolean).join("\n\n");
    return text ? [{ type: "text", text }] : [];
  }
  return [];
}

function isMediaBlock(block) {
  return block?.type === "image" || block?.type === "audio" || block?.type === "video";
}

function toolContentBlocks(node) {
  const preferred = toolViewBlocks(node?.resultView);
  const content = Array.isArray(node?.content) ? node.content : [];
  if (content.some(isMediaBlock)) return content;
  return preferred.length > 0 ? preferred : content;
}

function renderToolContent(node) {
  const rendered = toolContentBlocks(node).map((block) => {
    if (block?.type === "text") return renderToolText(block.text ?? "");
    if (isMediaBlock(block)) return mediaBlock(block, "tool");
    return `<p class="empty-content">Unsupported tool output: ${escapeHtml(safeType(block?.type))}</p>`;
  }).join("");
  if (rendered) return rendered;
  if (node.status === "running") return '<p class="tool-empty">Waiting for output</p>';
  return '<p class="tool-empty">No output</p>';
}

/** Inner HTML for a tool card body. Closed cards omit this from first paint. */
export function renderToolBody(node) {
  if (!node || node.kind !== "tool") return "";
  const title = node.resultView?.title ?? node.callView?.title ?? node.name ?? "unknown";
  return `${renderToolContent(node)}${renderToolDocument(node, title, node.seq ?? "")}`;
}

function safeDocumentId(value) {
  const id = String(value ?? "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "output";
}

function renderToolDocument(node, title, seq) {
  const blocks = toolContentBlocks(node);
  const text = blocks
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text ?? ""))
    .filter(Boolean)
    .join("\n\n");
  const media = blocks.filter(isMediaBlock);
  if (!text && media.length === 0) return "";
  const card = node?.resultView?.card ?? node?.callView?.card ?? "generic";
  const textKind = card === "terminal" ? "terminal" : card === "diff" ? "diff" : card === "read" ? "code" : "text";
  const kind = media.length > 0 ? (text ? "mixed" : "media") : textKind;
  const id = `tool-output-${safeDocumentId(node?.callId ?? seq)}`;
  return renderDocumentViewer({
    title,
    identity: "complete tool output",
    kind,
    language: node?.resultView?.language,
    text,
    blocks,
    textKind,
  }, { mode: "dialog", id, closeLabel: "Close" });
}

const CONTEXT_PREVIEW_CHARS = 140;
const SHORT_NOTICE_CHARS = 240;

function contextText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => String(block.text ?? ""))
    .join("\n")
    .replace(/\r\n?/g, "\n");
}

function contextForm(source) {
  switch (source?.form) {
    case "relay":
      return { key: "relay", label: "Relay" };
    case "notice":
      return { key: "notice", label: "Notice" };
    case "snapshot":
      return { key: "snapshot", label: "Context" };
    case "instructions":
      return { key: "instructions", label: "Instructions" };
    case "catalog":
      return { key: "catalog", label: "Catalog" };
    case "recall":
      return { key: "recall", label: "Recall" };
    default:
      return { key: "context", label: "Context" };
  }
}

function oneLinePreview(value) {
  const line = String(value ?? "")
    .split("\n")
    .find((candidate) => candidate.trim())
    ?.replace(/\s+/g, " ")
    .trim() ?? "";
  const characters = [...line];
  if (characters.length <= CONTEXT_PREVIEW_CHARS) return line;
  return `${characters.slice(0, CONTEXT_PREVIEW_CHARS - 1).join("").trimEnd()}…`;
}

// This is a model-facing plain-text contract, not HTML for the console. Only
// its mail-body is operator content; the surrounding instructions stay hidden.
function wrappedRelay(text) {
  const value = String(text ?? "").trim();
  const envelope = value.match(
    /^<agent-mail(?:\s([^>]*))?>\s*[\s\S]*?<mail-body>\s*([\s\S]*?)\s*<\/mail-body>[\s\S]*?<\/agent-mail>$/i,
  );
  if (!envelope) return null;
  const attributes = envelope[1] ?? "";
  const senderSessionId = attributes.match(/(?:^|\s)from=(?:"([^"]*)"|'([^']*)')/i);
  return {
    body: envelope[2].trim(),
    senderSessionId: String(senderSessionId?.[1] ?? senderSessionId?.[2] ?? "").trim(),
  };
}

function legacyRelay(text) {
  const value = String(text ?? "");
  const match = value.match(/^\s*From session\s+([^\n:]+)\s*:[ \t]*([^\n]*)(?:\n|$)/i);
  if (!match) return { body: value.trim(), senderSessionId: "" };
  const canonical = match[1].match(/session-[0-9a-f-]+/i)?.[0];
  const address = match[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  const inlineBody = match[2].trim();
  const remainingBody = value.slice(match[0].length).trim();
  return {
    body: [inlineBody, remainingBody].filter(Boolean).join("\n"),
    senderSessionId: canonical ?? address,
  };
}

function contextCard(node) {
  const source = node?.source && typeof node.source === "object" ? node.source : {};
  const form = contextForm(source);
  const modelText = contextText(node?.content);
  let body = modelText.trim();
  let senderSessionId = "";
  let preview = "";
  if (form.key === "relay") {
    const wrapped = wrappedRelay(modelText);
    if (wrapped) {
      body = wrapped.body;
      senderSessionId = String(source.senderSessionId ?? "").trim() || wrapped.senderSessionId;
    } else {
      const legacy = legacyRelay(modelText);
      body = legacy.body;
      senderSessionId = String(source.senderSessionId ?? "").trim() || legacy.senderSessionId;
    }
    preview = oneLinePreview(body);
  } else if (form.key === "notice") {
    preview = oneLinePreview(source.summary);
  }
  const open = form.key === "relay" || (form.key === "notice" && body.length <= SHORT_NOTICE_CHARS);
  return { form, body, senderSessionId, preview, open };
}

function renderContextCard(node, seq) {
  const card = contextCard(node);
  const sender = card.senderSessionId
    ? `<p class="context-sender">From <span>${escapeHtml(card.senderSessionId)}</span></p>`
    : "";
  const preview = card.preview
    ? `<span class="context-preview">${escapeHtml(card.preview)}</span>`
    : "";
  const body = card.body ? renderMessageText(card.body) : '<p class="empty-content">No message content</p>';
  return `<details class="message message-context context-${card.form.key}" data-seq="${seq}"${card.open ? " open" : ""}>
      <summary><strong>${escapeHtml(card.form.label)}</strong>${preview}${timeElement(node.time)}</summary>
      <div class="message-body context-body">${sender}${body}</div>
    </details>`;
}

function renderConversationNode(node) {
  const seq = escapeHtml(node?.seq ?? "");
  const time = eventTime(node?.time);
  if (node?.kind === "user" || node?.kind === "steering") {
    const steering = node.kind === "steering";
    const label = steering ? "Steering message" : "Your message";
    const accessibleLabel = time ? `${label} at ${time}` : label;
    return `<article class="message message-user${steering ? " message-steering" : ""}" data-seq="${seq}" aria-label="${escapeHtml(accessibleLabel)}">
      ${contentBlocks(node.content)}
    </article>`;
  }
  if (node?.kind === "context") {
    return renderContextCard(node, seq);
  }
  if (node?.kind === "assistant") {
    const streaming = node.status === "streaming";
    const interrupted = node.status === "interrupted";
    const accessibleLabel = time ? `Assistant message at ${time}` : "Assistant message";
    const reasoningLabel = time ? `Reasoning at ${time}` : "Reasoning";
    const parts = [];
    let answer = [];
    const flushAnswer = () => {
      if (answer.length === 0) return;
      parts.push(`<article class="message message-assistant${streaming ? " message-streaming" : ""}${interrupted ? " message-interrupted" : ""}" data-seq="${seq}" data-turn="${escapeHtml(node.turn ?? "")}" data-step="${escapeHtml(node.step ?? "")}" aria-label="${escapeHtml(accessibleLabel)}"${streaming ? ' aria-busy="true"' : ""}>
        ${answer.join("")}
      </article>`);
      answer = [];
    };
    for (const block of Array.isArray(node.blocks) ? node.blocks : []) {
      if (block?.type === "reasoning" && String(block.text ?? "").trim()) {
        flushAnswer();
        parts.push(`<section class="assistant-reasoning" aria-label="${escapeHtml(reasoningLabel)}" data-seq="${seq}" data-turn="${escapeHtml(node.turn ?? "")}" data-step="${escapeHtml(node.step ?? "")}"${streaming ? ' aria-busy="true"' : ""}>
          ${renderMarkdownText(block.text)}
        </section>`);
      } else if (block?.type === "text") {
        answer.push(renderMarkdownText(block.text ?? ""));
      } else if (block?.type === "image") {
        answer.push(attachmentBlock(block));
      }
    }
    flushAnswer();
    return parts.join("\n");
  }
  if (node?.kind === "tool") {
    const card = node.resultView?.card ?? node.callView?.card ?? "generic";
    const title = node.resultView?.title ?? node.callView?.title ?? node.name ?? "unknown";
    const liveArg = typeof node.liveKey === "string" && node.liveKey;
    const argumentText = liveArg ? String(node.arguments ?? "") : (node.argumentSummary ?? "");
    const argument = liveArg || (argumentText
      && !String(title).toLocaleLowerCase().includes(String(argumentText).toLocaleLowerCase()))
      ? `<span class="tool-argument${liveArg ? " message-live-text" : ""}"${liveArg ? ` data-live-key="${escapeHtml(liveArg)}"` : ""}>${escapeHtml(argumentText)}</span>`
      : "";
    const terminal = node.resultView?.card === "terminal" ? node.resultView : null;
    const terminalFailed = Number.isFinite(terminal?.exitCode) && terminal.exitCode !== 0;
    const failed = node.status === "error" || terminalFailed || Boolean(terminal?.signal);
    const stopped = node.status === "stopped";
    const status = node.status === "error" && !terminalFailed
      ? "Failed"
      : Number.isFinite(terminal?.exitCode)
        ? `${terminalFailed ? "Failed" : "Done"} · ${terminal.exitCode}`
        : terminal?.signal
          ? `Stopped · ${terminal.signal}`
          : node.status === "success"
            ? "Done"
            : node.status === "running"
              ? "Running"
              : stopped
                ? "Stopped"
                : "Failed";
    const tone = failed || stopped ? "bad" : node.status === "running" ? "running" : "ok";
    const callId = String(node.callId ?? "");
    const interactive = node.status !== "running";
    const deferred = interactive && !node.expanded && callId.length > 0;
    const href = deferred ? `tool/${encodeURIComponent(callId)}` : "";
    const interactionAttrs = interactive
      ? ` data-tool-output data-tool-body-state="${deferred ? "idle" : "loaded"}"${href ? ` data-tool-href="${escapeHtml(href)}"` : ""}`
      : "";
    const body = deferred ? "" : renderToolBody(node);
    return `<details class="message message-tool tool-${escapeHtml(node.status)} tool-tone-${tone}" data-seq="${seq}" data-call-id="${escapeHtml(callId)}" data-card="${escapeHtml(card)}"${node.expanded ? " open" : ""}${interactionAttrs}>
      <summary${interactive ? ' data-tool-output-summary' : ""}><strong>${escapeHtml(title)}</strong><span class="tool-status tool-status-${tone}">${escapeHtml(status)}</span>${argument}</summary>
      <div class="message-body tool-body">${body}</div>
    </details>`;
  }
  if (node?.kind === "command") {
    const name = `/${node.name || "command"}`;
    const text = typeof node.outcome?.text === "string" ? node.outcome.text : "";
    const status = node.status === "running" ? "Running" : node.status === "error" ? (text || "Failed") : (text || "Completed");
    const error = node.status === "error" ? " command-error" : "";
    if (status.includes("\n")) {
      const first = status.split("\n").find((line) => line.trim()) ?? (node.status === "error" ? "Failed" : "Completed");
      return `<details class="message message-command${error}" data-seq="${seq}">
        <summary><strong>${escapeHtml(name)}</strong><span>${escapeHtml(first)}</span></summary>
        <div class="message-body">${renderMessageText(status)}</div>
      </details>`;
    }
    return `<p class="message message-command${error}" data-seq="${seq}"><strong>${escapeHtml(name)}</strong><span>· ${escapeHtml(status)}</span></p>`;
  }
  if (node?.kind === "retry") {
    const current = node.current ?? {};
    const maximum = current.mode === "always" ? "∞" : (current.maxRetries ?? "?");
    const state = current.state === "cancelled" ? "cancelled" : current.state === "started" ? "started" : "scheduled";
    return `<details class="message message-retry" data-seq="${seq}">
      <summary><strong>Model retry ${escapeHtml(current.retry ?? "?")}/${escapeHtml(maximum)}</strong><span>${escapeHtml(state)} · ${escapeHtml(current.delayMs ?? 0)} ms</span></summary>
      <div class="message-body"><p>${current.code ? `Request failed (${escapeHtml(current.code)}). ` : "Request failed. "}The provider route will be tried again.</p></div>
    </details>`;
  }
  if (node?.kind === "compaction") {
    const count = Number.isSafeInteger(node.shadowedItemCount) ? `${node.shadowedItemCount} items` : "conversation history";
    const tokens = Number.isSafeInteger(node.shadowedTokenCount) ? ` · ~${node.shadowedTokenCount} tokens` : "";
    const state = node.status === "running" ? "Running" : node.status === "error" ? "Failed" : "Completed";
    return `<details class="message message-compaction${node.status === "error" ? " compaction-error" : ""}" data-seq="${seq}">
      <summary><strong>${escapeHtml(node.title || "Context compacted")}</strong><span>${state} · ${escapeHtml(count)}${escapeHtml(tokens)}</span></summary>
      ${node.summary ? `<div class="message-body">${renderMessageText(node.summary)}</div>` : ""}
    </details>`;
  }
  if (node?.kind === "turn-error") {
    return `<article class="message message-turn-error" data-seq="${seq}" role="alert"><strong>Turn failed</strong><p>${escapeHtml(safeTurnFailure(node.code))}</p>${node.code ? `<code>${escapeHtml(node.code)}</code>` : ""}</article>`;
  }
  if (node?.kind === "turn-status") {
    const labels = {
      aborted: "Turn interrupted",
      interrupted: "Turn recovered after interruption",
      blocked: "Turn blocked",
      "max-tokens": "Turn reached its token limit",
    };
    return `<p class="message message-turn-status" data-seq="${seq}">${escapeHtml(labels[node.status] ?? "Turn stopped")}</p>`;
  }
  if (node?.kind === "fallback") {
    return `<details class="message message-fallback" data-seq="${seq}"><summary><strong>${escapeHtml(node.eventType || "Unknown event")}</strong></summary>${node.summary ? `<div class="message-body">${renderMessageText(node.summary)}</div>` : ""}</details>`;
  }
  return "";
}

function queueTextRows(text) {
  return Math.min(12, Math.max(1, String(text ?? "").split("\n").length));
}

function renderPendingQueue(snapshot, paths) {
  const pending = Array.isArray(snapshot?.conversation?.pending) ? snapshot.conversation.pending : [];
  if (pending.length === 0) return "";
  const action = escapeHtml(paths.queue ?? "");
  const mutable = !isChildSession(snapshot) && snapshot.canMutatePending === true && Boolean(paths.queue);
  const rows = pending.map((item, index) => {
    const id = escapeHtml(item.id ?? "");
    const steering = item.placement === "steering";
    const n = index + 1;
    const text = item.text ?? "";
    const edit = mutable && item.editable
      ? `<form class="queue-edit" action="${action}" method="post" hx-post="${action}" hx-trigger="change" ${hxMutateAttrs()} hx-disabled-elt="find button">
          <input type="hidden" name="operation" value="edit">
          <input type="hidden" name="itemId" value="${id}">
          <label for="queue-text-${index}">Edit pending message ${n}</label>
          <textarea id="queue-text-${index}" class="queue-edit-text" name="text" rows="${queueTextRows(text)}" maxlength="32768" required data-message-id="${id}">${escapeHtml(text)}</textarea>
        </form>`
      : `<p class="queue-preview">${escapeHtml(text || "Queued message")}</p>`;
    const remove = mutable
      ? `<form class="queue-remove" action="${action}" method="post" hx-post="${action}" ${hxMutateAttrs()} hx-disabled-elt="find button">
          <input type="hidden" name="itemId" value="${id}">
          <button type="submit" name="operation" value="remove" aria-label="Remove pending message ${n}" title="Remove">&times;</button>
        </form>`
      : "";
    return `<li class="queue-item message-queued" data-message-id="${id}" data-placement="${steering ? "steering" : "queued"}" aria-label="${steering ? "Steering message" : "Queued message"}"><span class="queue-mark" aria-hidden="true">◦</span>${edit}${remove}</li>`;
  }).join("");
  return `<section id="pending-queue" class="pending-queue" aria-label="Queued messages">
    <ol>${rows}</ol>
  </section>`;
}

function safeTurnFailure(code) {
  switch (code) {
    case "INVALID_REQUEST":
      return "The selected model route rejected this request. Check the message or route compatibility, then try again.";
    case "INVALID_CREDENTIAL":
    case "MISSING_CREDENTIAL":
    case "AUTH":
      return "The selected model route could not authenticate. Check the qq credential, then try again.";
    case "QUOTA_EXCEEDED":
    case "RATE_LIMIT":
      return "The selected model route is temporarily rate-limited or out of quota. Wait, then try again.";
    case "CONTEXT_WINDOW_EXCEEDED":
      return "This session is too large for the selected model route. Compact the session before trying again.";
    default:
      return "DSH could not complete the last turn. You can revise the message and try again; host logs retain the diagnostic.";
  }
}

export function deriveStatus(events, agentStatus, turnStatus) {
  let openTurn;
  let lastEnd;
  if (turnStatus && typeof turnStatus === "object") {
    openTurn = turnStatus.openTurn;
    lastEnd = turnStatus.lastEnd;
  } else {
    for (const event of events) {
      if (event?.type === "turn/start") openTurn = event.data?.turn;
      if (event?.type === "turn/end") {
        if (openTurn === event.data?.turn) openTurn = undefined;
        lastEnd = event.data?.reason;
      }
    }
  }
  if (agentStatus === "running" || (agentStatus === undefined && openTurn !== undefined)) {
    return {
      key: "running",
      label: openTurn === undefined ? "Running" : `Running turn ${openTurn}`,
    };
  }
  switch (lastEnd?.kind) {
    case "completed":
      return { key: "ready", label: "Ready" };
    case "error": {
      const code = typeof lastEnd.error?.code === "string" ? lastEnd.error.code : "";
      return {
        key: "error",
        label: "Last turn failed",
        detail: safeTurnFailure(code),
        ...(code ? { code } : {}),
      };
    }
    case "aborted":
      return { key: "stopped", label: "Last turn interrupted" };
    case "interrupted":
      return { key: "stopped", label: "Last turn recovered after interruption" };
    case "blocked":
      return { key: "stopped", label: "Last turn blocked" };
    case "max-tokens":
      return { key: "stopped", label: "Last turn reached its token limit" };
    default:
      return { key: "ready", label: "Ready · no turns yet" };
  }
}

function sessionFace(session) {
  if (typeof session?.alias === "string" && session.alias.length > 0) {
    return session.alias;
  }
  if (Number.isFinite(session?.createdAt) && session.createdAt > 0) {
    const date = eventTime(session.createdAt).slice(0, 10);
    if (date) return date;
  }
  return "durable";
}

function liveFace(snapshot) {
  if (typeof snapshot?.alias === "string" && snapshot.alias.length > 0) {
    return snapshot.alias;
  }
  const current = Array.isArray(snapshot.sessions)
    ? snapshot.sessions.find((session) => session.id === snapshot.id)
    : undefined;
  return sessionFace({
    alias: current?.alias,
    createdAt: current?.createdAt,
  });
}

function sessionToken(session) {
  const alias = typeof session?.alias === "string" ? session.alias.trim() : "";
  return alias || sessionFace(session);
}

function isChildSession(snapshot) {
  return snapshot?.origin === "subagent" && typeof snapshot?.parent === "string" && snapshot.parent.length > 0;
}

function sessionSwitchHref(paths, sessionId) {
  const target = String(sessionId ?? "");
  return target && paths?.switchSession
    ? `${paths.switchSession}?session=${encodeURIComponent(target)}`
    : "";
}

function projectSessionGroups(snapshot, paths) {
  const groups = new Map();
  const add = (entry, project, folder) => {
    if (entry?.scope === "projects") return;
    const name = String(project ?? "").trim();
    const id = String(entry?.id ?? "").trim();
    if (!name || !id || entry?.origin === "subagent") return;
    const key = `${name}\n${String(folder ?? "").trim()}`;
    if (!groups.has(key)) groups.set(key, []);
    const list = groups.get(key);
    if (list.some((session) => session.id === id)) return;
    list.push(entry);
  };
  for (const entry of Array.isArray(snapshot?.activeProjects) ? snapshot.activeProjects : []) {
    add(entry, entry.project ?? entry.name, entry.folder);
  }
  for (const entry of Array.isArray(snapshot?.sessions) ? snapshot.sessions : []) {
    add(entry, snapshot.project, snapshot.folder);
  }
  if (snapshot?.id && !isChildSession(snapshot)) add(snapshot, snapshot.project, snapshot.folder);
  const encoded = new Map();
  for (const [key, rows] of groups) {
    encoded.set(key, menuSessions(rows).map((session) => ({
      id: session.id,
      token: sessionToken(session),
      href: sessionSwitchHref(paths, session.id),
    })));
  }
  return encoded;
}

function projectSessionsAttr(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return "";
  return ` data-sessions="${escapeHtml(JSON.stringify(sessions))}"`;
}

function bannerMark(kind) {
  if (kind === "add") {
    return `<svg class="banner-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
  }
  return `<svg class="banner-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

function pickerSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter((session) => (
    session?.origin !== "subagent" && session?.scope !== "projects"
  ));
}

function menuSessions(sessions) {
  return pickerSessions(sessions).slice().sort((left, right) => {
    const leftToken = sessionToken(left);
    const rightToken = sessionToken(right);
    const leftNumber = /^\d+$/.test(leftToken) ? Number(leftToken) : NaN;
    const rightNumber = /^\d+$/.test(rightToken) ? Number(rightToken) : NaN;
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber || leftToken.localeCompare(rightToken);
    }
    if (Number.isFinite(leftNumber)) return -1;
    if (Number.isFinite(rightNumber)) return 1;
    return leftToken.localeCompare(rightToken) || String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

function newSessionForm(action, extraClass = "") {
  if (!action) return "";
  const className = extraClass ? `new-session ${extraClass}` : "new-session";
  return `<form class="${className}" action="${escapeHtml(action)}" method="post">
      <button type="submit" aria-label="New session">${bannerMark("add")}</button>
    </form>`;
}

function selectedLiveTrackerSession(snapshot) {
  const selectedId = String(snapshot?.id ?? "");
  if (!selectedId || snapshot?.dashboard?.schema !== "qq.dashboard/v1") return null;
  for (const project of Array.isArray(snapshot.dashboard.projects) ? snapshot.dashboard.projects : []) {
    const selected = (Array.isArray(project?.sessions) ? project.sessions : [])
      .find((row) => row?.sessionId === selectedId);
    if (selected) return selected;
  }
  return null;
}

function trackerSessionFace(row) {
  return row?.alias || row?.label || "session";
}

function trackerActiveStartedAt(row) {
  return row?.activity === "working"
    && Number.isFinite(row?.phaseStartedAt)
    && Number.isInteger(row.phaseStartedAt)
    && row.phaseStartedAt >= 0
    ? row.phaseStartedAt
    : null;
}

function trackerChildPhase(row) {
  const phase = typeof row?.phase === "string" ? row.phase.trim() : "";
  if (phase && phase !== "none" && phase !== "unknown" && phase !== "work") return phase;
  return typeof row?.workflow === "string" ? row.workflow.trim() : "";
}

function renderLiveTrackerRow(row, paths, selectedId) {
  const current = row.sessionId === selectedId;
  const face = trackerSessionFace(row);
  const child = row.depth === 1;
  const childPhase = child && row.activity === "working" ? trackerChildPhase(row) : "";
  const secondary = row.alias && row.label !== row.alias && row.label !== childPhase ? row.label : "";
  const depthClass = ` live-tracker-depth-${Math.min(row.depth, 8)}`;
  const childClass = child ? " live-tracker-child-strip" : "";
  const state = childPhase && childPhase !== face
    ? `<span class="live-tracker-phase" data-phase="${escapeHtml(childPhase)}">${escapeHtml(childPhase)}</span>`
    : childPhase ? "" : `<span class="live-tracker-activity" data-activity="${escapeHtml(row.activity)}">${escapeHtml(row.activity)}</span>`;
  const startedAt = trackerActiveStartedAt(row);
  const elapsed = startedAt === null
    ? ""
    : `<time class="live-tracker-elapsed" data-phase-started-at="${startedAt}"${state ? "" : ' data-solo="true"'} hidden></time>`;
  return `<li class="live-tracker-row${depthClass}${childClass}"><a class="live-tracker-session${current ? " live-tracker-session-current" : ""}" href="${escapeHtml(sessionSwitchHref(paths, row.sessionId))}" data-session-id="${escapeHtml(row.sessionId)}" data-depth="${row.depth}"${current ? ' aria-current="page"' : ""}>
      <span class="live-tracker-identity"><span class="live-tracker-face">${escapeHtml(face)}</span>${secondary ? `<span class="live-tracker-label">${escapeHtml(secondary)}</span>` : ""}</span>
      <span class="live-tracker-state">${state}${elapsed}</span>
    </a></li>`;
}

function renderLiveTracker(snapshot, paths, create) {
  const dashboard = snapshot?.dashboard;
  const valid = dashboard?.schema === "qq.dashboard/v1" && Array.isArray(dashboard.projects) && paths?.switchSession;
  if (!valid) {
    return `<nav id="live-session-list" class="session-traversal live-tracker live-tracker-unavailable" aria-label="Live session tracker" aria-keyshortcuts="ArrowLeft ArrowRight"><span class="live-tracker-message">live tracking unavailable</span>${create}</nav>`;
  }
  if (dashboard.projects.length === 0) {
    return `<nav id="live-session-list" class="session-traversal live-tracker live-tracker-empty" aria-label="Live session tracker" aria-keyshortcuts="ArrowLeft ArrowRight"><span class="live-tracker-message">no live sessions</span>${create}</nav>`;
  }
  const selectedId = String(snapshot?.id ?? "");
  const selectedProject = dashboard.projects.find((project) => (
    project.sessions.some((row) => row.sessionId === selectedId)
  )) ?? dashboard.projects.find((project) => (
    project.name === snapshot?.project && String(project.folder ?? "") === String(snapshot?.folder ?? "")
  )) ?? dashboard.projects[0];
  const selectedKey = `${selectedProject.name}\n${String(selectedProject.folder ?? "")}`;
  const groups = dashboard.projects.map((project, index) => {
    const folder = project.folder && project.folderLabel
      ? `<span class="live-tracker-folder">${escapeHtml(project.folderLabel)}</span>`
      : "";
    const rows = project.sessions.length > 0
      ? project.sessions.map((row) => renderLiveTrackerRow(row, paths, selectedId)).join("")
      : '<li class="live-tracker-project-empty">no live sessions</li>';
    const hierarchyClass = project.sessions.some((row) => row.depth === 1)
      ? " live-tracker-sessions-hierarchical"
      : "";
    const current = `${project.name}\n${String(project.folder ?? "")}` === selectedKey;
    return `<section class="live-tracker-project" data-project="${escapeHtml(project.name)}" data-folder="${escapeHtml(project.folder ?? "")}" data-project-label="${escapeHtml(project.label)}" data-current="${current ? "true" : "false"}" aria-labelledby="live-tracker-project-${index}"${current ? "" : " hidden"}><h2 id="live-tracker-project-${index}" class="live-tracker-project-name">${escapeHtml(project.label)}${folder}</h2><ol class="live-tracker-sessions${hierarchyClass}">${rows}</ol></section>`;
  }).join("");
  return `<nav id="live-session-list" class="session-traversal live-tracker" aria-label="${escapeHtml(selectedProject.label)} sessions" aria-keyshortcuts="ArrowLeft ArrowRight" data-filter-project="${escapeHtml(selectedProject.name)}" data-filter-folder="${escapeHtml(selectedProject.folder ?? "")}">${groups}<span class="live-tracker-filter-empty" hidden>no live sessions</span>${create}</nav>`;
}

function sessionNavigation(snapshot, paths) {
  const child = isChildSession(snapshot);
  const projects = snapshot?.scope === "projects";
  const tracked = selectedLiveTrackerSession(snapshot);
  const token = tracked ? trackerSessionFace(tracked) : "";
  const create = child || projects || !paths.createSession
    ? ""
    : newSessionForm(paths.createSession);
  const tokens = renderLiveTracker(snapshot, paths, create);
  const close = child || !paths.close
    ? ""
    : `<form id="close-session" class="close-session session-background-actions" action="${escapeHtml(paths.close)}" method="post" hidden>
        <button type="submit" aria-label="Close this session">close</button>
      </form>`;
  return { token, tokens, create, close };
}

export function renderLoginSheet(sheet, paths) {
  const connectors = Array.isArray(sheet?.connectors) ? sheet.connectors : [];
  if (connectors.length === 0) return "";
  const action = sheet.action === "logout" ? "logout" : "login";
  const heading = action === "logout" ? "Drop a connector" : "Connect a model";
  const eyebrow = action === "logout" ? "Logout" : "Login";
  const promptAction = escapeHtml(paths.prompt ?? "");
  const buttons = connectors.map((connector) => {
    const id = escapeHtml(connector.id ?? "");
    const label = escapeHtml(connector.label ?? connector.id ?? "");
    const host = connector.hostOwned ? " host-owned" : "";
    const value = escapeHtml(`/${action} ${connector.id ?? ""}`);
    return `<button class="offer-choice login-choice" type="submit" name="prompt" value="${value}" data-connector="${id}">${label}${host ? ` <span>${escapeHtml(host.trim())}</span>` : ""}</button>`;
  }).join("");
  return `<aside class="offer-popup login-popup" role="dialog" aria-modal="true" aria-labelledby="login-heading" data-login-action="${escapeHtml(action)}">
    <div class="offer-sheet">
      <header class="offer-head">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2 id="login-heading">${escapeHtml(heading)}</h2>
      </header>
      <form class="offer-actions login-actions" action="${promptAction}" method="post"
        hx-post="${promptAction}"
        ${hxMutateAttrs()}
        hx-disabled-elt=".login-choice">
        ${buttons}
      </form>
    </div>
  </aside>`;
}

export function renderApprovalPopup(approval, paths, notice = "") {
  if (!approval || typeof approval.id !== "string" || !approval.id) return "";
  const tool = typeof approval.toolName === "string" && approval.toolName.trim()
    ? approval.toolName.trim()
    : "tool";
  const reason = typeof approval.reason === "string" && approval.reason.trim()
    ? `<p>${escapeHtml(approval.reason.trim())}</p>`
    : "";
  const action = escapeHtml(paths.approval ?? "");
  const refusal = notice ? `<p class="notice" role="alert">${escapeHtml(notice)}</p>` : "";
  return `<aside class="offer-popup approval-popup" role="dialog" aria-modal="true" aria-labelledby="approval-heading" data-approval-id="${escapeHtml(approval.id)}">
    <div class="offer-sheet">
      <header class="offer-head">
        <p class="eyebrow">Approval needed</p>
        <h2 id="approval-heading">${escapeHtml(tool)}</h2>
      </header>
      <div class="offer-brief" tabindex="0">
        <p>This action needs your approval. The grant applies only to this request.</p>
        ${reason}
      </div>
      ${refusal}
      <form class="offer-actions" action="${action}" method="post"
        hx-post="${action}"
        ${hxMutateAttrs()}
        hx-disabled-elt=".offer-choice">
        <input type="hidden" name="approvalId" value="${escapeHtml(approval.id)}">
        <button class="offer-choice offer-handoff" type="submit" name="outcome" value="allowed-once">Allow once</button>
        <button class="offer-choice offer-ignore" type="submit" name="outcome" value="rejected">Reject</button>
      </form>
    </div>
  </aside>`;
}

export function renderOfferPopup(offer, paths, notice = "") {
  if (!offer || typeof offer.brief !== "string" || offer.brief.trim().length === 0) return "";
  const runner = typeof offer.runnerBrief === "string" && offer.runnerBrief.trim()
    ? `<section class="offer-runner" aria-label="Runner-only brief">
        <h3>For the runner</h3>
        ${renderMessageText(offer.runnerBrief)}
      </section>`
    : "";
  const action = escapeHtml(paths.offer ?? "");
  const refusal = notice ? `<p class="notice" role="alert">${escapeHtml(notice)}</p>` : "";
  return `<aside class="offer-popup" role="dialog" aria-modal="true" aria-labelledby="offer-heading" data-offer-id="${escapeHtml(offer.id ?? "")}">
    <div class="offer-sheet">
      <header class="offer-head">
        <p class="eyebrow">New conversation</p>
        <h2 id="offer-heading">${escapeHtml(offer.title || "Start this, abandon previous, or bank this for later")}</h2>
      </header>
      <div class="offer-brief" tabindex="0">
        ${renderMessageText(offer.brief)}
        ${runner}
      </div>
      ${refusal}
      <form class="offer-actions" action="${action}" method="post"
        hx-post="${action}"
        ${hxMutateAttrs()}
        hx-disabled-elt=".offer-choice">
        <button class="offer-choice offer-handoff" type="submit" name="choice" value="start">Start this now</button>
        <button class="offer-choice offer-ignore" type="submit" name="choice" value="abandon">Abandon previous</button>
        <button class="offer-choice offer-bank" type="submit" name="choice" value="later">Bank this for later</button>
      </form>
    </div>
  </aside>`;
}

function renderSlashNotice(notice, paths, nodes = []) {
  const text = String(notice ?? "").trim();
  if (!text) return "";
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const names = [];
  let selected = "";
  let unbound = "";
  let isList = lines.length >= 2;
  for (const line of lines) {
    if (line === "none selected") continue;
    const match = /^([a-z][a-z0-9-]*)(?: \((selected|selected, unbound)\))?$/.exec(line);
    if (!match) {
      isList = false;
      break;
    }
    if (match[2] === "selected, unbound") unbound = match[1];
    else names.push(match[1]);
    if (match[2] === "selected") selected = match[1];
  }
  if (!isList || (names.length === 0 && !unbound)) {
    const receipt = Array.isArray(nodes)
      ? nodes.findLast((node) => node?.kind === "command" && String(node.outcome?.text ?? "").trim() === text)
      : undefined;
    if (receipt) return "";
    const kind = / selected$/.test(text) || text === "none selected" ? "notice-ok" : "notice";
    return `<p class="${kind}" role="status">${escapeHtml(text)}</p>`;
  }
  const action = escapeHtml(paths.prompt ?? "");
  const buttons = [
    ...names.map((name) => {
      const current = name === selected ? " workflows-current" : "";
      return `<button class="offer-choice workflows-choice${current}" type="submit" name="prompt" value="/workflows ${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }),
    ...(unbound
      ? [`<p class="workflows-unbound" role="status">${escapeHtml(`${unbound} (selected, unbound)`)}</p>`]
      : []),
    `<button class="offer-choice workflows-choice workflows-none" type="submit" name="prompt" value="/workflows none">none</button>`,
  ].join("");
  return `<aside class="offer-popup workflows-popup" role="dialog" aria-modal="true" aria-labelledby="workflows-heading">
    <div class="offer-sheet">
      <header class="offer-head">
        <p class="eyebrow">Workflows</p>
        <h2 id="workflows-heading">Pick a workflow</h2>
      </header>
      <form class="offer-actions workflows-actions" action="${action}" method="post"
        hx-post="${action}"
        ${hxMutateAttrs()}
        hx-disabled-elt=".workflows-choice">
        ${buttons}
        <button class="offer-choice workflows-choice workflows-dismiss" type="button">Cancel</button>
      </form>
    </div>
  </aside>`;
}

function overlayKeysAttr(keys) {
  if (!keys || typeof keys !== "object") return "";
  const reserved = new Set(["h", "H", "q", "Q", "x", "X", "Escape"]);
  const allowed = {};
  for (const [key, action] of Object.entries(keys)) {
    if (reserved.has(key)) continue;
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
    const id = String(action ?? "");
    if (!/^[a-z][a-z0-9-]*$/.test(id)) continue;
    allowed[key] = id;
  }
  if (Object.keys(allowed).length === 0) return "";
  return ` data-overlay-keys="${escapeHtml(JSON.stringify(allowed))}"`;
}

function workflowName(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(value) ? value : "";
}

function workflowLabel(name) {
  return `${name[0].toUpperCase()}${name.slice(1)}`;
}

function sessionModeChip(mode) {
  const name = workflowName(mode);
  if (!name || name === "none") return "";
  return `<span class="session-mode" data-mode="${name}">${escapeHtml(workflowLabel(name))}</span>`;
}

function placeName(snapshot) {
  if (snapshot?.scope === "home") return "home";
  if (snapshot?.scope === "projects") return "projects";
  return snapshot?.folderLabel || snapshot?.projectLabel || snapshot?.project || "";
}

function renderHomeLink(snapshot, paths) {
  if (!paths?.home || snapshot?.scope === "home") return "";
  return `<a class="session-home" href="${escapeHtml(paths.home)}" aria-label="Home">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d="m4.5 11.5 7.5-6.3 7.5 6.3M7.5 10.4v7.9h9v-7.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </a>`;
}

function projectsSessionId(snapshot) {
  const listed = (Array.isArray(snapshot?.sessions) ? snapshot.sessions : []).find((session) => (
    session?.scope === "projects" && session?.origin !== "subagent" && session?.id
  ));
  if (listed?.id) return String(listed.id);
  if (snapshot?.scope === "projects" && snapshot?.origin !== "subagent" && snapshot?.id) {
    return String(snapshot.id);
  }
  return "";
}

function projectsSessionLink(snapshot, paths, kind) {
  if (!paths?.projectsSession) return "";
  const current = snapshot?.scope === "projects";
  const sessionId = projectsSessionId(snapshot);
  const sessionAttr = sessionId ? ` data-session-id="${escapeHtml(sessionId)}"` : "";
  const currentAttr = current ? ' aria-current="page"' : "";
  if (kind === "menu") {
    return `<a class="projects-choice projects-session-choice${current ? " projects-choice-current" : ""}" href="${escapeHtml(paths.projectsSession)}" data-scope="projects"${sessionAttr}${currentAttr}>projects</a>`;
  }
  return `<a class="active-project-item projects-session-item${current ? " active-project-current" : ""}" href="${escapeHtml(paths.projectsSession)}" data-scope="projects"${sessionAttr}${currentAttr} title="projects"><span class="active-project-mark" aria-hidden="true"></span><span class="active-project-label">projects</span></a>`;
}

function activeProjectList(snapshot) {
  const projects = [];
  const seen = new Map();
  const add = (entry) => {
    if (entry?.scope === "projects") return;
    const project = String(entry?.project ?? entry?.name ?? "").trim();
    if (!project) return;
    const folder = String(entry?.folder ?? "").trim();
    const key = `${project}\n${folder}`;
    const projectLabel = String(entry?.projectLabel ?? entry?.label ?? project);
    const folderLabel = String(entry?.folderLabel ?? folder);
    const sessionId = String(entry?.id ?? "").trim();
    const recency = Number(entry?.latestEventAt ?? entry?.createdAt ?? 0);
    if (seen.has(key)) {
      const existing = projects[seen.get(key)];
      if (sessionId && recency >= (existing.recency ?? 0)) {
        existing.sessionId = sessionId;
        existing.recency = recency;
      }
      return;
    }
    seen.set(key, projects.length);
    projects.push({
      project,
      folder,
      projectLabel,
      folderLabel,
      label: folder ? folderLabel : projectLabel,
      sessionId,
      recency,
    });
  };
  for (const entry of Array.isArray(snapshot?.activeProjects) ? snapshot.activeProjects : []) add(entry);
  for (const entry of Array.isArray(snapshot?.sessions) ? snapshot.sessions : []) add(entry);
  if (snapshot?.id && snapshot?.scope !== "projects" && !isChildSession(snapshot)) add(snapshot);
  return projects;
}

function livePlaceKey(entry) {
  const project = String(entry?.project ?? "").trim();
  if (!project) return "";
  return `${project}\n${String(entry?.folder ?? "").trim()}`;
}

function livePlaceSet(snapshot) {
  const keys = new Set();
  const add = (entry) => {
    if (entry?.scope === "projects") return;
    const key = livePlaceKey(entry);
    if (key) keys.add(key);
  };
  if (snapshot?.scope !== "projects" && !isChildSession(snapshot)) add(snapshot);
  for (const entry of Array.isArray(snapshot?.activeProjects) ? snapshot.activeProjects : []) add(entry);
  for (const entry of Array.isArray(snapshot?.sessions) ? snapshot.sessions : []) add(entry);
  return keys;
}

function activeProjectHref(entry, paths, current) {
  if (current && paths.canonical) return paths.canonical;
  const folderPath = entry.folder ? `/${encodeURIComponent(entry.folder)}` : "";
  return `${paths.projectsBase}/${encodeURIComponent(entry.project)}${folderPath}`;
}

function renderProjectsMenu(snapshot, paths) {
  if (!paths?.projectsBase) return "";
  const projects = activeProjectList(snapshot);
  const sessionGroups = projectSessionGroups(snapshot, paths);
  const currentProject = snapshot?.scope === "projects" ? "" : String(snapshot?.project ?? "");
  const currentFolder = snapshot?.scope === "projects" ? "" : String(snapshot?.folder ?? "");
  const current = projects.find((entry) => entry.project === currentProject && entry.folder === currentFolder);
  const summary = current?.label || placeName(snapshot) || "projects";
  const projectLinks = projects.length > 0
    ? projects.map((entry) => {
        const isCurrent = snapshot?.scope !== "projects" && entry.project === currentProject && entry.folder === currentFolder;
        const href = activeProjectHref(entry, paths, isCurrent);
        const sessions = sessionGroups.get(`${entry.project}\n${entry.folder}`) ?? [];
        const sessionId = entry.sessionId || sessions[0]?.id || "";
        const sessionAttr = sessionId ? ` data-session-id="${escapeHtml(sessionId)}"` : "";
        return `<a class="projects-choice${isCurrent ? " projects-choice-current" : ""}" href="${escapeHtml(href)}" data-project="${escapeHtml(entry.project)}" data-folder="${escapeHtml(entry.folder)}"${sessionAttr}${projectSessionsAttr(sessions)} aria-controls="live-session-list"${isCurrent ? ' aria-current="page"' : ""}>${escapeHtml(entry.label)}</a>`;
      }).join("")
    : `<p class="session-empty">no live projects</p>`;
  return `<details class="projects-menu">
    <summary aria-label="Projects">${escapeHtml(summary)}</summary>
    <div class="projects-menu-list">
      ${projectsSessionLink(snapshot, paths, "menu")}
      ${projectLinks}
    </div>
  </details>`;
}

export function renderProjectRail(snapshot, paths, inert = false) {
  if (!paths?.projectsBase) return "";
  const projects = activeProjectList(snapshot);
  const sessionGroups = projectSessionGroups(snapshot, paths);
  const currentProject = snapshot?.scope === "projects" ? "" : String(snapshot?.project ?? "");
  const currentFolder = snapshot?.scope === "projects" ? "" : String(snapshot?.folder ?? "");
  const rows = projects.map((entry) => {
    const current = snapshot?.scope !== "projects" && entry.project === currentProject && entry.folder === currentFolder;
    const href = activeProjectHref(entry, paths, current);
    const sessions = sessionGroups.get(`${entry.project}\n${entry.folder}`) ?? [];
    const sessionId = entry.sessionId || sessions[0]?.id || "";
    const sessionAttr = sessionId ? ` data-session-id="${escapeHtml(sessionId)}"` : "";
    return `<li><a class="active-project-item${current ? " active-project-current" : ""}" href="${escapeHtml(href)}" data-project="${escapeHtml(entry.project)}" data-folder="${escapeHtml(entry.folder)}" data-live="true"${sessionAttr}${projectSessionsAttr(sessions)} aria-controls="live-session-list"${current ? ' aria-current="page"' : ""} title="${escapeHtml(entry.label)}"><span class="active-project-mark" aria-hidden="true"></span><span class="active-project-label">${escapeHtml(entry.label)}</span></a></li>`;
  }).join("");
  const sessions = sessionNavigation(snapshot, paths);
  const rootUrl = `${paths.canonical}${paths.canonical.includes("?") ? "&" : "?"}drawer=~`;
  return `<aside id="project-rail" class="project-rail" aria-label="Projects" data-current-project="${escapeHtml(currentProject)}" data-current-folder="${escapeHtml(currentFolder)}" data-current-active="${snapshot?.id ? "true" : "false"}"${inert ? " inert" : ""}>
    <nav class="active-projects" aria-label="Active projects; press Enter or Space to show all project sessions" aria-keyshortcuts="ArrowUp ArrowDown Enter Space" tabindex="0">${projectsSessionLink(snapshot, paths, "rail")}<ol>${rows || '<li class="session-empty">no live projects</li>'}</ol></nav>
    ${sessions.close}
    <section id="inactive-project-tree" class="inactive-project-tree" aria-label="Files" aria-keyshortcuts="F" data-root-url="${escapeHtml(rootUrl)}" hidden>
      <div class="project-tree-columns" role="tree" aria-label="Project files"><span class="project-tree-loading" role="status">···</span></div>
    </section>
  </aside>
  <svg id="session-connectors" class="session-connectors" aria-hidden="true" focusable="false" hidden></svg>`;
}

function renderWorkflowMenu(snapshot, paths) {
  const names = (Array.isArray(snapshot?.workflows) ? snapshot.workflows : [])
    .map(workflowName)
    .filter((name) => name && name !== "none" && name !== "base");
  const selected = workflowName(snapshot?.sessionMode);
  if (names.length === 0 || !paths.prompt) return "";
  const action = escapeHtml(paths.prompt);
  const buttons = names.map((name) => {
    const current = name === selected ? " workflows-current" : "";
    return `<button class="workflows-choice${current}" type="submit" name="prompt" value="/workflows ${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  }).join("");
  const summary = selected && selected !== "none" ? selected : "workflow";
  return `<details class="workflows-menu"${selected && selected !== "none" ? ` data-mode="${escapeHtml(selected)}"` : ""}>
    <summary aria-label="Choose workflow" aria-keyshortcuts="W">${escapeHtml(summary)}</summary>
    <form class="workflows-menu-list" action="${action}" method="post"
      hx-post="${action}"
      ${hxMutateAttrs()}
      hx-disabled-elt=".workflows-choice">
      ${buttons}
    </form>
  </details>`;
}

function renderSessionPlace(snapshot) {
  const name = placeName(snapshot);
  return name ? `<div class="session-place"><p class="session-project">${escapeHtml(name)}</p></div>` : "";
}

function composerControls(running, findWork = "") {
  const active = running || findWork === "compile" || findWork === "save";
  if (!active) return "";
  const label = findWork === "save" ? "Saving…" : findWork === "compile" ? "Finding…" : "";
  return `${label ? `<span class="composer-work-state" role="status">${label}</span>` : ""}
    <span id="interrupt-working" class="htmx-indicator" aria-live="polite">Stopping…</span>
    <button id="interrupt-submit" class="composer-interrupt" type="submit" form="interrupt-form" aria-label="Stop current turn" title="Stop"><svg class="composer-stop" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><rect fill="currentColor" x="6.5" y="6.5" width="11" height="11" rx="1.5"/></svg></button>`;
}

function composerCaseButton(snapshot) {
  if (!snapshot?.caseFile) return "";
  return `<button id="composer-case" class="composer-case" type="button" aria-haspopup="dialog" aria-controls="session-case-viewer" data-document-viewer-open="session-case-viewer" aria-label="Working memory">doc</button>`;
}

function composer(paths, snapshot) {
  const running = sessionStatus(snapshot).key === "running";
  const sessionId = snapshot?.id ?? "";
  const findWork = sessionFindWork(snapshot);
  const interrupt = `<form id="interrupt-form" class="interrupt-proxy" action="${escapeHtml(paths.interrupt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.interrupt)}"
      ${hxMutateAttrs()}
      hx-disabled-elt="#interrupt-submit"
      hx-indicator="#interrupt-working"></form>`;
  return `${interrupt}<form id="composer" class="composer" action="${escapeHtml(paths.prompt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.prompt)}"
      ${hxMutateAttrs()}
      hx-replace-url="${escapeHtml(paths.canonical)}"
      hx-disabled-elt="#composer-submit"
      hx-indicator="#working"
      hx-preserve="true">
      <label for="prompt">Message</label>
      <div class="composer-row">
        <textarea id="prompt" name="prompt" rows="1" maxlength="32768" required autocomplete="off" enterkeyhint="send"></textarea>
        <button id="composer-dictate" type="button" data-state="idle" aria-label="Dictate">
          <svg class="dictate-mic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
          </svg>
          <svg class="dictate-cancel" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z"/>
          </svg>
        </button>
        ${regionShell("composer-turn-controls", "composer-turn-controls", "composer", composerControls(running, findWork), true)}
        ${composerCaseButton(snapshot)}
        <button id="composer-submit" type="submit" aria-label="Send"><svg class="composer-enter" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M19 6v5H7.83l2.58-2.59L9 7 4 12l5 5 1.41-1.41L7.83 13H21V6h-2z"/></svg></button>
      </div>
      <span id="working" class="htmx-indicator" aria-live="polite">Admitting message…</span>
      <span id="dictation-status" class="dictation-status" data-state="idle" role="status" aria-live="polite" aria-atomic="true" hidden></span>
    </form>`;
}

function renderParentNav(snapshot, paths) {
  if (!isChildSession(snapshot)) return "";
  const href = sessionSwitchHref(paths, snapshot.parent);
  const face = sessionToken({ id: snapshot.parent, alias: snapshot.parentAlias });
  const parentLink = href
    ? `<a href="${escapeHtml(href)}" data-session-id="${escapeHtml(snapshot.parent)}"><span aria-hidden="true">←</span><span>parent ${escapeHtml(face)}</span></a>`
    : "";
  return parentLink
    ? `<nav class="session-parent" aria-label="Parent session">${parentLink}</nav>`
    : "";
}

export function renderSessionChildren(snapshot, paths) {
  if (!snapshot?.id) return "";
  if (isChildSession(snapshot)) return "";
  const children = Array.isArray(snapshot.children) ? snapshot.children : [];
  if (children.length === 0) return "";
  const rows = children.map((child) => {
    const href = sessionSwitchHref(paths, child?.id);
    if (!href) return "";
    const face = sessionToken(child);
    const status = child?.status === "running" ? "running" : "idle";
    return `<li><a class="session-child" href="${escapeHtml(href)}" data-session-id="${escapeHtml(child.id ?? "")}" data-child-session="${escapeHtml(child.id ?? "")}"><span class="session-child-face">${escapeHtml(face)}</span><span class="session-child-status" data-status="${status}">${status}</span></a></li>`;
  }).filter(Boolean).join("");
  return rows ? `<nav class="session-child-list" aria-label="Child sessions"><ol>${rows}</ol></nav>` : "";
}

export const SSE_REGION_NAMES = Object.freeze(["chrome", "transcript", "live", "queue", "children", "composer", "popups", "case"]);
export const LIVE_SSE_EVENTS = Object.freeze(["live"]);
export const MUTATION_REGION_NAMES = Object.freeze(["chrome", "children", "queue", "composer", "popups"]);
/** Prompt/interrupt: SSE owns the queue. POST OOB of pending races claim and sticks a duplicate. */
export const PROMPT_MUTATION_REGION_NAMES = Object.freeze(["chrome", "children", "composer", "popups"]);
export const SSE_REGION_IDS = Object.freeze({
  chrome: "session-chrome",
  transcript: "transcript-log",
  live: "transcript-live-nodes",
  queue: "session-queue",
  children: "session-children",
  composer: "composer-turn-controls",
  popups: "session-popups",
  case: "session-case",
});

function transcriptNodeIsOpen(node) {
  return node?.status === "running"
    || (node?.kind === "assistant" && node.status === "streaming");
}

/**
 * The settled transcript is a chronological prefix. Once any node opens, every
 * later node belongs to one mixed live suffix, irrespective of node kind. This
 * keeps text, tools, and subsequent text in log order.
 */
export function splitTranscriptNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const liveIndex = list.findIndex(transcriptNodeIsOpen);
  if (liveIndex < 0) return { settled: list, live: [] };
  return {
    settled: list.slice(0, liveIndex),
    live: list.slice(liveIndex),
  };
}

function safeLiveId(value) {
  const id = String(value ?? "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return id || "tail";
}

function liveNodeKey(node) {
  if (node?.kind === "tool") return `tool-${node.callId || node.seq || "tail"}`;
  if (node?.kind === "assistant") {
    return `assistant-${node.turn ?? ""}-${node.step ?? ""}-${node.seq ?? "tail"}`;
  }
  return `${node?.kind ?? "node"}-${node?.key ?? node?.seq ?? "tail"}`;
}

function liveBlockEvent(key, index, type) {
  return `live-${safeLiveId(key)}-${index}-${safeLiveId(type)}`;
}

function renderLiveAssistantBlock(node, block, index, key) {
  const seq = escapeHtml(node?.seq ?? "");
  const turn = escapeHtml(node?.turn ?? "");
  const step = escapeHtml(node?.step ?? "");
  const time = eventTime(node?.time);
  const type = block?.type === "reasoning" ? "reasoning" : block?.type === "image" ? "image" : "text";
  const target = liveBlockEvent(key, index, type);
  const text = String(block?.text ?? "");
  const stream = `<div id="${escapeHtml(target)}" class="message-text message-live-text" data-live-block="${index}" data-live-key="${escapeHtml(target)}">${escapeHtml(text)}</div>`;
  if (type === "reasoning") {
    const label = time ? `Reasoning at ${time}` : "Reasoning";
    return `<section class="assistant-reasoning" aria-label="${escapeHtml(label)}" data-seq="${seq}" data-turn="${turn}" data-step="${step}" aria-busy="true">${stream}</section>`;
  }
  if (type === "image") {
    return `<article class="message message-assistant message-streaming" data-seq="${seq}" data-turn="${turn}" data-step="${step}" aria-busy="true">${attachmentBlock(block)}</article>`;
  }
  const label = time ? `Assistant message at ${time}` : "Assistant message";
  return `<article class="message message-assistant message-streaming" data-seq="${seq}" data-turn="${turn}" data-step="${step}" aria-label="${escapeHtml(label)}" aria-busy="true">${stream}</article>`;
}

function wrapLiveNode(id, inner) {
  return `<div id="${escapeHtml(id)}" class="transcript-live-node" data-live-node="${escapeHtml(id)}">${inner}</div>`;
}

function liveAssistantIsland(node) {
  if (!node) return null;
  const key = liveNodeKey(node);
  const id = `live-node-${safeLiveId(key)}`;
  const streaming = node.status === "streaming";
  const segments = streaming
    ? (Array.isArray(node.blocks) ? node.blocks : []).map((block, index) => {
        const type = block?.type === "reasoning" ? "reasoning" : block?.type === "image" ? "image" : "text";
        return {
          key: `${key}:${index}:${type}`,
          event: liveBlockEvent(key, index, type),
          type,
          text: type === "image" ? JSON.stringify(block?.attachment ?? null) : String(block?.text ?? ""),
        };
      })
    : [];
  const inner = streaming
    ? (Array.isArray(node.blocks) ? node.blocks : []).map((block, index) =>
        renderLiveAssistantBlock(node, block, index, key)).join("\n")
    : renderConversationNode(node);
  return { key, id, kind: "assistant", segments, inner, html: wrapLiveNode(id, inner) };
}

function liveToolIsland(node) {
  if (!node) return null;
  const key = liveNodeKey(node);
  const id = `live-node-${safeLiveId(key)}`;
  const event = liveBlockEvent(key, "args", "text");
  const text = String(node.arguments ?? "");
  const inner = renderConversationNode({ ...node, liveKey: node.status === "running" ? event : undefined });
  return {
    key,
    id,
    kind: "tool",
    segments: node.status === "running" ? [{ key: `${key}:args:text`, event, type: "text", text }] : [],
    inner,
    html: wrapLiveNode(id, inner),
  };
}

function liveConversationIsland(node) {
  if (node?.kind === "assistant") return liveAssistantIsland(node);
  if (node?.kind === "tool") return liveToolIsland(node);
  const key = liveNodeKey(node);
  const id = `live-node-${safeLiveId(key)}`;
  const inner = renderConversationNode(node);
  return { key, id, kind: node?.kind ?? "node", segments: [], inner, html: wrapLiveNode(id, inner) };
}

function nodeKeys(nodes) {
  const seen = new Map();
  return (Array.isArray(nodes) ? nodes : []).map((node) => {
    const base = liveNodeKey(node);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return occurrence === 0 ? base : `${base}-occurrence-${occurrence}`;
  });
}

function keyedIslands(nodes) {
  const keys = nodeKeys(nodes);
  return nodes.map((node, index) => {
    const island = liveConversationIsland(node);
    if (island.key === keys[index]) return island;
    const id = `live-node-${safeLiveId(keys[index])}`;
    return { ...island, key: keys[index], id, html: wrapLiveNode(id, island.inner) };
  });
}

/** Serializable cursors for the chronological live suffix. */
export function liveTranscriptState(snapshot, previous = null) {
  const nodes = sessionNodes(snapshot);
  const allKeys = nodeKeys(nodes);
  const allIslands = keyedIslands(nodes);
  const { live } = splitTranscriptNodes(nodes);
  if (!previous) {
    return { allKeys, nodes: allIslands.slice(nodes.length - live.length), reset: false };
  }

  const prefix = isKeyPrefix(previous.allKeys, allKeys);
  if (!prefix) {
    return { allKeys, nodes: allIslands.slice(nodes.length - live.length), reset: true };
  }

  const held = new Set(previous.nodes.map((island) => island.key));
  for (const key of allKeys.slice(previous.allKeys.length)) held.add(key);
  return { allKeys, nodes: allIslands.filter((island) => held.has(island.key)), reset: false };
}

function liveAppendFrames(previous, state, event = "live") {
  if (!previous || !state || previous.kind !== state.kind) return null;
  if (previous.segments.length !== state.segments.length) return null;
  const frames = [];
  for (let index = 0; index < state.segments.length; index += 1) {
    const before = previous.segments[index];
    const after = state.segments[index];
    if (before.key !== after.key || before.type !== after.type) return null;
    if (before.text === after.text) continue;
    if (after.type === "image" || !after.text.startsWith(before.text)) return null;
    frames.push({
      event: `${event}-append`,
      data: JSON.stringify({
        op: "qq-live-append",
        key: after.event,
        from: before.text.length,
        text: after.text.slice(before.text.length),
      }),
    });
  }
  return frames.length > 0 ? frames : null;
}

function liveNodePatch(event, op, island, html = island.html) {
  return {
    event: `${event}-append`,
    data: JSON.stringify({
      op,
      key: island.id,
      html,
      ...(op === "qq-live-insert" ? { inner: island.inner } : {}),
    }),
  };
}

/**
 * Nodes enter one mixed tail and never change stacks. New nodes append after the
 * existing last node; token suffixes and tool progress patch their own ids;
 * sealing replaces only that node's contents so Markdown is promoted in place.
 */
export function liveTranscriptUpdate(previous, snapshot) {
  const state = liveTranscriptState(snapshot, previous);
  if (!previous) {
    return {
      state,
      junction: state.nodes.length > 0,
      frames: state.nodes.map((island) =>
        liveNodePatch(island.kind === "tool" ? "live-tool" : "live", "qq-live-insert", island)),
    };
  }
  if (state.reset) {
    return {
      state,
      junction: true,
      frames: [{ event: "live", data: state.nodes.map((island) => island.html).join("\n") }],
    };
  }

  const beforeByKey = new Map(previous.nodes.map((island) => [island.key, island]));
  const nextKeys = state.nodes.map((island) => island.key);
  const retainedKeys = previous.nodes
    .map((island) => island.key)
    .filter((key) => nextKeys.includes(key));
  if (!isKeyPrefix(retainedKeys, nextKeys)) {
    return {
      state,
      junction: true,
      frames: [{ event: "live", data: state.nodes.map((island) => island.html).join("\n") }],
    };
  }

  const frames = [];
  let junction = false;
  for (const island of state.nodes) {
    const before = beforeByKey.get(island.key);
    const event = island.kind === "tool" ? "live-tool" : "live";
    if (!before) {
      frames.push(liveNodePatch(event, "qq-live-insert", island));
      junction = true;
      continue;
    }
    if (before.inner === island.inner) continue;
    const append = liveAppendFrames(before, island, event);
    if (append) {
      frames.push(...append);
      continue;
    }
    frames.push(liveNodePatch(event, "qq-live-replace", island, island.inner));
    junction = true;
  }
  return { state, junction, frames };
}

function hxMutateAttrs() {
  return `hx-swap="none"`;
}

function sessionStatus(snapshot) {
  if (!snapshot?.id) return { key: "ready", label: "Ready" };
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  return deriveStatus(events, snapshot.agentStatus, snapshot.turnStatus);
}

function sessionFindWork(snapshot) {
  return snapshot?.findWork === "save" ? "save" : snapshot?.findWork === "compile" ? "compile" : "";
}

function argumentSummary(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const preferred = ["command", "path", "file_path", "file", "query", "pattern", "url", "task", "id"];
    for (const key of preferred) {
      const value = raw[key];
      if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim().slice(0, 180);
      if (typeof value === "number" || typeof value === "boolean") return `${key}: ${value}`;
    }
    const first = Object.entries(raw).find(([, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean");
    if (first) return `${first[0]}: ${String(first[1]).replace(/\s+/g, " ").slice(0, 150)}`;
    return "";
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  try {
    return argumentSummary(JSON.parse(text));
  } catch {
    return text.replace(/\s+/g, " ").slice(0, 180);
  }
}

/**
 * Inner code-mode tools live on the log (`tool/code-dispatch`), not the DSH
 * mouth. Project only the live sandbox so the operator sees the constant stub
 * plus current tools, not the last dry dump.
 * Closed inner cards are summaries only: the tool-body route reads the mouth.
 */
export function codeDispatchNodes(events, sinceSeq = 0) {
  const byId = new Map();
  const order = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (!Number.isSafeInteger(event?.seq) || event.seq < sinceSeq) continue;
    if (event.type !== "tool/code-dispatch-start" && event.type !== "tool/code-dispatch") continue;
    const data = event.data ?? {};
    const callId = String(data.subCallId ?? "");
    if (!callId) continue;
    let node = byId.get(callId);
    if (!node) {
      const args = data.arguments;
      node = {
        kind: "tool",
        key: `tool:${callId}`,
        seq: event.seq,
        time: event.time,
        callId,
        name: String(data.name ?? "unknown"),
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
        argumentSummary: argumentSummary(args),
        callView: null,
        resultView: null,
        status: "running",
        expanded: false,
        content: [],
        inner: true,
      };
      byId.set(callId, node);
      order.push(node);
    }
    if (event.type === "tool/code-dispatch") {
      node.resultSeq = event.seq;
      node.content = Array.isArray(data.content) ? data.content : [];
      node.isError = data.isError === true;
      node.status = data.isError === true ? "error" : "success";
    }
  }
  return order;
}

export function sessionDisplayNodes(snapshot) {
  const nodes = Array.isArray(snapshot?.conversation?.nodes) ? snapshot.conversation.nodes : [];
  let lastSettledSeq = 0;
  for (const node of nodes) {
    if (node?.status === "running") continue;
    if (Number.isSafeInteger(node?.seq) && node.seq > lastSettledSeq) lastSettledSeq = node.seq;
  }
  const inner = codeDispatchNodes(snapshot?.events, lastSettledSeq + 1);
  if (inner.length === 0) return nodes;
  const rest = nodes.filter((node) => !(
    node?.kind === "tool" && node.name === "run_code" && node.status === "running"
  ));
  return [...rest, ...inner].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
}

function sessionNodes(snapshot) {
  return sessionDisplayNodes(snapshot);
}

function slashNoticeHtml(snapshot, paths, notice) {
  return renderSlashNotice(notice, paths, sessionNodes(snapshot));
}

function isPopupMarkup(html) {
  return html.includes("offer-popup") || html.includes("workflows-popup");
}

function nodeFingerprint(node) {
  if (!node || typeof node !== "object") return "";
  const blocks = Array.isArray(node.blocks) ? node.blocks : Array.isArray(node.content) ? node.content : [];
  const last = blocks.at(-1);
  const lastText = typeof last?.text === "string" ? last.text : "";
  return [
    node.seq,
    node.kind,
    node.status,
    node.turn,
    node.step,
    node.eventType,
    node.callId ?? "",
    node.messageId ?? "",
    node.outcome?.kind ?? "",
    last?.type ?? "",
    lastText.length,
    lastText.slice(-24),
  ];
}

function settledNodeKey(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.key === "string" && node.key) return node.key;
  if (node.kind === "tool") return `tool:${node.callId || node.seq || ""}`;
  return `${node.kind ?? "node"}:${node.seq ?? ""}`;
}

function sseSwapAttrs(name, enabled, swap = "innerHTML") {
  return enabled ? ` hx-ext="sse" sse-swap="${escapeHtml(name)}" hx-swap="${escapeHtml(swap)}"` : "";
}

function regionShell(id, className, eventName, inner, enabled, swap = "innerHTML") {
  return `<div id="${escapeHtml(id)}" class="${escapeHtml(className)}"${sseSwapAttrs(eventName, enabled, swap)}>${inner}</div>`;
}

export function renderChrome(snapshot, paths, notice = "") {
  const emptyProject = !snapshot?.id;
  const status = sessionStatus(snapshot);
  const tracked = selectedLiveTrackerSession(snapshot);
  const face = emptyProject ? "" : tracked ? trackerSessionFace(tracked) : liveFace(snapshot);
  const sessions = sessionNavigation(snapshot, paths);
  const project = placeName(snapshot);
  const slash = slashNoticeHtml(snapshot, paths, notice);
  const inlineNotice = slash && !isPopupMarkup(slash) ? slash : "";
  const child = isChildSession(snapshot);
  const title = child ? "Child transcript" : "Operator console";
  return `<div class="session-heading">
      <div class="session-heading-start">
        ${renderProjectsMenu(snapshot, paths)}
        ${project ? `<p class="session-project">${escapeHtml(project)}</p>` : ""}
        ${sessions.tokens}
        ${sessions.token ? `<p class="session-id">${escapeHtml(sessions.token)}</p>` : ""}
        <h1 id="session-heading"><span class="session-heading-title">${title}${face ? ` · ${escapeHtml(face)}` : ""}</span></h1>
      </div>
      <div class="session-heading-end">
        ${child ? renderParentNav(snapshot, paths) : snapshot?.id ? renderWorkflowMenu(snapshot, paths) || sessionModeChip(snapshot.sessionMode) : ""}
      </div>
    </div>
    ${status.detail ? `<p class="notice turn-error" role="alert"><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(status.detail)}</span>${status.code ? `<code>${escapeHtml(status.code)}</code>` : ""}</p>` : ""}
    ${inlineNotice}`;
}

function renderSettledConversationNode(node) {
  if (node?.kind === "assistant" && node.status === "streaming") {
    return renderConversationNode({ ...node, status: "settled" });
  }
  return renderConversationNode(node);
}

export function renderTranscriptSettled(snapshot) {
  if (!snapshot?.id) return "";
  const { settled, live } = splitTranscriptNodes(sessionNodes(snapshot));
  if (settled.length === 0 && live.length === 0) {
    return '<p id="transcript-empty" class="empty-transcript">This DSH session has no transcript yet.</p>';
  }
  return settled.map(renderSettledConversationNode).filter(Boolean).join("\n");
}

function transcriptAnchor() {
  return regionShell("transcript-anchor", "transcript-anchor", "transcript", "", true, "beforebegin");
}

export function transcriptSettledInner(snapshot) {
  const settled = renderTranscriptSettled(snapshot);
  return `${settled}\n${transcriptAnchor()}`;
}

function isKeyPrefix(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length > next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * HTML for newly settled nodes only. `#transcript-settled` is append-only after
 * first paint unless a surface replace drops nodes, in which case the cell is
 * recommissioned.
 */
export function renderSettledTranscriptAppend(previousKeys, snapshot) {
  const { settled } = splitTranscriptNodes(sessionNodes(snapshot));
  const keys = settled.map(settledNodeKey);
  if (!Array.isArray(previousKeys)) return { keys, html: "", reset: false };
  if (!isKeyPrefix(previousKeys, keys)) {
    return { keys, html: transcriptSettledInner(snapshot), reset: true };
  }
  const seen = new Set(previousKeys);
  const added = settled.filter((node) => !seen.has(settledNodeKey(node)));
  let html = added.map(renderSettledConversationNode).filter(Boolean).join("\n");
  if (previousKeys.length === 0 && added.length > 0) {
    html += '<p id="transcript-empty" hx-swap-oob="delete"></p>';
  }
  return { keys, html, reset: false };
}

/** @deprecated Junctions are projected through the chronological live suffix. */
export function renderTranscriptJunction(snapshot) {
  return renderTranscriptSettled(snapshot);
}

export function renderLiveNodes(snapshot) {
  return liveTranscriptState(snapshot).nodes.map((island) => island.html).join("\n");
}

/** @deprecated Use renderLiveNodes. */
export function renderLiveText(snapshot) {
  return renderLiveNodes(snapshot);
}

/** @deprecated Tools share the mixed live suffix. */
export function renderLiveTool() {
  return "";
}

function renderProviderGapSlot() {
  return `<div id="provider-gap" class="provider-gap" data-state="idle" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true"><span class="provider-gap-caret" aria-hidden="true"></span><span class="provider-gap-elapsed" hidden></span></div>`;
}

export function renderTranscriptLive(snapshot, paths = {}) {
  if (!snapshot?.id) return "";
  return `${regionShell("transcript-live-nodes", "transcript-live-nodes", "live", renderLiveNodes(snapshot), true)}${regionShell("session-queue", "session-queue", "queue", renderQueue(snapshot, paths), true)}${renderProviderGapSlot()}`;
}

export function renderTranscript(snapshot, paths = {}) {
  const settled = renderTranscriptSettled(snapshot);
  const live = renderTranscriptLive(snapshot, paths);
  return [settled, live].filter(Boolean).join("\n");
}

export function renderQueue(snapshot, paths) {
  if (!snapshot?.id) return "";
  return renderPendingQueue(snapshot, paths);
}

export function renderComposerControls(snapshot) {
  if (!snapshot?.id || isChildSession(snapshot)) return "";
  const status = sessionStatus(snapshot);
  return composerControls(status.key === "running", sessionFindWork(snapshot));
}

export function renderComposer(snapshot, paths) {
  if (!snapshot?.id || isChildSession(snapshot)) return "";
  return composer(paths, snapshot);
}

export function renderCaseRegion(snapshot) {
  const doc = snapshot?.caseFile;
  if (!doc || typeof doc !== "object") return "";
  const text = String(doc.text ?? "");
  const title = doc.title || "Working memory";
  const panel = `<aside class="case-panel" aria-label="working memory"><p class="case-identity">working memory</p>${renderMarkdownText(text, "case-prose")}</aside>`;
  const viewer = renderDocumentViewer({
    title,
    identity: doc.identity || "working memory",
    kind: "markdown",
    text,
  }, { mode: "dialog", id: "session-case-viewer", closeLabel: "Close" });
  return `${panel}${viewer}`;
}

export function renderCastPanel(snapshot) {
  if (snapshot?.sessionMode !== "cast") return "";
  return `<aside id="cast-panel" class="cast-panel">
    <p id="cast-hint">this phone fills the TV</p>
    <input id="cast-pair-code" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" enterkeyhint="done" hidden>
    <button id="cast-toggle" type="button" data-state="idle">cast to TV</button>
    <div id="cast-audio" class="cast-audio">
      <span class="cast-audio-label">sound</span>
      <button type="button" id="cast-audio-tv" data-audio="tv">TV</button>
      <button type="button" id="cast-audio-phone" data-audio="phone">phone</button>
    </div>
    <label id="cast-offset-wrap" class="cast-offset">
      <span>offset <span id="cast-offset-value">0 ms</span></span>
      <input id="cast-offset" type="range" min="-400" max="400" step="10" value="0">
    </label>
    <p id="cast-error" hidden></p>
  </aside>`;
}

export function renderPopups(snapshot, paths, notice = "") {
  if (isChildSession(snapshot)) return renderProgressChip(snapshot?.progress);
  const slash = slashNoticeHtml(snapshot, paths, notice);
  const popupNotice = slash && isPopupMarkup(slash) ? slash : "";
  return `${renderCastPanel(snapshot)}
    ${renderProgressChip(snapshot?.progress)}
    ${renderLoginSheet(snapshot?.loginSheet, paths)}
    ${renderOfferPopup(snapshot?.offer, paths, notice)}
    ${renderApprovalPopup(snapshot?.approval, paths, notice)}
    ${renderOverlay(snapshot?.overlay, paths, notice, sessionFindWork(snapshot))}
    ${popupNotice}`;
}

export function renderSessionRegion(name, snapshot, paths, notice = "") {
  switch (name) {
    case "chrome":
      return renderChrome(snapshot, paths, notice);
    case "transcript":
      return renderTranscriptSettled(snapshot);
    case "live":
      return renderLiveNodes(snapshot);
    case "queue":
      return renderQueue(snapshot, paths);
    case "children":
      return renderSessionChildren(snapshot, paths);
    case "composer":
      return renderComposerControls(snapshot);
    case "popups":
      return renderPopups(snapshot, paths, notice);
    case "case":
      return renderCaseRegion(snapshot);
    default:
      return "";
  }
}

function liveTrackerFingerprint(dashboard) {
  if (dashboard?.schema !== "qq.dashboard/v1" || !Array.isArray(dashboard.projects)) return null;
  return dashboard.projects.map((project) => [
    project.key,
    project.name,
    project.label,
    project.folder,
    project.folderLabel,
    (Array.isArray(project.sessions) ? project.sessions : []).map((row) => [
      row.sessionId,
      row.alias,
      row.label,
      row.parentSessionId,
      row.depth,
      row.activity,
      row.workflow,
      row.phase,
      row.phaseStartedAt,
    ]),
  ]);
}

/** Compact per-region tokens. SSE emits a named event only when that token changes. */
export function regionFingerprints(snapshot) {
  const sessions = Array.isArray(snapshot?.sessions) ? snapshot.sessions : [];
  const children = Array.isArray(snapshot?.children) ? snapshot.children : [];
  const status = sessionStatus(snapshot);
  const offer = snapshot?.offer;
  const { settled, live } = splitTranscriptNodes(sessionNodes(snapshot));
  return {
    chrome: JSON.stringify([
      snapshot?.id,
      snapshot?.project,
      snapshot?.folder,
      snapshot?.alias,
      snapshot?.origin,
      snapshot?.parent,
      snapshot?.agentStatus,
      status.key,
      status.label,
      status.detail ?? "",
      status.code ?? "",
      sessions.map((session) => [session.id, session.createdAt, session.alias, session.project]),
      (snapshot?.activeProjects ?? []).map((session) => [session.id, session.createdAt, session.alias, session.project, session.folder]),
      liveTrackerFingerprint(snapshot?.dashboard),
      snapshot?.sessionMode ?? "",
      (snapshot?.workflows ?? []).join(","),
    ]),
    transcript: JSON.stringify([
      snapshot?.id,
      settled.length,
      nodeFingerprint(settled.at(-1)),
    ]),
    live: JSON.stringify([
      snapshot?.id,
      live.map(nodeFingerprint),
    ]),
    queue: JSON.stringify((snapshot?.conversation?.pending ?? []).map((item) => [item.id, item.target, item.text])),
    children: JSON.stringify([
      snapshot?.id,
      snapshot?.origin,
      snapshot?.parent,
      snapshot?.parentAlias,
      children.map((child) => [child.id, child.alias, child.status]),
    ]),
    composer: JSON.stringify([
      snapshot?.id,
      snapshot?.origin,
      status.key === "running",
      sessionFindWork(snapshot),
      Boolean(snapshot?.caseFile),
    ]),
    case: JSON.stringify([
      snapshot?.id,
      snapshot?.caseFile?.title ?? "",
      snapshot?.caseFile?.text ?? "",
    ]),
    popups: JSON.stringify([
      offer?.id ?? "",
      offer?.brief ?? "",
      snapshot?.approval?.id ?? "",
      snapshot?.approval?.toolName ?? "",
      snapshot?.loginSheet?.action ?? "",
      (snapshot?.loginSheet?.connectors ?? []).map((connector) => connector.id),
      snapshot?.overlay?.id ?? "",
      snapshot?.overlay?.media?.src ?? "",
      snapshot?.overlay?.chrome === false ? "0" : "1",
      snapshot?.progress?.title ?? "",
      snapshot?.sessionMode ?? "",
      sessionFindWork(snapshot),
    ]),
  };
}

/** Render the session panel children, each in a named SSE swap target. */
export function renderSessionContent(snapshot, paths, notice = "") {
  const emptyProject = !snapshot?.id;
  const chrome = regionShell("session-chrome", "session-chrome", "chrome", renderChrome(snapshot, paths, notice), true);
  const popups = regionShell("session-popups", "session-popups", "popups", renderPopups(snapshot, paths, notice), true);
  if (emptyProject) return `${chrome}${popups}`;
  const children = regionShell("session-children", "session-children", "children", renderSessionChildren(snapshot, paths), true);
  const composerRegion = regionShell(
    "session-composer",
    "session-composer",
    "composer-shell",
    renderComposer(snapshot, paths),
    true,
  );
  return `${chrome}
    <div id="transcript" class="transcript" aria-live="polite" aria-label="Session transcript" data-tool-base="${escapeHtml(paths.canonical ?? "")}" hx-history="false">
      <div id="transcript-log" class="transcript-log" hx-history="false">
        ${regionShell("transcript-settled", "transcript-settled", "transcript-reset", transcriptSettledInner(snapshot), true)}
        <div id="transcript-live" class="transcript-live">${renderTranscriptLive(snapshot, paths)}</div>
      </div>
    </div>
    ${children}
    ${composerRegion}
    ${popups}`;
}

/**
 * HTMX mutation response. Transcript and live tail belong to SSE. Queue is
 * SSE-owned on prompt; queue POST still replaces `#session-queue`.
 */
export function renderMutationOob(snapshot, paths, notice = "", regions = MUTATION_REGION_NAMES) {
  return regions.map((name) => {
    const id = SSE_REGION_IDS[name];
    const inner = renderSessionRegion(name, snapshot, paths, notice);
    return `<div id="${escapeHtml(id)}" hx-swap-oob="innerHTML">${inner}</div>`;
  }).join("\n");
}

export function renderOverlay(overlay, paths, notice = "", findWork = "") {
  if (!overlay || typeof overlay !== "object" || !overlay.id || !overlay.media?.src) return "";
  const chrome = overlay.chrome !== false;
  const action = escapeHtml(paths.overlay ?? "");
  const title = escapeHtml(overlay.title || "Rate this picture");
  const src = escapeHtml(overlay.media.src);
  const alt = escapeHtml(overlay.media.alt || overlay.title || "");
  const fit = overlay.media.fit === "contain" ? " data-fit=\"contain\"" : "";
  const keysAttr = overlayKeysAttr(overlay.keys);
  const actions = Array.isArray(overlay.actions) ? overlay.actions : [];
  const buttons = actions.map((item) => {
    const id = escapeHtml(item.id ?? "");
    const label = escapeHtml(item.label ?? item.id ?? "");
    return `<button class="offer-choice overlay-choice overlay-${id}" type="submit" name="choice" value="${id}">${label}</button>`;
  }).join("");
  const refusal = notice ? `<p class="notice" role="alert">${escapeHtml(notice)}</p>` : "";
  const saving = findWork === "save"
    ? `<p class="overlay-saving" aria-live="polite">Saving…</p>
        <form class="overlay-cancel" action="${escapeHtml(paths.interrupt)}" method="post"
          hx-post="${escapeHtml(paths.interrupt)}"
          ${hxMutateAttrs()}>
          <button type="submit">Cancel</button>
        </form>`
    : "";
  const stage = chrome
    ? `<div class="overlay-stage"><img src="${src}" alt="${alt}"${fit}></div>`
    : `<form class="overlay-stage overlay-stage-hit" action="${action}" method="post"
        hx-post="${action}"
        ${hxMutateAttrs()}>
        <button type="submit" name="choice" value="chrome" aria-label="Show buttons">
          <img src="${src}" alt="${alt}"${fit}>
        </button>
      </form>`;
  return `<aside class="overlay-popup${chrome ? "" : " overlay-chrome-hidden"}" role="dialog" aria-modal="true" aria-labelledby="overlay-heading" data-overlay-id="${escapeHtml(overlay.id)}"${keysAttr}>
    <div class="offer-sheet overlay-sheet">
      <header class="offer-head overlay-head">
        <p class="eyebrow">Find</p>
        <h2 id="overlay-heading">${title}</h2>
        ${saving}
        <form class="overlay-dismiss" action="${action}" method="post"
          hx-post="${action}"
          ${hxMutateAttrs()}>
          <button type="submit" name="choice" value="dismiss" aria-label="Close">×</button>
        </form>
      </header>
      ${stage}
      ${refusal}
      <form class="offer-actions overlay-actions" action="${action}" method="post"
        hx-post="${action}"
        ${hxMutateAttrs()}
        hx-disabled-elt=".overlay-choice">
        <button class="offer-choice overlay-choice overlay-chrome-toggle" type="submit" name="choice" value="chrome">Hide buttons</button>
        ${buttons}
      </form>
    </div>
  </aside>`;
}

function drawerQuery(path) {
  return `?drawer=${encodeURIComponent(String(path ?? ""))}`;
}

function drawerEntryHref(entry, drawer, paths) {
  if (entry.type === "project") {
    const project = String(entry.project ?? entry.name ?? "");
    const folder = String(entry.folder ?? "");
    const qualified = folder ? `~/${project}/${folder}` : `~/${project}`;
    return `${paths.canonical}${drawerQuery(qualified)}`;
  }
  if (entry.type === "directory") {
    const qualified = drawer.project ? `~/${drawer.project}/${entry.path}` : entry.path;
    return `${paths.canonical}${drawerQuery(qualified)}`;
  }
  const projectBase = drawer.project
    ? `${paths.projectsBase}/${encodeURIComponent(drawer.project)}`
    : paths.canonical;
  const mode = entry.kind === "binary" ? "open" : "file";
  return `${projectBase}/${mode}/${encodeURIComponent(entry.path)}`;
}

/** Render one non-recursive project level. Descendants are never embedded. */
export function renderProjectDrawer(drawer, paths, livePlaces = new Set()) {
  if (!drawer || !Array.isArray(drawer.entries)) return "";
  const opened = drawer.open === true;
  const breadcrumbs = Array.isArray(drawer.breadcrumbs) ? drawer.breadcrumbs : [];
  const nestedCrumbs = breadcrumbs.filter((crumb) => crumb.type !== "projects");
  const latestCrumb = nestedCrumbs.at(-1);
  const groupedRoot = !drawer.path && drawer.entries.some((entry) => entry.type === "project" && entry.folder);
  const selectedFolder = drawer.path && latestCrumb?.type === "project"
    ? String(drawer.path).split("/")[0]
    : "";
  const atProjectDirectory = drawer.scope === "project"
    && Boolean(drawer.project)
    && !groupedRoot;
  const currentFolder = drawer.path ? String(drawer.path) : selectedFolder;
  const liveHere = livePlaces.has(`${String(drawer.project ?? "")}\n${currentFolder}`);
  const startSessionBase = atProjectDirectory && !liveHere && paths.projectsBase
    ? `${paths.projectsBase}/${encodeURIComponent(drawer.project ?? "")}${currentFolder ? `/${encodeURIComponent(currentFolder)}` : ""}`
    : "";
  const startSession = startSessionBase
    ? `<form class="drawer-start-session" action="${escapeHtml(`${startSessionBase}/sessions`)}" method="post">
        <button type="submit" aria-label="New session"><span aria-hidden="true">+</span></button>
      </form>`
    : "";
  const breadcrumbHtml = nestedCrumbs.map((crumb, index) => {
    const current = index === nestedCrumbs.length - 1;
    const label = String(crumb.name ?? "").replace(/[\\/]+$/, "") || String(crumb.name ?? "");
    const path = String(crumb.path ?? "");
    const qualified = drawer.project
      ? `~/${drawer.project}${path ? `/${path}` : ""}`
      : "~";
    const href = `${paths.canonical}${drawerQuery(qualified)}`;
    return `<li${current ? ' class="drawer-crumb-current"' : ""}>${current
      ? `<span aria-current="page" title="${escapeHtml(label)}">${escapeHtml(label)}</span>${startSession}`
      : `<a href="${escapeHtml(href)}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`}</li>`;
  }).join("");
  const title = paths.projectsSession
    ? `<a href="${escapeHtml(paths.projectsSession)}">projects</a>`
    : "projects";
  const upPath = drawer.scope === "projects"
    ? ""
    : drawer.path
      ? `~/${drawer.project}${drawer.parent ? `/${drawer.parent}` : ""}`
      : "~";
  const upRow = drawer.scope === "projects"
    ? ""
    : `<li><a class="drawer-entry drawer-up" data-entry-type="up" data-tree-action="expand" href="${escapeHtml(`${paths.canonical}${drawerQuery(upPath)}`)}" aria-label="Up one level"><span class="drawer-name">..</span></a></li>`;
  const renderEntry = (entry, split = false) => {
    const href = drawerEntryHref(entry, drawer, paths);
    const action = entry.type === "directory" || entry.type === "project" ? "Open folder" : entry.kind === "binary" ? "Open file" : "Read file";
    const pathAttr = entry.type === "file" && entry.path
      ? ` data-file-path="${escapeHtml(entry.path)}"`
      : "";
    const project = entry.project || (entry.type === "directory" ? drawer.project : "");
    const folder = entry.folder || (entry.type === "directory" ? entry.path : "");
    const projectAttr = project ? ` data-project="${escapeHtml(project)}"` : "";
    const folderAttr = folder ? ` data-folder="${escapeHtml(folder)}"` : "";
    const treeAction = entry.type === "file" ? "open" : "expand";
    return `<li${split ? ' class="drawer-files-start"' : ""}><a class="drawer-entry" data-entry-type="${escapeHtml(entry.type)}" data-tree-action="${treeAction}" data-file-kind="${escapeHtml(entry.kind ?? "")}"${projectAttr}${folderAttr}${pathAttr} href="${escapeHtml(href)}" aria-label="${escapeHtml(`${action} ${entry.name}`)}">
      <span class="drawer-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
    </a></li>`;
  };
  const folders = drawer.entries.filter((entry) => entry.type !== "file");
  const files = drawer.entries.filter((entry) => entry.type === "file");
  const above = Boolean(upRow) || folders.length > 0;
  const rows = [
    upRow,
    ...folders.map((entry) => renderEntry(entry)),
    ...files.map((entry, index) => renderEntry(entry, above && index === 0)),
  ].join("");
  const empty = rows || '<li class="drawer-empty">nothing at this level</li>';
  const crumbs = breadcrumbHtml
    ? `<nav class="drawer-breadcrumbs" aria-label="File location"><ol>${breadcrumbHtml}</ol></nav>`
    : "";
  const drawerBrowserPath = drawer.scope === "projects"
    ? "~"
    : `~/${drawer.project}${drawer.path ? `/${drawer.path}` : ""}`;
  return `<button id="project-drawer-toggle" class="drawer-toggle" type="button" aria-controls="project-drawer" aria-expanded="${opened ? "true" : "false"}"${opened ? " inert" : ""}>files</button>
  <div id="project-drawer-backdrop" class="drawer-backdrop"${opened ? "" : " hidden"}></div>
  <aside id="project-drawer" class="project-drawer" role="dialog" aria-modal="true" aria-hidden="${opened ? "false" : "true"}" aria-labelledby="project-drawer-title" data-drawer-path="${escapeHtml(drawerBrowserPath)}"${opened ? "" : " inert"}>
    <header class="drawer-head">
      <h2 id="project-drawer-title" tabindex="-1">${title}</h2>
      <button class="drawer-close" type="button" aria-label="Close files">${bannerMark("close")}</button>
    </header>
    ${crumbs}
    <ul class="drawer-list">${empty}</ul>
  </aside>`;
}

function documentHead(assetPaths, title = "qq", options = {}) {
  const themeColor = options.themeColor ?? "#000000";
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="${escapeHtml(themeColor)}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="qq">
  <meta name="application-name" content="qq">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="htmx-config" content='{"disableInheritance":true,"historyEnabled":false,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"409","swap":true},{"code":"[45]..","swap":false,"error":true}]}'>
  <title>${escapeHtml(title)}</title>
  <link rel="manifest" href="${escapeHtml(assetPaths.manifest)}">
  <link rel="icon" href="${escapeHtml(assetPaths.icon192)}" sizes="192x192">
  <link rel="apple-touch-icon" href="${escapeHtml(assetPaths.icon192)}">
  <link rel="stylesheet" href="${escapeHtml(assetPaths.css)}">
  <script defer src="${escapeHtml(assetPaths.htmx)}"></script>
  <script defer src="${escapeHtml(assetPaths.sse)}"></script>
  <script defer src="${escapeHtml(assetPaths.browser)}" data-service-worker="${escapeHtml(assetPaths.serviceWorker)}"${assetPaths.uiGeneration ? ` data-ui-generation="${escapeHtml(assetPaths.uiGeneration)}"` : ""}${assetPaths.uiRevision ? ` data-ui-revision="${escapeHtml(assetPaths.uiRevision)}"` : ""}></script>
  <script defer src="/qq/dictate/client.js"></script>
  <script defer src="/qq/cast/client.js"></script>
</head>`;
}

function documentState(document) {
  const state = document?.state;
  if (state !== "loading" && state !== "error" && state !== "empty") return "";
  const defaultTitle = state === "loading" ? "Loading document" : state === "error" ? "Document unavailable" : "Nothing to display";
  const title = document?.stateTitle ?? defaultTitle;
  const message = document?.message ?? (state === "loading" ? "Fetching complete content…" : state === "error" ? "The document could not be opened." : "This document is empty.");
  const semantics = state === "error" ? ' role="alert"' : state === "loading" ? ' role="status" aria-live="polite"' : "";
  return `<section class="document-state document-state-${state}"${semantics}>
    <p class="document-state-label">${state}</p>
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  </section>`;
}

function renderDocumentText(text, kind, language) {
  if (kind === "markdown") return renderMarkdownText(text, "document-prose");
  if (kind === "code" || kind === "diff") {
    return renderHighlightedCode(text, kind === "diff" ? "diff" : language);
  }
  return `<pre class="document-pre document-${kind === "terminal" ? "terminal" : "text"}">${escapeHtml(text)}</pre>`;
}

function renderDocumentBlocks(document) {
  const kind = String(document?.textKind ?? document?.kind ?? "text").toLocaleLowerCase("en-US");
  return document.blocks.map((block) => {
    if (block?.type === "text") {
      return `<section class="document-block document-block-text">${renderDocumentText(String(block.text ?? ""), kind, document?.language)}</section>`;
    }
    if (isMediaBlock(block)) {
      return `<section class="document-block document-block-media">${mediaBlock(block, "document")}</section>`;
    }
    return `<p class="document-state">Unsupported document content: ${escapeHtml(safeType(block?.type))}</p>`;
  }).join("");
}

function renderDocumentContent(document) {
  const state = documentState(document);
  if (state) return state;
  if (Array.isArray(document?.blocks) && document.blocks.length > 0) return renderDocumentBlocks(document);
  const kind = String(document?.kind ?? "text").toLocaleLowerCase("en-US");
  return renderDocumentText(String(document?.text ?? ""), kind, document?.language);
}

/**
 * Plugin-blind full-screen reader. Callers provide only identity, state, and a
 * content kind: markdown, text, code, diff, terminal, media, or mixed.
 */
export function renderDocumentViewer(document, options = {}) {
  const mode = options.mode === "dialog" ? "dialog" : "page";
  const id = String(options.id ?? "document-viewer");
  const headingId = `${id}-heading`;
  const title = document?.title ?? "Document";
  const path = String(document?.path ?? "").trim();
  const identity = document?.identity ?? "read-only document";
  const kind = String(document?.kind ?? "text").toLocaleLowerCase("en-US");
  const closeLabel = options.closeLabel ?? (mode === "dialog" ? "Close" : "Back");
  const closeControl = mode === "dialog"
    ? `<button class="document-viewer-close" type="button" data-document-viewer-close>${escapeHtml(closeLabel)}</button>`
    : `<a class="document-viewer-close" href="${escapeHtml(options.closeHref ?? "#")}">${escapeHtml(closeLabel)}</a>`;
  const downloadHref = String(options.downloadHref ?? "");
  const downloadControl = downloadHref
    ? `<a class="document-viewer-download" aria-label="Download" download="${escapeHtml(options.downloadName ?? title)}" href="${escapeHtml(downloadHref)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 17v4h14v-4"/></svg></a>`
    : "";
  const toolbar = `<header class="document-viewer-toolbar${downloadControl ? " document-viewer-toolbar-with-download" : ""}">
      ${closeControl}
      <div class="document-viewer-identity">
        <p class="document-viewer-kind">${escapeHtml(identity)}</p>
        <h1 id="${escapeHtml(headingId)}" tabindex="-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h1>
        ${path ? `<p class="document-viewer-path" title="${escapeHtml(path)}">${escapeHtml(path)}</p>` : ""}
      </div>
      ${downloadControl}
    </header>`;
  const content = `<div class="document-viewer-content" data-content-kind="${escapeHtml(kind)}">${renderDocumentContent(document)}</div>`;
  if (mode === "dialog") {
    return `<dialog id="${escapeHtml(id)}" class="document-viewer document-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(headingId)}" data-document-viewer>
    ${toolbar}
    ${content}
  </dialog>`;
  }
  return `<main id="${escapeHtml(id)}" class="document-viewer document-viewer-page" aria-labelledby="${escapeHtml(headingId)}" data-document-viewer>
    ${toolbar}
    ${content}
  </main>`;
}

/** Explicit entry affordance for standalone document previews. Tool output cards
 *  use their summary row as the adaptive inline/full-screen entry. */
export function renderDocumentViewerTrigger(viewerId, label = "Open full screen") {
  return `<button class="document-viewer-trigger" type="button" aria-haspopup="dialog" aria-controls="${escapeHtml(viewerId)}" data-document-viewer-open="${escapeHtml(viewerId)}">${escapeHtml(label)}</button>`;
}

function fileProblem(error) {
  const status = Number(error?.status);
  return {
    state: "error",
    stateTitle: status === 413
      ? "File is too large"
      : status === 415 ? "Preview unavailable" : status === 404 ? "File not found" : "File unavailable",
    message: error?.message ?? "The file could not be opened safely.",
  };
}

/** Dedicated project-file route using the generic full-viewport reader. */
export function renderFilePage(view, paths, assetPaths) {
  const file = view?.file;
  const name = file?.name ?? view?.name ?? "file";
  const downloadPath = String(view?.path ?? "");
  const problem = view?.error
    ? fileProblem(view.error)
    : file?.kind === "markdown" || file?.kind === "text" || file?.kind === "code"
      ? {}
      : fileProblem({ status: 415, message: "qq: unsupported file type" });
  const viewer = renderDocumentViewer({
    title: name,
    path: file?.path ?? view?.path ?? "",
    identity: "read-only file",
    kind: file?.kind,
    text: file?.text,
    language: file?.language,
    ...problem,
  }, {
    mode: "page",
    id: "project-file-viewer",
    closeHref: paths.canonical,
    closeLabel: "Back to console",
    downloadHref: downloadPath && paths.fileDownload
      ? `${paths.fileDownload}${encodeURIComponent(downloadPath)}`
      : "",
    downloadName: name,
  });
  return `<!doctype html>
<html lang="en">
${documentHead(assetPaths, `${name} · qq`, { themeColor: "#000000" })}
<body class="document-page">
  ${viewer}
</body>
</html>`;
}

const DOCUMENT_VIEWER_PROOF = Object.freeze({
  yaml: {
    title: "config.yaml",
    path: "config.yaml",
    identity: "read-only file",
    kind: "code",
    language: "yaml",
    text: "name: proof\nindent:\n  nested: true\n  list:\n    - first\n    - second\n",
  },
  line: {
    title: "unbroken.txt",
    path: "unbroken.txt",
    identity: "read-only file",
    kind: "text",
    text: `token=${"abcdefghijklmnopqrstuvwxyz0123456789".repeat(12)}\n`,
  },
  code: {
    title: "sample.js",
    path: "src/sample.js",
    identity: "read-only file",
    kind: "code",
    language: "javascript",
    text: "export function sample(value) {\n  return value === 42;\n}\n",
  },
  diff: {
    title: "git diff",
    path: "src/a.js src/b.js",
    identity: "file changes",
    kind: "diff",
    text: [
      "--- a/src/a.js",
      "+++ b/src/a.js",
      "@@ -1,3 +1,3 @@",
      " export const a = 1;",
      `-${"old-unbroken-line-".repeat(18)}`,
      `+${"new-unbroken-line-".repeat(18)}`,
      "",
      "--- a/src/b.js",
      "+++ b/src/b.js",
      "@@ -1 +1 @@",
      "-export const b = false;",
      "+export const b = true;",
    ].join("\n"),
  },
  terminal: {
    title: "bash",
    identity: "complete tool output",
    kind: "terminal",
    text: Array.from({ length: 80 }, (_, index) => `line ${index + 1} of large terminal output`).join("\n"),
  },
  loading: { title: "README.md", identity: "complete tool output", kind: "text", state: "loading" },
  error: {
    title: "failed.sh",
    identity: "complete tool output",
    kind: "terminal",
    state: "error",
    stateTitle: "Tool failed",
    message: "The command exited with status 2.",
  },
  empty: { title: "empty.txt", identity: "complete tool output", kind: "text", state: "empty" },
});

/** Fixture page that proves the generic content-kind contract T-128 can call. */
export function renderDocumentViewerProofPage(assetPaths) {
  const samples = [
    ["yaml", "YAML"],
    ["line", "Long line"],
    ["code", "Highlighted code"],
    ["diff", "Multi-file diff"],
    ["terminal", "Terminal output"],
    ["loading", "Loading"],
    ["error", "Failure"],
    ["empty", "Empty"],
  ];
  const blocks = samples.map(([key, label]) => {
    const id = `proof-${key}`;
    const document = DOCUMENT_VIEWER_PROOF[key];
    return `<section class="document-viewer-proof-block" data-proof-kind="${key}">
      <header>
        <h2>${escapeHtml(label)}</h2>
        ${renderDocumentViewerTrigger(id)}
      </header>
      <pre class="document-viewer-proof-preview">${escapeHtml(document.text ?? document.message ?? document.stateTitle ?? "")}</pre>
      ${renderDocumentViewer(document, { mode: "dialog", id, closeLabel: "Close" })}
    </section>`;
  }).join("");
  return `<!doctype html>
<html lang="en">
${documentHead(assetPaths, "document viewer proof · qq", { themeColor: "#000000" })}
<body class="document-page">
  <main class="document-viewer-proof">
    <h1>Document viewer proof</h1>
    <p>Open full screen is the only entry. Scrolling, selecting, or tapping a preview never opens it.</p>
    ${blocks}
  </main>
</body>
</html>`;
}

function bodyClass(snapshot) {
  const classes = [];
  if (snapshot?.drawer?.open) classes.push("drawer-open");
  if (snapshot?.caseFile) classes.push("case-open");
  return classes.length ? ` class="${escapeHtml(classes.join(" "))}"` : "";
}

export function renderPage(snapshot, paths, assetPaths, notice = "") {
  const content = renderSessionContent(snapshot, paths, notice);
  const drawer = renderProjectDrawer(snapshot.drawer, paths, livePlaceSet(snapshot));
  const backgroundInert = snapshot?.drawer?.open ? " inert" : "";
  const rail = renderProjectRail(snapshot, paths, Boolean(backgroundInert));
  const caseRegion = snapshot?.id
    ? regionShell("session-case", "session-case", "case", renderCaseRegion(snapshot), Boolean(paths.events))
    : "";
  return `<!doctype html>
<html lang="en">
${documentHead(assetPaths)}
<body${bodyClass(snapshot)}>
  ${drawer}
  ${rail}
  <header class="site-header"${backgroundInert}>
    <a href="${escapeHtml(paths.canonical)}" aria-label="Reload the selected DSH session">qq / DSH</a>
    <span>Sequential handoff</span>
  </header>
  <main id="console-stream"${backgroundInert}${paths.events ? ` hx-ext="sse" sse-connect="${escapeHtml(paths.events)}"` : ""} hx-history="false">
    ${paths.events ? `<div id="ui-generation" hidden sse-swap="ui" hx-swap="none"${assetPaths.uiRevision ? ` data-ui-revision="${escapeHtml(assetPaths.uiRevision)}"` : ""}></div>
    <div id="switch-meta" hidden sse-swap="switch-meta" hx-swap="none"></div>
    <div id="switch-ready" hidden sse-swap="switch-ready" hx-swap="none"></div>` : ""}
    <section id="session-panel" class="session-panel" aria-labelledby="session-heading">${content}</section>
    ${caseRegion}
  </main>
  <footer${backgroundInert}>DSH owns session identity, transcript order, turn status, and interruption. Browser view state is not shared.</footer>
</body>
</html>`;
}
