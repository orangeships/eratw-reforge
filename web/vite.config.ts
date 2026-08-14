import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
// Tauri expects a fixed port and warns if it's not used.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "player" ? "./" : "/",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Don't watch the Rust side from Vite; tauri-cli handles it.
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    allowedHosts: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // safari14 (not 13): the 7.1a ROOMDATA place-predicates use BigInt
    // literals (`0n` — bitsets exceed 32 bits), which esbuild only emits for
    // safari ≥14. BigInt itself runs on all these targets; only the literal
    // syntax needs a newer floor. A Tauri app ships the modern system WebView,
    // so safari14 (2020) is a safe minimum.
    target: ["es2022", "chrome105", "safari14"],
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
