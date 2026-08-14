//! Native Tauri shell for the eraTW Modern Player.
//!
//! The renderer invokes only the commands registered below:
//!   - `ping` — liveness check; returns `"pong-<unix-millis>"`.
//!   - `validate_kojo_source_path` — normalize a player-selected source.
//!   - `add_kojo_source_scope` — authorize the normalized Kojo tree.
//!   - `save_state` / `load_state` — persist GameState JSON in the app data dir.
//!
//! Plugins enabled:
//!   - `tauri-plugin-dialog` — native folder picker.
//!   - `tauri-plugin-store` — persisted settings file (renderer side only).

mod asset_scope;
mod game_state;
mod project;

use std::time::{SystemTime, UNIX_EPOCH};

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
        .invoke_handler(tauri::generate_handler![
            ping,
            project::validate_kojo_source_path,
            asset_scope::add_kojo_source_scope,
            game_state::save_state,
            game_state::load_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
