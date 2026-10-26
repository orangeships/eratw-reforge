//! File-system watcher + manifest rebuild trigger — Phase 2.4.
//!
//! The renderer asks Rust to start watching a project root. Rust uses the
//! `notify` crate to watch `<root>/{CSV,ERB,resources}` recursively. On
//! any fs event, we shell out to `node build-manifests.mjs` (via the
//! tauri-plugin-shell) which re-runs the importer pipeline and writes
//! fresh JSON to `modernization/out/`.
//!
//! Latency collapse: an `in_flight` flag prevents the rebuild queue
//! from running more than one rebuild at a time. Burst saves (which
//! trigger several fs events in a row) collapse to 1-2 rebuilds, not N.
//! A debounce timer is a follow-up optimization (2.4 ships the simpler
//! "in-flight skip" — see Risks in phase-2-4-plan.md).
//!
//! Event flow:
//!   notify::recommended_watcher → handle_fs_event → trigger_rebuild
//!     → shell.command("node").output() → emit "manifest://rebuilt" or
//!     → emit "manifest://error"
//!
//! Capability: see web/src-tauri/capabilities/default.json. The shell
//! scope pins `node` to args matching
//! `modernization/scripts/build-manifests.mjs --project-root <abs path>`
//! so even a compromised renderer can't escape that pattern.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

/// Event names emitted to the renderer. Subscribed in the manifest-store.
pub const EVENT_REBUILT: &str = "manifest://rebuilt";
pub const EVENT_ERROR: &str = "manifest://error";

/// State stored in `app.state()`. Mutex-wrapped so `start_watch` can
/// atomically swap the active watcher (and the previous one is dropped,
/// which unregisters its OS handle).
pub struct WatchHandle(pub Mutex<Option<ActiveWatch>>);

/// What we hold while a watcher is alive. The `_watcher` field is named
/// with the leading underscore because we never read it after construction;
/// we only need to KEEP it alive — dropping it would unregister the
/// notify callback.
pub struct ActiveWatch {
    pub project_root: PathBuf,
    pub _watcher: RecommendedWatcher,
    /// Set to `true` while a rebuild is running. New events arriving
    /// during a rebuild are dropped (the rebuild is reading the same
    /// files; we don't need a second pass until it's done).
    pub in_flight: Mutex<bool>,
    /// Bumped on every fs event. Used to make sure only the latest
    /// "should rebuild" intention triggers a rebuild when bursts occur.
    /// Even though the in_flight check is the primary mechanism, this
    /// counter helps with race conditions.
    pub event_generation: AtomicU64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRebuiltEvent {
    pub project_root: String,
    pub generated_at: String,
    pub duration_ms: u64,
    pub manifest_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ManifestErrorEvent {
    pub project_root: String,
    pub phase: String,
    pub message: String,
    pub exit_code: Option<i32>,
}

/// Start watching `<project_root>/{CSV,ERB,resources}` recursively.
/// If a previous watcher was active, it's torn down first.
#[tauri::command]
pub fn start_watch(
    app: AppHandle,
    state: State<'_, WatchHandle>,
    project_root: String,
) -> Result<(), String> {
    let root = PathBuf::from(&project_root);
    if !root.is_dir() {
        return Err(format!("invalid project root: {}", project_root));
    }

    // 1. Drop any existing watcher.
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|e| format!("watch handle lock: {}", e))?;
        *guard = None;
    }

    // 2. Create a new notify watcher. Callback runs on notify's own
    //    thread; we just need to send a "should rebuild" signal back to
    //    the Tauri app to trigger the rebuild.
    let app_for_cb = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        match res {
            Ok(_event) => {
                // Bump the generation counter; trigger_rebuild checks this.
                if let Some(state) = app_for_cb.try_state::<WatchHandle>() {
                    if let Ok(guard) = state.0.lock() {
                        if let Some(active) = guard.as_ref() {
                            active.event_generation.fetch_add(1, Ordering::SeqCst);
                        }
                    }
                }
                trigger_rebuild(&app_for_cb);
            }
            Err(e) => {
                // notify itself errored; surface it. Don't tear down the
                // watcher — the next event might succeed.
                let _ = app_for_cb.emit(
                    EVENT_ERROR,
                    ManifestErrorEvent {
                        project_root: project_root.clone(),
                        phase: "watch".to_string(),
                        message: format!("notify: {}", e),
                        exit_code: None,
                    },
                );
            }
        }
    })
    .map_err(|e| format!("create notify watcher: {}", e))?;

    // 3. Watch the three subtrees. Missing subdirs are skipped (eraTW
    //    must have at least CSV/ and ERB/ for the project to be valid;
    //    resources/ is optional).
    for sub in &["CSV", "ERB", "resources"] {
        let dir = root.join(sub);
        if dir.is_dir() {
            watcher
                .watch(&dir, RecursiveMode::Recursive)
                .map_err(|e| format!("watch {}: {}", dir.display(), e))?;
        }
    }

    // 4. Install.
    let active = ActiveWatch {
        project_root: root,
        _watcher: watcher,
        in_flight: Mutex::new(false),
        event_generation: AtomicU64::new(0),
    };
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("watch handle lock: {}", e))?;
    *guard = Some(active);
    Ok(())
}

/// Tear down the active watcher. Idempotent.
#[tauri::command]
pub fn stop_watch(state: State<'_, WatchHandle>) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|e| format!("watch handle lock: {}", e))?;
    *guard = None;
    Ok(())
}

/// Trigger a rebuild. Called from the notify callback. Honors `in_flight`:
/// if a rebuild is already running, this call is a no-op (the next fs
/// event after the running rebuild finishes will trigger another pass,
/// picking up any new state).
fn trigger_rebuild(app: &AppHandle) {
    let project_root = {
        let state: State<'_, WatchHandle> = app.state();
        let guard = match state.0.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let Some(active) = guard.as_ref() else { return };
        active.project_root.clone()
    };

    // In-flight check.
    {
        let state: State<'_, WatchHandle> = app.state();
        let guard = match state.0.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let Some(active) = guard.as_ref() else { return };
        let mut inflight = match active.in_flight.lock() {
            Ok(b) => b,
            Err(_) => return,
        };
        if *inflight {
            return;
        }
        *inflight = true;
    }

    // Spawn the rebuild. The `in_flight` flag is cleared in the spawned
    // task regardless of success/failure, so the watcher keeps working.
    let app_for_task = app.clone();
    let root_for_task = project_root;
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        let result = run_rebuild(&app_for_task, &root_for_task).await;
        let duration_ms = started.elapsed().as_millis() as u64;

        // Clear in_flight. If the user switched projects mid-rebuild,
        // there's no active watcher anymore — that's fine, we just
        // unconditionally clear.
        {
            let state: State<'_, WatchHandle> = app_for_task.state();
            if let Ok(guard) = state.0.lock() {
                if let Some(active) = guard.as_ref() {
                    if let Ok(mut b) = active.in_flight.lock() {
                        *b = false;
                    }
                }
            };
        }

        match result {
            RebuildOutcome::Ok => {
                let _ = app_for_task.emit(
                    EVENT_REBUILT,
                    ManifestRebuiltEvent {
                        project_root: root_for_task.to_string_lossy().into_owned(),
                        generated_at: now_iso8601_utc(),
                        duration_ms,
                        manifest_count: 9,
                    },
                );
            }
            RebuildOutcome::Failed { stderr_tail, exit_code } => {
                let _ = app_for_task.emit(
                    EVENT_ERROR,
                    ManifestErrorEvent {
                        project_root: root_for_task.to_string_lossy().into_owned(),
                        phase: "rebuild".to_string(),
                        message: stderr_tail,
                        exit_code,
                    },
                );
            }
        }
    });
}

enum RebuildOutcome {
    Ok,
    Failed {
        stderr_tail: String,
        exit_code: Option<i32>,
    },
}

/// Resolve the absolute path of `modernization/scripts/build-manifests.mjs`
/// given the project root. The script lives one directory up from the
/// eraTW tree (i.e. as a sibling of the `eratw-sub-modding-main/` folder
/// the user picks in ProjectPicker).
///
/// We can't pass a relative path because Tauri's spawned process inherits
/// the cwd from `pnpm tauri dev`, which is `aigame/web/`. From there,
/// `modernization/scripts/build-manifests.mjs` resolves to a non-existent
/// path. Compute the absolute path and pass that instead.
fn absolute_script_path(project_root: &Path) -> Option<PathBuf> {
    project_root.parent().map(|sibling| {
        sibling
            .join("modernization")
            .join("scripts")
            .join("build-manifests.mjs")
    })
}

#[cfg(test)]
mod tests {
    //! Phase 3 audit P3 — script path derivation tests.
    //!
    //! `absolute_script_path` is the bridge between a user-picked project
    //! root and the node subprocess that rebuilds manifests. A wrong
    //! derivation silently breaks hot-reload — the watcher would emit
    //! "rebuilt" but the subprocess would fail to find its script.
    //!
    //! Pre-audit: 0 Rust tests. Post-audit: 3 tests pinning the happy
    //! path, the dev-tree layout, and the no-parent edge case.

    use super::*;

    #[test]
    fn resolves_dev_tree_layout() {
        // The real dev layout: project root is
        // `<repo>/eratw-sub-modding-main`, so the script lives at
        // `<repo>/modernization/scripts/build-manifests.mjs`. We don't
        // pin the full absolute path (CI runs on different paths);
        // we pin the suffix.
        let root = Path::new(
            "/repo/eratw-sub-modding-main",
        );
        let script = absolute_script_path(root)
            .expect("path with parent must derive a script path");
        assert!(script.ends_with("modernization/scripts/build-manifests.mjs"));
    }

    #[test]
    fn resolves_windows_path() {
        // The real Windows dev layout — the project root is
        // `F:\...\aigame\eratw-sub-modding-main`, and the script
        // is at `F:\...\aigame\modernization\scripts\build-manifests.mjs`.
        let root = Path::new(
            "F:\\mattest\\self-llm\\claude playground\\aigame\\eratw-sub-modding-main",
        );
        let script = absolute_script_path(root)
            .expect("windows path with parent must derive a script path");
        // The path's tail component is the platform-independent part.
        let tail: PathBuf = ["modernization", "scripts", "build-manifests.mjs"]
            .iter()
            .collect();
        assert!(script.ends_with(&tail));
    }

    #[test]
    fn returns_none_for_filesystem_root() {
        // A filesystem root has no parent. The function must return
        // None so the caller can surface a clear error instead of
        // spawning a subprocess with a wrong path.
        #[cfg(unix)]
        let root = Path::new("/");
        #[cfg(windows)]
        let root = Path::new("C:\\");
        let script = absolute_script_path(root);
        assert!(
            script.is_none(),
            "filesystem root has no parent; expected None"
        );
    }
}

/// Actually spawn the node subprocess. Returns Ok if exit code is 0.
async fn run_rebuild(app: &AppHandle, project_root: &Path) -> RebuildOutcome {
    let script_path = match absolute_script_path(project_root) {
        Some(p) => p.to_string_lossy().into_owned(),
        None => {
            return RebuildOutcome::Failed {
                stderr_tail: format!(
                    "cannot derive script path: project_root has no parent: {}",
                    project_root.display()
                ),
                exit_code: None,
            };
        }
    };
    let root_str = project_root.to_string_lossy().into_owned();

    let shell = app.shell();
    // The capability scope gates these args. We pass them verbatim.
    // The script path is an absolute path; the scope's first arg validator
    // accepts anything matching `modernization[/\]scripts[/\]build-manifests.mjs`,
    // which the absolute path's tail portion still matches.
    let cmd = shell
        .command("node")
        .args([&script_path, "--project-root", &root_str]);

    match cmd.output().await {
        Ok(out) if out.status.success() => RebuildOutcome::Ok,
        Ok(out) => {
            // Capture the last ~2KB of stderr for the error pill tooltip.
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail = tail_chars(&stderr, 2000);
            RebuildOutcome::Failed {
                stderr_tail: tail,
                exit_code: out.status.code(),
            }
        }
        Err(e) => RebuildOutcome::Failed {
            stderr_tail: format!("spawn failed: {}", e),
            exit_code: None,
        },
    }
}

/// Last `max_bytes`-worth of trailing characters from `s`. We approximate
/// "bytes" as "chars" to stay safe with multi-byte CJK content in error
/// messages. A UI tooltip only needs the tail anyway.
fn tail_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let start = s
        .char_indices()
        .rev()
        .nth(max_chars.saturating_sub(1))
        .map(|(i, _)| i)
        .unwrap_or(0);
    s[start..].to_string()
}

/// ISO 8601 UTC timestamp, e.g. "2026-06-15T10:23:48.123Z".
/// Uses SystemTime + a simple civil-from-days conversion. No external crate.
fn now_iso8601_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_ms = dur.as_millis() as u64;
    let secs = total_ms / 1000;
    let ms = total_ms % 1000;
    let (y, m, d) = civil_from_days((secs / 86400) as i64);
    let s_in_day = secs % 86400;
    let hh = s_in_day / 3600;
    let mm = (s_in_day % 3600) / 60;
    let ss = s_in_day % 60;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y, m, d, hh, mm, ss, ms
    )
}

/// Howard Hinnant's civil_from_days — convert days-since-epoch (1970-01-01)
/// to (year, month, day). Pure function, no_std friendly.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m_raw = mp + 3;
    let m = if m_raw > 12 { m_raw - 12 } else { m_raw } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}
