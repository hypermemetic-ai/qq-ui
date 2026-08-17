import { escapeHtml, renderMarkdownText, renderMessageText } from "./markdown.mjs";

export { escapeHtml };

function safeType(value) {
  return typeof value === "string" ? value : "unknown";
}

function contentBlocks(blocks, { markdown = false } = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return '<p class="empty-content">No displayable content</p>';
  }
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") {
        return '<p class="empty-content">Unsupported content</p>';
      }
      switch (block.type) {
        case "text":
          return markdown ? renderMarkdownText(block.text ?? "") : renderMessageText(block.text ?? "");
        case "reasoning":
          return `<details class="reasoning"><summary>Reasoning</summary>${renderMessageText(block.text ?? "")}</details>`;
        case "tool-call":
          return `<details class="tool"><summary>Tool: ${escapeHtml(block.name ?? "unknown")}</summary><pre>${escapeHtml(block.arguments ?? "")}</pre></details>`;
        case "tool-result":
          return `<details class="tool${block.isError ? " tool-error" : ""}" open><summary>Tool result${block.isError ? " — error" : ""}</summary>${contentBlocks(block.content)}</details>`;
        case "image": {
          const attachment = block.attachment ?? {};
          const dimensions =
            Number.isFinite(attachment.width) && Number.isFinite(attachment.height)
              ? ` ${attachment.width}×${attachment.height}`
              : "";
          return `<p class="attachment">Image attachment${escapeHtml(dimensions)}</p>`;
        }
        default:
          return `<p class="empty-content">Unsupported content: ${escapeHtml(safeType(block.type))}</p>`;
      }
    })
    .join("");
}

function eventTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function eventMessage(event) {
  if (event?.surfaceOp !== "append") return "";
  const time = eventTime(event.time);
  const timeElement = time
    ? `<time datetime="${time}">${escapeHtml(time)}</time>`
    : "";
  if (event.type === "user/message") {
    const source = event.data?.source;
    const direct = source?.kind === "user";
    if (!direct) {
      const label = `Context · ${source?.plugin ?? source?.kind ?? "unknown"}`;
      return `<details class="message message-context" data-seq="${escapeHtml(event.seq)}">
        <summary><strong>${escapeHtml(label)}</strong>${timeElement}</summary>
        <div class="message-body">${contentBlocks(event.data?.content)}</div>
      </details>`;
    }
    const accessibleLabel = time ? `Your message at ${time}` : "Your message";
    return `<article class="message message-user" data-seq="${escapeHtml(event.seq)}" aria-label="${escapeHtml(accessibleLabel)}">
      ${contentBlocks(event.data?.content)}
    </article>`;
  }
  if (event.type === "assistant/message") {
    const accessibleLabel = time ? `Assistant message at ${time}` : "Assistant message";
    return `<article class="message message-assistant" data-seq="${escapeHtml(event.seq)}" aria-label="${escapeHtml(accessibleLabel)}">
      ${contentBlocks(event.data?.message?.content, { markdown: true })}
    </article>`;
  }
  if (event.type === "tool/result") {
    return `<details class="message message-tool" data-seq="${escapeHtml(event.seq)}">
      <summary><strong>Tool result</strong>${timeElement}</summary>
      <div class="message-body">${contentBlocks(event.data?.message?.content)}</div>
    </details>`;
  }
  return "";
}

function safeTurnFailure(code) {
  switch (code) {
    case "INVALID_REQUEST":
      return "The selected model route rejected this request. Check the message or route compatibility, then try again.";
    case "INVALID_CREDENTIAL":
    case "MISSING_CREDENTIAL":
    case "AUTH":
      return "The selected model route could not authenticate. Check the workbench credential, then try again.";
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

function sessionNavigation(snapshot, paths) {
  const choices = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  return `<details class="session-menu">
    <summary aria-label="Show session controls"><span>Sessions</span></summary>
    <div class="session-controls" role="group" aria-label="Session controls">
      <form class="session-picker" action="${escapeHtml(paths.switchSession)}" method="get">
        <label for="session-choice">Session <span>${choices.length} durable</span></label>
        <select id="session-choice" name="session" required>
          ${choices.map((session) => {
            const current = session.id === snapshot.id;
            const created = Number.isFinite(session.createdAt) && session.createdAt > 0
              ? eventTime(session.createdAt).slice(0, 10)
              : "durable";
            const label = `${current ? "Current · " : ""}${created} · ${session.id}`;
            return `<option value="${escapeHtml(session.id)}"${current ? " selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
        <button type="submit">Open</button>
      </form>
      <form class="new-session" action="${escapeHtml(paths.createSession)}" method="post">
        <button type="submit" aria-label="Start a new durable DSH session">New <span>session</span></button>
      </form>
    </div>
  </details>`;
}

function composer(paths, running) {
  if (running) {
    return `<form id="interrupt-form" class="composer interrupt-composer" action="${escapeHtml(paths.interrupt)}" method="post"
      hx-post="${escapeHtml(paths.interrupt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-disabled-elt="#interrupt-submit"
      hx-indicator="#interrupt-working">
      <p>The current DSH turn is still running.</p>
      <div class="composer-actions">
        <span id="interrupt-working" class="htmx-indicator" aria-live="polite">Interrupting DSH…</span>
        <button id="interrupt-submit" class="button-danger" type="submit">Interrupt</button>
      </div>
    </form>`;
  }
  return `<form id="composer" class="composer" action="${escapeHtml(paths.prompt)}" method="post"
      hx-post="${escapeHtml(paths.prompt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-push-url="${escapeHtml(paths.canonical)}"
      hx-disabled-elt="#composer-submit"
      hx-indicator="#working">
      <label for="prompt">Message</label>
      <div class="composer-row">
        <textarea id="prompt" name="prompt" rows="1" maxlength="32768" required autocomplete="off" enterkeyhint="send" placeholder="Message this DSH session"></textarea>
        <button id="composer-submit" type="submit">Send</button>
      </div>
      <div class="composer-meta">
        <span id="working" class="htmx-indicator" aria-live="polite">Waiting for DSH…</span>
        <span class="key-hint">Enter to send · Shift+Enter for a new line</span>
      </div>
    </form>`;
}

/** Render only the stable SSE target's children. */
export function renderSessionContent(snapshot, paths, notice = "") {
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const status = deriveStatus(events, snapshot.agentStatus);
  const transcript = events.map(eventMessage).filter(Boolean).join("\n");
  return `<div class="session-heading">
      <div>
        <p class="eyebrow">DSH durable session</p>
        <h1 id="session-heading">Operator console</h1>
        <code>${escapeHtml(snapshot.id)}</code>
      </div>
      <p class="status status-${escapeHtml(status.key)}" role="status"><span class="status-dot" aria-hidden="true"></span><span class="status-label">${escapeHtml(status.label)}</span></p>
      ${sessionNavigation(snapshot, paths)}
    </div>
    ${status.detail ? `<p class="notice turn-error" role="alert"><strong>${escapeHtml(status.label)}</strong><span>${escapeHtml(status.detail)}</span>${status.code ? `<code>${escapeHtml(status.code)}</code>` : ""}</p>` : ""}
    ${notice ? `<p class="notice" role="alert">${escapeHtml(notice)}</p>` : ""}
    <div id="transcript" class="transcript" aria-live="polite" aria-label="Session transcript" hx-history="false">
      ${transcript || '<p class="empty-transcript">This DSH session has no transcript yet.</p>'}
    </div>
    ${composer(paths, status.key === "running")}`;
}

export function renderPage(snapshot, paths, assetPaths, notice = "") {
  const content = renderSessionContent(snapshot, paths, notice);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#0d1216">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="qq">
  <meta name="application-name" content="qq">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="htmx-config" content='{"disableInheritance":true,"historyCacheSize":0}'>
  <title>qq</title>
  <link rel="manifest" href="${escapeHtml(assetPaths.manifest)}">
  <link rel="icon" href="${escapeHtml(assetPaths.icon192)}" sizes="192x192">
  <link rel="apple-touch-icon" href="${escapeHtml(assetPaths.icon192)}">
  <link rel="stylesheet" href="${escapeHtml(assetPaths.css)}">
  <script defer src="${escapeHtml(assetPaths.htmx)}"></script>
  <script defer src="${escapeHtml(assetPaths.sse)}"></script>
  <script defer src="${escapeHtml(assetPaths.browser)}" data-service-worker="${escapeHtml(assetPaths.serviceWorker)}"></script>
</head>
<body>
  <header class="site-header">
    <a href="${escapeHtml(paths.canonical)}" aria-label="Reload the selected DSH session">qq / DSH</a>
    <span>Sequential handoff</span>
  </header>
  <main id="console-stream" hx-ext="sse" sse-connect="${escapeHtml(paths.events)}" hx-history="false">
    <section id="session-panel" class="session-panel" aria-labelledby="session-heading"
      hx-ext="sse" sse-swap="session" hx-swap="innerHTML">${content}</section>
  </main>
  <footer>DSH owns session identity, transcript order, turn status, and interruption. Browser view state is not shared.</footer>
</body>
</html>`;
}
