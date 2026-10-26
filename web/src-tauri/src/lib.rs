//! Native Tauri shell for the Web/Tauri runtime and Mod Studio.
//!
//! The registered command set is the IPC authority. Player/runtime commands
//! cover Kojo source access and save/load; Studio commands cover project
//! validation, generated manifests, resource scope, and source watching.
//! Manifest watcher events are emitted on `manifest://rebuilt` and
//! `manifest://error`.

mod asset_scope;
mod ai_proxy;
mod game_state;
mod manifest;
mod project;
mod watcher;

use std::time::{SystemTime, UNIX_EPOCH};

use watcher::WatchHandle;

#[tauri::command]
fn ping() -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("pong-{}", ts)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(WatchHandle(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            ping,
            ai_proxy::ai_http_request,
            project::validate_project_path,
            project::validate_kojo_source_path,
            manifest::get_manifest,
            asset_scope::add_asset_scope,
            asset_scope::add_kojo_source_scope,
            watcher::start_watch,
            watcher::stop_watch,
            game_state::save_state,
            game_state::load_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
