import { createConsoleHandler, createRootRedirectHandler } from "./http-app.mjs";

export const name = "qq-ui";
export const inject = ["qq", "webServer"];

/** Mount the server-rendered operator surface over the qq session service. */
export function apply(ctx, config) {
  if (ctx.webServer.host !== "127.0.0.1") {
    throw new Error("qq-ui: refusing a non-loopback web server");
  }
  const qq = ctx.get("qq");
  if (!qq) throw new Error("qq-ui: qq service is unavailable");
  const workflowsOf = () => ctx.get?.("qq-workflows", false) ?? null;
  const modelsOf = () => ctx.get?.("qq-models", false) ?? null;
  const finderOf = () => ctx.get?.("image-finder", false) ?? null;
  const basePath = String(config?.basePath ?? "/qq");
  const handler = createConsoleHandler(qq, {
    basePath,
    ssePollMs: config?.ssePollMs,
    liveAssets: config?.liveAssets === true,
    offerFor: (sessionId) => workflowsOf()?.offer?.(sessionId),
    chooseOffer: (sessionId, choice) => workflowsOf()?.choose?.(sessionId, { choice }),
    loginSheetFor: (sessionId) => modelsOf()?.sheetFor?.(sessionId),
    overlayFor: (sessionId) => finderOf()?.overlayFor?.(sessionId),
    chooseOverlay: (sessionId, form) => finderOf()?.chooseOverlay?.(sessionId, form),
  });
  ctx.effect(() => {
    const unregisterConsole = ctx.webServer.register({
      kind: "prefix",
      path: basePath,
      handler,
    });
    const unregisterRoot = ctx.webServer.register({
      kind: "exact",
      path: "/",
      handler: createRootRedirectHandler(basePath),
    });
    return () => {
      handler.dispose();
      unregisterRoot();
      unregisterConsole();
    };
  }, "qq-ui: HTML routes");
}
