(() => {
  "use strict";

  const livePath = "/qq/";
  const delays = [400, 1000, 2000, 4000];
  let attempt = 0;
  let timer;

  const looksLive = (html) =>
    typeof html === "string" &&
    (html.includes('id="composer"') || html.includes('id="interrupt-form"'));

  const schedule = () => {
    if (attempt >= delays.length) return;
    clearTimeout(timer);
    timer = setTimeout(probe, delays[attempt]);
    attempt += 1;
  };

  const probe = () => {
    fetch(livePath, { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((html) => {
        if (looksLive(html)) {
          location.replace(livePath);
          return;
        }
        schedule();
      })
      .catch(schedule);
  };

  window.addEventListener("online", probe);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") probe();
  });
  probe();
})();
