(() => {
  "use strict";

  const ownScript = document.currentScript;
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
    if (window.matchMedia("(pointer: fine)").matches) composer()?.focus();
  };

  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === "prompt") {
      fitComposer(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLTextAreaElement) || input.id !== "prompt") return;
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    input.form?.requestSubmit();
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
