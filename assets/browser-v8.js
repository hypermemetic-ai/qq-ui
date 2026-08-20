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
    showLatest();
    requestAnimationFrame(showLatest);
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
  const drawerIsOpen = () => document.body.classList.contains("drawer-open");
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
  const syncDrawerChrome = () => {
    const drawer = projectDrawer();
    const toggle = drawerToggle();
    const backdrop = drawerBackdrop();
    if (!drawer || !toggle || !backdrop) return;
    const open = drawerIsOpen();
    toggle.setAttribute("aria-expanded", String(open));
    drawer.setAttribute("aria-hidden", String(!open));
    drawer.inert = !open;
    backdrop.hidden = !open;
    for (const node of document.body.children) {
      if (node === drawer || node === backdrop || node.classList.contains("drawer-edge")) continue;
      node.inert = open;
    }
  };
  const openDrawer = ({ updateUrl = true, focus = true } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    if (updateUrl && drawer.dataset.drawerPath) {
      const url = new URL(location.href);
      url.searchParams.set("drawer", "");
      location.assign(`${url.pathname}${url.search}${url.hash}`);
      return;
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
    if (!projectDrawer()) return;
    document.body.classList.remove("drawer-open");
    syncDrawerChrome();
    if (updateUrl) updateDrawerUrl(false);
    if (restoreFocus) drawerToggle()?.focus({ preventScroll: true });
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

  let edgeGesture = null;
  const cancelEdgeGesture = () => { edgeGesture = null; };
  document.addEventListener("pointerdown", (event) => {
    if (drawerIsOpen() || desktopChair() || event.button !== 0 || event.clientX > 24) return;
    if (event.pointerType && event.pointerType !== "touch" && event.pointerType !== "pen") return;
    edgeGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), cancelled: false };
  }, { passive: true });
  document.addEventListener("pointermove", (event) => {
    if (!edgeGesture || edgeGesture.id !== event.pointerId) return;
    const dx = event.clientX - edgeGesture.x;
    const dy = event.clientY - edgeGesture.y;
    if (dx < -8 || Math.abs(dy) > Math.max(28, Math.abs(dx) * .72)) edgeGesture.cancelled = true;
  }, { passive: true });
  document.addEventListener("pointerup", (event) => {
    if (!edgeGesture || edgeGesture.id !== event.pointerId) return;
    const gesture = edgeGesture;
    cancelEdgeGesture();
    const dx = event.clientX - gesture.x;
    const dy = Math.abs(event.clientY - gesture.y);
    if (!gesture.cancelled && dx >= 56 && dy <= 42 && performance.now() - gesture.at <= 800) openDrawer();
  }, { passive: true });
  document.addEventListener("pointercancel", cancelEdgeGesture, { passive: true });

  let pendingClose = false;

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "session-choice") return;
    disarmClose();
    if (select.value) openSession(select.value);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
      clickButton("#composer-dictate");
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
  document.addEventListener("htmx:beforeSwap", captureDraft);
  document.addEventListener("htmx:sseBeforeMessage", captureDraft);
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

  window.addEventListener("load", showLatest, { once: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      syncDrawerChrome();
      prepareSession();
      if (drawerIsOpen()) requestAnimationFrame(() => openDrawer({ updateUrl: false }));
    }, { once: true });
  } else {
    syncDrawerChrome();
    prepareSession();
    if (drawerIsOpen()) requestAnimationFrame(() => openDrawer({ updateUrl: false }));
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
