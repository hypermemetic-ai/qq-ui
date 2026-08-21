import { escapeHtml, renderHighlightedCode, renderMarkdownText, renderMessageText } from "./markdown.mjs";

export { escapeHtml };

/** One-line host-wide download chip. Idle (missing/empty) renders nothing. */
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
  return `${preview}<details class="tool-output-full">
    <summary>Show full output · ${output.lines} lines · ${formatBytes(output.bytes)}</summary>
    <pre>${escapeHtml(output.text)}</pre>
  </details>`;
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

function renderToolContent(node) {
  const preferred = toolViewBlocks(node.resultView);
  const blocks = preferred.length > 0 ? preferred : (Array.isArray(node.content) ? node.content : []);
  const rendered = blocks.map((block) => {
    if (block?.type === "text") return renderToolText(block.text ?? "");
    if (block?.type === "image") return attachmentBlock(block);
    return `<p class="empty-content">Unsupported tool output: ${escapeHtml(safeType(block?.type))}</p>`;
  }).join("");
  if (rendered) return rendered;
  if (node.status === "running") return '<p class="tool-empty">Waiting for result</p>';
  if (node.status === "stopped") return '<p class="tool-empty">Stopped before completion</p>';
  if (node.status === "error") return '<p class="tool-empty">The tool failed without displayable output</p>';
  return '<p class="tool-empty">Completed with no output</p>';
}

function contextLabel(source) {
  return `Context · ${source?.plugin ?? source?.kind ?? "unknown"}`;
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
    return `<details class="message message-context" data-seq="${seq}">
      <summary><strong>${escapeHtml(contextLabel(node.source))}</strong>${timeElement(node.time)}</summary>
      <div class="message-body">${contentBlocks(node.content)}</div>
    </details>`;
  }
  if (node?.kind === "assistant") {
    const streaming = node.status === "streaming";
    const blocks = (Array.isArray(node.blocks) ? node.blocks : []).map((block) => {
      if (block?.type === "text") return renderMarkdownText(block.text ?? "");
      if (block?.type === "reasoning" && String(block.text ?? "").trim()) {
        return `<section class="assistant-reasoning" aria-label="Reasoning">
          <p class="reasoning-label">Reasoning</p>
          ${renderMessageText(block.text)}
        </section>`;
      }
      if (block?.type === "image") return attachmentBlock(block);
      return "";
    }).join("");
    const accessibleLabel = time ? `Assistant message at ${time}` : "Assistant message";
    return `<article class="message message-assistant${streaming ? " message-streaming" : ""}${node.status === "interrupted" ? " message-interrupted" : ""}" data-seq="${seq}" data-turn="${escapeHtml(node.turn ?? "")}" data-step="${escapeHtml(node.step ?? "")}" aria-label="${escapeHtml(accessibleLabel)}"${streaming ? ' aria-busy="true"' : ""}>
      ${blocks}
    </article>`;
  }
  if (node?.kind === "tool") {
    const state = node.status === "success" ? "Completed" : node.status === "running" ? "Running" : node.status === "stopped" ? "Stopped" : "Failed";
    const card = node.resultView?.card ?? node.callView?.card ?? "generic";
    const title = node.resultView?.title ?? node.callView?.title ?? node.name ?? "unknown";
    const argument = node.argumentSummary
      && !String(title).toLocaleLowerCase().includes(String(node.argumentSummary).toLocaleLowerCase())
      ? `<span class="tool-argument">${escapeHtml(node.argumentSummary)}</span>`
      : "";
    const terminal = node.resultView?.card === "terminal" ? node.resultView : null;
    const exit = terminal && Number.isFinite(terminal.exitCode)
      ? `<span class="tool-exit">exit ${terminal.exitCode}</span>`
      : terminal?.signal ? `<span class="tool-exit">${escapeHtml(terminal.signal)}</span>` : "";
    return `<details class="message message-tool tool-${escapeHtml(node.status)}" data-seq="${seq}" data-call-id="${escapeHtml(node.callId ?? "")}" data-card="${escapeHtml(card)}"${node.expanded ? " open" : ""}>
      <summary><span class="tool-state">${state}</span><strong>${escapeHtml(title)}</strong>${argument}${exit}</summary>
      <div class="message-body">${renderToolContent(node)}</div>
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

function renderPendingQueue(snapshot, paths) {
  const pending = Array.isArray(snapshot?.conversation?.pending) ? snapshot.conversation.pending : [];
  if (pending.length === 0) return "";
  const action = escapeHtml(paths.queue ?? "");
  const mutable = snapshot.canMutatePending === true && Boolean(paths.queue);
  const rows = pending.map((item, index) => {
    const id = escapeHtml(item.id ?? "");
    const label = item.placement === "steering" ? "Steering" : "Queued";
    const edit = mutable && item.editable
      ? `<form class="queue-edit" action="${action}" method="post" hx-post="${action}" hx-target="#session-panel" hx-swap="innerHTML" hx-disabled-elt="find button">
          <input type="hidden" name="operation" value="edit">
          <input type="hidden" name="itemId" value="${id}">
          <label for="queue-text-${index}">Edit pending message ${index + 1}</label>
          <textarea id="queue-text-${index}" class="queue-edit-text" name="text" rows="1" maxlength="32768" required data-message-id="${id}">${escapeHtml(item.text ?? "")}</textarea>
          <button type="submit" aria-label="Save pending message ${index + 1}">Save</button>
        </form>`
      : `<p class="queue-preview">${escapeHtml(item.text || "Pending message")}</p>`;
    const remove = mutable
      ? `<form class="queue-remove" action="${action}" method="post" hx-post="${action}" hx-target="#session-panel" hx-swap="innerHTML" hx-disabled-elt="find button">
          <input type="hidden" name="itemId" value="${id}">
          <button type="submit" name="operation" value="remove" aria-label="Remove pending message ${index + 1}">Remove</button>
        </form>`
      : "";
    return `<li class="queue-item" data-message-id="${id}"><span class="queue-kind">${label}</span>${edit}${remove}</li>`;
  }).join("");
  return `<section id="pending-queue" class="pending-queue" aria-labelledby="pending-queue-heading">
    <header><h2 id="pending-queue-heading">Pending messages</h2><span>${pending.length}</span></header>
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

export function deriveStatus(events, agentStatus) {
  let openTurn;
  let lastEnd;
  for (const event of events) {
    if (event?.type === "turn/start") openTurn = event.data?.turn;
    if (event?.type === "turn/end") {
      if (openTurn === event.data?.turn) openTurn = undefined;
      lastEnd = event.data?.reason;
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

function sessionNavigation(snapshot, paths) {
  const choices = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const switchAction = escapeHtml(paths.switchSession);
  const selected = snapshot.id
    ? choices.find((session) => session.id === snapshot.id) ?? snapshot
    : undefined;
  const face = selected ? sessionFace(selected) : "";
  const picker = snapshot.id && choices.length > 0
    ? `<form class="session-picker" action="${switchAction}" method="get">
        <label for="session-choice">sessions <span>${choices.length} live</span></label>
        <select id="session-choice" name="session" required>
          ${choices.map((session) => {
            const current = session.id === snapshot.id;
            const optionFace = sessionFace(session);
            const label = `${current ? "Current · " : ""}${optionFace}`;
            return `<option value="${escapeHtml(session.id)}"${current ? " selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
      </form>`
    : `<p class="session-empty">no live sessions</p>`;
  const closeControls = snapshot.id && paths.close
    ? `<button type="button" class="close-arm" aria-label="Close this session">close</button>
      <div class="close-confirm" hidden role="alertdialog" aria-modal="true" aria-labelledby="close-confirm-title" aria-describedby="close-confirm-copy">
        <p id="close-confirm-title">close session ${escapeHtml(face)}?</p>
        <p id="close-confirm-copy">history is kept</p>
        <div class="close-confirm-actions">
          <button type="button" class="close-keep" aria-label="Keep this session">keep</button>
          <form id="close-session" class="close-session" action="${escapeHtml(paths.close)}" method="post">
            <button type="submit" class="close-confirm-submit" aria-label="Close this session">close</button>
          </form>
        </div>
      </div>`
    : "";
  return `<details class="session-menu">
    <summary aria-label="Show session controls"><span>sessions</span></summary>
    <div class="session-controls" role="group" aria-label="Session controls">
      ${picker}
      <form class="new-session" action="${escapeHtml(paths.createSession)}" method="post">
        <button type="submit" aria-label="New session">+</button>
      </form>
      ${closeControls}
    </div>
  </details>`;
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
        hx-target="#session-panel"
        hx-swap="innerHTML"
        hx-disabled-elt=".login-choice">
        ${buttons}
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
        <p class="eyebrow">Ready leftover</p>
        <h2 id="offer-heading">${escapeHtml(offer.title || "Hand off, bank, or ignore")}</h2>
      </header>
      <div class="offer-brief" tabindex="0">
        ${renderMessageText(offer.brief)}
        ${runner}
      </div>
      ${refusal}
      <form class="offer-actions" action="${action}" method="post"
        hx-post="${action}"
        hx-target="#session-panel"
        hx-swap="innerHTML"
        hx-disabled-elt=".offer-choice">
        <button class="offer-choice offer-handoff" type="submit" name="choice" value="handoff">Hand off</button>
        <button class="offer-choice offer-bank" type="submit" name="choice" value="bank">Bank</button>
        <button class="offer-choice offer-ignore" type="submit" name="choice" value="ignore">Ignore</button>
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
        hx-target="#session-panel"
        hx-swap="innerHTML"
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

function sessionModeChip(mode) {
  if (typeof mode !== "string" || mode === "none" || !/^[a-z][a-z0-9-]{0,31}$/.test(mode)) return "";
  const label = `${mode[0].toUpperCase()}${mode.slice(1)}`;
  return `<p class="session-mode" data-mode="${mode}">${label}</p>`;
}

function composer(paths, running, sessionId = "", findWork = "") {
  if (findWork === "compile" || findWork === "save") {
    const label = findWork === "save" ? "Saving…" : "Finding…";
    return `<form id="interrupt-form" class="composer interrupt-composer" action="${escapeHtml(paths.interrupt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.interrupt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-disabled-elt="#interrupt-submit"
      hx-indicator="#interrupt-working">
      <p>${label}</p>
      <div class="composer-actions">
        <span id="interrupt-working" class="htmx-indicator" aria-live="polite">Cancelling…</span>
        <button id="interrupt-submit" class="button-danger" type="submit">Cancel</button>
      </div>
    </form>`;
  }
  const interrupt = running
    ? `<form id="interrupt-form" class="interrupt-proxy" action="${escapeHtml(paths.interrupt)}" method="post"
        data-session-id="${escapeHtml(sessionId)}"
        hx-post="${escapeHtml(paths.interrupt)}"
        hx-target="#session-panel"
        hx-swap="innerHTML"
        hx-disabled-elt="#interrupt-submit"
        hx-indicator="#interrupt-working"></form>`
    : "";
  return `${interrupt}<form id="composer" class="composer${running ? " composer-running" : ""}" action="${escapeHtml(paths.prompt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.prompt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-push-url="${escapeHtml(paths.canonical)}"
      hx-disabled-elt="#composer-submit"
      hx-indicator="#working">
      <label for="prompt">Message</label>
      <div class="composer-row">
        <textarea id="prompt" name="prompt" rows="1" maxlength="32768" required autocomplete="off" enterkeyhint="send" placeholder="${running ? "Steer this running turn" : "Message this DSH session"}"></textarea>
        <button id="composer-dictate" type="button" data-state="idle" aria-label="Dictate">
          <svg class="dictate-mic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/>
          </svg>
          <svg class="dictate-cancel" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M18.3 5.71 12 12.01 5.7 5.7 4.29 7.11 10.59 13.4 4.29 19.7 5.7 21.11 12 14.82l6.3 6.29 1.41-1.41-6.29-6.3 6.29-6.29z"/>
          </svg>
        </button>
        <button id="composer-submit" type="submit">Send</button>
      </div>
      <div class="composer-meta">
        <span id="working" class="htmx-indicator" aria-live="polite">Admitting message…</span>
        <span id="dictation-status" class="dictation-status" data-state="idle" role="status" aria-live="polite" aria-atomic="true" hidden></span>
        <span class="key-hint">${running ? "Enter steers at the next safe step" : "Enter to send"} · Shift+Enter for a new line</span>
        ${running ? `<span id="interrupt-working" class="htmx-indicator" aria-live="polite">Interrupting DSH…</span><button id="interrupt-submit" class="button-danger composer-interrupt" type="submit" form="interrupt-form">Interrupt</button>` : ""}
      </div>
    </form>`;
}

/** Render only the stable SSE target's children. */
export function renderSessionContent(snapshot, paths, notice = "") {
  const emptyProject = !snapshot?.id;
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const status = emptyProject
    ? { key: "ready", label: "Ready · no sessions" }
    : deriveStatus(events, snapshot.agentStatus);
  const nodes = Array.isArray(snapshot?.conversation?.nodes) ? snapshot.conversation.nodes : [];
  const transcript = nodes.map(renderConversationNode).filter(Boolean).join("\n");
  const findWork = snapshot.findWork === "save" ? "save" : snapshot.findWork === "compile" ? "compile" : "";
  const face = emptyProject ? (snapshot.project || "project") : liveFace(snapshot);
  return `<div class="session-heading">
      <div>
        <p class="eyebrow">${emptyProject ? "qq project" : "DSH durable session"}</p>
        ${sessionModeChip(snapshot.sessionMode)}
        <h1 id="session-heading">Operator console</h1>
        <code>${escapeHtml(face)}</code>
        ${renderProgressChip(snapshot.progress)}
      </div>
      <p class="status status-${escapeHtml(status.key)}" role="status"><span class="status-dot" aria-hidden="true"></span><span class="status-label">${escapeHtml(status.label)}</span></p>
      ${sessionNavigation(snapshot, paths)}
    </div>
    ${status.detail ? `<p class="notice turn-error" role="alert"><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(status.detail)}</span>${status.code ? `<code>${escapeHtml(status.code)}</code>` : ""}</p>` : ""}
    ${renderSlashNotice(notice, paths, nodes)}
    ${emptyProject ? "" : `<div id="transcript" class="transcript" aria-live="polite" aria-label="Session transcript" hx-history="false">
      ${transcript || '<p class="empty-transcript">This DSH session has no transcript yet.</p>'}
    </div>`}
    ${emptyProject ? "" : renderPendingQueue(snapshot, paths)}
    ${emptyProject ? "" : composer(paths, status.key === "running", snapshot.id, findWork)}
    ${renderLoginSheet(snapshot.loginSheet, paths)}
    ${renderOfferPopup(snapshot.offer, paths, notice)}
    ${renderOverlay(snapshot.overlay, paths, notice, findWork)}`;
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
          hx-target="#session-panel"
          hx-swap="innerHTML">
          <button type="submit">Cancel</button>
        </form>`
    : "";
  const stage = chrome
    ? `<div class="overlay-stage"><img src="${src}" alt="${alt}"${fit}></div>`
    : `<form class="overlay-stage overlay-stage-hit" action="${action}" method="post"
        hx-post="${action}"
        hx-target="#session-panel"
        hx-swap="innerHTML">
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
          hx-target="#session-panel"
          hx-swap="innerHTML">
          <button type="submit" name="choice" value="dismiss" aria-label="Close">×</button>
        </form>
      </header>
      ${stage}
      ${refusal}
      <form class="offer-actions overlay-actions" action="${action}" method="post"
        hx-post="${action}"
        hx-target="#session-panel"
        hx-swap="innerHTML"
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
    return `${paths.projectsBase}/${encodeURIComponent(entry.project ?? entry.name)}${drawerQuery("")}`;
  }
  if (entry.type === "directory") return `${paths.canonical}${drawerQuery(entry.path)}`;
  const root = entry.kind === "binary" ? paths.fileOpen : paths.fileView;
  return `${root}${encodeURIComponent(entry.path)}`;
}

function drawerKind(entry) {
  if (entry.type === "project") return "project";
  if (entry.type === "directory") return "dir";
  if (entry.kind === "markdown") return "md";
  if (entry.kind === "text") return "txt";
  if (entry.kind === "code") return "code";
  if (entry.kind === "binary") return "open";
  return "file";
}

/** Render one non-recursive project level. Descendants are never embedded. */
export function renderProjectDrawer(drawer, paths) {
  if (!drawer || !Array.isArray(drawer.entries)) return "";
  const opened = drawer.open === true;
  const breadcrumbs = Array.isArray(drawer.breadcrumbs) ? drawer.breadcrumbs : [];
  const breadcrumbHtml = breadcrumbs.map((crumb, index) => {
    const current = index === breadcrumbs.length - 1;
    const label = crumb.type === "projects" ? "~/projects" : crumb.name;
    let href = `${paths.canonical}${drawerQuery("~")}`;
    if (crumb.type === "project") {
      href = `${paths.projectsBase}/${encodeURIComponent(drawer.project)}${drawerQuery("")}`;
    } else if (crumb.type === "directory") {
      href = `${paths.canonical}${drawerQuery(crumb.path)}`;
    }
    return `<li>${current
      ? `<span aria-current="page" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
      : `<a href="${escapeHtml(href)}" title="${escapeHtml(label)}">${escapeHtml(label)}</a>`}</li>`;
  }).join("");
  const upPath = drawer.scope === "projects"
    ? ""
    : drawer.path ? drawer.parent : "~";
  const up = drawer.scope === "projects" ? "" : `<a class="drawer-up" href="${escapeHtml(`${paths.canonical}${drawerQuery(upPath)}`)}" aria-label="Up one level">
      <span aria-hidden="true">↑</span><span>up</span>
    </a>`;
  const rows = drawer.entries.map((entry) => {
    const href = drawerEntryHref(entry, drawer, paths);
    const action = entry.type === "directory" ? "Open folder" : entry.type === "project" ? "Open project" : entry.kind === "binary" ? "Open file" : "Read file";
    return `<li><a class="drawer-entry" data-entry-type="${escapeHtml(entry.type)}" data-file-kind="${escapeHtml(entry.kind ?? "")}" href="${escapeHtml(href)}" aria-label="${escapeHtml(`${action} ${entry.name}`)}">
      <span class="drawer-kind" aria-hidden="true">${drawerKind(entry)}</span>
      <span class="drawer-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</span>
    </a></li>`;
  }).join("");
  const empty = rows || '<li class="drawer-empty">nothing at this level</li>';
  return `<button id="project-drawer-toggle" class="drawer-toggle" type="button" aria-controls="project-drawer" aria-expanded="${opened ? "true" : "false"}"${opened ? " inert" : ""}>files</button>
  <button id="project-drawer-backdrop" class="drawer-backdrop" type="button" aria-label="Close files"${opened ? "" : " hidden"}></button>
  <aside id="project-drawer" class="project-drawer" role="dialog" aria-modal="true" aria-hidden="${opened ? "false" : "true"}" aria-labelledby="project-drawer-title" data-drawer-path="${escapeHtml(drawer.scope === "projects" ? "~" : drawer.path)}"${opened ? "" : " inert"}>
    <header class="drawer-head">
      <div>
        <p class="eyebrow">project files</p>
        <h2 id="project-drawer-title" tabindex="-1">browse</h2>
      </div>
      <button class="drawer-close" type="button" aria-label="Close files">×</button>
    </header>
    <nav class="drawer-breadcrumbs" aria-label="File location"><ol>${breadcrumbHtml}</ol></nav>
    ${up}
    <ul class="drawer-list">${empty}</ul>
  </aside>`;
}

function documentHead(assetPaths, title = "qq", options = {}) {
  const themeColor = options.themeColor ?? "#0d1216";
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="${escapeHtml(themeColor)}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="qq">
  <meta name="application-name" content="qq">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="htmx-config" content='{"disableInheritance":true,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"409","swap":true},{"code":"[45]..","swap":false,"error":true}]}'>
  <title>${escapeHtml(title)}</title>
  <link rel="manifest" href="${escapeHtml(assetPaths.manifest)}">
  <link rel="icon" href="${escapeHtml(assetPaths.icon192)}" sizes="192x192">
  <link rel="apple-touch-icon" href="${escapeHtml(assetPaths.icon192)}">
  <link rel="stylesheet" href="${escapeHtml(assetPaths.css)}">
  <script defer src="${escapeHtml(assetPaths.htmx)}"></script>
  <script defer src="${escapeHtml(assetPaths.sse)}"></script>
  <script defer src="${escapeHtml(assetPaths.browser)}" data-service-worker="${escapeHtml(assetPaths.serviceWorker)}"></script>
  <script defer src="/qq/dictate/client.js"></script>
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

function renderDocumentContent(document) {
  const state = documentState(document);
  if (state) return state;
  const kind = String(document?.kind ?? "text").toLocaleLowerCase("en-US");
  const text = String(document?.text ?? "");
  if (kind === "markdown") return renderMarkdownText(text, "document-prose");
  if (kind === "code" || kind === "diff") {
    return renderHighlightedCode(text, kind === "diff" ? "diff" : document?.language);
  }
  return `<pre class="document-pre document-${kind === "terminal" ? "terminal" : "text"}">${escapeHtml(text)}</pre>`;
}

/**
 * Plugin-blind full-screen reader. Callers provide only identity, state, and a
 * content kind: markdown, text, code, diff, or terminal.
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
  const toolbar = `<header class="document-viewer-toolbar">
      ${closeControl}
      <div class="document-viewer-identity">
        <p class="document-viewer-kind">${escapeHtml(identity)}</p>
        <h1 id="${escapeHtml(headingId)}" tabindex="-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h1>
        ${path ? `<p class="document-viewer-path" title="${escapeHtml(path)}">${escapeHtml(path)}</p>` : ""}
      </div>
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

/** The only built-in entry affordance; content surfaces are never tap targets. */
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

export function renderPage(snapshot, paths, assetPaths, notice = "") {
  const content = renderSessionContent(snapshot, paths, notice);
  const drawer = renderProjectDrawer(snapshot.drawer, paths);
  const backgroundInert = snapshot?.drawer?.open ? " inert" : "";
  return `<!doctype html>
<html lang="en">
${documentHead(assetPaths)}
<body${snapshot?.drawer?.open ? ' class="drawer-open"' : ""}>
  ${drawer}
  <header class="site-header"${backgroundInert}>
    <a href="${escapeHtml(paths.canonical)}" aria-label="Reload the selected DSH session">qq / DSH</a>
    <span>Sequential handoff</span>
  </header>
  <main id="console-stream"${backgroundInert}${paths.events ? ` hx-ext="sse" sse-connect="${escapeHtml(paths.events)}"` : ""} hx-history="false">
    <section id="session-panel" class="session-panel" aria-labelledby="session-heading"${paths.events ? `
      hx-ext="sse" sse-swap="session" hx-swap="innerHTML"` : ""}>${content}</section>
  </main>
  <footer${backgroundInert}>DSH owns session identity, transcript order, turn status, and interruption. Browser view state is not shared.</footer>
</body>
</html>`;
}
