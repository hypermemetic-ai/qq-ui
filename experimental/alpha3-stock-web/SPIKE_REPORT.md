# DSH `0.1.2-alpha.3` stock-Web composition spike report

Status date: 2026-09-01

## Decision in one paragraph

The bounded result supports **A, DSH root + additive QQ Core contributions**, as
the next composition to test in a live host. Public alpha.3 contracts cleanly
support QQ theme tokens, a session-contextual header control, a session-scoped
QQ view with stock tab navigation, and a stock slash-command contribution.
Cordis disposal/reapplication can own all cleanup. The spike does **not** show
that stock alpha.3 can host QQ Core's application pages, global navigation,
application keymap, or mobile Project Sessions Navigator: those contracts do
not exist in the inspected public surface. Add those narrow shell seams
upstream and run the live composition gate before changing root `DESIGN.md`.
B (QQ shell + stock conversation island) remains second choice and needs an
upstream conversation/layout seam. C (QQ root + headless primitives) retains
the most UI ownership and is not justified by this spike.

This report supersedes the earlier rc.7-only boundary inference. Missing the
operator-supplied alpha.3 release was a research failure, not registry
uncertainty.

## Evidence and exact pins

Authoritative research input:

- immutable artifact:
  `/home/qqp/.local/state/.qq-workflows-research/research-15f22e5b/`;
- release tag: `dsh-v0.1.2-alpha.3`;
- source commit: `dd6322d604e00eec1ba5e0c8541159906a21094a`;
- compared baseline: `dsh-v0.1.0-rc.7` at
  `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`.

The experimental manifest exactly pins these public runtime/type contracts:

| Package | Pin | Use |
|---|---:|---|
| `@deepseek-ai/cordis` | `4.0.2` | one plugin lifecycle and service context |
| `@deepseek-ai/dsh-api-session-controller` | `0.1.2-alpha.3` | official Session list/snapshot contracts |
| `@deepseek-ai/dsh-client-ui-renderer` | `0.1.2-alpha.3` | public `ctx.slots` service |
| `@deepseek-ai/dsh-client-ui-slots` | `0.1.2-alpha.3` | typed slot props/registration |
| `@deepseek-ai/dsh-client-ui-session` | `0.1.2-alpha.3` | session standard props |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.1.2-alpha.3` | public header-action and view slots |
| `@deepseek-ai/dsh-client-ui-theme` | `0.1.2-alpha.3` | token override layer |
| `@deepseek-ai/dsh-client-ui-commands` | `0.1.2-alpha.3` | stock `/qq` popup command |
| `@deepseek-ai/dsh-session` | `0.1.2-alpha.3` | public `SessionId` type export |
| `react` | `18.3.1` | stock module-table external |

No import uses a DSH `src` path. No concrete class is cast. The runtime bundle
requests only `react`; DSH capabilities arrive through declared Cordis
services. The four npm tarballs retained by the research artifact corroborate
published package shape, but none is copied or vendored here.

## Composition and dependency graph

```text
experimental stock Web profile (separate URL/port)
  stock @deepseek-ai/dsh-web-app@0.1.2-alpha.3
    stock Host transport/runtime/static UI roster
    @deepseek-ai/dsh-client-modules
      scans host Loader package manifests for dsh.client
    @deepseek-ai/dsh-client-hmr
      watches registered lib/client.js artifacts
  @hypermemetic-ai/qq-ui-alpha3-spike (one added Loader row)
    host apply(): empty
    dsh.client inject order:
      api-session-controller
      ui-renderer -> public slots
      ui-session
      ui-conversation
      ui-theme
      ui-commands
    client factory external: stock module-table `react`
```

There is one host Cordis Loader and one browser Cordis plugin tree. HMR replaces
the same browser fiber through Cordis disposal/reapplication. The spike adds no
second transport, Session/Workspace controller, event projection, retry,
reconciliation, browser loader, service worker, authentication layer, or
presentation server.

## Contribution matrix

| Product probe | Result | Public alpha.3 path | Limitation |
|---|---|---|---|
| Brand / high-contrast theme | Implemented | `ctx.theme.overrideTokens(source, light/dark pairs)` | Token layer, not arbitrary stock DOM restyling |
| Isolated page | Partially implemented | `conversation.view` list entry `qq-session` | A session target tab, not an application route/page |
| Navigation to page | Partially implemented | stock Conversation view tab from `id`/`label` | No global URL, nav item, deep-link, or page host |
| Contextual control | Implemented | `conversation.session.header.actions` list entry | Session-header scope only |
| Numbered identity | Implemented as a spike projection | `sessionId` + `useSessions(list.ids)` | Host-list ordinal can move; durable QQ numbering still needs QQ decoration semantics |
| Command | Implemented | public `ctx.commandUi.register` creates `/qq` | Stock contract is slash `popupSelect`, not an app command bus |
| Same action for visible control and command | Implemented | stable ID `qq.session.copy-numbered-identity` dispatches one handler | Directory is package-local because stock has no global command dispatch contract |
| Desktop keybinding | Missing API; no hack | none | No central keymap, user binding, conflict, enablement, or programmatic command dispatch contract |
| Mobile Project Sessions Navigator | Feasibility gap | stock layout/sidebar are usable wholesale | No additive project-session nav surface, immersive file route, or requested mobile layout/focus mode |
| Feature render isolation | Implemented for QQ view | plugin-owned React error boundary | Client-plugin `apply` failure still participates in alpha.3's whole-roster boot barrier |

The implementation uses only additive `list` slots. It does not replace root,
sidebar, conversation, composer, or transcript. Multiple slot entries at
different priorities can coexist and the lowest priority wins; they are not
categorically rejected. The replacement blocker is that priority shadowing
does not inherit the shadowed entry's child declarations. For a conversation
island, that combines with stock root ownership/package dependencies and the
fact that stock `ConversationRoot` is not exported by the public `./client`
entry.

## Exact missing upstream seams

### 1. Application page and navigation contributions

There is no public page registry, route/outlet host, or additive navigation
item contract in the inspected alpha.3 package entries. `conversation.view`
is session-scoped and cannot represent Usage, Find, STS2, a working-memory
document, or an immersive mobile file surface as independent app pages.

Smallest useful seam: one lifecycle-owned contract that registers a stable page
ID, render component, optional URL codec, title/breadcrumb contribution, and
failure fallback; plus an additive navigation contribution referring to that
page ID. Registration/disposal must remove route and nav atomically. A static
host also needs an explicit authenticated index-fallback policy for deep URLs.

### 2. Application command and keymap service

`CommandUiContract` exposes slash-menu `popupSelect` registrations and host
command decorations. It does not expose stable application command dispatch,
enablement, keybinding contributions, user overrides, conflict resolution, or
key hints. A global `keydown` listener would bypass those requirements and was
not added.

Smallest useful seam: `commands.register({ id, title, enabled, execute })`,
`commands.dispatch(id, context)`, and a lifecycle-owned keymap contribution
addressing command IDs. Buttons, gestures, palette rows, and user bindings must
all dispatch through the same service.

### 3. Mobile project/session and immersive layout surface

The stock sidebar is a single coarse seat whose occupant owns child
declarations. Replacing it would discard stock composition unless an explicit
opt-out/child contract exists. There is no public additive mobile Project
Sessions Navigator seat or shell capability to request an immersive/translucent
file-navigation mode.

Smallest useful seam: additive navigator sections/items plus a shell layout
request (`workspace`, `immersive`, focus target, back behavior) owned by the
active page. QQ Core can then contribute the Project Sessions Navigator without
mutating stock DOM or replacing unrelated conversation machinery.

### 4. Non-essential plugin activation containment

Slot rendering can be bounded by the plugin, as this spike demonstrates, but
alpha.3 client roster activation is a boot barrier. A broken optional QQ page
plugin can therefore prevent normal shell boot before its render boundary
exists.

Smallest useful seam: mark selected client entries non-essential and expose a
stock diagnostic/retry placeholder while allowing the reliable shell roster to
finish. Dependency providers remain fail-loud; only explicitly optional leaf
features get containment.

## Lifecycle, HMR, and isolation evidence

`proofs/lifecycle.proof.mjs` performs two complete generations. Each generation
activates the client plugin, exercises header click and `/qq` through the same
command ID, then disposes it. It asserts zero remaining slot entries, theme
layers, slash commands, provided service, and local command registrations.
Reapplication must recreate exactly one of each. The QQ session view is wrapped
in `QQFeatureBoundary`; the proof exercises its fallback.

`npm run watch` rebuilds the registered artifact. Stock alpha.3
`dsh-client-hmr` stat-polls every client graph artifact and owns the SSE notify,
module invalidation/prefetch, old-fiber disposal, style cleanup, and
`entry.refresh()`. The repository proof establishes lifecycle suitability for
that swap. It does **not** establish that a real browser swapped this package:
no live alpha.3 host/browser run was available in this checkout.

This is a trusted, first-party package loaded from the same host profile. It is
not an iframe, independently deployed micro-frontend, or runtime marketplace.
Runtime installation without rebuilding the host dependency set is not a
requirement demonstrated here. Future plugins may have an optional host Cordis
half for genuinely QQ-specific same-machine capabilities; this presentation
plugin has none. Tailscale remains the authentication boundary and no local QQ
Core auth service is introduced.

## Developer workflow

In `experimental/alpha3-stock-web`:

```sh
npm install --ignore-scripts  # exact package pins
npm run build                 # deterministic stock module artifact
npm run check                 # public package type/declaration proof
npm run prove                 # lifecycle + emitted module proofs
npm run watch                 # short edit/build loop for stock HMR polling
```

Host workflow:

1. install this directory as the local
   `@hypermemetic-ai/qq-ui-alpha3-spike` package;
2. layer `host/cordis.patch.yml` after stock `dsh-web-app`;
3. run that profile on a different port/origin from legacy `/qq`;
4. keep legacy available for instant fallback;
5. edit this plugin under `npm run watch`; stock HMR observes `lib/client.js`.

A distinct origin deliberately avoids legacy service-worker/cache scope. No
external host command is asserted because profile/patch CLI ownership belongs
to the host repository and was not available here.

## Prohibited paths checked

The deterministic builder rejects runtime source containing:

- `WebSocket` or `EventSource` construction;
- `fetch` transport;
- private DOM lookup (`querySelector`, `closest`, `getElementById`);
- DSH deep `src` imports;
- retry/reconnect/reconciliation/deduplication logic.

The emitted-bundle proof independently checks the same operational/DOM paths
and rejects the old `dsh-client-runtime` identity. The code has no root-slot
registration, concrete cast, fork, vendor copy, QQ retry layer, or fake HTML
server.

## Deletion opportunity

If a live stock-composition slice proves daily work, the legacy middle tier can
be removed wholesale rather than translated into React effects:

- `src/http-app.mjs`: custom HTTP routing/mutations, SSE, snapshot handoff,
  assets and PWA behavior;
- `src/render.mjs`: SSR/partial transcript and page assembly;
- `assets/browser-v9.js`: HTMX/DOM swap, routing, responsive, reconnect and
  feature-specific orchestration;
- `src/approval.mjs`: custom approval answerer;
- HTMX/SSE vendor assets and most browser-oriented proof scripts;
- the second `qq-webserver`/root ownership in the host overlay.

QQ Core keeps product semantics and genuinely QQ-specific capabilities. Durable
session/workspace/conversation state stays DSH-authoritative; immediate QQ view
state stays in the browser. The deletion gate remains after real two-browser,
reconnect, interaction, history, and mobile daily-work evidence—not after this
repository-only composition proof.

## Executed commands and status

Passed in this checkout:

```text
node experimental/alpha3-stock-web/scripts/build.mjs
  PASS — deterministic alpha.3 closure-factory bundle
node experimental/alpha3-stock-web/proofs/lifecycle.proof.mjs
  PASS — activation, dispatch, disposal, reapplication, no stale registrations
node experimental/alpha3-stock-web/proofs/bundle.proof.mjs
  PASS — exact pins, one stock module registration, deterministic rebuild,
         only React module request, prohibited-path scan
node --check experimental/alpha3-stock-web/lib/client.js
  PASS
node experimental/alpha3-stock-web/proofs/public-types-gate.proof.mjs
  PASS — incomplete or mismatched installs block; only an exact set invokes tsc
npm test
  PASS — all existing proofs plus prove:alpha3-stock-web; the clean worktree had
         no node_modules, so recovery verification temporarily linked the exact
         legacy installation (highlight.js 11.12.0, markdown-it 15.0.0) and
         removed the link afterward
```

Blocked, not passed:

```text
node experimental/alpha3-stock-web/scripts/check-public-types.mjs
  BLOCKED — this checkout has no complete installed exact alpha.3 public
            package/type set; the script exits 2 rather than calling an
            unexecuted type check successful
```

Not executed and not claimed passing:

- stock alpha.3 host boot with the added Loader row;
- live browser rendering or visual/responsive behavior;
- live HMR swap;
- real DSH session operation, two-browser synchronization, reconnect, approval,
  question, attachment, history, or mobile navigation behavior.

## A/B/C result and next gate

### A. DSH root + QQ Core contributions — continue to live gate

Best-supported by this spike. It minimizes QQ operational and UI machinery and
gives ordinary feature code local registration/disposal. It still needs public
application page/nav/keymap/mobile seams and optional-leaf activation
containment before it can satisfy the whole QQ Core product.

### B. QQ Core shell + stock conversation island — retain as fallback

Potentially appropriate if the shell seams cannot express QQ Core's mobile and
heterogeneous-page requirements. Alpha.3 does not publicly export the stock
`ConversationRoot`, and root/single-slot priority shadowing does not carry child
declarations. Do not implement this with deep imports, copied stock components,
or DOM surgery; request a supported conversation island/layout opt-out first.

### C. QQ Core root + headless primitives — do not start here

Public Session/Workspace controllers make this possible, but it reintroduces
the greatest presentation ownership (conversation/composer/interactions and
shell composition) and does not by itself make ordinary QQ feature work safer.
It remains an escalation only after A and a supported B seam fail concrete
product requirements.

Next bounded gate: compose the host patch in a real alpha.3 stock Web profile,
run on a separate origin, install exact dependencies and pass the type check,
then prove boot, visible contributions, live HMR cleanup, one real session, and
mobile viewport behavior. Only after that evidence should root `DESIGN.md` be
revised.
