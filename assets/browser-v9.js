(() => {
  "use strict";

  const ownScript = document.currentScript;
  const desktopChair = () => window.matchMedia("(min-width: 42.01rem)").matches;
  const composer = () => document.querySelector("#prompt");
  const completeSlash = async (input) => {
    if (!(input instanceof HTMLTextAreaElement)) return;
    const line = input.value;
    if (!line.startsWith("/")) return;
    const action = input.form?.getAttribute("action") ?? "";
    if (!action.endsWith("/prompt")) return;
    const url = new URL(action.replace(/\/prompt$/, "/complete"), location.href);
    url.searchParams.set("line", line);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const body = await response.json();
      if (typeof body.completed !== "string" || body.completed === line) return;
      input.value = body.completed;
      const cursor = body.completed.length;
      input.setSelectionRange(cursor, cursor);
      fitComposer(input);
    } catch {
      /* completion is best-effort */
    }
  };
  const fitComposer = (input = composer(), { shrink = true } = {}) => {
    if (!(input instanceof HTMLTextAreaElement)) return;
    const extras = input.offsetHeight - input.clientHeight;
    if (!shrink) {
      const next = input.scrollHeight + extras;
      if (next > input.offsetHeight) input.style.height = `${next}px`;
      return;
    }
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + extras}px`;
  };
  try { history.scrollRestoration = "manual"; } catch {}
  const transcriptBottomGap = 48;
  let transcriptView = { follow: true, top: 0 };
  let transcriptProgrammatic = false;
  let transcriptSizeObserver = null;
  const atTranscriptBottom = (transcript) =>
    transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= transcriptBottomGap;
  const showLatest = () => {
    const transcript = document.querySelector("#transcript");
    if (!transcript) return;
    transcriptProgrammatic = true;
    transcript.scrollTop = transcript.scrollHeight;
    transcriptView = { follow: true, top: transcript.scrollTop };
    requestAnimationFrame(() => { transcriptProgrammatic = false; });
  };
  const followLatest = () => {
    if (!transcriptView.follow) return;
    showLatest();
    requestAnimationFrame(() => {
      if (transcriptView.follow) showLatest();
    });
  };
  const anchorTranscript = () => {
    transcriptView = { follow: true, top: 0 };
    followLatest();
  };
  const captureTranscriptView = (transcript = document.querySelector("#transcript")) => {
    if (!transcript || transcriptProgrammatic) return;
    // Swaps and token paint must not unanchor. Only a user scroll does that.
    if (transcriptView.follow) return;
    transcriptView = { follow: false, top: transcript.scrollTop };
  };
  const onTranscriptUserScroll = (transcript) => {
    if (!transcript || transcriptProgrammatic) return;
    transcriptView = {
      follow: atTranscriptBottom(transcript),
      top: transcript.scrollTop,
    };
  };
  const bindTranscriptFollow = () => {
    const transcript = document.querySelector("#transcript");
    if (!transcript || typeof ResizeObserver !== "function") return;
    if (!transcriptSizeObserver) {
      transcriptSizeObserver = new ResizeObserver(() => {
        if (transcriptView.follow) showLatest();
      });
    } else {
      transcriptSizeObserver.disconnect();
    }
    transcriptSizeObserver.observe(transcript);
    for (const child of transcript.children ?? []) transcriptSizeObserver.observe(child);
  };
  const restoreTranscriptView = () => {
    const restore = () => {
      const transcript = document.querySelector("#transcript");
      if (!transcript) return;
      if (transcriptView.follow) showLatest();
      else transcript.scrollTop = transcriptView.top;
    };
    restore();
    requestAnimationFrame(restore);
  };
  let swapDraft = null;
  const captureDraft = () => {
    const input = composer();
    const active = document.activeElement;
    if (input instanceof HTMLTextAreaElement) {
      swapDraft = {
        kind: "composer",
        value: input.value,
        focused: active === input,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
      return;
    }
    if (active instanceof HTMLTextAreaElement && active.classList.contains("queue-edit-text")) {
      swapDraft = {
        kind: "queue",
        id: active.dataset.messageId,
        value: active.value,
        focused: true,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
      return;
    }
    swapDraft = { kind: "none", focused: false };
  };
  const restoreDraft = () => {
    const draft = swapDraft;
    swapDraft = null;
    if (!draft) return;
    const input = draft?.kind === "queue"
      ? [...document.querySelectorAll(".queue-edit-text")]
          .find((candidate) => candidate.dataset.messageId === draft.id)
      : composer();
    if (draft?.kind === "composer" && input instanceof HTMLTextAreaElement) {
      if (draft.focused && document.activeElement === input) {
        fitComposer(input, { shrink: false });
        return;
      }
      if (draft.value) input.value = draft.value;
      fitComposer(input, { shrink: false });
    } else if (draft?.kind === "queue" && input instanceof HTMLTextAreaElement) {
      input.value = draft.value;
      fitComposer(input, { shrink: false });
    }
    if (draft?.focused && input instanceof HTMLTextAreaElement) {
      input.focus();
      try { input.setSelectionRange(draft.start, draft.end); } catch {}
      return;
    }
    const prompt = composer();
    if (prompt instanceof HTMLTextAreaElement && prompt === document.activeElement) prompt.blur();
  };
  const prepareSession = () => {
    restoreTranscriptView();
    bindTranscriptFollow();
    syncProviderGapForTurn();
    restorePersistedDraft();
    const input = composer();
    if (input instanceof HTMLTextAreaElement && document.activeElement !== input) {
      fitComposer(input, { shrink: false });
    }
  };
  const submitForm = (selector) => {
    const form = document.querySelector(selector);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };
  const clickButton = (selector) => {
    const button = document.querySelector(selector);
    if (button instanceof HTMLElement) button.click();
  };
  const currentSessionId = () => {
    const composerForm = document.querySelector("#composer") ?? document.querySelector("#interrupt-form");
    const fromDataset = composerForm?.dataset?.sessionId;
    if (fromDataset) return fromDataset;
    const match = location.pathname.match(/\/session\/(session-[0-9a-fA-F-]{36})(?:\/|$)/);
    return match ? match[1] : "";
  };
  let resetAdoptedSession = () => {};
  let overlaySessionId = "";
  let liveSessionId = currentSessionId();
  let committedLocation = location.href;
  let pendingCanonical = "";
  let switchGeneration = 0;
  let bootstrapSwitch = null;
  let activeSseSource = null;
  let liveSwitchMeta = null;
  const viewingSessionId = () => overlaySessionId || liveSessionId;
  let inFlightDraft = "";
  const composerDraftKey = (sessionId = liveSessionId || currentSessionId()) => (sessionId ? `qq:composer:${sessionId}` : "");
  const persistComposerDraft = (input = composer(), sessionId = liveSessionId || currentSessionId()) => {
    const key = composerDraftKey(sessionId);
    if (!key || !(input instanceof HTMLTextAreaElement)) return;
    try {
      if (input.value) sessionStorage.setItem(key, input.value);
      else sessionStorage.removeItem(key);
    } catch { /* private mode */ }
  };
  const clearComposerDraft = (sessionId = liveSessionId || currentSessionId()) => {
    const key = composerDraftKey(sessionId);
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch { /* private mode */ }
  };
  const restorePersistedDraft = (sessionId = liveSessionId || currentSessionId(), { replace = false } = {}) => {
    const input = composer();
    const key = composerDraftKey(sessionId);
    if (!key || !(input instanceof HTMLTextAreaElement) || (!replace && input.value)) return;
    try {
      const saved = sessionStorage.getItem(key) ?? "";
      if (replace || saved) input.value = saved;
      if (input.value) fitComposer(input, { shrink: false });
    } catch { /* private mode */ }
  };
  const sessionLinks = () => {
    const seen = new Set();
    const links = [];
    for (const link of document.querySelectorAll(".session-token[data-session-id]")) {
      const id = link.dataset.sessionId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      links.push(link);
    }
    return links;
  };
  const sessionIds = () => sessionLinks().map((link) => link.dataset.sessionId).filter(Boolean);
  const openSession = (sessionId) => {
    if (!sessionId || sessionId === viewingSessionId()) return;
    const link = sessionLinks().find((entry) => entry.dataset.sessionId === sessionId);
    if (link?.href) {
      void chairGo(link.href, link);
      return;
    }
    const projectMatch = location.pathname.match(/^(.*\/project\/[^/]+(?:\/[^/]+)?)\/session\/session-[0-9a-fA-F-]{36}(?:\/|$)/);
    if (projectMatch) {
      void chairGo(`${projectMatch[1]}/session/${sessionId}`);
      return;
    }
    const match = location.pathname.match(/^(.*)\/session\/session-[0-9a-fA-F-]{36}(?:\/|$)/);
    const base = match ? match[1] : "/qq";
    void chairGo(`${base}/session/${sessionId}`);
  };
  const confirmingClose = () => document.querySelector(".session-item-current.close-confirming");
  const restoreCloseFocus = () => {
    const arm = document.querySelector(".close-arm");
    if (arm instanceof HTMLElement) arm.focus();
  };
  const disarmClose = () => {
    const row = document.querySelector(".session-item-current");
    const confirm = row?.querySelector(".close-confirm");
    const arm = row?.querySelector(".close-arm");
    if (!row) return;
    row.classList.remove("close-confirming");
    if (confirm) confirm.hidden = true;
    if (arm) arm.hidden = false;
  };
  const armClose = () => {
    const row = document.querySelector(".session-item-current");
    const confirm = row?.querySelector(".close-confirm");
    const arm = row?.querySelector(".close-arm");
    const submit = confirm?.querySelector("button[type=\"submit\"]");
    if (!row || !confirm) return;
    row.classList.add("close-confirming");
    confirm.hidden = false;
    if (arm) arm.hidden = true;
    if (submit instanceof HTMLElement) submit.focus();
  };
  const neighborSession = (delta) => {
    const ids = sessionIds();
    const current = liveSessionId;
    const index = ids.indexOf(current);
    if (index < 0 || ids.length < 2) return;
    openSession(ids[(index + delta + ids.length) % ids.length]);
  };
  const scrollTranscript = (mode) => {
    const transcript = document.querySelector("#transcript");
    if (!transcript) return;
    const page = Math.max(transcript.clientHeight - 48, 80);
    if (mode === "up") transcript.scrollTop -= page;
    if (mode === "down") transcript.scrollTop += page;
    if (mode === "home") transcript.scrollTop = 0;
    if (mode === "end") transcript.scrollTop = transcript.scrollHeight;
  };
  const workflowsMenu = () => document.querySelector(".workflows-menu");
  const workflowChoices = (menu = workflowsMenu()) => menu
    ? [...menu.querySelectorAll(".workflows-choice")].filter((choice) => !choice.disabled)
    : [];
  const closeWorkflowsMenu = (restoreFocus = false) => {
    const menu = workflowsMenu();
    if (menu instanceof HTMLDetailsElement && menu.open) {
      menu.open = false;
      if (restoreFocus) menu.querySelector(":scope > summary")?.focus();
      return true;
    }
    return false;
  };
  const openWorkflowsMenu = () => {
    const menu = workflowsMenu();
    if (!(menu instanceof HTMLDetailsElement)) return false;
    menu.open = true;
    const choices = workflowChoices(menu);
    const choice = choices.find((candidate) => candidate.classList.contains("workflows-current")) ?? choices[0];
    choice?.focus();
    return true;
  };
  const handleWorkflowMenuKey = (event) => {
    const menu = workflowsMenu();
    if (!(menu instanceof HTMLDetailsElement)) return false;
    const summary = menu.querySelector(":scope > summary");
    if (event.key === "Enter" && event.target === summary) {
      event.preventDefault();
      if (menu.open) closeWorkflowsMenu(true);
      else openWorkflowsMenu();
      return true;
    }
    if (!menu.open) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      closeWorkflowsMenu(true);
      return true;
    }
    const choices = workflowChoices(menu);
    const current = choices.indexOf(document.activeElement);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const fallback = choices.findIndex((choice) => choice.classList.contains("workflows-current"));
      const start = current >= 0 ? current : fallback >= 0 ? fallback : 0;
      const delta = event.key === "ArrowUp" ? -1 : 1;
      choices[(start + delta + choices.length) % choices.length]?.focus();
      return true;
    }
    if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      choices[current].click();
      return true;
    }
    return false;
  };
  const dismissSheet = () => {
    const ignore = document.querySelector(".offer-ignore");
    if (ignore instanceof HTMLElement) {
      ignore.click();
      return true;
    }
    const workflows = document.querySelector(".workflows-popup");
    if (workflows) {
      workflows.remove();
      return true;
    }
    if (closeWorkflowsMenu()) return true;
    return false;
  };
  const editingElsewhere = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const type = String(node.type || "text").toLowerCase();
      return type !== "button" && type !== "submit" && type !== "reset" && type !== "checkbox" && type !== "radio";
    }
    return node.isContentEditable;
  };

  const activeProjectItems = () => [...document.querySelectorAll(".active-project-item[href]")];
  const projectIdentity = (entry) => `${String(entry?.project ?? "")}\n${String(entry?.folder ?? "")}`;
  const projectStorageKey = () => {
    const consolePath = location.pathname.replace(/\/(?:projects|project|session)(?:\/.*)?$/, "") || "/";
    return `qq-active-projects:${consolePath}`;
  };
  const activeProjectEntry = (item) => ({
    project: String(item?.dataset?.project ?? ""),
    folder: String(item?.dataset?.folder ?? ""),
    label: String(item?.title || item?.querySelector?.(".active-project-label")?.textContent || item?.dataset?.folder || item?.dataset?.project || "").trim(),
    href: String(item?.href ?? ""),
  });
  const readRememberedProjects = () => {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(projectStorageKey()) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry) => {
        if (!entry || typeof entry !== "object" || !entry.project || !entry.label || !entry.href) return false;
        try { return new URL(entry.href, location.href).origin === location.origin; } catch { return false; }
      });
    } catch {
      return [];
    }
  };
  const rememberActiveProjects = () => {
    try {
      sessionStorage.setItem(projectStorageKey(), JSON.stringify(activeProjectItems().map(activeProjectEntry)));
    } catch {
      /* the visible rail still works when browser storage is unavailable */
    }
  };
  const buildActiveProjectItem = (entry) => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.className = "active-project-item";
    link.href = entry.href;
    link.dataset.project = entry.project;
    link.dataset.folder = entry.folder || "";
    const display = entry.folder && String(entry.label || "").includes(" / ")
      ? entry.folder
      : (entry.label || entry.folder || entry.project);
    link.title = display;
    const mark = document.createElement("span");
    mark.className = "active-project-mark";
    mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "active-project-label";
    label.textContent = display;
    link.append(mark, label);
    row.append(link);
    return row;
  };
  const currentProjectSessionHref = () => {
    const id = currentSessionId();
    if (!id || !location.pathname.includes(`/session/${id}`)) return "";
    return new URL(location.pathname, location.origin).href;
  };
  const projectSwitchHref = (project, folder = "") => {
    const name = String(project ?? "");
    if (!name) return "";
    const prefix = location.pathname.match(/^(\/[^/]+)(?=\/project\/|\/session\/|$)/);
    const base = prefix ? prefix[1] : "/qq";
    const nested = String(folder ?? "") ? `/${encodeURIComponent(folder)}` : "";
    return new URL(`${base}/project/${encodeURIComponent(name)}${nested}`, location.origin).href;
  };
  const retargetProjectLink = (link, currentKey, currentHref) => {
    if (!(link instanceof HTMLAnchorElement) || !link.dataset.project) return;
    const key = projectIdentity({ project: link.dataset.project, folder: link.dataset.folder });
    if (key === currentKey && currentHref) {
      link.href = currentHref;
      return;
    }
    const next = projectSwitchHref(link.dataset.project, link.dataset.folder);
    if (next) link.href = next;
  };
  const restoreListOrder = (list, items, keyOf) => {
    const remembered = readRememberedProjects();
    if (!list || !remembered.length || items.length < 2) return;
    const rows = new Map(items.map((item) => [keyOf(item), item.closest("li") ?? item]));
    const next = [];
    const used = new Set();
    for (const entry of remembered) {
      const key = projectIdentity(entry);
      const row = rows.get(key);
      if (!row || used.has(key)) continue;
      next.push(row);
      used.add(key);
    }
    for (const [key, row] of rows) {
      if (used.has(key) || !row) continue;
      next.push(row);
    }
    if (next.length) list.replaceChildren(...next);
  };
  const restoreActiveProjects = () => {
    const rail = document.querySelector("#project-rail");
    const list = rail?.querySelector(".active-projects ol");
    if (!rail || !list) return;
    restoreListOrder(list, activeProjectItems(), (item) => projectIdentity(activeProjectEntry(item)));
    restoreListOrder(
      document.querySelector(".projects-menu-list"),
      [...document.querySelectorAll(".projects-choice[data-project]")],
      (item) => projectIdentity({ project: item.dataset.project, folder: item.dataset.folder }),
    );
    const currentKey = projectIdentity({ project: rail.dataset.currentProject, folder: rail.dataset.currentFolder });
    const currentIsActive = rail.dataset.currentActive === "true";
    const currentHref = currentIsActive ? currentProjectSessionHref() : "";
    for (const item of activeProjectItems()) retargetProjectLink(item, currentKey, currentHref);
    for (const choice of document.querySelectorAll(".projects-choice[data-project]")) {
      retargetProjectLink(choice, currentKey, currentHref);
    }
    rememberActiveProjects();
  };
  const activeProjectKeys = () => new Set(activeProjectItems().map((item) => projectIdentity(activeProjectEntry(item))));
  const appendActiveProject = (entry) => {
    if (!entry.project || activeProjectKeys().has(projectIdentity(entry))) return;
    const list = document.querySelector(".active-projects ol");
    if (!list) return;
    list.append(buildActiveProjectItem(entry));
    rememberActiveProjects();
  };
  const removeActiveProject = (entry) => {
    const key = projectIdentity(entry);
    const item = activeProjectItems().find((candidate) => projectIdentity(activeProjectEntry(candidate)) === key);
    item?.closest("li")?.remove();
    rememberActiveProjects();
  };
  const responseHasSession = (response) => {
    if (response.status === 404) return false;
    const path = new URL(response.url).pathname;
    if (/\/session\/session-[0-9a-f-]+(?:\/|$)/i.test(path)) return true;
    if (/\/project\/[^/]+/i.test(path) && (response.ok || response.redirected)) return true;
    return response.ok;
  };
  const validateRememberedProjects = async () => {
    const current = activeProjectItems().find((item) => item.matches('[aria-current="page"]'));
    const candidates = activeProjectItems()
      .filter((item) => item !== current && item.dataset.live !== "true")
      .map(activeProjectEntry);
    await Promise.all(candidates.map(async (entry) => {
      try {
        const response = await fetch(entry.href, { method: "HEAD", headers: { Accept: "text/html" } });
        if (response.status === 404) removeActiveProject(entry);
        else if (!responseHasSession(response) && response.status >= 400) removeActiveProject(entry);
      } catch {
        /* retain remembered activity when validation cannot reach the fixture */
      }
    }));
  };
  const neighborProject = (delta) => {
    const projects = activeProjectItems();
    if (projects.length < 2) return;
    const current = projects.findIndex((project) => project.matches('[aria-current="page"]'));
    const index = current < 0 ? 0 : current;
    const next = projects[(index + delta + projects.length) % projects.length];
    void chairGo(next.href, next);
  };
  const inactiveProjectTree = () => document.querySelector("#inactive-project-tree");
  const projectTreeColumns = () => inactiveProjectTree()?.querySelector(".project-tree-columns");
  const projectTreeIsOpen = () => {
    const tree = inactiveProjectTree();
    return Boolean(tree && !tree.hidden);
  };
  const activeProjectNames = () => new Set(activeProjectItems().map((item) => item.dataset.project).filter(Boolean));
  const discoverActiveProjects = async (entries) => {
    const candidates = entries.filter((entry) => entry.kind === "project" && entry.project && !activeProjectNames().has(entry.project));
    await Promise.all(candidates.map(async (entry) => {
      try {
        const response = await fetch(entry.href, { method: "HEAD", headers: { Accept: "text/html" } });
        if (!responseHasSession(response)) return;
        appendActiveProject(entry);
      } catch {
        /* project activity discovery is best-effort */
      }
    }));
  };
  const folderEntries = (html, responseUrl) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const entries = [...parsed.querySelectorAll("#project-drawer .drawer-entry[data-entry-type]")]
      .map((link) => {
        const kind = link.dataset.entryType;
        const label = link.querySelector(".drawer-name")?.textContent?.trim() ?? "";
        let href = "";
        try { href = new URL(link.getAttribute("href") ?? "", responseUrl).href; } catch {}
        let project = String(link.dataset.project ?? "");
        if (!project) {
          try {
            const match = new URL(href).pathname.match(/\/project\/([^/]+)/);
            project = match ? decodeURIComponent(match[1]) : "";
          } catch {}
        }
        return {
          kind,
          label,
          href,
          project,
          folder: String(link.dataset.folder ?? ""),
          fileKind: String(link.dataset.fileKind ?? ""),
          action: String(link.dataset.treeAction ?? (kind === "file" ? "open" : "expand")),
        };
      })
      .filter((entry) => entry.href && entry.label && ["project", "directory", "file"].includes(entry.kind));
    let createHref = "";
    const start = parsed.querySelector("#project-drawer .drawer-start-session[action]");
    if (start instanceof HTMLFormElement) {
      try { createHref = new URL(start.getAttribute("action") ?? "", responseUrl).href; } catch { createHref = ""; }
    }
    return { entries, createHref };
  };
  const projectCreateHref = (entry) => {
    const project = entry.project || (entry.kind === "project" ? entry.label : "");
    if (!project) return "";
    const folder = entry.folder || (entry.kind === "directory" ? entry.label : "");
    const folderPart = folder ? `/${encodeURIComponent(folder)}` : "";
    const prefix = location.pathname.match(/^(.*)\/project\//)?.[1] ?? "";
    try {
      return new URL(`${prefix}/project/${encodeURIComponent(project)}${folderPart}/sessions`, location.origin).href;
    } catch {
      return "";
    }
  };
  const treeCreateMark = (href) => {
    const create = document.createElement("span");
    create.className = "project-tree-create";
    create.dataset.href = href;
    create.dataset.action = "create";
    create.setAttribute("aria-label", "New session");
    create.textContent = "+";
    return create;
  };
  const attachTreeCreate = (node, href) => {
    if (!(node instanceof HTMLElement) || !href) return;
    node.classList.add("project-tree-node-create");
    const existing = node.querySelector(".project-tree-create");
    if (existing instanceof HTMLElement) {
      existing.dataset.href = href;
      return;
    }
    const mark = treeCreateMark(href);
    const branch = node.querySelector(".project-tree-branch");
    if (branch) branch.before(mark);
    else node.append(mark);
  };
  const projectTreeNodes = (column) => [...column.querySelectorAll(".project-tree-node")];
  let treeRequest = 0;
  const trimProjectTree = (depth) => {
    const columns = projectTreeColumns();
    if (!columns) return;
    for (const column of [...columns.querySelectorAll(".project-tree-column")]) {
      if (Number(column.dataset.depth) >= depth) column.remove();
    }
  };
  const renderProjectTreeColumn = (entries, depth, parentNode) => {
    const columns = projectTreeColumns();
    if (!columns) return null;
    trimProjectTree(depth);
    columns.querySelector(".project-tree-loading")?.remove();
    if (entries.length === 0) return null;
    const column = document.createElement("div");
    column.className = "project-tree-column";
    column.dataset.depth = String(depth);
    column.setAttribute("role", "group");
    if (parentNode instanceof HTMLElement) column.dataset.parentHref = parentNode.dataset.href ?? "";
    for (const [index, entry] of entries.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-tree-node";
      button.dataset.href = entry.href;
      button.dataset.kind = entry.kind;
      button.dataset.action = entry.action;
      button.dataset.project = entry.project;
      button.dataset.folder = entry.folder;
      button.dataset.fileKind = entry.fileKind;
      button.dataset.depth = String(depth);
      button.setAttribute("role", "treeitem");
      button.setAttribute("aria-selected", String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.title = entry.label;
      const label = document.createElement("span");
      label.className = "project-tree-label";
      label.textContent = entry.label;
      if (entry.kind === "file") {
        button.append(label);
      } else {
        const mark = document.createElement("span");
        mark.className = "project-tree-mark";
        mark.setAttribute("aria-hidden", "true");
        button.append(mark, label);
      }
      if (entry.action === "expand") {
        const branch = document.createElement("span");
        branch.className = "project-tree-branch";
        branch.setAttribute("aria-hidden", "true");
        branch.textContent = "›";
        button.append(branch);
      }
      const createHref = projectCreateHref(entry);
      if (createHref) attachTreeCreate(button, createHref);
      column.append(button);
    }
    columns.append(column);
    return column;
  };
  const treeChildUrl = (node) => new URL(node.dataset.href, location.href).href;
  const loadProjectTreeColumn = async (url, depth, parentNode = null, focusChild = false) => {
    const request = ++treeRequest;
    trimProjectTree(depth);
    try {
      const response = await fetch(url, { headers: { Accept: "text/html" } });
      if (!response.ok) return null;
      const html = await response.text();
      if (request !== treeRequest && depth > 0) return null;
      const listing = folderEntries(html, response.url);
      if (parentNode) attachTreeCreate(parentNode, listing.createHref);
      const column = renderProjectTreeColumn(listing.entries, depth, parentNode);
      if (focusChild) column?.querySelector(".project-tree-node")?.focus();
      return column;
    } catch {
      return null;
    }
  };
  let projectTreeReady = null;
  const hydrateProjectTree = () => {
    const tree = inactiveProjectTree();
    if (!tree) return Promise.resolve(null);
    if (!projectTreeReady) projectTreeReady = loadProjectTreeColumn(tree.dataset.rootUrl, 0);
    return projectTreeReady;
  };
  const selectProjectTreeNode = (node) => {
    if (!(node instanceof HTMLElement)) return;
    const column = node.closest(".project-tree-column");
    for (const other of projectTreeNodes(column)) {
      const selected = other === node;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
    }
  };
  const spawnProjectSession = (node) => {
    if (!(node instanceof HTMLElement) || !node.dataset.href) return;
    void navigatePage(node.dataset.href, node);
  };
  const createProjectSession = (node) => {
    if (!(node instanceof HTMLElement) || !node.dataset.href) return;
    const form = document.createElement("form");
    form.method = "post";
    form.action = node.dataset.href;
    form.hidden = true;
    document.body.append(form);
    form.requestSubmit();
  };
  const activateProjectTreeNode = (node, focusChild = true) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.action === "expand") {
      void loadProjectTreeColumn(treeChildUrl(node), Number(node.dataset.depth) + 1, node, focusChild);
      return;
    }
    if (node.dataset.action === "create") {
      createProjectSession(node);
      return;
    }
    if (node.dataset.action === "spawn") {
      spawnProjectSession(node);
      return;
    }
    void navigatePage(node.dataset.href, node);
  };
  const setProjectTreeOpen = (open, restoreFocus = false) => {
    const tree = inactiveProjectTree();
    if (!tree) return;
    tree.hidden = !open;
    document.body.classList.toggle("inactive-projects-open", open);
    if (!open) {
      if (restoreFocus) document.querySelector(".active-project-current")?.focus({ preventScroll: true });
      return;
    }
    void hydrateProjectTree().then(() => {
      const first = tree.querySelector(".project-tree-node");
      if (first instanceof HTMLElement) first.focus({ preventScroll: true });
    });
  };
  const handleProjectTreeKey = (event) => {
    if (!projectTreeIsOpen()) return false;
    const node = event.target instanceof Element ? event.target.closest(".project-tree-node") : null;
    if (event.key === "Escape") {
      event.preventDefault();
      setProjectTreeOpen(false, true);
      return true;
    }
    if (!(node instanceof HTMLElement)) return false;
    const column = node.closest(".project-tree-column");
    const nodes = projectTreeNodes(column);
    const index = nodes.indexOf(node);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = nodes[(index + delta + nodes.length) % nodes.length];
      selectProjectTreeNode(next);
      next.focus();
      return true;
    }
    if (event.key === "ArrowRight") {
      if (node.dataset.action !== "expand") return false;
      event.preventDefault();
      selectProjectTreeNode(node);
      activateProjectTreeNode(node, true);
      return true;
    }
    if (event.key === "ArrowLeft") {
      const depth = Number(node.dataset.depth);
      if (depth <= 0) return false;
      event.preventDefault();
      const parentHref = column.dataset.parentHref;
      trimProjectTree(depth);
      const parent = [...document.querySelectorAll(".project-tree-node")].find((candidate) => candidate.dataset.href === parentHref);
      parent?.focus();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectProjectTreeNode(node);
      activateProjectTreeNode(node, true);
      return true;
    }
    return false;
  };
  document.addEventListener("click", (event) => {
    const create = event.target instanceof Element ? event.target.closest(".project-tree-create") : null;
    if (create instanceof HTMLElement) {
      event.preventDefault();
      createProjectSession(create);
      return;
    }
    const node = event.target instanceof Element ? event.target.closest(".project-tree-node") : null;
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    selectProjectTreeNode(node);
    activateProjectTreeNode(node, false);
  });

  const projectDrawer = () => document.querySelector("#project-drawer");
  const projectRail = () => document.querySelector("#project-rail");
  const drawerToggle = () => document.querySelector("#project-drawer-toggle");
  const drawerBackdrop = () => document.querySelector("#project-drawer-backdrop");
  let drawerReturnFocus = null;
  const drawerIsOpen = () => document.body.classList.contains("drawer-open");
  const CHAIR_MODE_KEY = "qq:chair-mode";
  const navMode = () => document.body.classList.contains("nav-mode");
  const PAGE_CACHE_MS = 8000;
  const pageCache = new Map();
  const pageControllers = new Map();
  let navGeneration = 0;
  let pendingHtmxProcess = false;
  const consolePageUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const path = url.pathname;
      if (/\.(?:js|css|png|webmanifest|map|woff2?)$/i.test(path)) return null;
      if (/\/(?:file|open|download|events|assets)\//.test(path) || /\/events$/.test(path)) return null;
      if (path.endsWith("/sw.js")) return null;
      return url;
    } catch {
      return null;
    }
  };
  const rememberPage = (key, entry) => {
    pageCache.set(key, entry);
    if (pageCache.size <= 24) return;
    const oldest = pageCache.keys().next().value;
    if (oldest && oldest !== key) pageCache.delete(oldest);
  };
  const abortPrefetchesExcept = (keep) => {
    for (const [key, controller] of pageControllers) {
      if (key === keep) continue;
      controller.abort();
      pageControllers.delete(key);
      const hit = pageCache.get(key);
      if (hit && !hit.ready) pageCache.delete(key);
    }
  };
  const prefetchPage = (value, priority = "low") => {
    const url = consolePageUrl(value);
    if (!url) return null;
    const key = url.href;
    const hit = pageCache.get(key);
    if (hit && (!hit.ready || Date.now() - hit.at < PAGE_CACHE_MS)) return hit.promise;
    const controller = new AbortController();
    const promise = fetch(key, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/html" },
      priority,
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("navigate");
      const html = await response.text();
      const page = { html, url: response.url };
      const entry = { at: Date.now(), promise: Promise.resolve(page), ready: true };
      rememberPage(key, entry);
      if (response.url !== key) rememberPage(response.url, entry);
      return page;
    }).catch((error) => {
      pageControllers.delete(key);
      const current = pageCache.get(key);
      if (current?.promise === promise) pageCache.delete(key);
      throw error;
    }).finally(() => {
      if (pageControllers.get(key) === controller) pageControllers.delete(key);
    });
    pageControllers.set(key, controller);
    rememberPage(key, { at: Date.now(), promise, ready: false });
    return promise;
  };
  const processConsole = () => {
    pendingHtmxProcess = false;
    if (typeof globalThis.htmx?.process === "function") globalThis.htmx.process(document.body);
  };
  const closeSseSources = () => {
    const api = globalThis.htmx;
    if (!api || typeof api.trigger !== "function") return;
    for (const node of document.querySelectorAll("[sse-connect], [data-sse-connect]")) {
      api.trigger(node, "htmx:beforeCleanupElement");
    }
  };
  const rebindSseSwaps = (stream) => {
    const nodes = [
      stream,
      ...stream.querySelectorAll("[sse-swap], [data-sse-swap], [hx-trigger], [data-hx-trigger]"),
    ];
    for (const node of nodes) {
      const internalData = node["htmx-internal-data"];
      if (internalData) delete internalData.initHash;
    }
  };
  // Mirrors HTMX 2.0.10's deterministic attribute hash without calling minified internals.
  const htmxAttributeHash = (node) => {
    let hash = 0;
    const add = (value) => {
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
    };
    for (const attribute of node.attributes) {
      if (!attribute.value) continue;
      add(attribute.name);
      add(attribute.value);
    }
    return hash;
  };
  const syncHtmxInitHash = (node) => {
    const internalData = node["htmx-internal-data"];
    if (internalData) internalData.initHash = htmxAttributeHash(node);
  };
  const markGroupCurrent = (selector, currentClass, current) => {
    for (const item of document.querySelectorAll(selector)) {
      const on = item === current;
      item.classList.toggle(currentClass, on);
      if (on) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  };
  const markLinkCurrent = (link) => {
    if (!(link instanceof Element)) return;
    if (link.matches(".active-project-item")) markGroupCurrent(".active-project-item[href]", "active-project-current", link);
    if (link.matches(".projects-choice")) markGroupCurrent(".projects-choice[href]", "projects-choice-current", link);
    if (link.matches(".session-token")) markGroupCurrent(".session-token[href]", "session-token-current", link);
  };
  const adoptPage = (html, url, historyMode = "push") => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    if (!(parsed.body instanceof HTMLElement)) return false;
    const keepNav = navMode();
    resetAdoptedSession();
    closeSseSources();
    projectTreeReady = null;
    treeRequest += 1;
    const next = document.adoptNode(parsed.body);
    if (keepNav) next.classList.add("nav-mode");
    document.title = parsed.title;
    document.documentElement.replaceChild(next, document.body);
    if (historyMode === "push") {
      if (!history.state?.qqPage) history.replaceState({ qqPage: true }, "", location.href);
      history.pushState({ qqPage: true }, "", url);
    }
    if (keepNav) pendingHtmxProcess = true;
    else processConsole();
    syncInitialChrome({ skipValidate: true });
    restorePersistedDraft();
    restoreTranscriptView();
    return true;
  };
  const navigatePage = async (value, current = null) => {
    const url = consolePageUrl(value);
    if (!url) {
      location.assign(String(value ?? ""));
      return;
    }
    if (url.href === location.href) return;
    if (current instanceof Element && current.matches("[aria-current='page']")) return;
    markLinkCurrent(current);
    const gen = ++navGeneration;
    abortPrefetchesExcept(url.href);
    closeSseSources();
    try {
      const page = await prefetchPage(url.href, "high");
      if (gen !== navGeneration) return;
      if (!page?.html || !adoptPage(page.html, page.url)) throw new Error("adopt");
    } catch (error) {
      if (gen !== navGeneration) return;
      if (error?.name === "AbortError") return;
      location.assign(url.href);
    }
  };
  const overlayProjectItem = (link) => {
    if (!(link instanceof Element)) return null;
    if (link.matches(".active-project-item")) return link;
    if (!link.matches(".projects-choice") || !link.dataset.project) return null;
    return [...document.querySelectorAll(".active-project-item")].find((item) => (
      item.dataset.project === link.dataset.project
      && (item.dataset.folder || "") === (link.dataset.folder || "")
    )) ?? link;
  };
  const readProjectSessions = (item) => {
    try {
      const parsed = JSON.parse(item?.dataset?.sessions || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((session) => session && session.id && session.href)
        : [];
    } catch {
      return [];
    }
  };
  const paintSessionTokens = (sessions, currentId, projectItem = null) => {
    const nav = document.querySelector(".session-traversal");
    if (!nav) return;
    nav.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement("span");
      empty.className = "session-empty";
      empty.textContent = "no live sessions";
      nav.append(empty);
    }
    for (const session of sessions) {
      const link = document.createElement("a");
      link.className = session.id === currentId ? "session-token session-token-current" : "session-token";
      if (session.id === currentId) link.setAttribute("aria-current", "page");
      link.href = session.href;
      link.dataset.sessionId = session.id;
      link.title = session.id;
      const label = document.createElement("span");
      label.textContent = session.token || session.id;
      link.append(label);
      nav.append(link);
    }
    const create = document.querySelector("form.new-session");
    if (create instanceof HTMLFormElement && !create.hidden) {
      const form = document.createElement("form");
      form.className = "new-session";
      const project = projectItem?.dataset?.project || document.querySelector(".active-project-item[aria-current='page']")?.dataset?.project || "";
      const folder = projectItem?.dataset?.folder || document.querySelector(".active-project-item[aria-current='page']")?.dataset?.folder || "";
      const canonicalBase = project
        ? `${consoleBasePath()}/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/sessions`
        : create.action;
      form.action = canonicalBase;
      form.method = "post";
      const button = document.createElement("button");
      button.type = "submit";
      button.setAttribute("aria-label", "New session");
      button.innerHTML = '<svg class="banner-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      form.append(button);
      nav.append(form);
    }
  };
  const rememberOverlaySession = (projectItem, sessionId, href) => {
    overlaySessionId = sessionId || "";
    pendingCanonical = href || "";
    if (projectItem instanceof HTMLElement && sessionId) projectItem.dataset.sessionId = sessionId;
  };
  const consoleBasePath = () => {
    const stream = document.querySelector("#console-stream");
    try {
      const current = new URL(stream?.getAttribute("sse-connect") || location.href, location.href);
      const match = current.pathname.match(/^(.*?)(?:\/project\/|\/session\/)/);
      if (match?.[1]) return match[1];
    } catch { /* use the console default */ }
    return "/qq";
  };
  const sessionEventsUrl = (sessionId) =>
    `${consoleBasePath()}/session/${encodeURIComponent(sessionId)}/events`;
  const selectionCanonical = (sessionId, projectItem, fallback = "") => {
    const id = String(sessionId || "");
    if (!id) return fallback;
    const project = String(projectItem?.dataset?.project || "");
    const folder = String(projectItem?.dataset?.folder || "");
    if (!project) return `${consoleBasePath()}/session/${encodeURIComponent(id)}`;
    return `${consoleBasePath()}/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/session/${encodeURIComponent(id)}`;
  };
  const normalizedCanonical = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  };
  const sessionHistoryState = (sessionId, canonical) => ({
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    qqPage: true,
    qqSession: sessionId,
    canonical,
  });
  const commitSessionLocation = (sessionId, canonical, mode = "push") => {
    const href = normalizedCanonical(canonical);
    if (!sessionId || !href) return;
    committedLocation = new URL(href, location.href).href;
    if (mode === "none") return;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current === href) {
      history.replaceState(sessionHistoryState(sessionId, href), "", href);
      return;
    }
    if (!history.state?.qqPage) {
      history.replaceState(sessionHistoryState(liveSessionId, current), "", current);
    }
    history.pushState(sessionHistoryState(sessionId, href), "", href);
  };
  const syncRailAfterSwitch = (meta) => {
    const rail = document.querySelector("#project-rail");
    if (!(rail instanceof HTMLElement)) return;
    const oldProject = rail.dataset.currentProject || "";
    const oldFolder = rail.dataset.currentFolder || "";
    rail.dataset.currentProject = String(meta.project || "");
    rail.dataset.currentFolder = String(meta.folder || "");
    rail.dataset.currentActive = "true";
    for (const choice of document.querySelectorAll(".projects-choice[data-project]")) {
      const item = [...document.querySelectorAll(".active-project-item[data-project]")].find((candidate) => (
        candidate.dataset.project === choice.dataset.project
        && (candidate.dataset.folder || "") === (choice.dataset.folder || "")
      ));
      if (!(item instanceof HTMLElement)) continue;
      if (choice.dataset.sessions) item.dataset.sessions = choice.dataset.sessions;
      else delete item.dataset.sessions;
      if (choice.dataset.sessionId) item.dataset.sessionId = choice.dataset.sessionId;
    }
    const currentProject = [...document.querySelectorAll(".active-project-item[data-project]")].find((item) => (
      item.dataset.project === String(meta.project || "")
      && (item.dataset.folder || "") === String(meta.folder || "")
    ));
    if (currentProject) {
      currentProject.dataset.sessionId = meta.id;
      currentProject.href = meta.canonical;
      markLinkCurrent(currentProject);
    }
    const canonical = normalizedCanonical(meta.canonical);
    const projectBase = canonical.replace(/\/session\/[^/?#]+$/, "");
    const create = rail.querySelector("form.new-session");
    const close = rail.querySelector("#close-session");
    if (create instanceof HTMLFormElement) create.action = `${projectBase}/sessions`;
    if (close instanceof HTMLFormElement) close.action = `${canonical}/close`;
    const child = Boolean(document.querySelector("#session-chrome .session-parent"));
    if (create instanceof HTMLFormElement) create.hidden = child;
    if (oldProject !== String(meta.project || "") || oldFolder !== String(meta.folder || "")) {
      closeDrawer({ updateUrl: false, restoreFocus: false });
      projectTreeReady = null;
      treeRequest += 1;
    }
  };
  const liveSwitch = (sessionId, { history: historyMode = "none", exitWhenReady = false, canonical = "" } = {}) => {
    const id = String(sessionId || "");
    if (!id || (id === liveSessionId && !bootstrapSwitch)) return false;
    if (!bootstrapSwitch) persistComposerDraft(composer(), liveSessionId);
    resetAdoptedSession();
    const stream = document.querySelector("#console-stream");
    if (!(stream instanceof HTMLElement)) return false;
    const generation = ++switchGeneration;
    const events = sessionEventsUrl(id);
    const bootstrap = `${events}?bootstrap=session&switch=${generation}`;
    if (historyMode === "push") commitSessionLocation(id, canonical || pendingCanonical, "push");
    bootstrapSwitch = {
      id,
      generation,
      sourceUrl: new URL(bootstrap, location.href).href,
      canonical: canonical || pendingCanonical,
      history: historyMode,
      exitWhenReady: Boolean(exitWhenReady),
      meta: null,
    };
    stream.setAttribute("aria-busy", "true");
    closeSseSources();
    activeSseSource = null;
    stream.setAttribute("sse-connect", bootstrap);
    rebindSseSwaps(stream);
    if (typeof globalThis.htmx?.process === "function") globalThis.htmx.process(stream);
    return true;
  };
  const finishLiveSwitch = (payload) => {
    const state = bootstrapSwitch;
    if (!state
      || String(payload?.id || "") !== state.id
      || String(payload?.generation ?? "") !== String(state.generation)
      || !state.meta) return false;
    const meta = state.meta;
    liveSessionId = state.id;
    liveSwitchMeta = meta;
    bootstrapSwitch = null;
    pendingCanonical = meta.canonical || state.canonical;
    const stream = document.querySelector("#console-stream");
    if (stream instanceof HTMLElement) {
      // Keep the bootstrap URL: this EventSource continues with ordinary live events,
      // and its HTMX attribute hash must continue to describe the active source.
      stream.removeAttribute("aria-busy");
      syncHtmxInitHash(stream);
    }
    syncRailAfterSwitch(meta);
    swapDraft = null;
    restorePersistedDraft(liveSessionId, { replace: true });
    anchorTranscript();
    prepareSession();
    if (state.history === "push" && normalizedCanonical(meta.canonical)) {
      const canonical = normalizedCanonical(meta.canonical);
      history.replaceState(sessionHistoryState(liveSessionId, canonical), "", canonical);
      committedLocation = new URL(canonical, location.href).href;
    }
    if (state.exitWhenReady) {
      paintChairMode(false);
      commitSessionLocation(liveSessionId, meta.canonical || state.canonical, "push");
    }
    return true;
  };
  const selectOverlayProject = (item) => {
    const projectItem = overlayProjectItem(item);
    if (!(projectItem instanceof HTMLElement)) return false;
    markLinkCurrent(projectItem);
    if (item !== projectItem && item instanceof Element) markLinkCurrent(item);
    const sessions = readProjectSessions(projectItem);
    const currentId = sessions.some((session) => session.id === overlaySessionId)
      ? overlaySessionId
      : (projectItem.dataset.sessionId || sessions[0]?.id || "");
    paintSessionTokens(sessions, currentId, projectItem);
    const selected = sessions.find((session) => session.id === currentId) ?? sessions[0];
    const canonical = selectionCanonical(selected?.id || currentId, projectItem, selected?.href || projectItem.href);
    rememberOverlaySession(projectItem, selected?.id || currentId, canonical);
    if (selected?.id) {
      liveSwitch(selected.id, {
        history: navMode() ? "none" : "push",
        canonical,
      });
    }
    return true;
  };
  const selectOverlaySession = (link) => {
    if (!(link instanceof HTMLElement) || !link.dataset.sessionId) return false;
    markLinkCurrent(link);
    const projectItem = document.querySelector(".active-project-item[aria-current='page']");
    const canonical = selectionCanonical(link.dataset.sessionId, projectItem, link.href);
    rememberOverlaySession(projectItem, link.dataset.sessionId, canonical);
    liveSwitch(link.dataset.sessionId, {
      history: navMode() ? "none" : "push",
      canonical,
    });
    return true;
  };
  const paintChairMode = (nav, persist = true) => {
    if (nav) document.body.classList.add("nav-mode");
    else document.body.classList.remove("nav-mode");
    if (nav) {
      overlaySessionId = "";
      pendingCanonical = "";
      const prompt = composer();
      if (prompt instanceof HTMLTextAreaElement && document.activeElement === prompt) prompt.blur();
    }
    syncDrawerChrome();
    if (!persist) return;
    try { sessionStorage.setItem(CHAIR_MODE_KEY, nav ? "nav" : "session"); } catch { /* private mode */ }
  };
  const commitOverlaySession = () => {
    const desired = overlaySessionId;
    if (!desired) {
      paintChairMode(false);
      return true;
    }
    if (bootstrapSwitch?.id === desired) {
      bootstrapSwitch.exitWhenReady = true;
      return false;
    }
    if (desired !== liveSessionId) return false;
    const canonical = liveSwitchMeta?.canonical || pendingCanonical || committedLocation;
    paintChairMode(false);
    commitSessionLocation(liveSessionId, canonical, "push");
    return true;
  };
  const chairGo = (value, current = null) => {
    if (current instanceof Element) {
      if (current.matches(".active-project-item, .projects-choice")) {
        selectOverlayProject(current);
        return;
      }
      if (current.matches(".session-token")) {
        selectOverlaySession(current);
        return;
      }
    }
    void navigatePage(value, current);
  };
  const closeMobileRailAfterAction = () => {
    if (desktopChair() || !navMode()) return;
    commitOverlaySession();
    // A live switch commits its destination when bootstrap is ready, but the
    // mobile rail should not remain open while that work finishes.
    if (navMode()) paintChairMode(false);
  };
  const modifiedClick = (event) => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const applyChairMode = (mode, persist = true) => {
    if (mode === "nav") {
      paintChairMode(true, persist);
      return;
    }
    if (persist) commitOverlaySession();
    else paintChairMode(false, false);
  };
  const restoreChairMode = () => {
    let mode = "session";
    try {
      if (sessionStorage.getItem(CHAIR_MODE_KEY) === "nav") mode = "nav";
    } catch { /* private mode */ }
    applyChairMode(mode, false);
  };
  const toggleChairMode = () => applyChairMode(navMode() ? "session" : "nav");
  const openDocumentViewerDialog = () => document.querySelector(".document-viewer-dialog[open]");
  const documentViewerIsOpen = () => Boolean(openDocumentViewerDialog());
  let documentViewerReturnFocus = null;
  let documentViewerHome = null;
  let documentViewerScroll = [];
  let documentViewerPriorInert = new WeakMap();
  const applyDocumentViewerPriorInert = (viewer) => {
    for (const node of document.body.children) {
      if (node === viewer) continue;
      if (documentViewerPriorInert.has(node)) node.inert = documentViewerPriorInert.get(node);
    }
  };
  const syncDocumentViewerChrome = (viewer, open) => {
    if (!(viewer instanceof Element)) return;
    if (open) {
      documentViewerPriorInert = new WeakMap();
      for (const node of document.body.children) {
        if (node === viewer) continue;
        documentViewerPriorInert.set(node, node.inert);
        node.inert = true;
      }
      return;
    }
    applyDocumentViewerPriorInert(viewer);
    requestAnimationFrame(() => applyDocumentViewerPriorInert(viewer));
  };
  const captureDocumentViewerScroll = (from) => {
    const seen = [];
    for (let node = from instanceof Element ? from : null; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
        seen.push({ node, top: node.scrollTop, left: node.scrollLeft });
      }
    }
    documentViewerScroll = seen;
  };
  const restoreDocumentViewerScroll = () => {
    const restore = () => {
      for (const entry of documentViewerScroll) {
        if (!entry.node.isConnected) continue;
        entry.node.scrollTop = entry.top;
        entry.node.scrollLeft = entry.left;
      }
    };
    restore();
    requestAnimationFrame(restore);
  };
  const parkDocumentViewer = (viewer) => {
    if (viewer.parentElement === document.body) return;
    documentViewerHome = { parent: viewer.parentNode, next: viewer.nextSibling };
    document.body.append(viewer);
  };
  const unparkDocumentViewer = (viewer) => {
    const home = documentViewerHome;
    documentViewerHome = null;
    if (!home?.parent?.isConnected) {
      viewer.remove();
      return;
    }
    home.parent.insertBefore(viewer, home.next);
  };
  const restoreDocumentViewerFocus = () => {
    const opener = documentViewerReturnFocus;
    documentViewerReturnFocus = null;
    if (opener instanceof HTMLElement && opener.isConnected && !opener.inert) {
      opener.focus({ preventScroll: true });
    }
    restoreDocumentViewerScroll();
  };
  const closeDocumentViewer = (viewer = openDocumentViewerDialog()) => {
    if (!(viewer instanceof HTMLElement) || !viewer.open) return;
    viewer.close?.();
    if (viewer.open) {
      viewer.removeAttribute("open");
      syncDocumentViewerChrome(viewer, false);
      unparkDocumentViewer(viewer);
      restoreDocumentViewerFocus();
    }
  };
  const openDocumentViewer = (viewer, opener) => {
    if (!(viewer instanceof HTMLElement) || viewer.tagName !== "DIALOG") return;
    if (documentViewerIsOpen() && openDocumentViewerDialog() !== viewer) closeDocumentViewer();
    documentViewerReturnFocus = opener instanceof HTMLElement ? opener : document.activeElement;
    captureDocumentViewerScroll(documentViewerReturnFocus instanceof Element ? documentViewerReturnFocus : document.querySelector("#transcript, .document-viewer-proof"));
    parkDocumentViewer(viewer);
    syncDocumentViewerChrome(viewer, true);
    if (!viewer.open) {
      if (typeof viewer.showModal === "function") viewer.showModal();
      else viewer.setAttribute("open", "");
    }
    const heading = viewer.querySelector("h1");
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  };
  const TOOL_INLINE_VIEWPORT_RATIO = 0.42;
  const toolInlineLimit = () => {
    const height = Number(window.visualViewport?.height)
      || Number(window.innerHeight)
      || Number(document.documentElement?.clientHeight)
      || 720;
    return height * TOOL_INLINE_VIEWPORT_RATIO;
  };
  const TOOL_MEDIA_WAIT_MS = 1_600;
  const toolLayoutFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const boundedToolMediaWait = (promise) => new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), TOOL_MEDIA_WAIT_MS);
    Promise.resolve(promise).then(() => finish(true), () => finish(true));
  });
  const waitForToolMediaEvent = (node, readyEvents) => new Promise((resolve) => {
    let settled = false;
    const done = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const eventName of readyEvents) node.removeEventListener(eventName, onReady);
      node.removeEventListener("error", onReady);
      resolve(ready);
    };
    const onReady = () => done(true);
    const timer = setTimeout(() => done(false), TOOL_MEDIA_WAIT_MS);
    for (const eventName of readyEvents) node.addEventListener(eventName, onReady, { once: true });
    node.addEventListener("error", onReady, { once: true });
  });
  const waitForToolMediaNode = async (node) => {
    if (node.tagName === "IMG") {
      if (!node.complete && !await waitForToolMediaEvent(node, ["load"])) return false;
      if (typeof node.decode === "function") {
        try { return boundedToolMediaWait(node.decode()); } catch { return true; }
      }
      return true;
    }
    if (node.tagName === "VIDEO" && Number(node.readyState) < 1) {
      return waitForToolMediaEvent(node, ["loadedmetadata"]);
    }
    return true;
  };
  const waitForToolMedia = async (body) => {
    const readiness = await Promise.all(
      [...body.querySelectorAll("img, video")].map(waitForToolMediaNode),
    );
    return readiness.every(Boolean);
  };
  const measureToolBody = (card, body) => {
    const rectWidth = Number(card.getBoundingClientRect?.().width)
      || Number(card.clientWidth)
      || Number(window.innerWidth)
      || 320;
    let horizontalPadding = 0;
    try {
      const style = getComputedStyle(card);
      horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0)
        + (Number.parseFloat(style.paddingRight) || 0);
    } catch { /* the full card width is a safe fallback */ }
    card.style.setProperty("--tool-measure-width", `${Math.max(1, rectWidth - horizontalPadding)}px`);
    card.classList.add("tool-measuring");
    const height = Math.max(Number(body.scrollHeight) || 0, Number(body.getBoundingClientRect?.().height) || 0);
    card.classList.remove("tool-measuring");
    card.style.removeProperty("--tool-measure-width");
    return height;
  };
  const toolOutputUrl = (card) => {
    const href = String(card.dataset.toolHref ?? "").replace(/^\/+/, "");
    if (!href) return null;
    const transcript = card.closest("#transcript[data-tool-base]");
    const base = String(transcript?.dataset.toolBase ?? "") || location.pathname;
    const url = new URL(base, location.href);
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${href}`;
    return url;
  };
  const presentToolBody = async (card, summary) => {
    const body = card.querySelector(":scope > .tool-body");
    if (!(body instanceof HTMLElement)) return;
    await toolLayoutFrame();
    const mediaReady = await waitForToolMedia(body);
    await toolLayoutFrame();
    if (!card.isConnected) return;
    const viewer = body.querySelector(".document-viewer-dialog");
    if (!mediaReady && viewer instanceof HTMLElement) {
      card.open = false;
      openDocumentViewer(viewer, summary);
      return;
    }
    const inlineHeight = measureToolBody(card, body) + 12;
    if (!(viewer instanceof HTMLElement) || inlineHeight <= toolInlineLimit()) {
      card.open = true;
      return;
    }
    card.open = false;
    openDocumentViewer(viewer, summary);
  };
  const loadToolBody = async (card) => {
    const body = card.querySelector(":scope > .tool-body");
    if (!(body instanceof HTMLElement)) return false;
    if (card.dataset.toolBodyState === "loaded") return true;
    if (card.dataset.toolBodyState === "loading") return false;
    const url = toolOutputUrl(card);
    if (!url) return false;
    card.dataset.toolBodyState = "loading";
    try {
      const response = await fetch(url, { headers: { Accept: "text/html", "HX-Request": "true" } });
      if (!response.ok) throw new Error(`tool output ${response.status}`);
      body.innerHTML = await response.text();
      globalThis.htmx?.process?.(body);
      card.dataset.toolBodyState = "loaded";
      return true;
    } catch {
      body.innerHTML = "<p class=\"tool-empty\">Tool output is unavailable</p>";
      card.dataset.toolBodyState = "error";
      return false;
    }
  };
  const activateToolCard = async (card, summary) => {
    if (!(card instanceof HTMLDetailsElement)) return;
    if (card.open) {
      card.open = false;
      return;
    }
    if (card.dataset.toolBodyState === "loading") return;
    card.setAttribute("aria-busy", "true");
    try {
      const ready = await loadToolBody(card);
      if (!card.isConnected) return;
      if (!ready && card.dataset.toolBodyState !== "error") return;
      await presentToolBody(card, summary);
    } finally {
      card.removeAttribute("aria-busy");
    }
  };
  document.addEventListener("close", (event) => {
    const viewer = event.target;
    if (!(viewer instanceof HTMLElement) || !viewer.classList.contains("document-viewer-dialog")) return;
    syncDocumentViewerChrome(viewer, false);
    unparkDocumentViewer(viewer);
    restoreDocumentViewerFocus();
  }, true);
  const updateDrawerUrl = (open) => {
    const url = new URL(location.href);
    if (open) url.searchParams.set("drawer", projectDrawer()?.dataset.drawerPath || "");
    else url.searchParams.delete("drawer");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const panelFocusables = (panel) => {
    if (!panel) return [];
    return [...panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node instanceof HTMLElement && !node.hidden);
  };
  const drawerIsTransient = () => document.body.classList.contains("drawer-drag-active") || document.body.classList.contains("drawer-drag-settling");
  const panelIsTransient = () => drawerIsTransient();
  const syncDrawerChrome = () => {
    const drawer = projectDrawer();
    const rail = projectRail();
    const toggle = drawerToggle();
    const backdrop = drawerBackdrop();
    const filesOpen = drawerIsOpen();
    const transient = panelIsTransient();
    toggle?.setAttribute("aria-expanded", String(filesOpen));
    if (drawer) {
      drawer.setAttribute("aria-hidden", String(!filesOpen));
      drawer.inert = !filesOpen;
    }
    if (rail) {
      if (desktopChair() || navMode()) {
        rail.removeAttribute("aria-hidden");
        rail.inert = filesOpen;
      } else {
        rail.setAttribute("aria-hidden", "true");
        rail.inert = true;
      }
    }
    if (backdrop) {
      backdrop.hidden = !filesOpen && !transient;
      backdrop.setAttribute("aria-hidden", String(!filesOpen));
      backdrop.inert = !filesOpen;
    }
    for (const node of document.body?.children ?? []) {
      if (node === drawer || node === rail || node === backdrop) continue;
      node.inert = filesOpen;
    }
  };
  let drawerSettleTimer = null;
  const clearDrawerTransient = ({ sync = true } = {}) => {
    if (drawerSettleTimer !== null) clearTimeout(drawerSettleTimer);
    drawerSettleTimer = null;
    document.body.classList.remove("drawer-drag-active", "drawer-drag-settling");
    projectDrawer()?.style.removeProperty("transform");
    drawerBackdrop()?.style.removeProperty("opacity");
    if (sync) syncDrawerChrome();
  };
  const openDrawer = ({ updateUrl = true, focus = true, preserveTransient = false } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    if (!preserveTransient) clearDrawerTransient({ sync: false });
    if (!drawerIsOpen()) {
      const active = document.activeElement;
      drawerReturnFocus = active instanceof HTMLElement && active !== document.body && !drawer.contains(active)
        ? active
        : null;
    }
    document.body.classList.add("drawer-open");
    syncDrawerChrome();
    if (updateUrl) updateDrawerUrl(true);
    if (focus) {
      const heading = document.querySelector("#project-drawer-title");
      if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
    }
  };
  const closeDrawer = ({ updateUrl = true, restoreFocus = true, preserveTransient = false } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    if (!preserveTransient) clearDrawerTransient({ sync: false });
    const returnFocus = drawerReturnFocus;
    drawerReturnFocus = null;
    document.body.classList.remove("drawer-open");
    syncDrawerChrome();
    if (updateUrl) updateDrawerUrl(false);
    if (!restoreFocus) return;
    if (desktopChair()) drawerToggle()?.focus({ preventScroll: true });
    else if (returnFocus?.isConnected && !returnFocus.inert) returnFocus.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && drawer.contains(document.activeElement)) document.activeElement.blur();
  };
  const trapDrawerFocus = (event) => {
    const panel = drawerIsOpen() ? projectDrawer() : null;
    const focusable = panelFocusables(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    const index = focusable.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (index < 0 || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  const FILE_RETURN_KIND = "qq-file-return";
  const FILE_RETURN_NAME_PREFIX = `${FILE_RETURN_KIND}:`;
  const filePageViewer = () => document.querySelector(".document-viewer-page");
  const currentHref = () => `${location.pathname}${location.search}${location.hash}`;
  const fileReturnHref = (href) => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  };
  const sameHref = (left, right) => fileReturnHref(left) === fileReturnHref(right);
  const mergeHistoryState = (patch) => {
    const current = history.state && typeof history.state === "object" ? { ...history.state } : {};
    return { ...current, ...patch };
  };
  const readFileReturnPayload = (value) => {
    const payload = value && typeof value === "object" ? value : null;
    if (!payload || payload.kind !== FILE_RETURN_KIND) return null;
    const href = fileReturnHref(payload.href);
    const fileHref = fileReturnHref(payload.fileHref);
    const openerPath = String(payload.openerPath ?? "").trim();
    if (!href || !fileHref || !openerPath || !fileHref.includes("/file/")) return null;
    return {
      kind: FILE_RETURN_KIND,
      href,
      fileHref,
      openerPath,
      transcriptTop: Number.isFinite(payload.transcriptTop) ? payload.transcriptTop : 0,
      nonce: String(payload.nonce ?? ""),
    };
  };
  const fileReturnState = (state = history.state) => {
    const owner = state && typeof state === "object" ? state : null;
    return readFileReturnPayload(owner?.qqFileReturn);
  };
  const fileFromState = (state = history.state) => {
    const owner = state && typeof state === "object" ? state : null;
    return readFileReturnPayload(owner?.qqFileFrom);
  };
  const writeWindowNamePayload = (payload) => {
    try { window.name = `${FILE_RETURN_NAME_PREFIX}${JSON.stringify(payload)}`; } catch {}
  };
  const readWindowNamePayload = () => {
    const raw = typeof window.name === "string" ? window.name : "";
    if (!raw.startsWith(FILE_RETURN_NAME_PREFIX)) return null;
    try {
      return readFileReturnPayload(JSON.parse(raw.slice(FILE_RETURN_NAME_PREFIX.length)));
    } catch {
      return null;
    }
  };
  const clearWindowName = () => {
    try {
      if (String(window.name ?? "").startsWith(FILE_RETURN_NAME_PREFIX)) window.name = "";
    } catch {}
  };
  const findFileOpener = (openerPath) => {
    const drawer = projectDrawer();
    if (!drawer) return null;
    return [...drawer.querySelectorAll("a.drawer-entry[data-file-path]")]
      .find((node) => node.dataset.filePath === openerPath) ?? null;
  };
  const recordFileReturnFromLink = (link) => {
    if (!(link instanceof HTMLElement) || String(link.tagName).toUpperCase() !== "A") return;
    const openerPath = String(link.dataset.filePath ?? "").trim();
    if (!openerPath) return;
    const fileHref = fileReturnHref(link.getAttribute("href") ?? link.href);
    if (!fileHref || !fileHref.includes("/file/")) return;
    const transcript = document.querySelector("#transcript");
    const payload = {
      kind: FILE_RETURN_KIND,
      href: currentHref(),
      fileHref,
      openerPath,
      transcriptTop: transcript ? transcript.scrollTop : 0,
      nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    };
    writeWindowNamePayload(payload);
    try { history.replaceState(mergeHistoryState({ qqFileReturn: payload }), "", currentHref()); } catch {}
  };
  const adoptFileReturnFromWindowName = () => {
    if (!filePageViewer()) return;
    const named = readWindowNamePayload();
    clearWindowName();
    if (!named || !sameHref(named.fileHref, currentHref())) return;
    if (fileFromState()) return;
    try { history.replaceState(mergeHistoryState({ qqFileFrom: named }), "", currentHref()); } catch {}
  };
  const matchingFileReturnForBack = () => {
    const payload = fileFromState();
    if (!payload || !sameHref(payload.fileHref, currentHref())) return null;
    return payload;
  };
  const consumeFileReturn = () => {
    const current = history.state && typeof history.state === "object" ? { ...history.state } : {};
    if (!Object.hasOwn(current, "qqFileReturn")) return;
    delete current.qqFileReturn;
    try { history.replaceState(Object.keys(current).length ? current : null, "", currentHref()); } catch {}
  };
  const pendingFileReturn = () => {
    const payload = fileReturnState();
    return Boolean(payload && sameHref(payload.href, currentHref()));
  };
  const restoreFileReturnFromHistory = () => {
    if (filePageViewer()) return;
    const payload = fileReturnState();
    if (!payload) return;
    const matches = sameHref(payload.href, currentHref());
    if (matches) {
      if (!drawerIsOpen()) openDrawer({ updateUrl: false, focus: false });
      const transcript = document.querySelector("#transcript");
      if (transcript) {
        transcriptView = { follow: false, top: payload.transcriptTop };
        transcript.scrollTop = payload.transcriptTop;
        requestAnimationFrame(() => {
          const live = document.querySelector("#transcript");
          if (!live) return;
          live.scrollTop = payload.transcriptTop;
        });
      }
      const focusOpener = () => {
        const opener = findFileOpener(payload.openerPath);
        if (opener instanceof HTMLElement && opener.isConnected && !opener.inert && !opener.closest("[inert]")) {
          opener.focus({ preventScroll: true });
        }
      };
      focusOpener();
      requestAnimationFrame(focusOpener);
    }
    consumeFileReturn();
  };

  const surfaceGestureBlocked = (target) => {
    if (documentViewerIsOpen()) return true;
    if (target.closest("#project-drawer, #project-rail, #project-drawer-backdrop, .document-viewer, #session-chrome, .session-children, #composer, .session-composer, .session-popups")) return true;
    const transcript = target.closest("#transcript");
    // Transcript controls stay native for taps; only a horizontal lock takes the gesture.
    if (!transcript && target.closest("form, a, button, input, textarea, select, option, label, summary, audio, video, [contenteditable]:not([contenteditable=\"false\"]), [role=button], [role=link], [role=textbox], [role=slider], [role=spinbutton], [role=switch], [role=tab], [role=checkbox], [role=radio]")) return true;
    for (let node = target; node; node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const overflowX = getComputedStyle(node).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
    }
    return false;
  };
  const findTouch = (touches, id) => {
    for (let index = 0; index < touches.length; index += 1) {
      if (touches[index].identifier === id) return touches[index];
    }
    return null;
  };
  let surfaceGesture = null;
  const activeTouchOptions = { capture: true, passive: false };
  const endSurfaceGesture = () => {
    surfaceGesture = null;
    document.removeEventListener("touchmove", moveSurfaceGesture, true);
    document.removeEventListener("touchend", finishSurfaceGesture, true);
    document.removeEventListener("touchcancel", finishSurfaceGesture, true);
  };
  const cancelSurfaceGesture = () => {
    const hadDrag = Boolean(surfaceGesture?.horizontal) || panelIsTransient();
    endSurfaceGesture();
    if (hadDrag) clearDrawerTransient();
  };
  const transitionMilliseconds = (node) => {
    if (!(node instanceof Element)) return 0;
    const values = getComputedStyle(node).transitionDuration.split(",");
    return Math.max(0, ...values.map((value) => {
      const duration = parseFloat(value) || 0;
      return value.trim().endsWith("ms") ? duration : duration * 1000;
    }));
  };
  const applySurfaceDrag = (gesture, distance) => {
    const panel = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!panel || !backdrop) return;
    gesture.distance = Math.min(gesture.hiddenDistance, Math.max(0, distance));
    const progress = gesture.distance / gesture.hiddenDistance;
    panel.style.transform = `translate3d(calc(105% - ${gesture.distance}px), 0, 0)`;
    backdrop.style.opacity = String(progress);
    if (!document.body.classList.contains("drawer-drag-active")) {
      document.body.classList.add("drawer-drag-active");
      syncDrawerChrome();
    }
  };
  const settleSurfaceDrag = (gesture, open) => {
    const panel = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!panel || !backdrop) {
      clearDrawerTransient();
      return;
    }
    document.body.classList.remove("drawer-drag-active");
    document.body.classList.add("drawer-drag-settling");
    if (open) {
      if (drawerIsOpen()) syncDrawerChrome();
      else openDrawer({ preserveTransient: true });
    } else if (drawerIsOpen()) closeDrawer({ preserveTransient: true });
    else syncDrawerChrome();
    panel.style.transform = open ? "translate3d(0, 0, 0)" : "translate3d(105%, 0, 0)";
    panel.getBoundingClientRect();
    backdrop.style.opacity = open ? "1" : "0";
    const settleFor = Math.max(transitionMilliseconds(panel), transitionMilliseconds(backdrop));
    drawerSettleTimer = setTimeout(() => clearDrawerTransient(), settleFor ? settleFor + 40 : 0);
  };
  function finishSurfaceGesture(event) {
    const gesture = surfaceGesture;
    const point = gesture && findTouch(event.changedTouches, gesture.id);
    if (!gesture || !point) return;
    endSurfaceGesture();
    if (!gesture.horizontal || event.type === "touchcancel") {
      if (gesture.horizontal && gesture.kind === "drawer") settleSurfaceDrag(gesture, gesture.mode === "close");
      return;
    }
    if (gesture.kind === "nav") {
      const dx = point.clientX - gesture.x;
      const releaseDelay = performance.now() - gesture.lastAt;
      const velocity = releaseDelay <= 120 ? gesture.velocity : 0;
      if (gesture.mode === "open") {
        if (dx >= 30 || velocity >= 0.25) applyChairMode("nav");
      } else if (gesture.mode === "close") {
        if (dx <= -30 || velocity <= -0.25) commitOverlaySession();
      }
      return;
    }
    if (gesture.kind === "drawer") {
      const travel = Math.abs(gesture.distance - (gesture.startDistance ?? 0));
      if (travel < 12) {
        settleSurfaceDrag(gesture, gesture.mode === "close");
        return;
      }
      const releaseDelay = performance.now() - gesture.lastAt;
      const velocity = releaseDelay <= 120 ? gesture.velocity : 0;
      const projectedDistance = gesture.distance + (-velocity) * 320;
      settleSurfaceDrag(gesture, projectedDistance >= gesture.hiddenDistance * .42);
    }
  }
  function moveSurfaceGesture(event) {
    const gesture = surfaceGesture;
    if (!gesture || event.touches.length !== 1) {
      cancelSurfaceGesture();
      return;
    }
    const point = findTouch(event.touches, gesture.id);
    if (!point) {
      cancelSurfaceGesture();
      return;
    }
    const now = performance.now();
    const dx = point.clientX - gesture.x;
    const dy = point.clientY - gesture.y;
    const absoluteX = Math.abs(dx);
    const absoluteY = Math.abs(dy);
    gesture.samples.push({ x: point.clientX, at: now });
    const cutoff = now - 120;
    while (gesture.samples.length > 1 && gesture.samples[0].at < cutoff) gesture.samples.shift();
    if (!gesture.horizontal) {
      if (absoluteY >= 10 && absoluteY > absoluteX * 1.15) {
        endSurfaceGesture();
        return;
      }
      if (gesture.kind === "nav") {
        const closeDx = dx;
        if (closeDx > 8) {
          endSurfaceGesture();
          return;
        }
        if (closeDx > -10 || absoluteX <= absoluteY * 1.45) return;
        gesture.horizontal = true;
      } else if (gesture.kind === "drawer") {
        const closeDx = -dx;
        if (closeDx > 8) {
          endSurfaceGesture();
          return;
        }
        if (closeDx > -10 || absoluteX <= absoluteY * 1.45) return;
        const panel = projectDrawer();
        if (!panel) {
          endSurfaceGesture();
          return;
        }
        gesture.horizontal = true;
        gesture.width = Math.max(1, panel.getBoundingClientRect().width || 1);
        gesture.hiddenDistance = gesture.width * 1.05;
        gesture.startDistance = gesture.hiddenDistance;
      } else {
        if (dx < -10 && absoluteX > absoluteY * 1.45) {
          const panel = projectDrawer();
          if (!panel) {
            endSurfaceGesture();
            return;
          }
          gesture.kind = "drawer";
          gesture.mode = "open";
          gesture.horizontal = true;
          gesture.width = Math.max(1, panel.getBoundingClientRect().width || 1);
          gesture.hiddenDistance = gesture.width * 1.05;
          gesture.startDistance = 0;
        } else if (dx > 10 && absoluteX > absoluteY * 1.45) {
          gesture.kind = "nav";
          gesture.mode = "open";
          gesture.horizontal = true;
        } else {
          return;
        }
      }
    }
    if (gesture.kind === "drawer") {
      const closing = gesture.mode === "close";
      const openDx = -dx;
      if (closing) {
        if (absoluteY > Math.max(18, absoluteX * .68)) {
          cancelSurfaceGesture();
          return;
        }
      } else if (openDx <= 0 || absoluteY > Math.max(18, openDx * .68)) {
        cancelSurfaceGesture();
        return;
      }
      event.preventDefault();
      const anchor = gesture.samples[0];
      gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
      gesture.lastAt = now;
      applySurfaceDrag(gesture, closing ? gesture.startDistance + openDx : openDx);
    } else if (gesture.kind === "nav") {
      event.preventDefault();
      const anchor = gesture.samples[0];
      gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
      gesture.lastAt = now;
      gesture.distance = dx;
    }
  }
  document.addEventListener("touchstart", (event) => {
    if (surfaceGesture) cancelSurfaceGesture();
    else if (panelIsTransient()) clearDrawerTransient();
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.touches.length !== 1 || desktopChair()) return;
    const point = event.touches[0];
    const now = performance.now();
    if (navMode()) {
      surfaceGesture = {
        kind: "nav",
        mode: "close",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    } else if (drawerIsOpen()) {
      if (!target.closest("#project-drawer, #project-drawer-backdrop")) return;
      surfaceGesture = {
        kind: "drawer",
        mode: "close",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    } else if (surfaceGestureBlocked(target)) return;
    else {
      surfaceGesture = {
        kind: "surface",
        mode: "open",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    }
    document.addEventListener("touchmove", moveSurfaceGesture, activeTouchOptions);
    document.addEventListener("touchend", finishSurfaceGesture, { capture: true, passive: true });
    document.addEventListener("touchcancel", finishSurfaceGesture, { capture: true, passive: true });
  }, { capture: true, passive: true });
  window.addEventListener("pagehide", cancelSurfaceGesture);
  window.addEventListener("beforeunload", cancelSurfaceGesture);
  window.addEventListener("popstate", () => {
    cancelSurfaceGesture();
    const sessionMatch = location.pathname.match(/\/session\/(session-[0-9a-fA-F-]{36})\/?$/);
    if (history.state?.qqPage && sessionMatch) {
      const sessionId = sessionMatch[1];
      committedLocation = location.href;
      overlaySessionId = sessionId;
      pendingCanonical = location.href;
      liveSwitch(sessionId, { history: "none", canonical: location.href });
      return;
    }
    if (history.state?.qqPage) {
      const gen = ++navGeneration;
      void prefetchPage(location.href, "high")?.then((page) => {
        if (gen !== navGeneration) return;
        if (!page?.html || !adoptPage(page.html, location.href, "none")) throw new Error("adopt");
      }).catch(() => {
        if (gen !== navGeneration) return;
        location.reload();
      });
      return;
    }
    restoreTranscriptView();
  });
  let pendingClose = false;

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "session-choice") return;
    if (select.value) openSession(select.value);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (desktopChair() || !navMode() || !(form instanceof HTMLFormElement)
      || !form.matches(".session-traversal .new-session")) return;
    // Observe the native submission rather than replacing the button's action.
    // This keeps pointer and keyboard activation single-shot.
    paintChairMode(false);
  });

  document.addEventListener("pointerdown", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const picker = link.matches(".active-project-item, .projects-choice, .session-token");
    if (picker) return;
    const url = consolePageUrl(link.href);
    if (!url || (url.pathname === location.pathname && url.search === location.search)) return;
    abortPrefetchesExcept(url.href);
    prefetchPage(url.href);
  }, { capture: true, passive: true });
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || modifiedClick(event)) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = consolePageUrl(link.href);
    const picker = link.matches(".active-project-item, .projects-choice, .session-token");
    if (!url) return;
    if (!picker && url.pathname === location.pathname && url.search === location.search) return;
    const closesMobileRail = picker && !desktopChair() && navMode()
      && Boolean(link.closest("#project-rail, .session-traversal"));
    event.preventDefault();
    void chairGo(url.href, link);
    if (closesMobileRail) closeMobileRailAfterAction();
  }, true);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const toolCard = target?.closest(".message-tool[data-tool-output]");
    const toolSummary = toolCard?.querySelector(":scope > summary[data-tool-output-summary]");
    if (toolCard instanceof HTMLDetailsElement && toolSummary instanceof HTMLElement
      && (!toolCard.open || toolSummary.contains(target))) {
      event.preventDefault();
      void activateToolCard(toolCard, toolSummary);
      return;
    }
    const fileLink = target?.closest("a.drawer-entry[data-file-path][href]");
    if (fileLink instanceof HTMLElement && event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      recordFileReturnFromLink(fileLink);
    }
    const fileClose = target?.closest("a.document-viewer-close");
    if (fileClose instanceof HTMLElement && filePageViewer() && event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      if (matchingFileReturnForBack() && typeof history.back === "function") {
        event.preventDefault();
        history.back();
        return;
      }
    }
    const viewerOpen = target?.closest("[data-document-viewer-open]");
    if (viewerOpen instanceof HTMLElement) {
      event.preventDefault();
      const viewer = document.getElementById(viewerOpen.getAttribute("data-document-viewer-open") ?? "");
      if (viewer) openDocumentViewer(viewer, viewerOpen);
      return;
    }
    if (target?.closest("[data-document-viewer-close]")) {
      event.preventDefault();
      closeDocumentViewer(target.closest(".document-viewer-dialog") ?? openDocumentViewerDialog());
      return;
    }
    if (target?.closest("#project-drawer-toggle")) {
      event.preventDefault();
      if (drawerIsOpen()) closeDrawer();
      else openDrawer();
      return;
    }
    if (target?.closest(".drawer-close")) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    const dismiss = target?.closest(".workflows-dismiss");
    if (dismiss instanceof HTMLElement) {
      event.preventDefault();
      dismiss.closest(".workflows-popup")?.remove();
      return;
    }
    const traversalAction = target?.closest(".session-traversal a[href], .session-traversal button, .session-traversal input, .session-traversal select, .session-traversal textarea, .session-traversal [role=button], .session-traversal [role=link]");
    if (!desktopChair() && !traversalAction
      && target?.closest(".session-heading-start, .session-project, .session-mobile-id, .session-place")) {
      event.preventDefault();
      toggleChairMode();
      return;
    }
    if (navMode() && !target?.closest("#project-rail, .session-traversal")) {
      event.preventDefault();
      commitOverlaySession();
      return;
    }
    const arm = target?.closest(".close-arm");
    if (arm instanceof HTMLElement) {
      event.preventDefault();
      armClose();
      return;
    }
    if (confirmingClose() && !target?.closest(".session-item-current")) {
      disarmClose();
    }
  });

  document.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement)) return;
    if (!menu.open) return;
    if (!menu.classList.contains("session-menu") && !menu.classList.contains("workflows-menu") && !menu.classList.contains("projects-menu")) return;
    for (const other of document.querySelectorAll("details.session-menu, details.workflows-menu, details.projects-menu")) {
      if (other !== menu) other.open = false;
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === "prompt") {
      fitComposer(event.target);
      persistComposerDraft(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (documentViewerIsOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDocumentViewer();
      }
      return;
    }
    if (event.key === "Escape" && confirmingClose()) {
      event.preventDefault();
      disarmClose();
      restoreCloseFocus();
      return;
    }
    if (drawerIsOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      } else if (event.key === "Tab") {
        trapDrawerFocus(event);
      }
      return;
    }
    const input = event.target;
    const inComposer = input instanceof HTMLTextAreaElement && input.id === "prompt";

    if (inComposer) {
      pendingClose = false;
      if (event.key === "Tab") {
        event.preventDefault();
        completeSlash(input);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        input.form?.requestSubmit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingClose()) {
          disarmClose();
          restoreCloseFocus();
          return;
        }
        if (document.querySelector("#interrupt-form")) {
          submitForm("#interrupt-form");
          return;
        }
        if (dismissSheet()) return;
        input.blur();
      }
      return;
    }

    if (!desktopChair()) return;
    if (editingElsewhere(input)) return;

    const key = event.key;
    if (handleWorkflowMenuKey(event)) return;
    if (handleProjectTreeKey(event)) return;
    if (pendingClose) {
      if (key === "x" || key === "X") {
        event.preventDefault();
        pendingClose = false;
        if (document.querySelector(".overlay-popup")) {
          clickButton('.overlay-dismiss button[value="dismiss"]');
          return;
        }
        if (document.querySelector(".workflows-popup")) {
          document.querySelector(".workflows-popup")?.remove();
          return;
        }
        if (closeWorkflowsMenu()) return;
        submitForm("#close-session");
        return;
      }
      pendingClose = false;
      if (key === "Escape") {
        event.preventDefault();
        return;
      }
    }

    if (key === "Enter") {
      event.preventDefault();
      composer()?.focus();
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (confirmingClose()) {
        disarmClose();
        restoreCloseFocus();
        return;
      }
      if (document.querySelector("#interrupt-form")) {
        submitForm("#interrupt-form");
        return;
      }
      dismissSheet();
      return;
    }
    if (key === "n" || key === "N") {
      event.preventDefault();
      submitForm(".new-session");
      return;
    }
    const overlay = document.querySelector(".overlay-popup");
    if (overlay) {
      const reserved = key === "h" || key === "H" || key === "q" || key === "Q" || key === "x" || key === "X" || key === "Escape";
      let bound = null;
      try { bound = JSON.parse(overlay.dataset.overlayKeys || "{}"); } catch { bound = null; }
      const action = !reserved && bound && bound[key];
      if (typeof action === "string" && action) {
        event.preventDefault();
        clickButton(`.overlay-${action}`);
        return;
      }
    }
    if (key === "f" || key === "F") {
      event.preventDefault();
      setProjectTreeOpen(!projectTreeIsOpen(), true);
      return;
    }
    if (key === "w" || key === "W") {
      event.preventDefault();
      openWorkflowsMenu();
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      neighborProject(-1);
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      neighborProject(1);
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      neighborSession(-1);
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      neighborSession(1);
      return;
    }
    if (key === "q" || key === "Q") {
      event.preventDefault();
      pendingClose = true;
      return;
    }
    if (key === " " || key === "Spacebar") {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("qq:desktop-dictation-toggle"));
      return;
    }
    if (key === "1") {
      event.preventDefault();
      clickButton(".offer-handoff");
      return;
    }
    if (key === "2") {
      event.preventDefault();
      clickButton(".offer-bank");
      return;
    }
    if (key === "3") {
      event.preventDefault();
      clickButton(".offer-ignore");
      return;
    }
    if (key === "j" || key === "J") {
      event.preventDefault();
      scrollTranscript("up");
      return;
    }
    if (key === "k" || key === "K") {
      event.preventDefault();
      scrollTranscript("down");
      return;
    }
    if (key === "PageUp") {
      event.preventDefault();
      scrollTranscript("up");
      return;
    }
    if (key === "PageDown") {
      event.preventDefault();
      scrollTranscript("down");
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      scrollTranscript("home");
      return;
    }
    if (key === "End") {
      event.preventDefault();
      scrollTranscript("end");
      return;
    }
    if (key === "h" || key === "H") event.preventDefault();
  });

  document.addEventListener("htmx:beforeRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement) || form.id !== "composer") return;
    const input = composer();
    // htmx has already captured the request parameters. Empty the admitted
    // draft now so typing can continue while the short admission is in flight.
    if (input instanceof HTMLTextAreaElement) {
      inFlightDraft = input.value;
      input.value = "";
      clearComposerDraft();
      fitComposer(input);
      input.blur();
    }
    anchorTranscript();
  });
  document.addEventListener("htmx:afterRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement) || form.id !== "composer") return;
    const failed = event.detail?.successful === false || event.detail?.failed === true;
    const input = composer();
    if (failed) {
      if (input instanceof HTMLTextAreaElement && !input.value && inFlightDraft) {
        input.value = inFlightDraft;
        persistComposerDraft(input);
        fitComposer(input, { shrink: false });
      }
      return;
    }
    inFlightDraft = "";
    if (input instanceof HTMLTextAreaElement && input.value) persistComposerDraft(input);
    else clearComposerDraft();
  });
  document.addEventListener("scroll", (event) => {
    if (event.target?.id === "transcript") onTranscriptUserScroll(event.target);
  }, true);
  const visualViewport = window.visualViewport;
  if (visualViewport && typeof visualViewport.addEventListener === "function") {
    visualViewport.addEventListener("resize", () => {
      if (transcriptView.follow) showLatest();
    });
  }
  // Jitter buffer for visible text: hold the start of a burst, then leak
  // characters at a steady rate so a 0ms slab does not read as fast→stall→fast.
  // Catchup may rise toward MAX_CPS so we do not trail forever, but it must
  // not collapse a dump back into a 400ms blob.
  const LIVE_SMOOTH_START_MS = 96;
  const LIVE_SMOOTH_IDLE_MS = 180;
  const LIVE_SMOOTH_CPS = 36;
  const LIVE_SMOOTH_MAX_CPS = 52;
  const LIVE_SMOOTH_MAX_CATCHUP_MS = 4000;
  const liveBuffers = new Map();
  let liveRaf = 0;
  let liveStartTimer = 0;
  const liveSmoothOn = () => ownScript?.dataset.liveSmooth === "1";
  const liveNow = () => (typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now());
  const PROVIDER_GAP_SILENCE_MS = 1000;
  const PROVIDER_GAP_ELAPSED_MS = 1000;
  let providerGapSince = 0;
  let providerGapArmed = false;
  let providerGapAwaiting = false;
  let providerGapStopping = false;
  let providerGapWatch = 0;
  let providerGapTick = 0;
  let providerGapShownSecond = -1;
  const turnIsRunning = () => !providerGapStopping && (providerGapAwaiting || Boolean(document.querySelector("#interrupt-submit")));
  const liveToolRunning = () => {
    const tail = document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
    return Boolean(tail?.querySelector?.(".message-tool.tool-running"));
  };
  const clearProviderGapTimers = () => {
    if (providerGapWatch) {
      clearTimeout(providerGapWatch);
      providerGapWatch = 0;
    }
    if (providerGapTick) {
      clearInterval(providerGapTick);
      providerGapTick = 0;
    }
  };
  const providerGapSlot = () => document.getElementById?.("provider-gap") ?? document.querySelector?.(".provider-gap");
  const hideProviderGap = () => {
    const gap = providerGapSlot();
    if (gap) {
      gap.dataset.state = "idle";
      gap.setAttribute("data-state", "idle");
      gap.setAttribute("aria-hidden", "true");
      gap.removeAttribute("aria-label");
      const elapsed = gap.querySelector(".provider-gap-elapsed");
      if (elapsed) {
        elapsed.hidden = true;
        elapsed.textContent = "";
      }
    }
    providerGapShownSecond = -1;
    if (providerGapTick) {
      clearInterval(providerGapTick);
      providerGapTick = 0;
    }
  };
  resetAdoptedSession = () => {
    liveBuffers.clear();
    if (liveRaf) {
      cancelAnimationFrame(liveRaf);
      liveRaf = 0;
    }
    if (liveStartTimer) {
      clearTimeout(liveStartTimer);
      liveStartTimer = 0;
    }
    clearProviderGapTimers();
    providerGapArmed = false;
    providerGapAwaiting = false;
    providerGapStopping = false;
    providerGapSince = 0;
    hideProviderGap();
  };
  const paintProviderGap = () => {
    let gap = providerGapSlot();
    if (!gap) {
      const host = document.getElementById?.("transcript-live") ?? document.querySelector?.("#transcript-live");
      if (!host || typeof document.createElement !== "function") return;
      gap = document.createElement("div");
      gap.id = "provider-gap";
      gap.className = "provider-gap";
      gap.setAttribute("role", "status");
      gap.setAttribute("aria-live", "polite");
      gap.setAttribute("aria-atomic", "true");
      gap.innerHTML = '<span class="provider-gap-caret" aria-hidden="true"></span><span class="provider-gap-elapsed" hidden></span>';
      host.append(gap);
    }
    gap.dataset.state = "on";
    gap.setAttribute("data-state", "on");
    gap.removeAttribute("aria-hidden");
    const waited = Math.max(0, liveNow() - providerGapSince);
    const elapsed = gap.querySelector(".provider-gap-elapsed");
    if (waited >= PROVIDER_GAP_ELAPSED_MS && elapsed) {
      const seconds = Math.max(1, Math.round(waited / 1000));
      elapsed.hidden = false;
      elapsed.textContent = `${seconds}s`;
      if (seconds !== providerGapShownSecond) {
        providerGapShownSecond = seconds;
        gap.setAttribute("aria-label", `Waiting for model · ${seconds}s`);
      }
    } else {
      gap.setAttribute("aria-label", "Waiting for model");
    }
    followLatest();
  };
  const syncProviderGap = () => {
    if (!turnIsRunning() || liveToolRunning()) {
      hideProviderGap();
      return;
    }
    if (liveNow() - providerGapSince < PROVIDER_GAP_SILENCE_MS) return;
    paintProviderGap();
    if (!providerGapTick) providerGapTick = setInterval(syncProviderGap, 250);
  };
  const scheduleProviderGap = () => {
    if (providerGapWatch) clearTimeout(providerGapWatch);
    providerGapWatch = setTimeout(() => {
      providerGapWatch = 0;
      syncProviderGap();
    }, PROVIDER_GAP_SILENCE_MS);
  };
  const noteLiveActivity = () => {
    hideProviderGap();
    providerGapSince = liveNow();
    if (turnIsRunning()) scheduleProviderGap();
  };
  const syncProviderGapForTurn = () => {
    if (document.querySelector("#interrupt-submit")) providerGapAwaiting = false;
    if (!document.querySelector("#interrupt-submit")) providerGapStopping = false;
    if (!turnIsRunning()) {
      providerGapArmed = false;
      providerGapAwaiting = false;
      providerGapStopping = false;
      clearProviderGapTimers();
      hideProviderGap();
      return;
    }
    if (!providerGapArmed) {
      providerGapArmed = true;
      providerGapSince = liveNow();
    }
    if (liveToolRunning()) {
      hideProviderGap();
      scheduleProviderGap();
      return;
    }
    scheduleProviderGap();
  };
  const armProviderGapFromSend = () => {
    providerGapStopping = false;
    providerGapAwaiting = true;
    providerGapArmed = true;
    providerGapSince = liveNow();
    scheduleProviderGap();
  };
  document.addEventListener("htmx:beforeRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "composer") {
      armProviderGapFromSend();
      return;
    }
    if (form.id !== "interrupt-form") return;
    providerGapStopping = true;
    providerGapAwaiting = false;
    providerGapArmed = false;
    clearProviderGapTimers();
    hideProviderGap();
  });
  document.addEventListener("htmx:afterRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement) || form.id !== "composer") return;
    const failed = event.detail?.successful === false || event.detail?.failed === true;
    if (!failed) return;
    providerGapAwaiting = false;
    syncProviderGapForTurn();
  });
  const paintLiveSlice = (state, take) => {
    if (take <= 0) return;
    const slice = state.committed.slice(state.painted, state.painted + take);
    state.painted += slice.length;
    const textNode = state.block.firstChild;
    if (textNode?.nodeType === 3 && textNode === state.block.lastChild && typeof textNode.appendData === "function") {
      textNode.appendData(slice);
    } else {
      state.block.append(slice);
    }
  };
  const flushLiveElt = (elt) => {
    for (const [key, state] of liveBuffers) {
      if (state.elt !== elt) continue;
      paintLiveSlice(state, state.committed.length - state.painted);
      liveBuffers.delete(key);
    }
  };
  const playLive = () => {
    liveRaf = 0;
    const now = liveNow();
    let againAt = Infinity;
    for (const state of liveBuffers.values()) {
      const pending = state.committed.length - state.painted;
      if (pending <= 0) continue;
      if (now < state.startAt) {
        againAt = Math.min(againAt, state.startAt);
        continue;
      }
      const dt = Math.max(0, now - state.lastTick);
      state.lastTick = now;
      let cps = LIVE_SMOOTH_CPS;
      const catchup = pending / (LIVE_SMOOTH_MAX_CATCHUP_MS / 1000);
      if (catchup > cps) cps = Math.min(LIVE_SMOOTH_MAX_CPS, catchup);
      const take = Math.min(pending, Math.max(1, Math.floor((cps * dt) / 1000) || 1));
      paintLiveSlice(state, take);
      if (state.committed.length > state.painted) againAt = Math.min(againAt, now + 16);
      else state.emptyAt = now;
    }
    followLatest();
    if (againAt < Infinity) scheduleLive(againAt - now);
  };
  const scheduleLive = (delayMs) => {
    if (delayMs > 4) {
      if (liveStartTimer) return;
      liveStartTimer = setTimeout(() => {
        liveStartTimer = 0;
        scheduleLive(0);
      }, delayMs);
      return;
    }
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(playLive);
  };
  const appendLiveChars = (block, text) => {
    const textNode = block.firstChild;
    if (textNode?.nodeType === 3 && textNode === block.lastChild && typeof textNode.appendData === "function") {
      textNode.appendData(text);
    } else {
      block.append(text);
    }
  };
  const liveTailElement = (elt) => {
    if (elt instanceof HTMLElement && elt.id === "transcript-live-nodes") return elt;
    return document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
  };
  const applyLivePatch = (elt, data, { smooth = true } = {}) => {
    const tail = liveTailElement(elt);
    if (!(tail instanceof HTMLElement) || typeof data !== "string" || data.length === 0) return false;
    let patch;
    try {
      patch = JSON.parse(data);
    } catch {
      return false;
    }
    if (!patch || typeof patch.op !== "string" || typeof patch.key !== "string") return false;

    if (patch.op === "qq-live-insert" || patch.op === "qq-live-replace") {
      if (typeof patch.html !== "string") return false;
      const target = document.getElementById?.(patch.key) ?? null;
      if (patch.op === "qq-live-insert") {
        if (target && typeof patch.inner === "string") {
          flushLiveElt(tail);
          target.innerHTML = patch.inner;
          globalThis.htmx?.process?.(target);
        } else if (!target && typeof tail.insertAdjacentHTML === "function") {
          tail.insertAdjacentHTML("beforeend", patch.html);
          const inserted = document.getElementById?.(patch.key) ?? tail.lastElementChild;
          globalThis.htmx?.process?.(inserted ?? tail);
        }
        return true;
      }
      // Seal and tool progress restyle only their stable wrapper. Flush any
      // jitter-buffered suffix first so a replacement cannot strand tokens.
      if (target) {
        flushLiveElt(tail);
        target.innerHTML = patch.html;
        globalThis.htmx?.process?.(target);
      }
      return true;
    }

    if (patch.op !== "qq-live-append"
      || !Number.isSafeInteger(patch.from)
      || patch.from < 0
      || typeof patch.text !== "string") return false;
    const block = [...tail.querySelectorAll(".message-live-text")]
      .find((node) => node.dataset.liveKey === patch.key);
    // A recognized append frame must never fall through to HTMX's innerHTML
    // swap. If a reconnect raced an old DOM, the next full live frame
    // recommissions the tail without painting protocol JSON.
    if (!block) return true;
    const state = liveBuffers.get(patch.key);
    const from = state ? state.committed.length : (block.textContent ?? "").length;
    if (from !== patch.from) return true;
    const buffered = smooth && liveSmoothOn() && !block.classList.contains("tool-argument");
    if (!buffered) {
      appendLiveChars(block, patch.text);
      if (state) {
        state.committed += patch.text;
        state.painted = state.committed.length;
      }
      return true;
    }
    const next = state ?? {
      elt: tail,
      block,
      committed: block.textContent ?? "",
      painted: (block.textContent ?? "").length,
      startAt: 0,
      lastTick: 0,
      emptyAt: 0,
    };
    const wasEmpty = next.committed.length === next.painted;
    next.committed += patch.text;
    if (wasEmpty) {
      const now = liveNow();
      const continueBurst = next.emptyAt > 0 && (now - next.emptyAt) < LIVE_SMOOTH_IDLE_MS;
      next.startAt = continueBurst ? now : now + LIVE_SMOOTH_START_MS;
      next.lastTick = next.startAt;
    }
    liveBuffers.set(patch.key, next);
    scheduleLive(Math.max(0, next.startAt - liveNow()));
    return true;
  };
  const swapTargetId = (event) => event.detail?.target?.id || event.target?.id || "";
  const touchesComposer = (id) =>
    id === "session-panel" || id === "session-composer" || id === "session-queue" || id === "pending-queue" || id === "composer";
  const touchesTranscript = (id) =>
    id === "session-panel" || id === "transcript" || id === "transcript-log" || id === "transcript-live"
      || id === "transcript-live-nodes" || id === "transcript-anchor"
      || id.startsWith("live-node-") || id.startsWith("live-assistant-");
  for (const eventName of ["htmx:beforeSwap", "htmx:sseBeforeMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesComposer(id)) captureDraft();
      if (touchesTranscript(id)) captureTranscriptView();
    });
  }
  const ownGeneration = ownScript?.dataset.uiGeneration ?? "";
  document.addEventListener("htmx:sseBeforeMessage", (event) => {
    const elt = event.target instanceof HTMLElement ? event.target : event.detail?.target;
    const source = typeof EventSource !== "undefined" && event.detail?.target instanceof EventSource
      ? event.detail.target
      : null;
    if (source && bootstrapSwitch?.sourceUrl && source.url !== bootstrapSwitch.sourceUrl) {
      event.preventDefault();
      return;
    }
    if (source && activeSseSource && source !== activeSseSource) {
      event.preventDefault();
      return;
    }
    if (elt instanceof HTMLElement
      && elt.id === "session-composer"
      && event.detail?.type === "composer-shell") {
      const currentComposer = document.querySelector("#composer");
      if (currentComposer instanceof HTMLElement) {
        currentComposer.removeAttribute("hx-preserve");
        currentComposer.removeAttribute("id");
      }
    }
    const data = typeof event.detail?.data === "string"
      ? event.detail.data
      : typeof event.detail?.elt?.id === "string" && typeof event.data === "string"
        ? event.data
        : "";
    if (elt instanceof HTMLElement && (elt.id === "switch-meta" || elt.id === "switch-ready")) {
      event.preventDefault();
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const state = bootstrapSwitch;
      if (!state
        || String(payload?.id || "") !== state.id
        || String(payload?.generation ?? "") !== String(state.generation)) return;
      if (elt.id === "switch-meta") {
        state.meta = payload;
        return;
      }
      finishLiveSwitch(payload);
      return;
    }
    if (elt instanceof HTMLElement && elt.id === "ui-generation") {
      event.preventDefault();
      const incoming = data;
      if (ownGeneration && incoming && incoming !== ownGeneration) {
        persistComposerDraft();
        location.reload();
      }
      return;
    }
    if (applyLivePatch(elt, data)) {
      event.preventDefault();
      noteLiveActivity();
      if (!liveSmoothOn()) followLatest();
      return;
    }
    if (elt?.id === "transcript-live-nodes" && typeof data === "string") {
      flushLiveElt(elt);
      noteLiveActivity();
    }
  });
  const paintLiveChannel = (channel, data) => {
    const elt = document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
    if (!applyLivePatch(elt, data, { smooth: channel !== "live-tool-append" })) return;
    noteLiveActivity();
    followLatest();
  };
  document.addEventListener("htmx:sseOpen", (event) => {
    const source = event.detail?.source;
    if (!source || typeof source.addEventListener !== "function") return;
    const stream = document.querySelector("#console-stream");
    let expected = "";
    try { expected = new URL(stream?.getAttribute("sse-connect") || "", location.href).href; } catch {}
    if (source.url && expected && source.url !== expected) {
      if (activeSseSource === source) activeSseSource = null;
      source.close?.();
      return;
    }
    activeSseSource = source;
    if (source.qqLiveBound) return;
    source.qqLiveBound = true;
    source.addEventListener("live-append", (message) => {
      if (source !== activeSseSource) return;
      paintLiveChannel("live-append", message.data);
    });
    source.addEventListener("live-tool-append", (message) => {
      if (source !== activeSseSource) return;
      paintLiveChannel("live-tool-append", message.data);
    });
  });
  for (const eventName of ["htmx:afterSwap", "htmx:sseMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesComposer(id)) restoreDraft();
    });
  }

  for (const eventName of ["htmx:afterSwap", "htmx:afterSettle", "htmx:sseMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesTranscript(id) || id === "session-composer" || id === "composer-turn-controls" || id === "composer") prepareSession();
    });
  }

  window.addEventListener("load", restoreTranscriptView, { once: true });
  window.addEventListener("pageshow", () => {
    adoptFileReturnFromWindowName();
    restoreFileReturnFromHistory();
    restorePersistedDraft();
    restoreTranscriptView();
  });

  const syncInitialChrome = (options = {}) => {
    adoptFileReturnFromWindowName();
    const keepOpenerFocus = pendingFileReturn();
    if (keepOpenerFocus) {
      const payload = fileReturnState();
      transcriptView = { follow: false, top: payload.transcriptTop };
    }
    syncDrawerChrome();
    restoreChairMode();
    prepareSession();
    restoreActiveProjects();
    if (!options.skipValidate) void validateRememberedProjects();
    if (drawerIsOpen()) requestAnimationFrame(() => openDrawer({ updateUrl: false, focus: !keepOpenerFocus }));
    restoreFileReturnFromHistory();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncInitialChrome, { once: true });
  } else {
    syncInitialChrome();
  }

  const serviceWorker = ownScript?.dataset.serviceWorker;
  if (serviceWorker && "serviceWorker" in navigator) {
    window.addEventListener(
      "load",
      () => navigator.serviceWorker.register(serviceWorker, { updateViaCache: "none" }).catch(() => {}),
      { once: true },
    );
  }
})();
