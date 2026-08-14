//! Asset protocol scope for player-authorized local Kojo files.
//!
//! Lets the renderer (React side) ask Rust to add a directory to the
//! `asset://` protocol's allowlist, so `<img src={convertFileSrc(...)}/>`
//! can load files from that directory.
//!
//! Kojo source selection is dynamic (the user picks a folder at runtime), so the
//! scope can't be hard-coded in tauri.conf.json. We expose a command that
//! takes an absolute path and calls `AppHandle::asset_protocol_scope().allow_directory`.
//!
//! The scope is process-wide and accumulates — calling `add_kojo_source_scope`
//! twice with the same path is a no-op. Calling with a new path appends.

use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::project::resolve_kojo_source_root;

/// Add a selected eraTW Kojo source directory to the asset protocol scope,
/// recursively. `source_path` may be the project root, ERB directory, or the
/// exact `口上・メッセージ関連` directory.
#[tauri::command]
pub fn add_kojo_source_scope(app: AppHandle, source_path: String) -> Result<String, String> {
    let (kojo, _) = resolve_kojo_source_root(Path::new(&source_path))?;
    app.asset_protocol_scope()
        .allow_directory(&kojo, true)
        .map_err(|e| format!("tauri scope: {}", e))?;
    Ok(kojo.to_string_lossy().into_owned())
}
