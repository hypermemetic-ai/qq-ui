# QQ UI architectural direction

> **Status: working design, not an implementation specification.** This document records the intended direction, principles, and review invariants for QQ UI. It does not claim that the current server-rendered console already has this shape. Any manifest or API examples are illustrative; choices listed under “Open decisions” remain open. Change an invariant deliberately and document why rather than letting an implementation accident decide it.

## Goal

QQ UI should be a dependable shell and delivery boundary for independently evolvable operator capabilities. Ordinary feature work should be local, removable, composable, and fast to iterate on. A weak or unfinished feature must be ignorable and unable to destabilize sessions, navigation, or the rest of the UI.

The measure of success is not a React rewrite or architectural purity. It is that supported paths are obvious, dangerous custom behavior is difficult, and an operator can add useful UI and see results quickly without reopening connection, synchronization, routing, or responsive-shell design.

The current console is an ESM Cordis plugin implemented with JavaScript templates, HTTP handlers, HTMX, SSE, browser code, and CSS. Those pieces intentionally form one delivery boundary today. Migration must respect its server-first behavior, loopback trust boundary, capability, and mobile/operator UX. The direction below is a seam to grow toward, not a claim that migration has happened.

## Principles and ownership

Simplification must happen on two independent axes:

1. **Operational ownership.** One supported DSH client runtime owns transport, discovery, reconnect and repair, session/workspace lifecycle, event ordering, caches and projections, prompt/interactions, attachments, and cross-client synchronization. QQ Core does not add a second socket, transcript reducer, retry loop, ordering layer, or optimistic durable model.
2. **UI delivery and composition.** QQ Core replaces the implicit protocol among handlers, rendered partials, HTMX swaps, DOM selectors, responsive panels, feature handlers, and service-worker state with explicit routes, outlets, commands, capabilities, and Cordis-managed contribution lifecycles. Moving the same orchestration into framework effects is not simplification.

The target topology is a QQ Core client shell and feature set consuming one supported DSH runtime directly, with only a small same-machine service or desktop bridge for genuinely QQ-specific capabilities. It is not a second presentation server or client runtime.

There must be one clear owner for each kind of state. Durable/runtime data remains server- or DSH-runtime-authoritative. Immediate view state—open sheets, focus, draft text, selected tabs, gestures, and layout measurements—is browser-authoritative. QQ Core may present and decorate official immutable projections, including numbered session identity and project/session policy. A QQ Project is the product presentation of a DSH Workspace, with QQ-specific remotes adding only decorations or domain data. QQ Core must not independently reconcile the underlying runtime events.

QQ Core owns its high-contrast, hyper-minimal product identity where it differentiates: shell chrome, navigation, layout, commands, user keymaps, gestures, mobile Project Sessions Navigator, file-navigation experiences, and operator-facing project/session semantics. It need not own transcript typography, streamed Markdown, tables, code rendering, composer mechanics, or conversation interactions merely to control every pixel. Prefer mature DSH conversation/content/workbench components wholesale when they fit; then prefer supported primitives, slots, themes, and contributions. Replace upstream presentation only when a product need justifies the ongoing ownership.

QQ Core runs on the same machine and relies on Tailscale for authentication. Do not introduce a QQ Core local-auth or remote-service architecture.

## Core, shell, and UI feature plugins

“UI feature plugin” below is a descriptive subset of Cordis plugins, not a new extension unit or runtime. `@hypermemetic-ai/qq-ui` remains the Cordis shell and contribution host; other Cordis plugins register UI against capabilities that it provides. Optional providers such as `image-finder`, `qq-workflows`, `qq-dashboard`, `qq-models`, `media-box`, and `approval` already participate through this host model. The current `consoleMenu` capability on the provided `qq-ui` service—validated registration with an idempotent disposer and no disposed item retained by SSR—is the first live example of the contract to extend.

**The QQ Core kernel inside `qq-ui` is deliberately small.** It owns browser bootstrap; the supported DSH/runtime adapter; route/outlet composition; command dispatch; visual tokens and shared primitives; contribution validation/diagnostics; and failure boundaries. It does not discover, install, enable, or reload Cordis plugins. Cordis owns plugin discovery, configuration, injection, disposal, and reapplication. The kernel may expose common session/workspace projections, but only as views over the official runtime source. The adapter exposes official observable sources, actions, and pure selectors; it contains no cache, reducer, event listener, retry, deduplication, ordering, or optimistic reconciliation layer.

**The `qq-ui` shell is product infrastructure.** It provides the public capabilities through which Cordis plugins contribute application navigation and responsive layout, named surfaces, commands, keyboard/keymap behavior, focus and gestures, browser-history behavior, shared overlays, and consistent project/session identity. The shell should primarily compose contributions—even its first-party pages—rather than encode Find, Usage, STS2, or every future feature in the kernel.

**UI feature plugins own feature-specific UI and behavior.** They are ordinary Cordis plugins such as Find, Usage, Spire Companion/STS2, galleries, file views, working-memory documents, and experiments. In their Cordis context they may register views, commands, and optional same-machine backend capabilities through public `qq-ui` contracts. They must not take ownership of DSH operational concerns or reach into another feature’s implementation.

“Everything is a plugin” does not mean micro-frontends, iframes, independently deployed bundles, or a browser-side plugin loader. Trusted feature plugins use the existing Cordis context path. Registration is attached to that context, and Cordis disposal/reapplication removes and recreates the contributions during disablement or HMR. No second discovery, enablement, or runtime bundle-installation mechanism is part of this design. If optional backend endpoints are needed, they use Cordis effects plus a lifecycle-managed `qq-ui` capability/route contract rather than ad hoc shell handlers. The exact transport that publishes contribution changes to an already-running browser remains an implementation decision; it must not become a second plugin lifecycle.

## Contribution contract

Registrations should be typed and declarative where practical, use stable names and IDs, validate at the boundary, return an idempotent teardown, and be inspectable in diagnostics. A contributing plugin registers from its Cordis context and binds every returned teardown to that context; `qq-ui` must not retain a contribution after Cordis disposes its owner. The exact API is open; an illustrative registration could contribute `routes`, `navigation`, `commands`, `shortcuts`, `gestures`, `panes`, and `headerActions` without prescribing the eventual syntax.

Named shell surfaces may include navigation items and badges, header actions, routes and full-workspace outlets, panes/tabs, status areas, context menus, overlays/modals/toasts, commands, shortcut and gesture bindings, titles/breadcrumbs, and requested layout/focus modes. Contributions are capabilities, not promises about shell DOM structure.

A visible control, shortcut, command-palette item, and gesture for the same action dispatch the same command with the same enablement, telemetry, and error semantics. User-defined keybindings target stable command IDs, not private event handlers. Conflicts are resolved centrally and visibly.

Cross-plugin imports require an explicit public contract. No plugin may depend on ambient mutable globals or another plugin’s private store, selectors, CSS, or route internals. Disposing, disabling, or deleting a plugin through Cordis removes its routes, commands, bindings, state subscriptions, backend capabilities, and visual contributions. Optional service facades are looked up on demand rather than captured across reloads. Each route/outlet and asynchronous contribution has a failure boundary so one plugin can fail without taking down the reliable shell.

### DOM ownership invariant

A plugin **must not imperatively mutate private DOM owned by the shell or another plugin**.

A plugin may fully render and manipulate its own mounted root, including using editor, terminal, canvas, WebGL, visualization, drag/drop, or other DOM-heavy libraries. It may own a full-workspace or immersive view. It may alter shell behavior through supported capabilities and contribution points, including requesting focus or layout modes. This rule limits *whose private DOM* a plugin can mutate; it does not prohibit direct DOM work.

Prohibited outside a plugin-owned root:

```js
// Private selector and markup replacement
document.querySelector(".shell-header").innerHTML = featureMarkup;
// Arbitrary shell styling/state mutation
document.body.classList.add("find-plugin-drawer-open");
// Reaching into another plugin
document.querySelector("[data-plugin=usage] .private-chart").remove();
```

These patterns couple plugins to refactors and responsive implementation details, create conflicts, bypass lifecycle/failure policy, and leak listeners or markup during teardown and HMR. If a legitimate experience cannot be built through the public surfaces, extend the shell contract; do not forbid the experience or normalize a private-selector hack.

## Plugin review checklist

A plugin addition or change is acceptable when:

- its feature code and tests are local to its module, with cross-plugin use limited to declared public contracts;
- registration uses stable IDs and named surfaces, validates inputs, and has deterministic, idempotent teardown;
- Cordis disposal or disablement leaves no routes, controls, subscriptions, timers, keybindings, styles, endpoints, mounted DOM, resources, service facades, or persisted-state debris;
- controls, shortcuts, and gestures converge on stable commands, and custom keybindings can be resolved centrally;
- durable data has one authoritative owner; the plugin adds no transport, runtime cache, event repair, or duplicate presentation/server state;
- DOM access stays within its mounted root, while shell effects use public capabilities;
- loading, empty, error, and asynchronous failures are contained by an appropriate boundary and do not block core navigation/session use;
- desktop keyboard/focus behavior and mobile navigation/gesture behavior remain coherent and accessible;
- HMR uses Cordis disposal and reapplication, preserving the short edit-feedback loop without duplicate registrations, stale closures, listeners, DOM, resources, service facades, or state; and
- contract tests cover contributed surfaces and teardown, while the smallest representative end-to-end path proves integration.

## Migration posture

Migrate by adding seams around existing behavior, not by a speculative parity rewrite. Preserve current capability, server-authoritative data, first-paint usefulness where required, security headers/trust assumptions, responsive behavior, numbered session semantics, mobile navigator, file views, dictation/recording affordances, and instant fallback.

Run the new implementation in parallel at a distinct URL, route, port, or origin. Deliberately isolate its service-worker scope and cache/version behavior from the legacy PWA. The first usable vertical slice must support real daily work: shell, live session/conversation, core navigation and commands, mobile behavior, and at least one representative heterogeneous plugin, with immediate switching back to the legacy UI. Continue by work-driven migration, then remove the old HTTP/template/partial/HTMX/SSE/browser orchestration only when no migrated feature depends on it.

Before broad implementation, validate the DSH boundary with a public capability matrix and two spikes: direct QQ Core runtime consumption, and supported use of upstream conversation/workbench components via root replacement, composition, slots, or themes. Close missing public seams upstream rather than recreating operational machinery in QQ Core. Adapter contract tests and two simultaneous browser contexts must prove prompt/stream/stop, interactions, reconnect visibility, cross-client correctness, bounded history/DOM, and teardown.

Research correction: an earlier architecture pass failed to discover the operator-supplied `dsh-v0.1.2-alpha.3` release and over-indexed on the locally pinned rc.7. That was a research failure, not registry uncertainty. Alpha.3 must be compared with rc.7 from release source/assets and public APIs before choosing a version; this document does not claim the result or freeze a DSH package seam.

## Open decisions

The following must be decided explicitly through spikes and representative plugins:

- exact Cordis-facing registration, adapter, and contribution API shapes;
- the initial named-surface catalog and rules for extending it;
- state ownership, URL/history behavior, persistence locations, and schema migration;
- server/client rendering boundaries, framework and build tooling, and how server-first startup is preserved where valuable;
- the transport and invalidation protocol for reflecting Cordis contribution changes in a running browser, plus optional backend capability endpoint shapes;
- trusted-code assumptions and the isolation level beyond route/outlet error boundaries;
- API compatibility/versioning and deprecation policy for QQ Core, plugins, and the DSH adapter;
- contract, accessibility, responsive, multi-context, teardown, and HMR test tooling; and
- where this design is linked for documentation discoverability.
