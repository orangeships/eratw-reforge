/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in a player-only build (`vite build --mode player`). */
  readonly VITE_PLAYER_BUILD?: string;
  /** Shipped MiniMax API key injected at build time from `.env.local`
   *  (gitignored — never commit the key). */
  readonly VITE_AI_DEFAULT_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
