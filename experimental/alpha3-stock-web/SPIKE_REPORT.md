# DSH `0.1.2-alpha.3` stock-Web composition live-gate report

Status date: 2026-09-01

Gate verdict: **BLOCKED before host installation; not passed**

Root `DESIGN.md`: **unchanged**

## Decision

The live gate does not supply enough evidence to approve an architecture
revision. **A (stock DSH root + additive QQ Core contributions) remains the
best next candidate**, because its public-contract and repository lifecycle
proofs require the least QQ ownership. It is not yet live-proven. Re-run this
same gate in an environment that can resolve npm and retain the resulting exact
locks; only a complete host/browser/HMR/session result should trigger a proposal
to revise root `DESIGN.md`.

**B (QQ shell + supported stock conversation island) remains the fallback** if
A cannot meet the product's shell needs after upstream seams are added.
Alpha.3 still does not expose a supported conversation/layout island.
**C (QQ root + headless DSH primitives) is not the starting point**, because it
retains the most QQ presentation and interaction ownership.

No production cutover is proposed. Legacy `/qq`, its deployment, its profile,
and its origin were not read, stopped, reconfigured, or replaced.

## Evidence policy

The research handoff at
`/home/qqp/.local/state/.qq-workflows-research/research-9cd44791/answer.md`
was treated only as leads. Its supplied SHA-256 was independently confirmed as
`3975d4dd21f242e2d626a468ad7b5bf0719726cf956217872870aec8c1e76814`,
and its `evidence/manifest.jsonl` has zero lines. No executed/PASS claim was
copied from it.

Implementation evidence is retained under
[`evidence/live-gate-2026-09-01/`](evidence/live-gate-2026-09-01/), including
source excerpts with line numbers, DNS/npm logs, proof output, browser-tooling
preflight, a machine-readable status matrix, and hashes. There are no host logs
or screenshots because no host boot occurred; a fake/static substitute was not
used.

## Authoritative source and launcher semantics

The supplied source checkout independently resolves to:

```text
commit dd6322d604e00eec1ba5e0c8541159906a21094a
tag    dsh-v0.1.2-alpha.3
```

The source establishes this launch form:

```sh
DSH_HOME="$RUN/dsh-home" \
HOME="$RUN/os-home" \
"$RUN/host/node_modules/.bin/dsh" web \
  --patch "$RUN/spike/host/cordis.patch.yml" \
  --host 127.0.0.1 \
  --port 0 \
  --no-open
```

This is sourced, not inferred:

| Fact | Authoritative alpha.3 source |
|---|---|
| Launcher flags must precede the first app flag | `apps/cli/src/args.ts:4-11,120-145` |
| `dsh web` is the `web` profile alias and owns repeatable `--patch` | `apps/cli/src/args.ts:13-14,156-168` |
| Profiles resolve under `$DSH_HOME/profiles/<name>` | `packages/boot/app-boot/src/profile.ts:122-134` |
| Missing stock Web profile initializes base then web-app, with `patchReload: live` | `packages/boot/app-boot/src/profile.ts:136-145,805-843` |
| Patch order is bundles → profile → home → command overlays | `apps/cli/src/profile-boot.ts:124-172` |
| Web flags are host, port, trusted-host, no-open | `packages/bundle/web-app/src/startup.ts:1-5,46-60` |
| Port 0 is supported; `0.0.0.0` is rejected | `packages/bundle/web-app/src/startup.ts:51-54,63-85` |
| Parsed patches/app args reach profile boot | `apps/cli/src/bin.ts:24-44` |

The exact CLI's rendered `dsh web --help` remains **blocked**: no alpha.3 CLI is
installed, the immutable source has no built `apps/cli/lib/bin.js` and no
`node_modules`, and the registry is unavailable. The report does not pretend
source text is executed help output.

## Isolated execution attempt

The implementation used only task-owned paths and loopback assumptions:

- disposable root shape: `/tmp/qq-alpha3-live-<unique-id>`;
- separate `HOME`, `DSH_HOME`, XDG paths, npm cache, workspace, and browser
  context;
- `127.0.0.1`, OS-assigned port 0, and no browser auto-open;
- hard refusal of protected legacy port 3082 in browser automation;
- an isolated execution wrapper that drops all ambient variables except
  PATH/locale and generates only task-owned HOME/DSH_HOME/XDG/tmp/npm paths;
- no read or copy from `/home/qqp/.local/state/qq` (only its existence was
  observed to identify the protected location).

The preparation script successfully verified the source tag/commit, copied the
spike to a writable disposable path, generated an exact host manifest with 253
DSH overrides, emitted isolated environment exports, and generated the command
sheet. The profile pinning proof preserves exactly these stock bundles:

```json
["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
```

The additive patch remains one Loader row after those layers:

```yaml
- insert:
    - id: qq-ui-alpha3-spike
      name: '@hypermemetic-ai/qq-ui-alpha3-spike'
```

The live dump that would prove final ordering could not run without the CLI, so
this is still intended composition, not a live roster claim.

## Package/type integration defects addressed

The landed repository candidate was not sufficient for a real public type
install. The implementation made these corrections:

1. Added the missing exact public alpha.3 type dependencies (23 additional DSH
   packages), while retaining exact peers.
2. Changed TypeScript from `5.9.2` to source-toolchain `6.0.3`.
3. Added public type-only assembly imports for:
   - `@deepseek-ai/dsh-api-remotes/client`;
   - `@deepseek-ai/dsh-api-workspace-controller/client`;
   - `@deepseek-ai/dsh-client-ui-layout/client`;
   - `@deepseek-ai/dsh-client-ui-settings/client`.
4. Changed target/lib to ES2024 + DOM + `ESNext.Disposable`, retaining
   `skipLibCheck: false`, strict mode, exact optional properties, and unchecked
   index checking.
5. Generated 253 exact DSH overrides from the immutable source and added a
   synchronization command.
6. Added a lock/node_modules closure audit and a multi-root installed-version
   inventory. Both reject any DSH package other than `0.1.2-alpha.3`.
7. Added profile pinning that refuses a non-stock Web bundle roster.
8. Added a composition verifier for stock roster, writable package link, and
   stock-versus-patched dump cardinality.
9. Added real-browser/HMR automation and protected-origin guards.
10. Fixed a defect found by the new harness proof: passing `path.resolve`
   directly to `Array.map` polluted it with callback index/array arguments;
   the inventory now uses an explicit unary callback.
11. Fixed the failed-QA blank-Session sequencing defect. The browser runner no
   longer waits for header/tab/view immediately after workspace creation. It
   proves theme and `/qq` while blank, drives only the rendered composer/Send
   transition, conditionally grades active chrome/HMR, and requires an exact
   rendered assistant marker for a model-turn pass. The repository proof locks
   that ordering and rejects private-state/controller shortcuts.

The configured public contract still cannot honestly be called passing. A real
install and compiler invocation are required.

## Exact dependency/lock outcome

Observed runtime tools were Node `v26.7.0`, npm `11.19.0`, and pnpm `11.18.0`.
The package now has 35 exact dev dependencies, exact peers, and no caret/tilde
direct pin. All DSH overrides are `0.1.2-alpha.3`.

The independent install attempt was:

```sh
HOME=<task-home> npm_config_cache=<task-cache> \
  npm install --ignore-scripts --no-audit --no-fund
```

It produced no resolver output, lock, or `node_modules` before the 52-second
bound. Independent diagnosis then showed:

```text
getent registry.npmjs.org   no address
curl registry metadata     exit 6, Could not resolve host
npm --loglevel silly ping   ENOTFOUND on attempts 1 and 2
```

The immutable local npm cache has four alpha.3 tarballs only. No other exact
alpha.3 installed CLI/closure was found; all discovered DSH binaries were
`0.1.0-rc.7`. Therefore:

- `package-lock.json`: **BLOCKED, not generated**;
- installed DSH inventory: **BLOCKED, no installation**;
- `node scripts/check-public-types.mjs`: **BLOCKED, exit 2**;
- strict TypeScript compile: **not invoked**;
- no `--legacy-peer-deps`, `--force`, mock declarations, mock compiler, or
  `skipLibCheck` escape was used.

The retained first-run path uses exact overrides to generate a lock; all repeat
runs switch to `npm ci`. A lock must be reviewed and landed before this gate can
pass.

## Browser and HMR path

Real browser tooling is available and was independently launched:

```text
Playwright 1.62.1
Chromium 151.0.7922.34
```

A tooling-only run opened Chromium against an intentionally unused loopback
port and received `net::ERR_CONNECTION_REFUSED`, proving browser execution and
cleanup—not product rendering.

The maintained browser script accepts only loopback HTTP, rejects port 3082,
and requires all writable paths below the disposable run prefix. Its sequencing
matches authoritative alpha.3 source rather than assuming registered slots are
always rendered:

- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:59-76,129-155,165-194`
  hides header actions/tablist and returns no view area while a Session is blank;
- `packages/client/ui-conversation/src/client/contract/snapshot.ts:26-33`
  defines the blank/engaging/active phase edge;
- `packages/api/session-controller/src/client/sessions/session.ts:190-206`
  makes a supported submission synchronously set `promptAttempted` before the
  provider call;
- `packages/client/ui-conversation/src/client/service.ts:221-245` registers the
  visible submission echo before the host prompt round trip.

Against a real host the runner therefore:

- verifies the stock boot manifest, stock roster, and exactly one QQ row;
- creates a workspace and real blank Session through rendered stock controls;
- while blank, proves exact QQ theme tokens and one `/qq` row/popup through the
  resident **Commands** button, proves header/tab/view are correctly hidden,
  and captures desktop/mobile blank geometry;
- uses only rendered composer fill + **Send** to attempt the real Session
  transition—no private controller, fabricated state, or internal dispatch;
- if Send exposes engaging chrome, proves the QQ header, tab/view, active
  desktop/mobile behavior, and their HMR cleanup/reapplication;
- if provider/model configuration keeps the composer non-editable or Send
  disabled, records
  header/view/active-HMR assertions as credential/provider blocked while still
  proving blank-visible theme/slash HMR cleanup;
- calls a model turn passing only when the assistant renders the exact requested
  marker. A failed prompt can expose engaging chrome but never counts as a model
  turn.

The runner emits structured `browser-result.json`: exit 0 means all UI/HMR plus
the exact assistant marker passed; exit 2 means an honest provider/model block;
exit 1 means an assertion failure. `proofs/live-harness.proof.mjs` inspects this
ordering and rejects the original immediate active-chrome assertion regression.

Those product assertions remain **BLOCKED, not executed** in the retained run,
because no exact host installation exists. The source conditions and repository
proof establish how to run and grade the gate; they are not rendered-browser
evidence. The script does not serve HTML, mock DSH, call internal QQ command
dispatch as a UI substitute, or inspect/mutate private Session state.

## Gate matrix

| Objective | Status | Retained basis / exact blocker |
|---|---|---|
| Authoritative commit/tag | **PASS** | Independent Git output and source excerpts |
| Exact launcher/profile semantics | **PASS from source** | Concrete files/lines above; actual `--help` blocked |
| Isolated disposable harness | **PASS (preparation)** | Safety guards and preparation proof |
| Exact direct pins and alpha.3 overrides | **PASS (manifest)** | 35 direct pins, 253 synchronized overrides |
| Retained exact npm lock | **BLOCKED** | DNS `ENOTFOUND`; no lock emitted |
| Installed all-alpha.3 audit | **BLOCKED** | No package installation |
| Genuine strict public type check | **BLOCKED (exit 2)** | Exact dependencies absent; no compiler invocation |
| Stock profile roster and additive row dump | **BLOCKED** | Exact alpha.3 CLI unavailable |
| Host boot / distinct origin | **BLOCKED** | Same package/CLI prerequisite |
| Client-module load | **BLOCKED** | No host |
| Visible QQ theme/header/view/slash contributions | **BLOCKED** | No rendered host |
| Activation → disposal → reapplication in stock HMR | **BLOCKED** | No rendered host; automation ready |
| Real blank DSH Session | **BLOCKED** | No host |
| Real model turn | **BLOCKED** | No host; after that, isolated provider credential required |
| Desktop/mobile rendered behavior | **BLOCKED** | Browser available, product host absent |
| Legacy `/qq` preserved | **PASS (scope)** | No legacy files/config/processes changed |
| Root `DESIGN.md` unchanged | **PASS** | File not modified |

## Public contribution ownership

| Concern | DSH ownership | QQ ownership in A | Current evidence |
|---|---|---|---|
| Root shell/sidebar/session navigation | Complete | None | Public/source contract only; no live render |
| HTTP auth/RPC/WebSocket/recovery | Complete | None | QQ bundle has no transport paths |
| Client module load and HMR | Complete | Rebuild artifact only | Repository proof; live swap blocked |
| Session list/snapshot | Controller/service | Read via `sessions` | Compile contract configured; real compile blocked |
| Theme presentation | Theme + layout presenter | Five reversible token overrides | Lifecycle proof; live CSS blocked |
| Header | Conversation slot | One session-contextual action | Lifecycle proof; live render blocked |
| Session view/tab navigation | Conversation view ring | One session-scoped QQ view | Lifecycle proof; live render blocked |
| Slash UI | Stock command shell | `/qq` popup contribution | Lifecycle proof; live interaction blocked |
| QQ command dispatch | None | Tiny browser-local directory | Activation/disposal proof passes |
| Model/session durability | Complete | None | No live Session/turn proof |

The host half remains deliberately empty. It adds no endpoint, auth, transport,
cache, retry, reconnect, reconciliation, runtime, reload channel, or second Web
root.

## Unsupported shell seams

Alpha.3's inspected public surface still does not provide a supported way for A
to own all QQ Core shell needs:

- first-class application page and heterogeneous route registry;
- global/project navigation contribution with mobile presentation;
- application-level keymap/gesture registry;
- Project Sessions Navigator and mobile sheet contract;
- explicit optional-leaf error containment policy;
- supported stock conversation island with stock shell/layout omitted.

`conversation.view` is session scoped, not a general app page. Root-slot
takeover, private DOM lookup, DSH `src` imports, concrete casts, copied stock
components, and a second Web root remain rejected workarounds.

## Deletion opportunity if A later passes

A successful live gate plus upstream shell seams would allow QQ to delete or
avoid owning:

- custom presentation transport/reload/reconnect/reconciliation machinery;
- custom transcript and interaction projection;
- custom composer, queue/steer/stop, approvals/questions, Tool rendering, and
  attachment UI;
- custom session polling and history cache;
- most root conversation styling and theme plumbing.

Do not take that deletion yet. This gate did not prove stock host behavior,
Session behavior, reconnect/two-browser/history/interactions, or product mobile
navigation.

## Test status

Recovery verification passed:

```text
node experimental/alpha3-stock-web/scripts/build.mjs
node experimental/alpha3-stock-web/proofs/lifecycle.proof.mjs
node experimental/alpha3-stock-web/proofs/bundle.proof.mjs
node experimental/alpha3-stock-web/proofs/public-types-gate.proof.mjs
node experimental/alpha3-stock-web/proofs/live-harness.proof.mjs
node --check experimental/alpha3-stock-web/lib/client.js
npm --prefix experimental/alpha3-stock-web run prove
node experimental/alpha3-stock-web/scripts/live/prepare.mjs \
  --run-root /tmp/qq-alpha3-live-recovery-<unique> \
  --source <authoritative-alpha3-source>
npm test
```

The root suite used a temporary read-only link to the existing exact root
`node_modules` installation at `/home/qqp/projects/qq-ui/node_modules`; the link
was removed immediately afterward. This does not revise the original retained
`root-npm-test.log`, which accurately records that the first isolated run had no
root dependencies. Full recovery output is retained in
`evidence/live-gate-2026-09-01/recovery-verification.txt`.

Still blocked, not passed:

```text
node experimental/alpha3-stock-web/scripts/check-public-types.mjs
  BLOCKED — exit 2; all 35 exact dev dependencies are absent from the spike.
getent ahosts registry.npmjs.org
  BLOCKED — exit 2; no address.
curl --head https://registry.npmjs.org/@deepseek-ai%2fdsh
  BLOCKED — exit 6; Could not resolve host.
```

The dependency closure cannot be installed, so the real strict compiler, CLI
help/config dumps, host boot, rendered browser assertions, HMR, and Session/model
claims remain blocked. Passing repository tests do not upgrade those statuses.

## Rerun/decision gate

A future rerun may call the live gate passed only after it retains:

1. exact spike and host locks plus zero-drift installed inventories;
2. strict public compiler exit 0 with `skipLibCheck: false`;
3. exact CLI help and stock/patched config dumps;
4. host log with a loopback, nonlegacy origin;
5. boot-manifest/client-bundle network evidence;
6. rendered desktop/mobile screenshots and assertion JSON;
7. strong no-op disposal and exactly-once reapplication evidence;
8. one real stock Session and, where credentials are intentionally supplied to
   the isolated profile, one real model turn.

Only then should the operator be asked whether root `DESIGN.md` should change.
