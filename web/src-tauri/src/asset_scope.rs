//! Asset protocol scope — Phase 2.2.
//!
//! Lets the renderer (React side) ask Rust to add a directory to the
//! `asset://` protocol's allowlist, so `<img src={convertFileSrc(...)}/>`
//! can load files from that directory.
//!
//! Project selection is dynamic (the user picks a folder at runtime), so the
//! scope can't be hard-coded in tauri.conf.json. We expose a command that
//! takes an absolute path and calls `AppHandle::asset_protocol_scope().allow_directory`.
//!
//! The scope is process-wide and accumulates — calling `add_asset_scope`
//! twice with the same path is a no-op. Calling with a new path appends.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::project::resolve_kojo_source_root;

/// Add `<project_root>/resources` to the asset protocol scope, recursively.
/// Idempotent: calling twice with the same root is safe.
///
/// Returns the absolute resources directory path on success; returns an
/// error string on failure (mirrors the convention used by `get_manifest`).
#[tauri::command]
pub fn add_asset_scope(app: AppHandle, project_root: String) -> Result<String, String> {
    let root = PathBuf::from(&project_root);
    if !root.is_dir() {
        return Err(format!("invalid project root: {}", project_root));
    }
    let resources = root.join("resources");
    if !resources.is_dir() {
        return Err(format!(
            "resources/ directory does not exist under {}",
            resources.display()
        ));
    }
    app.asset_protocol_scope()
        .allow_directory(&resources, true)
        .map_err(|e| format!("tauri scope: {}", e))?;
    Ok(resources.to_string_lossy().into_owned())
}

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
