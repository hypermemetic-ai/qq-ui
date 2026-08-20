import { escapeHtml, renderMarkdownText, renderMessageText } from "./markdown.mjs";

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

function renderSlashNotice(notice, paths) {
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
  if (findWork === "compile" || findWork === "save" || running) {
    const label = findWork === "save"
      ? "Saving…"
      : findWork === "compile"
        ? "Finding…"
        : "The current DSH turn is still running.";
    const submit = findWork ? "Cancel" : "Interrupt";
    return `<form id="interrupt-form" class="composer interrupt-composer" action="${escapeHtml(paths.interrupt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.interrupt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-disabled-elt="#interrupt-submit"
      hx-indicator="#interrupt-working">
      <p>${label}</p>
      <div class="composer-actions">
        <span id="interrupt-working" class="htmx-indicator" aria-live="polite">Interrupting DSH…</span>
        <button id="interrupt-submit" class="button-danger" type="submit">${submit}</button>
      </div>
    </form>`;
  }
  return `<form id="composer" class="composer" action="${escapeHtml(paths.prompt)}" method="post"
      data-session-id="${escapeHtml(sessionId)}"
      hx-post="${escapeHtml(paths.prompt)}"
      hx-target="#session-panel"
      hx-swap="innerHTML"
      hx-push-url="${escapeHtml(paths.canonical)}"
      hx-disabled-elt="#composer-submit"
      hx-indicator="#working">
      <label for="prompt">Message</label>
      <div class="composer-row">
        <textarea id="prompt" name="prompt" rows="1" maxlength="32768" required autocomplete="off" enterkeyhint="send" placeholder="Message this DSH session"></textarea>
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
        <span id="working" class="htmx-indicator" aria-live="polite">Waiting for DSH…</span>
        <span class="key-hint">Enter to send · Shift+Enter for a new line</span>
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
  const transcript = events.map(eventMessage).filter(Boolean).join("\n");
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
    ${renderSlashNotice(notice, paths)}
    ${emptyProject ? "" : `<div id="transcript" class="transcript" aria-live="polite" aria-label="Session transcript" hx-history="false">
      ${transcript || '<p class="empty-transcript">This DSH session has no transcript yet.</p>'}
    </div>`}
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
  <meta name="htmx-config" content='{"disableInheritance":true,"historyCacheSize":0,"responseHandling":[{"code":"204","swap":false},{"code":"[23]..","swap":true},{"code":"409","swap":true},{"code":"[45]..","swap":false,"error":true}]}'>
  <title>qq</title>
  <link rel="manifest" href="${escapeHtml(assetPaths.manifest)}">
  <link rel="icon" href="${escapeHtml(assetPaths.icon192)}" sizes="192x192">
  <link rel="apple-touch-icon" href="${escapeHtml(assetPaths.icon192)}">
  <link rel="stylesheet" href="${escapeHtml(assetPaths.css)}">
  <script defer src="${escapeHtml(assetPaths.htmx)}"></script>
  <script defer src="${escapeHtml(assetPaths.sse)}"></script>
  <script defer src="${escapeHtml(assetPaths.browser)}" data-service-worker="${escapeHtml(assetPaths.serviceWorker)}"></script>
  <script defer src="/qq/dictate/client.js"></script>
</head>
<body>
  <header class="site-header">
    <a href="${escapeHtml(paths.canonical)}" aria-label="Reload the selected DSH session">qq / DSH</a>
    <span>Sequential handoff</span>
  </header>
  <main id="console-stream"${paths.events ? ` hx-ext="sse" sse-connect="${escapeHtml(paths.events)}"` : ""} hx-history="false">
    <section id="session-panel" class="session-panel" aria-labelledby="session-heading"${paths.events ? `
      hx-ext="sse" sse-swap="session" hx-swap="innerHTML"` : ""}>${content}</section>
  </main>
  <footer>DSH owns session identity, transcript order, turn status, and interruption. Browser view state is not shared.</footer>
</body>
</html>`;
}
