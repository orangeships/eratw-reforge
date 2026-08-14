# modernization/runtime/

Live runtime subtree. Owns the types, helpers, and (future) engines
that Phase 4–9 will use to play the game. **No upstream imports.**
Every file under here is part of the modernized core.

## Layout

```
runtime/
  state/                Phase 3.1 — GameState + clone/diff helpers
  intent/               Phase 4+   — AgentIntent handling
  settlement/           Phase 5+   — SOURCE_CHECK equivalents
  dialogue/             Phase 6+   — KOJO dispatch
  world/                Phase 8+   — WorldScheduler + CharacterScheduler
  agent/                Phase 9+   — Generative Agents runtime (optional)
  README.md             this file
```

Each subtree exports its public surface via `<subtree>/index.ts`.

## Rules

- **No imports from `../importer/`** — that's read-only indexer code.
- **No imports from upstream (`eratw-sub-modding-main/`)** — this is
  the modernized core, not a wrapper.
- **No `Map` / `Set` / `Date` / class instances / functions in
  exported types** — all state must be JSON-safe so `structuredClone`
  works.
- **No LLM calls** — agents live behind a stub interface until
  Phase 9.

## Tests

Tests live under `../tests/unit/`. Mirror the existing pattern
(see `glossary-loader.test.ts` for the tmpdir + factory idiom;
see `game-state.test.ts` for the pure-data variant).

## See also

- `docs/phase-3-plan.md` — Phase 3 high-level plan
- `docs/phase-3-substages.md` — Phase 3 sub-stage breakdown
- `docs/phase-4-10-roadmap.md` — Phases 4–10 strategic outline
