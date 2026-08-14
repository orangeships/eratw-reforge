/**
 * Phase 4.5H — player/studio split flag (decision "A": logical now).
 *
 * `PLAYER_BUILD` is true in a player-only build (`pnpm build:player`,
 * which runs `vite build --mode player` and loads `web/.env.player`).
 * When set, the shell hides the developer-tools entry points (the
 * title's `开发者工具` button and the `developerTools` screen), so the
 * build is a player-facing app with no creator/debug surface.
 *
 * This is the *logical* split. The *physical* two-app extraction
 * (`apps/player` + `apps/studio` + `packages/core`) is deferred to a
 * dedicated slice after Phase 5 (see `phase-4-10-roadmap.md`); the
 * `web/app/game/` subtree is already free of dev-tools imports (guarded
 * by `player-boundary.test.ts`) so that extraction will be mechanical.
 */
export const PLAYER_BUILD: boolean = import.meta.env.VITE_PLAYER_BUILD === "1";
