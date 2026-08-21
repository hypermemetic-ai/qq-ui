(() => {
  "use strict";

  const ownScript = document.currentScript;
  const desktopChair = () => window.matchMedia("(min-width: 42.01rem)").matches;
  const composer = () => document.querySelector("#prompt");
  const fitComposer = (input = composer()) => {
    if (!(input instanceof HTMLTextAreaElement)) return;
    input.style.height = "0px";
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
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
    if (input instanceof HTMLTextAreaElement && input.value) {
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
    swapDraft = null;
  };
  const restoreDraft = () => {
    const draft = swapDraft;
    swapDraft = null;
    if (!draft) return;
    const input = draft.kind === "composer"
      ? composer()
      : [...document.querySelectorAll(".queue-edit-text")]
          .find((candidate) => candidate.dataset.messageId === draft.id);
    if (!(input instanceof HTMLTextAreaElement)) return;
    input.value = draft.value;
    if (draft.kind === "composer") fitComposer(input);
    if (draft.focused) {
      input.focus();
      try { input.setSelectionRange(draft.start, draft.end); } catch {}
    }
  };
  const prepareSession = () => {
    restoreTranscriptView();
    fitComposer();
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
  const sessionIds = () => [...document.querySelectorAll("#session-choice option")]
    .map((option) => option.value)
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
    if (!home?.parent?.isConnected) return;
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
  const closeDrawer = ({ updateUrl = true, restoreFocus = true } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    clearDrawerTransient({ sync: false });
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

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("#project-drawer-backdrop") || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    closeDrawer();
  });
  drawerBackdrop()?.addEventListener("touchstart", (event) => {
    event.preventDefault();
    if (drawerIsOpen()) closeDrawer();
  }, { passive: false });

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
    if (open) openDrawer({ preserveTransient: true });
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
      if (gesture.horizontal) clearDrawerTransient();
      return;
    }
    const releaseDelay = performance.now() - gesture.lastAt;
    const velocity = releaseDelay <= 120 ? Math.max(0, gesture.velocity) : 0;
    const projectedDistance = gesture.distance + velocity * 320;
    const open = gesture.distance >= gesture.hiddenDistance * .42 || (gesture.distance >= 12 && projectedDistance >= gesture.hiddenDistance * .42);
    settleSurfaceDrag(gesture, open);
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
      if (dx < -8 || (absoluteY >= 10 && absoluteY > absoluteX * 1.15)) {
        endSurfaceGesture();
        return;
      }
      if (dx < 10 || dx <= absoluteY * 1.45) return;
      gesture.horizontal = true;
      gesture.width = Math.max(1, projectDrawer()?.getBoundingClientRect().width || 1);
      gesture.hiddenDistance = gesture.width * 1.05;
    }
    if (dx <= 0 || absoluteY > Math.max(18, dx * .68)) {
      cancelSurfaceGesture();
      return;
    }
    event.preventDefault();
    const anchor = gesture.samples[0];
    gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
    gesture.lastAt = now;
    applySurfaceDrag(gesture, dx);
  }
  document.addEventListener("touchstart", (event) => {
    if (surfaceGesture) cancelSurfaceGesture();
    else if (drawerIsTransient()) clearDrawerTransient();
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.touches.length !== 1 || !projectDrawer() || drawerIsOpen() || desktopChair() || surfaceGestureBlocked(target)) return;
    const point = event.touches[0];
    const now = performance.now();
    surfaceGesture = {
      id: point.identifier,
      x: point.clientX,
      y: point.clientY,
      lastAt: now,
      distance: 0,
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
    if (target?.closest(".drawer-close, #project-drawer-backdrop")) {
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
    if (!(menu instanceof HTMLDetailsElement) || !menu.classList.contains("session-menu")) return;
    if (!menu.open) disarmClose();
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
  for (const eventName of ["htmx:beforeSwap", "htmx:sseBeforeMessage"]) {
    document.addEventListener(eventName, () => {
      captureDraft();
      captureTranscriptView();
    });
  }
  document.addEventListener("htmx:afterSwap", restoreDraft);
  document.addEventListener("htmx:sseMessage", restoreDraft);

  for (const eventName of ["htmx:afterSwap", "htmx:afterSettle", "htmx:sseMessage"]) {
    document.addEventListener(eventName, (event) => {
      if (
        eventName === "htmx:sseMessage" ||
        event.detail?.target?.id === "session-panel" ||
        event.target?.id === "session-panel"
      ) {
        prepareSession();
      }
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
