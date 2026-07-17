@AGENTS.md

## Claude Code

Claude-specific instructions belong here only when they do not apply to other agents.

## Fork Notes (cnolti)

This is the `cnolti/claudian` fork of `YishenTu/claudian`, rebased onto upstream 2.0.34. Fork-only surface:

- **Heartbeat** — background vault daemon (`src/app/heartbeat/`, contract in `src/core/types/heartbeat.ts`, exposed via `FeatureHost.heartbeat`). UI: heart button + status dropdown in the input nav row, settings panel section, `heartbeat*` settings keys.
- **Tool-call grouping** — `src/features/chat/rendering/toolCallGrouping.ts` collapses runs of ≥2 consecutive tool/thinking blocks. Progressive during streaming (`keepTrailingOpen` on text-block/compact-boundary creation in `StreamController`), final pass in `InputController`'s turn-finally block (NOT `resetStreamingState` — that only runs on tab recycle), replay pass in `MessageRenderer`. Running subagents never group.
- **Status narrator** — cheap-model live status line while a turn runs (`statusNarratorEnabled`/`statusNarratorModel`). Contract in `core/providers/types.ts` (`StatusNarrationService`), Claude impl via `runColdStartQuery`, coordinator `src/features/chat/services/StatusNarrator.ts` (throttled, ephemeral DOM only, `.claudian-narrator-line` is transparent to grouping).
- **External-context merging** — `mergePersistentExternalContextPaths()` in `src/utils/externalContext.ts` unions persistent settings paths into existing conversations (8 call sites). The invalid-path cleanup Notice is intentionally silenced.
- **onunload runtime cleanup** — `main.ts` terminates provider runtimes on plugin unload to avoid zombie CLI processes.
- **Branding/deploy** — manifest id stays `claudian` (upstream renamed theirs to `realclaudian`); `npm run deploy` bumps the `-fork.N` version, builds, copies to the vault (`OBSIDIAN_VAULT` in `.env.local`), commits and pushes to all non-upstream remotes (`--skip-bump`, `--skip-git` to opt out).
- **Test locale** — `scripts/run-jest.js` pins `en_US.UTF-8` so upstream `toLocaleString` assertions pass on German hosts. Tests need Node ≥22.4 (use nvm; system default may be older).

When merging upstream again: prefer re-porting these patches onto a fresh upstream base over conflict-merging (worked well for 2.0.24 and 2.0.34). Mind the architecture boundary tests (`scripts/check-architecture-boundaries.test.mjs`): heartbeat lives in `src/app/` because it imports `main` and `providers/claude`.
