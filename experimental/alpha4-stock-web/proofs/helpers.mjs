import { readFile } from "node:fs/promises";

class FakeComponent {
  constructor(props) {
    this.props = props ?? {};
    this.state = {};
  }
}

export const fakeReact = Object.freeze({
  Component: FakeComponent,
  createElement(type, props, ...children) {
    return Object.freeze({ type, props: Object.freeze({ ...(props ?? {}), children: Object.freeze(children) }) });
  },
});

export async function loadClientSource(sourceUrl) {
  const source = await readFile(sourceUrl, "utf8");
  const module = { exports: {} };
  const require = (id) => {
    if (id === "react") return fakeReact;
    throw new Error(`unexpected client source dependency: ${id}`);
  };
  Function("require", "module", "exports", source)(require, module, module.exports);
  return module.exports;
}

export function createLifecycleBench(sessionIds = ["session-b", "session-a"]) {
  const contributions = new Map();
  const themeLayers = new Map();
  const slashCommands = new Map();
  const providers = new Map();
  const owned = [];

  const own = (dispose) => {
    if (typeof dispose === "function") owned.push(dispose);
    return dispose;
  };

  const ctx = {
    effect(setup) {
      return own(setup());
    },
    provide(name, value) {
      if (providers.has(name)) throw new Error(`duplicate provider: ${name}`);
      providers.set(name, value);
      own(() => {
        if (providers.get(name) === value) providers.delete(name);
      });
    },
    sessions: {
      list: {
        getSnapshot: () => ({ ids: [...sessionIds] }),
      },
    },
    slots: {
      inject(name, setup) {
        const dispose = setup();
        return own(dispose);
      },
      register(options, component) {
        const key = `${options.name}:${options.id ?? "single"}`;
        if (contributions.has(key)) throw new Error(`duplicate slot contribution: ${key}`);
        const entry = Object.freeze({ ...options, component });
        contributions.set(key, entry);
        return () => {
          if (contributions.get(key) === entry) contributions.delete(key);
        };
      },
    },
    theme: {
      overrideTokens(source, tokens) {
        if (themeLayers.has(source)) throw new Error(`duplicate theme layer: ${source}`);
        themeLayers.set(source, tokens);
        return () => {
          if (themeLayers.get(source) === tokens) themeLayers.delete(source);
        };
      },
    },
    commandUi: {
      register(command) {
        if (slashCommands.has(command.name)) throw new Error(`duplicate slash command: ${command.name}`);
        slashCommands.set(command.name, command);
        return () => {
          if (slashCommands.get(command.name) === command) slashCommands.delete(command.name);
        };
      },
    },
  };

  return {
    ctx,
    contributions,
    themeLayers,
    slashCommands,
    providers,
    async dispose() {
      const errors = [];
      while (owned.length > 0) {
        try {
          await owned.pop()?.();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "lifecycle bench disposal failed");
    },
  };
}
