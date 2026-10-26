//! GameState persistence — Phase 4.
//!
//! Reads / writes the live `GameState` (Phase 3.1's shape) as JSON
//! to a per-project file in the Tauri app data dir. Different
//! eraTW project roots get different files so switching projects
//! doesn't clobber a save.
//!
//! File layout:
//!   <app_data>/states/<projectRootHash>.json
//!
//! `<projectRootHash>` is a 16-hex-char SipHash of the project
//! root string. Cryptographic strength is irrelevant here — it's
//! a filename key, not a security boundary; the app data dir is
//! already per-user.
//!
//! The `state` argument to `save_state` is untyped `serde_json::Value`
//! because the `GameState` type lives in TypeScript. The renderer's
//! `tauri-bridge.ts` is the contract; Rust just round-trips JSON.
//!
//! Phase 5+ will read the same file with the same helper, so the
//! shape contract is durable.
//!
//! Test strategy: the file-I/O functions take a `base: &Path`
//! argument (the Tauri-side resolves it to `app_data_dir`). Tests
//! pass a tempdir. The Tauri-command wrappers are thin adapters
//! on top of those pure functions.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::Manager;

/// Hash a project-root string into a 16-hex-char filename key.
/// `DefaultHasher` (SipHash) is in std, no extra crate. Output
/// length is always 16 hex chars (or "empty" for the empty
/// input, which is rejected upstream anyway).
pub fn project_root_hash(project_root: &str) -> String {
    if project_root.is_empty() {
        return "empty".to_string();
    }
    let mut h = DefaultHasher::new();
    project_root.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Build the absolute save-file path for `project_root` under
/// `base`. The file is one level deep: `<base>/states/<hash>.json`.
pub fn state_file_path(base: &Path, project_root: &str) -> PathBuf {
    base.join("states")
        .join(format!("{}.json", project_root_hash(project_root)))
}

/// Reject empty or absurdly long project roots. 1024 is well
/// above any realistic Windows MAX_PATH but well below a
/// "path-traversal in a header" attack.
pub fn validate_project_root(project_root: &str) -> Result<(), String> {
    if project_root.is_empty() {
        return Err("project_root must not be empty".to_string());
    }
    if project_root.len() > 1024 {
        return Err(format!(
            "project_root too long ({} > 1024)",
            project_root.len()
        ));
    }
    Ok(())
}

/// Pure helper: write `state` to the per-project file under
/// `base`. The Tauri command `save_state` is a thin wrapper
/// around this. Tests use a tempdir as `base`.
pub fn save_state_to(
    base: &Path,
    project_root: &str,
    state: &serde_json::Value,
) -> Result<(), String> {
    validate_project_root(project_root)?;
    let states_dir = base.join("states");
    std::fs::create_dir_all(&states_dir)
        .map_err(|e| format!("create states dir {}: {}", states_dir.display(), e))?;
    let path = state_file_path(base, project_root);
    let text = serde_json::to_string_pretty(state)
        .map_err(|e| format!("serialize state: {}", e))?;
    // Memory blocks are written before their save root. Publishing the root
    // atomically keeps the previous complete slot readable on write failure.
    static WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let temp = path.with_extension(format!("{}.{}.tmp", std::process::id(), WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &path)
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write {}: {}", path.display(), error));
    }
    Ok(())
}

/// Pure helper: read the per-project file under `base`. Returns
/// `Ok(None)` if the file doesn't exist (first boot, or the user
/// cleared their last project). The Tauri command `load_state` is
/// a thin wrapper around this.
pub fn load_state_from(
    base: &Path,
    project_root: &str,
) -> Result<Option<serde_json::Value>, String> {
    validate_project_root(project_root)?;
    let path = state_file_path(base, project_root);
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {}", path.display(), e))?;
    let state: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse {}: {}", path.display(), e))?;
    Ok(Some(state))
}

/// Tauri command: write the current `GameState` to the app data dir.
/// See `tauri-bridge.ts::saveState` for the JS side.
#[tauri::command]
pub fn save_state(
    app: tauri::AppHandle,
    project_root: String,
    state: serde_json::Value,
) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {}", e))?;
    save_state_to(&app_data_dir, &project_root, &state)
}

/// Tauri command: read the persisted `GameState` from the app data
/// dir. Returns `null` if no save file exists. See
/// `tauri-bridge.ts::loadState` for the JS side.
#[tauri::command]
pub fn load_state(
    app: tauri::AppHandle,
    project_root: String,
) -> Result<Option<serde_json::Value>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {}", e))?;
    load_state_from(&app_data_dir, &project_root)
}

#[cfg(test)]
mod tests {
    //! Phase 4 audit P3 — GameState persistence tests.
    //!
    //! Pre-4A: 0 Rust tests for game_state. Post-4B: 12 tests
    //! pinning the hash, the file-path derivation, the
    //! project-root validation, the round-trip, the missing-
    //! file case, the corrupt-JSON case, and the per-project
    //! collision-free keying.
    //!
    //! Tests use a tempdir as the "base" path. Cleanup is
    //! best-effort; CI runs in a fresh container.

    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmpdir(label: &str) -> PathBuf {
        let pid = std::process::id();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir()
            .join(format!("eratw-game-state-test-{}-{}-{}", label, pid, ts));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn best_effort_cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    // ----- project_root_hash -----

    #[test]
    fn project_root_hash_is_deterministic() {
        let h1 = project_root_hash(r"F:\mattest\self-llm\claude playground\aigame\eratw-sub-modding-main");
        let h2 = project_root_hash(r"F:\mattest\self-llm\claude playground\aigame\eratw-sub-modding-main");
        assert_eq!(h1, h2);
        assert!(!h1.is_empty());
        assert_eq!(h1.len(), 16, "16 hex chars expected; got {:?}", h1);
    }

    #[test]
    fn project_root_hash_differs_per_path() {
        let a = project_root_hash(r"F:\a");
        let b = project_root_hash(r"F:\b");
        assert_ne!(a, b);
    }

    #[test]
    fn project_root_hash_handles_empty_as_sentinel() {
        // Empty is rejected by validate_project_root, but the
        // hash function itself shouldn't crash and should
        // produce a stable sentinel.
        let h1 = project_root_hash("");
        let h2 = project_root_hash("");
        assert_eq!(h1, h2);
        assert!(!h1.is_empty());
    }

    // ----- validate_project_root -----

    #[test]
    fn validate_project_root_accepts_typical_paths() {
        assert!(validate_project_root(r"F:\foo").is_ok());
        assert!(validate_project_root("/home/user/project").is_ok());
        assert!(validate_project_root(r"C:\Users\user\AppData\Roaming\eratw").is_ok());
    }

    #[test]
    fn validate_project_root_rejects_empty() {
        assert!(validate_project_root("").is_err());
    }

    #[test]
    fn validate_project_root_rejects_overlong() {
        // 1025 chars > 1024 cap.
        let long = "a".repeat(1025);
        assert!(validate_project_root(&long).is_err());
        // Exactly 1024 must still pass.
        let exact = "a".repeat(1024);
        assert!(validate_project_root(&exact).is_ok());
    }

    // ----- state_file_path -----

    #[test]
    fn state_file_path_lands_under_states_subdir() {
        let base = Path::new(r"C:\appdata");
        let p = state_file_path(base, r"F:\foo");
        assert!(p.starts_with(base.join("states")));
        assert_eq!(p.extension().and_then(|s| s.to_str()), Some("json"));
    }

    #[test]
    fn state_file_path_uses_hash_not_raw_path() {
        // Path traversal hardening: a project_root that contains
        // path separators must not end up as a directory under
        // `<base>/states/`. The hash collapses it.
        let base = Path::new(r"C:\appdata");
        let p = state_file_path(base, r"F:\..\..\etc\passwd");
        let parent = p.parent().expect("path has parent");
        assert_eq!(parent, base.join("states"));
    }

    // ----- save_state_to / load_state_from round-trip -----

    #[test]
    fn save_then_load_round_trip() {
        let base = unique_tmpdir("roundtrip");
        let root = r"F:\test-project";
        // Intentionally generic JSON shape — this test pins the
        // round-trip behaviour, not the legacy namespace layout.
        // The legacy keys are forbidden in this codebase's web/
        // tree (see forbidden-names.test.ts).
        let state = serde_json::json!({
            "time": {"tickValue": 0, "dayIndex": 0, "hourOfDay": 8},
            "master": {
                "charaNum": 0,
                "location": "神社",
                "state": {
                    "ns1": {"0": 1},
                    "ns2": {},
                    "ns3": {},
                    "ns4": {"0": 100},
                    "ns5": {"0": 1000, "1": 500},
                    "ns6": {},
                    "ns7": {}
                }
            },
            "charas": {},
            "flagStore": {},
            "eventLog": [
                {"kind": "STATUS_MESSAGE", "timestamp": 1, "source": "system", "text": "boot"}
            ],
            "readOnlyMetadata": {
                "takenAt": 0,
                "charas": [],
                "flagUniverse": [],
                "commandCatalog": [],
                "functionIndex": [],
                "kojoMap": [],
                "genericHandlers": [],
                "timeOfDay": null,
                "locationMap": null
            }
        });

        save_state_to(&base, root, &state).expect("save");
        let loaded = load_state_from(&base, root).expect("load").expect("not None");
        assert_eq!(loaded, state);
        best_effort_cleanup(&base);
    }

    #[test]
    fn load_returns_none_for_missing_file() {
        let base = unique_tmpdir("missing");
        let loaded = load_state_from(&base, r"F:\nope").expect("load");
        assert!(loaded.is_none());
        best_effort_cleanup(&base);
    }

    #[test]
    fn load_returns_error_for_corrupt_json() {
        let base = unique_tmpdir("corrupt");
        let root = r"F:\corrupt";
        let path = state_file_path(&base, root);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{not json").unwrap();
        let result = load_state_from(&base, root);
        assert!(result.is_err(), "expected parse error, got {:?}", result);
        best_effort_cleanup(&base);
    }

    // ----- validation gate propagates to I/O functions -----

    #[test]
    fn save_rejects_empty_project_root() {
        let base = unique_tmpdir("empty");
        let state = serde_json::json!({});
        let result = save_state_to(&base, "", &state);
        assert!(result.is_err());
        best_effort_cleanup(&base);
    }

    #[test]
    fn load_rejects_empty_project_root() {
        let base = unique_tmpdir("empty-load");
        let result = load_state_from(&base, "");
        assert!(result.is_err());
        best_effort_cleanup(&base);
    }

    // ----- multi-project behaviour -----

    #[test]
    fn two_projects_dont_collide() {
        let base = unique_tmpdir("twoproj");
        let a_state = serde_json::json!({"who": "a"});
        let b_state = serde_json::json!({"who": "b"});
        save_state_to(&base, r"F:\proj-a", &a_state).unwrap();
        save_state_to(&base, r"F:\proj-b", &b_state).unwrap();
        let a_loaded = load_state_from(&base, r"F:\proj-a").unwrap().unwrap();
        let b_loaded = load_state_from(&base, r"F:\proj-b").unwrap().unwrap();
        assert_eq!(a_loaded, a_state);
        assert_eq!(b_loaded, b_state);
        assert_ne!(a_loaded, b_loaded);
        best_effort_cleanup(&base);
    }

    #[test]
    fn overwrite_succeeds() {
        let base = unique_tmpdir("overwrite");
        let root = r"F:\same";
        let v1 = serde_json::json!({"v": 1});
        let v2 = serde_json::json!({"v": 2});
        save_state_to(&base, root, &v1).unwrap();
        save_state_to(&base, root, &v2).unwrap();
        let loaded = load_state_from(&base, root).unwrap().unwrap();
        assert_eq!(loaded, v2);
        best_effort_cleanup(&base);
    }

    #[cfg(windows)]
    #[test]
    fn failed_replace_keeps_previous_complete_save() {
        let base = unique_tmpdir("failed-replace");
        let root = r"F:\readonly-slot";
        let previous = serde_json::json!({"version": 2, "state": {"memory": "complete"}});
        save_state_to(&base, root, &previous).unwrap();
        let path = state_file_path(&base, root);
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions).unwrap();
        let result = save_state_to(&base, root, &serde_json::json!({"state": "replacement"}));
        let loaded = load_state_from(&base, root).unwrap().unwrap();
        let mut permissions = std::fs::metadata(&path).unwrap().permissions();
        permissions.set_readonly(false);
        std::fs::set_permissions(&path, permissions).unwrap();
        assert!(result.is_err());
        assert_eq!(loaded, previous);
        assert_eq!(std::fs::read_dir(base.join("states")).unwrap().count(), 1);
        best_effort_cleanup(&base);
    }
}
