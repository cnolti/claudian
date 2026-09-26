# AGENTS.md

## Loading and verification

- Tests follow the guides of the source they cover; they do not inherit `src/` instructions automatically.
- Build, dependency, lockfile, locale/static-asset import, and `esbuild.config.mjs` changes also require `scripts/AGENTS.md`. Composition changes require the guides of the services being wired.
- Use the Node version in `.node-version`. For code changes, the full verification command is:

```bash
npm run typecheck && npm run lint && npm run test && npm run build && npm run check:performance
```

- For focused changes, `npm run test:affected -- --base origin/main` selects related tests; it does not replace typecheck, lint, build, or performance checks. Documentation-only changes need `git diff --check` (CI enforces it on every pull request) and their affected documentation tests, not a production build.
- Dev and production builds load `.env.local` and may copy artifacts into the configured `OBSIDIAN_VAULT`, including removal of its old `.codex-vendor`. Check that destination before building; clearing the shell variable does not prevent reloading it from the file.

## Architectural constraints

- `src/main.ts` is the sole concrete composition root and lifecycle publisher. App subcomposition returns complete domains, never a second root or service locator.
- `src/composition/` holds main-owned wiring that must reach both `app/` and `features/`. Only `main.ts` and other composition modules import it; it never imports `main.ts` or concrete providers, and `main.ts` still constructs, registers, and tears it down.
- App repositories/settings/storage depend on core contracts, not feature orchestration or provider-native protocols. Concrete provider imports are confined to `main.ts` and provider-default assembly.
- Features use `FeatureHost` and core registries, never concrete app/provider implementations. `FeatureHost` stays feature-neutral; chat-only capabilities belong in chat's `ChatFeatureHost` extension. Providers use `ProviderHost`, never feature orchestration. Core imports none of these implementations.
- Shared ACP code contains protocol mechanics and protocol-level normalization only; provider launch policy, extensions, provider-specific normalization, and history stay provider-owned.

## Local conventions

- Use English for code/comments/identifiers/commits/code blocks. Soft-wrap Markdown. Put uncommitted notes, traces, and throwaway scripts in `.context/`. No production `console.*`.
- TypeScript files use PascalCase for their main concept, camelCase for utility bags, and kebab-case for external package names. Preserve `index.ts` barrels, `types.ts` buckets, and source-mirrored test names; this does not require creating new barrels or type buckets. No interface `I` prefix. Preserve acronym capitals in filenames and matching owned identifiers (`ACPClientConnection`, `buildACPUsageInfo`, `URLs`); leading acronyms remain lowercase in camelCase (`acpConnection`). Preserve external API names and serialized keys. Folders use kebab-case; imports omit `.ts` and prefer `@/`.
- UI actions use native controls. Buttons that do not submit a form declare `type="button"`; non-native controls need equivalent accessible names, roles, and keyboard behavior.

## Regression verification

- For behavior changes, demonstrate the intended failing regression before implementation and rerun it afterward. Documentation/mechanical changes are exempt; when automation is infeasible, record a repeatable reproduction and verify the nearest stable contract.

## Instruction maintenance

- Keep non-obvious constraints at their narrowest common scope, with one authoritative home and explicit exceptions. Remove implementation inventories, generic advice, inherited duplicates, and retired decisions.
- Each guide has a sibling `CLAUDE.md` containing only `@AGENTS.md`.

## Fork notes (cnolti)

This is the `cnolti/claudian` fork of `YishenTu/claudian`, re-ported onto upstream 2.3.4. Fork-only surface:

- **Heartbeat**: background vault daemon. Contract in `src/core/types/heartbeat.ts`; scheduling/state in `src/app/heartbeat/` behind a narrow `HeartbeatManagerHost` (no `main` import); the Claude turn runs provider-owned in `src/providers/claude/heartbeat/`; `main.ts` wires both and exposes `FeatureHost.heartbeat`. UI: `features/chat/ui/HeartbeatStatusControl.ts` (nav row) and `features/settings/HeartbeatSettingsSection.ts`; `heartbeat*` settings keys.
- **Tool-call grouping**: `features/chat/rendering/toolCallGrouping.ts` collapses runs of at least 2 consecutive tool/thinking blocks. While streaming, `StreamController` caps the trailing run at `STREAMING_TRAILING_VISIBLE` (after pending-tool flushes and after every tool result); `InputController` groups a finished assistant message when the next one starts; `MessageRenderer.finalizeResponse` and replay run the final pass before upstream's "Worked for" collapse. Running tools/subagents never group.
- **Branding/deploy**: manifest id stays `claudian` (upstream uses `realclaudian`); `npm run deploy` bumps the `-fork.N` version, builds, copies to the vault (`OBSIDIAN_VAULT` in `.env.local`), commits, and pushes to all non-upstream remotes (`--skip-bump`, `--skip-git`).
- **Test locale**: `scripts/run-jest.js` pins `en_US.UTF-8` so `toLocaleString` assertions pass on German hosts.

**Heartbeat is disabled in the vault since 2026-09-26** (`heartbeatEnabled: false`): launchd + `heartbeat.sh` is the only daemon scheduler (decision: the daemon must run without Obsidian; both paths shared `state.json` without a common lock). On the next upstream re-port, do NOT re-port the heartbeat runner/manager; at most keep a read-only status indicator that reads `.agentfiles/daemon/state.json`. This shrinks the fork surface.

Retired with 2.3.4 because upstream now covers them: external-context merging (upstream removed external context, #1283) and the onunload runtime cleanup (`executionLifecycleRegistry.dispose()`).

When merging upstream again, re-port this surface onto a fresh upstream base instead of conflict-merging, then land it on `main` via `merge -s ours` plus `git read-tree -u --reset <port-branch>`.
