window.__ModuleLoader__.load({
  id: "@hypermemetic-ai/qq-ui-alpha3-spike",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";

    const React = require("react");

    const PLUGIN_ID = "@hypermemetic-ai/qq-ui-alpha3-spike";
    const COMMAND_ID = "qq.session.copy-numbered-identity";
    const SESSION_VIEW_ID = "qq-session";
    const HEADER_ENTRY_ID = "qq-numbered-session";
    const THEME_SOURCE = "qq.alpha3-spike";

    const QQ_THEME_TOKENS = Object.freeze({
      "--dsw-alias-bg-base": Object.freeze({ light: "#ffffff", dark: "#050505" }),
      "--dsw-alias-bg-layer-1": Object.freeze({ light: "#f7f7f7", dark: "#0b0b0b" }),
      "--dsw-alias-border-l1": Object.freeze({ light: "#111111", dark: "#eeeeee" }),
      "--dsw-alias-brand-primary": Object.freeze({ light: "#000000", dark: "#ffffff" }),
      "--dsw-alias-label-primary": Object.freeze({ light: "#000000", dark: "#ffffff" }),
    });

    const badgeStyle = Object.freeze({
      appearance: "none",
      background: "var(--dsw-alias-bg-base)",
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: "2px",
      color: "var(--dsw-alias-label-primary)",
      cursor: "pointer",
      font: "600 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace",
      letterSpacing: "0.08em",
      minWidth: "2.6rem",
      padding: "0.3rem 0.45rem",
      textTransform: "uppercase",
    });

    const pageStyle = Object.freeze({
      background: "var(--dsw-alias-bg-base)",
      color: "var(--dsw-alias-label-primary)",
      display: "grid",
      gap: "1rem",
      minHeight: "100%",
      padding: "clamp(1rem, 4vw, 3rem)",
      placeContent: "start",
    });

    /** Derive QQ's display ordinal directly from the official list snapshot. */
    function sessionOrdinal(list, sessionId) {
      const index = Array.isArray(list && list.ids) ? list.ids.indexOf(sessionId) : -1;
      return index < 0 ? null : index + 1;
    }

    function numberedSessionIdentity(list, sessionId) {
      const ordinal = sessionOrdinal(list, sessionId);
      return ordinal === null ? "QQ ?" : `QQ ${ordinal}`;
    }

    function createCommandDirectory() {
      const entries = new Map();
      return Object.freeze({
        register(command) {
          if (!command || typeof command.id !== "string" || typeof command.run !== "function") {
            throw new TypeError("qq command requires a stable id and run function");
          }
          if (entries.has(command.id)) throw new Error(`duplicate QQ command: ${command.id}`);
          entries.set(command.id, command);
          return () => {
            if (entries.get(command.id) === command) entries.delete(command.id);
          };
        },
        dispatch(id, payload) {
          const command = entries.get(id);
          if (!command) throw new Error(`unknown QQ command: ${id}`);
          return command.run(payload);
        },
        ids() {
          return Object.freeze([...entries.keys()]);
        },
      });
    }

    async function copyText(text) {
      if (!globalThis.navigator || typeof globalThis.navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard writing is unavailable in this browser context");
      }
      await globalThis.navigator.clipboard.writeText(text);
    }

    function NumberedSessionAction({ sessionId, useSessions, dispatch }) {
      const identity = useSessions((list) => numberedSessionIdentity(list, sessionId));
      return React.createElement("button", {
        "aria-label": `Copy numbered session identity ${identity}`,
        "data-qq-command": COMMAND_ID,
        onClick: () => { void dispatch(COMMAND_ID, { sessionId }); },
        style: badgeStyle,
        title: `Copy ${identity}`,
        type: "button",
      }, identity);
    }

    class QQFeatureBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }

      static getDerivedStateFromError() {
        return { failed: true };
      }

      componentDidCatch(error) {
        console.error("qq alpha.3 session view failed", error);
      }

      render() {
        if (!this.state.failed) return this.props.children;
        return React.createElement("section", {
          "aria-label": "QQ session page unavailable",
          "data-qq-plugin-root": "session-page-error",
          role: "alert",
          style: pageStyle,
        }, "QQ view unavailable. Stock conversation remains active.");
      }
    }

    function QQSessionContent({ sessionId, useSessions }) {
      const identity = useSessions((list) => numberedSessionIdentity(list, sessionId));
      const title = useSessions((list) => list.byId?.[sessionId]?.displayTitle ?? sessionId);
      return React.createElement("section", {
        "aria-label": "QQ session page",
        "data-qq-plugin-root": "session-page",
        style: pageStyle,
      },
      React.createElement("p", { style: { font: "600 12px/1 ui-monospace, monospace", letterSpacing: "0.12em", margin: 0 } }, "QQ CORE / ALPHA.3"),
      React.createElement("h1", { style: { font: "600 clamp(1.6rem, 5vw, 3.4rem)/0.95 system-ui", margin: 0 } }, identity),
      React.createElement("p", { style: { margin: 0 } }, title),
      React.createElement("p", { style: { margin: 0, maxWidth: "42rem" } },
        "This isolated QQ-owned view is contributed to the stock DSH conversation target. Stock transcript, composer, interactions, transport, and repair remain mounted."));
    }

    function QQSessionView(props) {
      return React.createElement(QQFeatureBoundary, null, React.createElement(QQSessionContent, props));
    }

    exports.name = "qq-ui-alpha3-spike-client";
    exports.inject = ["slots", "theme", "sessions", "commandUi"];
    exports.COMMAND_ID = COMMAND_ID;
    exports.HEADER_ENTRY_ID = HEADER_ENTRY_ID;
    exports.PLUGIN_ID = PLUGIN_ID;
    exports.QQ_THEME_TOKENS = QQ_THEME_TOKENS;
    exports.SESSION_VIEW_ID = SESSION_VIEW_ID;
    exports.NumberedSessionAction = NumberedSessionAction;
    exports.QQFeatureBoundary = QQFeatureBoundary;
    exports.QQSessionContent = QQSessionContent;
    exports.QQSessionView = QQSessionView;
    exports.createCommandDirectory = createCommandDirectory;
    exports.numberedSessionIdentity = numberedSessionIdentity;
    exports.sessionOrdinal = sessionOrdinal;

    exports.apply = function apply(ctx) {
      const commands = createCommandDirectory();
      ctx.provide("qqCommands", commands);

      ctx.effect(() => commands.register({
        id: COMMAND_ID,
        run: async ({ sessionId }) => {
          const identity = numberedSessionIdentity(ctx.sessions.list.getSnapshot(), sessionId);
          await copyText(identity);
          return identity;
        },
      }), "qq-alpha3: command");

      ctx.effect(() => ctx.theme.overrideTokens(THEME_SOURCE, QQ_THEME_TOKENS), "qq-alpha3: theme tokens");

      ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
        name: "conversation.session.header.actions",
        id: HEADER_ENTRY_ID,
        order: 20,
        inject: (sessionId) => ({
          dispatch: (id, payload) => commands.dispatch(id, payload),
        }),
      }, NumberedSessionAction));

      ctx.slots.inject("conversation.view", () => ctx.slots.register({
        name: "conversation.view",
        id: SESSION_VIEW_ID,
        label: "QQ",
        order: 50,
      }, QQSessionView));

      ctx.effect(() => ctx.commandUi.register({
        name: "qq",
        description: "QQ session actions",
        available: () => true,
        ui: {
          kind: "popupSelect",
          options: async () => [{ id: COMMAND_ID, label: "Copy numbered session identity" }],
          onSelect: async (option, session) => {
            if (option.id !== COMMAND_ID) throw new Error(`unknown /qq action: ${option.id}`);
            await commands.dispatch(COMMAND_ID, { sessionId: session.sessionId });
          },
        },
      }), "qq-alpha3: /qq command");
    };

    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
