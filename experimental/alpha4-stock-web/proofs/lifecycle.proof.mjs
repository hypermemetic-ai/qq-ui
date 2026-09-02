#!/usr/bin/env node
import assert from "node:assert/strict";
import { createLifecycleBench, loadClientSource } from "./helpers.mjs";

const client = await loadClientSource(new URL("../src/client.cjs", import.meta.url));
assert.deepEqual(client.inject, ["slots", "theme", "sessions", "commandUi"]);
assert.equal(client.sessionOrdinal({ ids: ["b", "a"] }, "a"), 2);
assert.equal(client.sessionOrdinal({ ids: ["b", "a"] }, "missing"), null);
assert.equal(client.numberedSessionIdentity({ ids: ["b", "a"] }, "a"), "QQ 2");
assert.equal(client.numberedSessionIdentity({ ids: ["b", "a"] }, "missing"), "QQ ?");

const originalNavigator = globalThis.navigator;
const copied = [];
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async (value) => { copied.push(value); } } },
});

try {
  for (let generation = 1; generation <= 2; generation += 1) {
    const bench = createLifecycleBench();
    client.apply(bench.ctx);

    assert.deepEqual([...bench.contributions.keys()].sort(), [
      "conversation.session.header.actions:qq-numbered-session",
      "conversation.view:qq-session",
    ]);
    assert.deepEqual([...bench.themeLayers.keys()], ["qq.alpha4-spike"]);
    assert.deepEqual([...bench.slashCommands.keys()], ["qq"]);
    assert.deepEqual([...bench.providers.keys()], ["qqCommands"]);
    assert.deepEqual(bench.providers.get("qqCommands").ids(), [client.COMMAND_ID]);

    const header = bench.contributions.get("conversation.session.header.actions:qq-numbered-session");
    assert.equal(header.order, 20);
    assert.equal(header.component, client.NumberedSessionAction);
    const injected = header.inject("session-a");
    await injected.dispatch(client.COMMAND_ID, { sessionId: "session-a" });
    assert.equal(copied.at(-1), "QQ 2");

    const page = bench.contributions.get("conversation.view:qq-session");
    assert.equal(page.label, "QQ");
    assert.equal(page.order, 50);
    assert.equal(page.component, client.QQSessionView);
    const pageTree = page.component({ sessionId: "session-a", useSessions: () => { throw new Error("not rendered above boundary"); } });
    assert.equal(pageTree.type, client.QQFeatureBoundary);
    assert.equal(pageTree.props.children[0].type, client.QQSessionContent);
    const pageContent = client.QQSessionContent({
      sessionId: "session-a",
      useSessions: (selector) => selector({
        ids: ["session-b", "session-a"],
        byId: { "session-a": { displayTitle: "Architecture spike" } },
      }),
    });
    assert.equal(pageContent.type, "section");
    assert.equal(pageContent.props["data-qq-plugin-root"], "session-page");
    assert.equal(pageContent.props.children[1].props.children[0], "QQ 2");
    assert.equal(pageContent.props.children[2].props.children[0], "Architecture spike");
    const boundary = new client.QQFeatureBoundary({ children: pageContent });
    assert.equal(boundary.render(), pageContent);
    boundary.state = client.QQFeatureBoundary.getDerivedStateFromError(new Error("bad feature"));
    assert.equal(boundary.render().props["data-qq-plugin-root"], "session-page-error");

    const slash = bench.slashCommands.get("qq");
    assert.equal(slash.available({ sessionId: "session-a" }), true);
    assert.deepEqual(await slash.ui.options({ sessionId: "session-a" }, new AbortController().signal), [
      { id: client.COMMAND_ID, label: "Copy numbered session identity" },
    ]);
    await slash.ui.onSelect({ id: client.COMMAND_ID, label: "Copy numbered session identity" }, { sessionId: "session-a" });
    assert.equal(copied.at(-1), "QQ 2");

    const action = client.NumberedSessionAction({
      sessionId: "session-a",
      useSessions: (selector) => selector({ ids: ["session-b", "session-a"] }),
      dispatch: injected.dispatch,
    });
    assert.equal(action.type, "button");
    assert.equal(action.props.children[0], "QQ 2");
    assert.equal(action.props["data-qq-command"], client.COMMAND_ID);
    action.props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(copied.at(-1), "QQ 2");

    const oldDirectory = bench.providers.get("qqCommands");
    await bench.dispose();
    assert.equal(bench.contributions.size, 0, `generation ${generation}: stale slot registration`);
    assert.equal(bench.themeLayers.size, 0, `generation ${generation}: stale theme layer`);
    assert.equal(bench.slashCommands.size, 0, `generation ${generation}: stale slash command`);
    assert.equal(bench.providers.size, 0, `generation ${generation}: stale provider`);
    assert.deepEqual(oldDirectory.ids(), [], `generation ${generation}: stale QQ command`);
  }
} finally {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
}

console.log("alpha4 lifecycle proof passed: activation, disposal, reapplication, shared dispatch, no stale registrations");
