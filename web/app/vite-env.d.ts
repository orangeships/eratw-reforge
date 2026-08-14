/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in a player-only build (`vite build --mode player`). */
  readonly VITE_PLAYER_BUILD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
