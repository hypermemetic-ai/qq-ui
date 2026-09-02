# QQ Core / DSH alpha.3 stock-Web composition spike

This is a separate, presentation-only Cordis package for the bounded
`dsh-v0.1.2-alpha.3` experiment. It does not replace the legacy
`@hypermemetic-ai/qq-ui` plugin, mount `/qq`, run a presentation server, or
change root `DESIGN.md`.

## Current live-gate status (2026-09-01)

**Blocked before host installation.** The implementation run independently
verified the authoritative source and prepared the isolated harness, but this
execution environment could not resolve `registry.npmjs.org` (`curl` exit 6;
npm `ENOTFOUND`). The supplied cache contains only four alpha.3 tarballs and
the authoritative source has neither `node_modules` nor a built CLI. Therefore:

- no exact package lock could be generated;
- the genuine public TypeScript contract remains blocked with exit 2;
- alpha.3 `--help`, config dumps, host boot, rendered QQ contributions, live
  HMR, real Session, and desktop/mobile product assertions were not run;
- no screenshots are presented as live evidence.

See [`evidence/live-gate-2026-09-01/`](evidence/live-gate-2026-09-01/) for the
retained logs and [`SPIKE_REPORT.md`](SPIKE_REPORT.md) for the decision.

## Exact public contract configuration

`package.json` now contains:

- 35 exact dev pins (including TypeScript `6.0.3`);
- exact runtime peer pins;
- 253 exact `@deepseek-ai/dsh*` overrides generated from the immutable alpha.3
  source checkout;
- no caret or tilde direct pin.

The strict proof is configured with target/lib ES2024 + `ESNext.Disposable`,
public assembly augmentation imports, and `skipLibCheck: false`. It uses only public
package roots and documented `./client`/`./types` exports. It is not counted as
passing until a real install completes and this command exits 0:

```sh
npm run check
```

`npm run check` first audits every locked and installed DSH package location as
exactly `0.1.2-alpha.3`, then invokes the real TypeScript compiler. It never
uses a mock compiler or turns on `skipLibCheck`. Synchronize source-derived
overrides with:

```sh
npm run sync:overrides -- /path/to/dsh-alpha3
```

A first network-enabled run must generate and retain `package-lock.json`:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run build
npm run check
npm run prove
```

After that lock is reviewed and landed, repeat with `npm ci --ignore-scripts`.
Do not use `--force`, `--legacy-peer-deps`, or an ignored compiler exit code as
a gate pass.

Repository-only checks that do not need public packages:

```sh
node scripts/build.mjs
node proofs/lifecycle.proof.mjs
node proofs/bundle.proof.mjs
node proofs/public-types-gate.proof.mjs
node proofs/live-harness.proof.mjs
node --check lib/client.js
```

The public-types gate proof only proves that missing/mismatched versions block
and an exact fixture invokes `tsc`; it is deliberately not a substitute for the
real public type check.

## Authoritative launch mechanism

The command is recovered from alpha.3 source, not guessed:

```sh
DSH_HOME="$RUN/dsh-home" \
HOME="$RUN/os-home" \
"$RUN/host/node_modules/.bin/dsh" web \
  --patch "$RUN/spike/host/cordis.patch.yml" \
  --host 127.0.0.1 \
  --port 0 \
  --no-open
```

Concrete authoritative references at commit
`dd6322d604e00eec1ba5e0c8541159906a21094a` / tag
`dsh-v0.1.2-alpha.3`:

- `apps/cli/src/args.ts:4-14,120-168`: launcher flags precede app flags and
  `dsh web` aliases profile `web`;
- `packages/boot/app-boot/src/profile.ts:122-145,805-843`: profiles live below
  `$DSH_HOME`; stock Web is `dsh-base` then `dsh-web-app`, with live patch
  reload;
- `apps/cli/src/profile-boot.ts:124-172`: order is bundle layers, profile
  `cordis.patch.yml`, home `cordis.patch.yml`, then `--patch` overlays;
- `packages/bundle/web-app/src/startup.ts:1-5,46-87`: Web options are `--host`,
  `--port` (0 asks the OS), `--trusted-host`, and `--no-open`; `0.0.0.0` is
  explicitly rejected;
- `apps/cli/src/bin.ts:24-44`: parsed patches and remaining app arguments are
  passed to profile boot.

The CLI's actual `web --help` output still must be captured once the exact CLI
can be installed; it was blocked here and is not claimed.

## Safety-guarded disposable harness

Prepare a new, empty root. The script rejects any path not matching
`/tmp/qq-alpha3-live-<id>`, verifies the exact source commit/tag, copies this
package to a writable location, writes an exact host manifest, creates isolated
`HOME`/`DSH_HOME`/XDG/cache paths, and emits an execution wrapper that
removes every ambient variable except a small nonsecret locale/PATH allowlist:

```sh
RUN="$(mktemp -d /tmp/qq-alpha3-live-XXXXXXXX)"
node scripts/live/prepare.mjs \
  --run-root "$RUN" \
  --source /home/qqp/.local/state/.qq-workflows-research/research-15f22e5b/dsh-alpha3
cat "$RUN/COMMANDS.md"
```

Follow the generated sheet. Important gates:

1. Generate/reuse exact locks and pass both closure audits and the real type
   check.
2. Inspect installed lifecycle scripts. The sheet names only the source-observed
   subprocess/native packages for a narrow rebuild; never approve every script.
3. Initialize the isolated stock profile, pin its pnpm resolutions, and add the
   local package through `dsh plugin --profile web add ...`.
4. Run the generated composition verifier. It requires the installed profile
   dependency to resolve to the writable spike, keeps the bundle roster exactly
   `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, proves QQ absent from
   the stock dump, and proves one QQ Loader row in the patched dump.
5. Retain config dumps, installed-version inventory, host log, browser JSON,
   console/network rows, and screenshots under `$RUN/artifacts`.

The harness never reads `/home/qqp/.local/state/qq`, never inherits ambient
provider credentials, never binds port 3082, and never reuses a browser
profile. The browser runner rejects port 3082 and every non-loopback URL.

## Real-browser and HMR assertions

Once the isolated host prints its one-time launch URL, run in another isolated
shell (paths are examples; use the generated sheet):

```sh
node "$RUN/spike/scripts/live/browser.mjs" \
  --url '<printed-launch-url>' \
  --spike "$RUN/spike" \
  --workspace "$RUN/workspace" \
  --artifacts "$RUN/artifacts" \
  --playwright /path/to/node_modules/playwright \
  --executable /path/to/chromium
```

The script uses rendered Chromium and follows alpha.3's real Session phases:

1. It verifies a valid stock `window.__DSH_BOOT__`, exactly one QQ client row,
   retained stock layout/conversation/chat rows, and no client-plugin failure
   shell.
2. It completes first-run onboarding and creates a real workspace/blank Session
   through the rendered stock picker.
3. While the Session is blank, it asserts only what stock actually renders:
   exact QQ theme tokens and one `/qq` contribution opened through the resident
   composer's **Commands** button. It also asserts that QQ's header action, view
   tab, and view body are correctly absent, then captures 1280×800 and 390×844
   blank-shell screenshots with overflow geometry.
4. It attempts the supported user transition by filling the rendered composer
   and clicking **Send**. It never calls a controller or fabricates Session
   state. If the isolated profile has no enabled editor/Send path for its
   model/provider, the script records `BLOCKED_PROVIDER_CONFIGURATION`, keeps
   header/view assertions
   blocked, and continues with blank-visible HMR checks.
5. Only after Send visibly exposes nonblank/engaging chrome does it assert
   exactly one QQ header action, stock QQ tab/view, and active desktop/mobile
   geometry.
6. Stock HMR temporarily replaces only QQ's `apply` with a no-op. Theme and
   `/qq` cleanup/reapplication are always asserted. Header/tab/view cleanup is
   asserted only after rendered active chrome existed; otherwise those fields
   remain `BLOCKED_SESSION_REMAINED_BLANK`. Reapplication must be exactly once
   and must not navigate the page.
7. A real model-turn pass requires the assistant to render the exact unique
   marker requested by the user-visible prompt. A rendered provider/credential
   failure or no assistant response is a block, never a model-turn pass.

The blank precondition comes from authoritative alpha.3 source at commit
`dd6322d604e00eec1ba5e0c8541159906a21094a`:

- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx:59-76,129-155,165-194`
  hides header actions/tablist and returns no view area while
  `session.blank && conversationPhase(...) === 'blank'`;
- `packages/client/ui-conversation/src/client/contract/snapshot.ts:26-33`
  changes the phase to `engaging` after `promptAttempted`;
- `packages/api/session-controller/src/client/sessions/session.ts:190-206`
  flips that edge synchronously in `beginSubmission`, before the provider RPC;
- `packages/client/ui-conversation/src/client/service.ts:221-245` registers the
  echo, yields a paint, and only then calls `prompt`.

Those source facts define the automation state machine; they do not prove this
environment rendered it. The retained live run stopped before host installation.
The browser runner exits 0 only for the complete UI plus exact assistant-marker
path, exits 2 for the structured provider/model blocks above, and exits 1 for an
assertion defect.

The mutation happens only in the disposable copied package and is restored
byte-for-byte in `finally`. Stock DSH owns file polling, SSE notification,
client-module replacement, Cordis disposal, and reapplication. QQ has no reload
channel.

## Credential boundary

A blank stock Session, QQ theme, and the stock command catalog should not need
a model credential. Header/view chrome needs a supported Send to move the
Session out of the blank phase. Alpha.3 source shows that an accepted submission
exposes engaging chrome before the provider RPC, but an isolated profile may
keep the composer non-editable or Send disabled until a model/provider is
configured. The runner records that exact rendered precondition instead of
timing out.

A real model turn additionally requires a provider credential entered
specifically into the isolated profile (for example through that host's
Settings) and an exact rendered assistant marker. A failed send can still prove
the stock blank→engaging UI transition, but it is never graded as a successful
model turn. Do not inspect, copy, or inherit credentials from the active legacy
environment.
