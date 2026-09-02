# DSH `0.1.2-alpha.3` stock-Web composition live-gate report

Status date: 2026-09-02

Gate verdict: **BLOCKED before host installation; not passed**

Root `DESIGN.md`: **unchanged**

## Decision

The live gate does not supply enough evidence to approve an architecture
revision. **A (stock DSH root + additive QQ Core contributions) remains the
best next candidate**, because its public-contract and repository lifecycle
proofs require the least QQ ownership. It is not yet live-proven. Re-run this
same gate in an implementation execution context with working non-loopback
egress plus DNS/HTTPS access to npm (or a complete verifiable public cache), and
retain the resulting exact locks. Only a complete host/browser/HMR/session
result should trigger a proposal to revise root `DESIGN.md`.

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

Implementation evidence is retained chronologically under both
[`evidence/live-gate-2026-09-01/`](evidence/live-gate-2026-09-01/) and the fresh
[`evidence/live-gate-2026-09-02/`](evidence/live-gate-2026-09-02/). The latter
contains source excerpts with line numbers, isolated npm/debug logs, interface
and route diagnosis, proof output, a machine-readable status matrix, and hashes.
There are no host logs or live product screenshots because no host boot
occurred. The one image is explicitly an inert-page browser-tooling preflight;
it is not used as product evidence, and no fake/static product substitute was
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
`node_modules`, and this execution sandbox cannot reach the registry. The report
does not pretend source text is executed help output.

## Isolated execution attempt

The implementation used only task-owned paths and loopback assumptions:

- disposable root shape: `/tmp/qq-alpha3-live-<unique-id>`;
- separate `HOME`, `DSH_HOME`, XDG paths, npm cache, workspace, and browser
  context;
- `127.0.0.1`, OS-assigned port 0, and no browser auto-open;
- hard refusal of protected legacy port 3082 in browser automation;
- canonical, non-symlink run roots and browser writable paths all constrained to
  one run root;
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
12. Fixed a live-rerun safety defect: lexical prefix checks accepted a symlinked
   `/tmp/qq-alpha3-live-*` root. Preparation, isolated execution, and browser
   writable paths now require canonical non-symlink roots before mutation; the
   browser also requires one shared run root. A regression proof verifies that
   a symlink is rejected without creating state in its target.

The configured public contract still cannot honestly be called passing. A real
install and compiler invocation are required.

## Exact dependency/lock outcome

The fresh run observed Node `v26.7.0` and npm `11.19.0`. The package has 35 exact
dev dependencies, exact peers, no caret/tilde direct pin, and 253 source-derived
DSH overrides fixed at `0.1.2-alpha.3`.

A separate architect-side probe reported successful DNS, HTTPS metadata, and
`npm ping`. Because it retained no package install for this execution, that was
a useful rerun trigger but not a gate PASS. The safety-isolated implementation
run executed:

```sh
npm ping --registry=https://registry.npmjs.org \
  --fetch-retries=0 --fetch-timeout=15000
npm install --ignore-scripts --no-audit --no-fund \
  --fetch-retries=0 --fetch-timeout=15000
```

Its independently retained diagnosis is narrower and reproducible:

```text
ip -brief link                         lo only
ip route show                          empty
getent ahosts registry.npmjs.org       exit 2
fixed-IP HTTPS to 104.16.4.34:443      exit 7, Network is unreachable
isolated npm ping                      exit 1, ENOTFOUND
isolated npm install                   exit 1, ENOTFOUND at @deepseek-ai/cordis
```

The only supplied package cache remains four alpha.3 tarballs, not a complete
closure. The failed install created neither a lock nor `node_modules`. Therefore:

- spike and host `package-lock.json`: **BLOCKED, not generated**;
- installed DSH inventory / zero-alpha.4 audit: **BLOCKED, no installation**;
- `node scripts/check-public-types.mjs`: **BLOCKED, exit 2** with all 35 exact
  dependencies reported absent;
- strict TypeScript compile: **not invoked**;
- no `--legacy-peer-deps`, `--force`, source-built substitute, mock declarations,
  mock compiler, or `skipLibCheck` escape was used.

The 2026-09-01 DNS failure remains retained separately; the 2026-09-02 evidence
adds the successful isolated preparation, bounded real install attempt, npm
debug logs, and loopback-only route diagnosis. The first network-enabled run
must generate and retain a reviewed lock; repeat runs then switch to `npm ci`.

## Browser and HMR path

Real browser tooling is available and was independently launched:

```text
Playwright 1.62.1
Chromium 151.0.7922.34
```

The fresh tooling-only run opened Chromium against an inert `data:` page and
captured `browser-tooling-only.png`. This proves browser execution and screenshot
capability—not a stock host, QQ rendering, responsive product behavior, or HMR.

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
| Isolated disposable harness | **PASS (preparation)** | Canonical-root/symlink guards and preparation proof |
| Exact direct pins and alpha.3 overrides | **PASS (manifest)** | 35 direct pins, 253 synchronized overrides |
| Retained exact npm locks | **BLOCKED** | Loopback-only sandbox; isolated npm `ENOTFOUND`; no lock emitted |
| Installed all-alpha.3 / no-alpha.4 audit | **BLOCKED** | No package installation |
| Genuine strict public type check | **BLOCKED (exit 2)** | Exact dependencies absent; no compiler invocation |
| Stock profile roster and additive row dump | **BLOCKED** | Exact alpha.3 CLI unavailable |
| Host boot / distinct origin | **BLOCKED** | Same package/CLI prerequisite |
| Client-module load | **BLOCKED** | No host |
| Visible QQ theme/header/view/slash contributions | **BLOCKED** | No rendered host |
| Activation → disposal → reapplication in stock HMR | **BLOCKED** | No rendered host; automation ready |
| Real blank DSH Session | **BLOCKED** | No host |
| Real model turn | **BLOCKED** | No host; after that, isolated provider credential required |
| Desktop/mobile rendered behavior | **BLOCKED** | Browser tooling available, product host absent |
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

Fresh 2026-09-02 repository verification passed:

```text
node experimental/alpha3-stock-web/scripts/build.mjs
node experimental/alpha3-stock-web/proofs/lifecycle.proof.mjs
node experimental/alpha3-stock-web/proofs/bundle.proof.mjs
node experimental/alpha3-stock-web/proofs/public-types-gate.proof.mjs
node experimental/alpha3-stock-web/proofs/live-harness.proof.mjs
node --check experimental/alpha3-stock-web/lib/client.js
node --check experimental/alpha3-stock-web/scripts/live/run-root.mjs
node --check experimental/alpha3-stock-web/scripts/live/prepare.mjs
node --check experimental/alpha3-stock-web/scripts/live/isolated-exec.mjs
node --check experimental/alpha3-stock-web/scripts/live/browser.mjs
npm test
```

The full root suite used a temporary read-only link to the existing root
`node_modules` installation at `/home/qqp/projects/qq-ui/node_modules`; the link
was removed immediately afterward. Output is retained in the new evidence set.
The tooling preflight also launched Playwright `1.62.1` with Chromium
`151.0.7922.34` and captured only a clearly labeled inert-page image.

Still blocked, not passed:

```text
isolated npm install                 exit 1, ENOTFOUND at @deepseek-ai/cordis
spike package-lock.json              absent
host package-lock.json               absent
node scripts/check-public-types.mjs  exit 2, exact dependencies absent
strict tsc                           not invoked
CLI/help/dumps/host/product browser  not run
```

Passing repository tests and browser-tooling availability do not upgrade the
strict public type, installed closure, host, HMR, Session, viewport, or model
statuses. No credential was inherited or inspected. The run stopped before the
credential stage, so the immediate requirement is registry-capable execution;
a credential intentionally entered into the isolated profile is a later,
separate requirement only for the real model-turn assertion.

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
