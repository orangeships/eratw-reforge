# Legacy ERB compatibility executor

Status: **production-dead, tooling-live**.

This directory preserves a function-level ERB executor for focused compatibility
tests, migration research, and oracle comparisons. It is not part of Web/Tauri
player bootstrap and is not a fallback for current dialogue routing.

Legacy generated shards may still exist under `web/public/` for those tests.
Their presence in a source tree or copied build directory does not mean the
application loads or executes them.

Current game dialogue belongs to `modernization/runtime/kojo/` and reaches the
UI through either the generated Browser tree or Tauri `KojoCache`. When an
authored route is missing, gated, or unsupported, fix that active importer,
resolver, cache adapter, or an explicitly owned native deterministic slice.

Do not reconnect this executor merely because it can evaluate a particular ERB
construct. Production use requires a new explicit architecture decision from
the user, along with player-bootstrap, state-authority, save, bundle-size, and
cross-adapter verification.
