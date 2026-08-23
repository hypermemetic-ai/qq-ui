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
  const showLatest = () => {
    const transcript = document.querySelector("#transcript");
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  };
  const transcriptBottomGap = 48;
  let transcriptView = { follow: true, top: 0 };
  const captureTranscriptView = (transcript = document.querySelector("#transcript")) => {
    if (!transcript) return;
    transcriptView = {
      follow: transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= transcriptBottomGap,
      top: transcript.scrollTop,
    };
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
  const sessionIds = () => [...document.querySelectorAll(".session-token[data-session-id]")]
    .map((token) => token.dataset.sessionId)
    .filter(Boolean);
  const openSession = (sessionId) => {
    if (!sessionId || sessionId === currentSessionId()) return;
    const projectMatch = location.pathname.match(/^(.*\/project\/[^/]+)\/session\/session-[0-9a-fA-F-]{36}(?:\/|$)/);
    if (projectMatch) {
      location.assign(`${projectMatch[1]}/session/${sessionId}`);
      return;
    }
    const match = location.pathname.match(/^(.*)\/session\/session-[0-9a-fA-F-]{36}(?:\/|$)/);
    const base = match ? match[1] : "/qq";
    location.assign(`${base}/session/${sessionId}`);
  };
  const confirmingClose = () => document.querySelector(".session-controls.close-confirming");
  const restoreCloseFocus = () => {
    const arm = document.querySelector(".close-arm");
    if (arm instanceof HTMLElement) arm.focus();
  };
  const disarmClose = () => {
    const controls = document.querySelector(".session-controls");
    const confirm = document.querySelector(".close-confirm");
    const arm = document.querySelector(".close-arm");
    if (!controls) return;
    controls.classList.remove("close-confirming");
    if (confirm) confirm.hidden = true;
    if (arm) arm.hidden = false;
  };
  const armClose = () => {
    const controls = document.querySelector(".session-controls");
    const confirm = document.querySelector(".close-confirm");
    const arm = document.querySelector(".close-arm");
    const keep = document.querySelector(".close-keep");
    if (!controls || !confirm) return;
    controls.classList.add("close-confirming");
    confirm.hidden = false;
    if (arm) arm.hidden = true;
    if (keep instanceof HTMLElement) keep.focus();
  };
  const neighborSession = (delta) => {
    const ids = sessionIds();
    const current = currentSessionId();
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
    label: String(item?.title || item?.querySelector?.(".active-project-label")?.textContent || "").trim(),
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
    link.title = entry.label;
    const mark = document.createElement("span");
    mark.className = "active-project-mark";
    mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "active-project-label";
    label.textContent = entry.label;
    link.append(mark, label);
    row.append(link);
    return row;
  };
  const currentProjectSessionHref = () => {
    const id = currentSessionId();
    if (!id || !location.pathname.includes(`/session/${id}`)) return "";
    return new URL(location.pathname, location.origin).href;
  };
  const restoreProjectChoiceDestinations = (remembered, currentKey, currentIsActive) => {
    const destinations = new Map(remembered.map((entry) => [projectIdentity(entry), entry.href]));
    const currentHref = currentIsActive ? currentProjectSessionHref() : "";
    for (const link of document.querySelectorAll(".projects-choice[data-project]")) {
      const key = projectIdentity({ project: link.dataset.project, folder: link.dataset.folder });
      const href = key === currentKey && currentHref ? currentHref : destinations.get(key);
      if (href) link.href = href;
    }
  };
  const restoreActiveProjects = () => {
    const rail = document.querySelector("#project-rail");
    const list = rail?.querySelector(".active-projects ol");
    if (!rail || !list) return;
    const currentKey = projectIdentity({ project: rail.dataset.currentProject, folder: rail.dataset.currentFolder });
    const currentIsActive = rail.dataset.currentActive === "true";
    const rememberedAll = readRememberedProjects();
    const destinations = new Map(rememberedAll.map((entry) => [projectIdentity(entry), entry.href]));
    const existing = new Map(activeProjectItems().map((item) => [projectIdentity(activeProjectEntry(item)), item.closest("li")]));
    const currentHref = currentIsActive ? currentProjectSessionHref() : "";
    for (const [key, row] of existing) {
      const link = row?.querySelector?.(".active-project-item");
      const href = key === currentKey && currentHref ? currentHref : destinations.get(key);
      if (href && link instanceof HTMLElement && link.tagName === "A") link.href = href;
    }
    const remembered = rememberedAll.filter((entry) => currentIsActive || projectIdentity(entry) !== currentKey);
    const rows = [];
    const used = new Set();
    for (const entry of remembered) {
      const key = projectIdentity(entry);
      if (used.has(key)) continue;
      used.add(key);
      rows.push(existing.get(key) ?? buildActiveProjectItem(entry));
    }
    for (const [key, row] of existing) {
      if (used.has(key)) continue;
      used.add(key);
      rows.push(row);
    }
    list.replaceChildren(...rows);
    restoreProjectChoiceDestinations(rememberedAll, currentKey, currentIsActive);
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
  const responseHasSession = (response) => response.ok && /\/session\/session-[0-9a-f-]+(?:\/|$)/i.test(new URL(response.url).pathname);
  const validateRememberedProjects = async () => {
    const current = activeProjectItems().find((item) => item.matches('[aria-current="page"]'));
    const candidates = activeProjectItems().filter((item) => item !== current).map(activeProjectEntry);
    await Promise.all(candidates.map(async (entry) => {
      try {
        const response = await fetch(entry.href, { method: "HEAD", headers: { Accept: "text/html" } });
        if (!responseHasSession(response)) removeActiveProject(entry);
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
    location.assign(projects[(index + delta + projects.length) % projects.length].href);
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
    const start = parsed.querySelector("#project-drawer .drawer-start-session[action]");
    if (start instanceof HTMLFormElement) {
      let href = "";
      try { href = new URL(start.getAttribute("action") ?? "", responseUrl).href; } catch {}
      if (href) entries.unshift({ kind: "session", label: "session", href, project: "", folder: "", fileKind: "", action: "create" });
    }
    return entries;
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
      } else if (entry.kind === "session") {
        const add = document.createElement("span");
        add.className = "project-tree-add";
        add.setAttribute("aria-hidden", "true");
        add.textContent = "+";
        button.append(add, label);
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
      const entries = folderEntries(html, response.url);
      const column = renderProjectTreeColumn(entries, depth, parentNode);
      if (depth === 0) void discoverActiveProjects(entries);
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
    location.assign(node.dataset.href);
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
    location.assign(node.dataset.href);
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
    const node = event.target instanceof Element ? event.target.closest(".project-tree-node") : null;
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    selectProjectTreeNode(node);
    activateProjectTreeNode(node, false);
  });

  const projectDrawer = () => document.querySelector("#project-drawer");
  const drawerToggle = () => document.querySelector("#project-drawer-toggle");
  const drawerBackdrop = () => document.querySelector("#project-drawer-backdrop");
  let drawerReturnFocus = null;
  const drawerIsOpen = () => document.body.classList.contains("drawer-open");
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
  const drawerFocusables = () => {
    const drawer = projectDrawer();
    if (!drawer) return [];
    return [...drawer.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node instanceof HTMLElement && !node.hidden);
  };
  const drawerIsTransient = () => document.body.classList.contains("drawer-drag-active") || document.body.classList.contains("drawer-drag-settling");
  const syncDrawerChrome = () => {
    const drawer = projectDrawer();
    const toggle = drawerToggle();
    const backdrop = drawerBackdrop();
    if (!drawer || !backdrop) return;
    const open = drawerIsOpen();
    const transient = drawerIsTransient();
    toggle?.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
    drawer.inert = !open;
    backdrop.hidden = !open && !transient;
    backdrop.setAttribute("aria-hidden", String(!open));
    backdrop.inert = !open;
    for (const node of document.body.children) {
      if (node === drawer || node === backdrop) continue;
      node.inert = open;
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
    const focusable = drawerFocusables();
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
    if (target.closest("#project-drawer, #project-drawer-backdrop, .document-viewer, form, a, button, input, textarea, select, option, label, summary, audio, video, [contenteditable]:not([contenteditable=\"false\"]), [role=button], [role=link], [role=textbox], [role=slider], [role=spinbutton], [role=switch], [role=tab], [role=checkbox], [role=radio]")) return true;
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
    const hadDrag = Boolean(surfaceGesture?.horizontal) || drawerIsTransient();
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
    const drawer = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!drawer || !backdrop) return;
    gesture.distance = Math.min(gesture.hiddenDistance, Math.max(0, distance));
    const progress = gesture.distance / gesture.hiddenDistance;
    drawer.style.transform = `translate3d(calc(-105% + ${gesture.distance}px), 0, 0)`;
    backdrop.style.opacity = String(progress);
    if (!document.body.classList.contains("drawer-drag-active")) {
      document.body.classList.add("drawer-drag-active");
      syncDrawerChrome();
    }
  };
  const settleSurfaceDrag = (gesture, open) => {
    const drawer = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!drawer || !backdrop) {
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
    drawer.getBoundingClientRect();
    drawer.style.transform = open ? "translate3d(0, 0, 0)" : "translate3d(-105%, 0, 0)";
    backdrop.style.opacity = open ? "1" : "0";
    const settleFor = Math.max(transitionMilliseconds(drawer), transitionMilliseconds(backdrop));
    drawerSettleTimer = setTimeout(() => clearDrawerTransient(), settleFor ? settleFor + 40 : 0);
  };
  function finishSurfaceGesture(event) {
    const gesture = surfaceGesture;
    const point = gesture && findTouch(event.changedTouches, gesture.id);
    if (!gesture || !point) return;
    endSurfaceGesture();
    if (!gesture.horizontal || event.type === "touchcancel") {
      if (gesture.horizontal) settleSurfaceDrag(gesture, gesture.mode === "close");
      return;
    }
    const travel = Math.abs(gesture.distance - (gesture.startDistance ?? 0));
    if (travel < 12) {
      settleSurfaceDrag(gesture, gesture.mode === "close");
      return;
    }
    const releaseDelay = performance.now() - gesture.lastAt;
    const velocity = releaseDelay <= 120 ? gesture.velocity : 0;
    const projectedDistance = gesture.distance + velocity * 320;
    settleSurfaceDrag(gesture, projectedDistance >= gesture.hiddenDistance * .42);
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
    const closing = gesture.mode === "close";
    gesture.samples.push({ x: point.clientX, at: now });
    const cutoff = now - 120;
    while (gesture.samples.length > 1 && gesture.samples[0].at < cutoff) gesture.samples.shift();
    if (!gesture.horizontal) {
      if (closing) {
        if (dx > 8 || (absoluteY >= 10 && absoluteY > absoluteX * 1.15)) {
          endSurfaceGesture();
          return;
        }
        if (dx > -10 || absoluteX <= absoluteY * 1.45) return;
      } else {
        if (dx < -8 || (absoluteY >= 10 && absoluteY > absoluteX * 1.15)) {
          endSurfaceGesture();
          return;
        }
        if (dx < 10 || dx <= absoluteY * 1.45) return;
      }
      gesture.horizontal = true;
      gesture.width = Math.max(1, projectDrawer()?.getBoundingClientRect().width || 1);
      gesture.hiddenDistance = gesture.width * 1.05;
      gesture.startDistance = closing ? gesture.hiddenDistance : 0;
    }
    if (closing) {
      if (absoluteY > Math.max(18, absoluteX * .68)) {
        cancelSurfaceGesture();
        return;
      }
    } else if (dx <= 0 || absoluteY > Math.max(18, dx * .68)) {
      cancelSurfaceGesture();
      return;
    }
    event.preventDefault();
    const anchor = gesture.samples[0];
    gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
    gesture.lastAt = now;
    applySurfaceDrag(gesture, closing ? gesture.hiddenDistance + dx : dx);
  }
  document.addEventListener("touchstart", (event) => {
    if (surfaceGesture) cancelSurfaceGesture();
    else if (drawerIsTransient()) clearDrawerTransient();
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.touches.length !== 1 || !projectDrawer() || desktopChair()) return;
    const closing = drawerIsOpen();
    if (closing) {
      if (!target.closest("#project-drawer, #project-drawer-backdrop")) return;
    } else if (surfaceGestureBlocked(target)) return;
    const point = event.touches[0];
    const now = performance.now();
    surfaceGesture = {
      mode: closing ? "close" : "open",
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
    document.addEventListener("touchmove", moveSurfaceGesture, activeTouchOptions);
    document.addEventListener("touchend", finishSurfaceGesture, { capture: true, passive: true });
    document.addEventListener("touchcancel", finishSurfaceGesture, { capture: true, passive: true });
  }, { capture: true, passive: true });
  window.addEventListener("pagehide", cancelSurfaceGesture);
  window.addEventListener("beforeunload", cancelSurfaceGesture);
  window.addEventListener("popstate", cancelSurfaceGesture);

  let pendingClose = false;

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "session-choice") return;
    disarmClose();
    if (select.value) openSession(select.value);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
    const arm = target?.closest(".close-arm");
    if (arm instanceof HTMLElement) {
      event.preventDefault();
      armClose();
      return;
    }
    const keep = target?.closest(".close-keep");
    if (keep instanceof HTMLElement) {
      event.preventDefault();
      disarmClose();
      restoreCloseFocus();
      return;
    }
    if (confirmingClose() && !target?.closest(".session-controls")) {
      disarmClose();
    }
  });

  document.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement)) return;
    if (menu.classList.contains("session-menu") && !menu.open) disarmClose();
    if (!menu.open) return;
    if (!menu.classList.contains("session-menu") && !menu.classList.contains("workflows-menu") && !menu.classList.contains("projects-menu")) return;
    for (const other of document.querySelectorAll("details.session-menu, details.workflows-menu, details.projects-menu")) {
      if (other !== menu) other.open = false;
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === "prompt") {
      fitComposer(event.target);
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

    if (event.key === "Escape" && confirmingClose()) {
      event.preventDefault();
      disarmClose();
      restoreCloseFocus();
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
      input.value = "";
      fitComposer(input);
    }
  });
  document.addEventListener("scroll", (event) => {
    if (event.target?.id === "transcript") captureTranscriptView(event.target);
  }, true);
  const appendLiveTail = (elt, data) => {
    if (!(elt instanceof HTMLElement) || elt.id !== "transcript-live-text") return false;
    if (typeof data !== "string" || data.length === 0) return false;
    let patch;
    try {
      patch = JSON.parse(data);
    } catch {
      return false;
    }
    if (patch?.op !== "qq-live-append"
      || typeof patch.key !== "string"
      || !Number.isSafeInteger(patch.from)
      || patch.from < 0
      || typeof patch.text !== "string") return false;
    const block = [...elt.querySelectorAll(".message-live-text")]
      .find((node) => node.dataset.liveKey === patch.key);
    // A recognized append frame must never fall through to HTMX's innerHTML
    // swap. If a reconnect raced an old DOM, the next full frame recommissions
    // the cell without ever painting protocol JSON into the transcript.
    if (!block || (block.textContent ?? "").length !== patch.from) return true;
    const textNode = block.firstChild;
    if (textNode?.nodeType === 3 && textNode === block.lastChild && typeof textNode.appendData === "function") {
      textNode.appendData(patch.text);
    } else {
      block.append(patch.text);
    }
    return true;
  };
  const swapTargetId = (event) => event.detail?.target?.id || event.target?.id || "";
  const touchesComposer = (id) =>
    id === "session-panel" || id === "session-composer" || id === "session-queue" || id === "pending-queue" || id === "composer";
  const touchesTranscript = (id) =>
    id === "session-panel" || id === "transcript" || id === "transcript-log" || id === "transcript-live"
      || id === "transcript-live-text" || id === "transcript-live-tool"
      || id === "transcript-anchor" || id.startsWith("live-assistant-");
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
    if (elt instanceof HTMLElement && elt.id === "ui-generation") {
      event.preventDefault();
      const incoming = typeof event.detail?.data === "string"
        ? event.detail.data
        : typeof event.data === "string" ? event.data : "";
      if (ownGeneration && incoming && incoming !== ownGeneration) location.reload();
      return;
    }
    const data = typeof event.detail?.data === "string"
      ? event.detail.data
      : typeof event.detail?.elt?.id === "string" && typeof event.data === "string"
        ? event.data
        : "";
    if (!appendLiveTail(elt, data)) return;
    event.preventDefault();
    if (transcriptView.follow) showLatest();
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
      if (touchesTranscript(id) || id === "session-composer") prepareSession();
    });
  }

  window.addEventListener("load", restoreTranscriptView, { once: true });
  window.addEventListener("pageshow", () => {
    adoptFileReturnFromWindowName();
    restoreFileReturnFromHistory();
  });

  const syncInitialChrome = () => {
    adoptFileReturnFromWindowName();
    const keepOpenerFocus = pendingFileReturn();
    if (keepOpenerFocus) {
      const payload = fileReturnState();
      transcriptView = { follow: false, top: payload.transcriptTop };
    }
    syncDrawerChrome();
    prepareSession();
    restoreActiveProjects();
    void validateRememberedProjects();
    void hydrateProjectTree();
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
