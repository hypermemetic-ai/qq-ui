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

  let pendingClose = false;

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "session-choice") return;
    disarmClose();
    if (select.value) openSession(select.value);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
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
    document.addEventListener("DOMContentLoaded", prepareSession, { once: true });
  } else {
    prepareSession();
  }

  const serviceWorker = ownScript?.dataset.serviceWorker;
  if (serviceWorker && "serviceWorker" in navigator) {
    window.addEventListener(
      "load",
      () => navigator.serviceWorker.register(serviceWorker).catch(() => {}),
      { once: true },
    );
  }
})();
