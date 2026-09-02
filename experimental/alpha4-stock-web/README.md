# QQ UI / DSH alpha.4 stock-Web composition spike

This sibling package is the operator-approved alpha.4 continuation of the
historical `experimental/alpha3-stock-web` work. It targets exact DeepSeek
Harness `0.1.2-alpha.4` and keeps **architecture A**: stock DSH Web owns the
root application and QQ adds a small presentation layer through public
Cordis/DSH contracts.

This is an experiment, not a production cutover. It never replaces or
reconfigures legacy `/qq`, and it must never bind protected port `3082`.

## Ownership boundary

Stock DSH continues to own:

- the root/responsive shell and sidebar;
- workspace and Session lifecycle/history;
- connection, browser trust, recovery, and reconnect;
- conversation state, Chat transcript, composer, and interactions;
- model discovery/selection and Settings;
- the Agent loop, tools, persistence, and provider calls.

This package owns only:

- five reversible QQ theme-token overrides;
- one `/qq` command contribution;
- one nonblank-Session header action;
- one nonblank-Session QQ view/tab;
- the minimal public assembly and cleanup required for those contributions.

The package declares `dsh.client` but no `dsh.bundle`. Its host patch has one
inserted row. `@hypermemetic-ai/qq-models` is deliberately separate: it must be
installed as the third profile Bundle after stock `dsh-base` and
`dsh-web-app`; this UI package is only a plain profile dependency.

## Exact alpha.4 closure

Authoritative source identity:

- tag: `dsh-v0.1.2-alpha.4`
- commit: `4e84901e6471b79ec0338099867ebb4606d12bb5`
- 252 `@deepseek-ai/dsh*` source package names, all version
  `0.1.2-alpha.4`
- sorted name/version set SHA-256:
  `fe20e208a3359dbd3a39f83c22afa81e184374cbf386b4f33c3598de57439ce5`

Relative to alpha.3, the generated set adds
`@deepseek-ai/dsh-experimental-code-runtime-python` and removes
`@deepseek-ai/dsh-code-runtime-python` plus
`@deepseek-ai/dsh-tool-subagent-report`.

`package.json` contains the source-generated 252 overrides. Every direct and
peer DSH dependency is exact alpha.4. `package-lock.json` is lockfile v3 and
currently resolves 61 installed DSH package locations, all exact alpha.4 with
registry resolution/integrity. Public compile imports use ordinary package
roots and documented `./client`/`./types` paths; no removed invariant companion
is imported. TypeScript runs with `skipLibCheck: false`.

Regenerate pins only from the exact source tag:

```sh
node scripts/sync-alpha4-overrides.mjs /path/to/dsh-v0.1.2-alpha.4
npm ci --ignore-scripts
npm test
```

## Safety-gated live workflow

The live workflow rejects source directories and mutable links as install
inputs. In a normal Git checkout, create each tarball and digest-bound
clean-commit provenance with:

```sh
node scripts/live/pack-committed.mjs /clean/committed/qq-models /tmp/packs
node scripts/live/pack-committed.mjs /clean/committed/qq-ui/experimental/alpha4-stock-web /tmp/packs
```

`prepare.mjs` accepts only those `.tgz` files and provenance records. It also
blocks a `qq-models` pack unless both adapters expose the alpha.4
`imageRequestPricing` and `prepareCall` defaults and its manifest runs exact
DSH/Cordis integration coverage. No UI compatibility shim is accepted.

```sh
node scripts/live/prepare.mjs \
  --run-root /tmp/qq-alpha4-live-UNIQUE \
  --source /path/to/exact/dsh-v0.1.2-alpha.4 \
  --ui-pack /tmp/packs/hypermemetic-ai-qq-ui-alpha4-spike-0.0.0-alpha.4-spike.tgz \
  --ui-provenance /tmp/packs/hypermemetic-ai-qq-ui-alpha4-spike-0.0.0-alpha.4-spike.tgz.provenance.json \
  --qq-models-pack /tmp/packs/hypermemetic-ai-qq-models-0.0.0.tgz \
  --qq-models-provenance /tmp/packs/hypermemetic-ai-qq-models-0.0.0.tgz.provenance.json
```

The generated `COMMANDS.md` starts commands through an explicit allowlist and
uses separate run-owned `HOME`, `DSH_HOME`, `QQ_DSH_HOME`, XDG roots, npm
cache/config, temporary directory, empty workspace, browser profile, and
OS-assigned loopback port. It records stock, additive-model, and final patched
config separately.

The run stops before authorization. The only supported credential step is a
fresh isolated Grok device login. The operator approves the displayed code;
the command must not be piped or recorded. No provider key is requested. Auth
evidence contains readiness and `0700`/`0600`-style mode facts only—never a
device code, token, cookie, OAuth response, header, or tokenized URL.

`supervise.mjs` launches the actual DSH child in a task-owned process group,
passes the launch URL to the browser only over stdin, stores only sanitized
logs, and proves the owned child/group is reaped. HMR mutates and restores the
installed tarball artifact under the disposable profile, not a checkout link.
The final turn proof reads only the task-owned stock Session JSONL and retains
route/count/hash/terminal facts, not transcript content.

## Live acceptance semantics

A final PASS requires all of the following:

1. one QQ client row and the expected stock client rows in the live boot graph;
2. blank state: QQ theme and slash command exactly once, with header/tab/view
   correctly absent;
3. rendered stock model picker containing one `xai-auth/grok-4.6` route;
4. rendered Send of a random no-tools nonce prompt;
5. nonempty streamed assistant output containing that nonce;
6. persisted `request/header` selecting `xai-auth/grok-4.6`, at least one
   `assistant/chunk`, a final nonce-containing `assistant/message`, completed
   `turn/end`, and zero `tool/call` events;
7. active state: one QQ header action, tab/view, slash contribution, and stock
   Chat;
8. disposal/reapplication of every QQ contribution exactly once without page
   navigation or stale registration;
9. desktop/mobile geometry, accessibility-visible controls, no horizontal
   overflow, stock Settings/model/session controls, and stock reconnect;
10. sanitized evidence and `PASS_REAPED_NO_ORPHAN` cleanup.

An engaging transition, route listing, missing credential, provider error, or
fabricated/mock Session event is never a model-turn pass.

## Current status

Repository implementation, exact install, build, closure audit, strict public
type check, lifecycle, bundle, path guards, packed-input checks, synthetic
extractor negative tests, and supervisor contract tests pass.

The live product matrix has **not** been executed by this change. The inspected
clean `qq-models` prerequisite remains commit
`6dc6fb1a6d76aa0c83edfc8326481760e0b1aac2`, which lacks both required alpha.4
adapter defaults and exact integration tests. The harness correctly rejects
that pack. Therefore host/browser/HMR/device-login/real-turn assertions are
**BLOCKED**, not PASS. See `SPIKE_REPORT.md` and retained preparation evidence.
