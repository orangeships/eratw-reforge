//! Resolve the player's lawful local Kojo source directory.

use serde::Serialize;
use std::path::{Path, PathBuf};

const KOJO_DIR_NAME: &str = "口上・メッセージ関連";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KojoSourceValidation {
    pub path: String,
    pub kojo_root: Option<String>,
    pub layout: Option<String>,
    pub is_valid: bool,
    pub error: Option<String>,
}

/// Accept an eraTW project root, its ERB directory, or the exact
/// `口上・メッセージ関連` directory selected by the player.
pub fn resolve_kojo_source_root(path: &Path) -> Result<(PathBuf, &'static str), String> {
    if !path.is_dir() {
        return Err(format!("所选路径不是目录：{}", path.display()));
    }

    if path.file_name().and_then(|name| name.to_str()) == Some(KOJO_DIR_NAME) {
        return Ok((path.to_path_buf(), "kojo-directory"));
    }

    let under_erb = path.join(KOJO_DIR_NAME);
    if under_erb.is_dir() {
        return Ok((under_erb, "erb-directory"));
    }

    let under_project = path.join("ERB").join(KOJO_DIR_NAME);
    if under_project.is_dir() {
        return Ok((under_project, "project-root"));
    }

    Err(format!(
        "没有找到 ERB/{}；请选择原版项目根目录、ERB 目录或口上目录本身",
        KOJO_DIR_NAME
    ))
}

#[tauri::command]
pub fn validate_kojo_source_path(path: String) -> KojoSourceValidation {
    match resolve_kojo_source_root(Path::new(&path)) {
        Ok((root, layout)) => KojoSourceValidation {
            path,
            kojo_root: Some(root.to_string_lossy().into_owned()),
            layout: Some(layout.to_string()),
            is_valid: true,
            error: None,
        },
        Err(error) => KojoSourceValidation {
            path,
            kojo_root: None,
            layout: None,
            is_valid: false,
            error: Some(error),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Build a unique tmp dir per test invocation. Tmpdir collisions
    /// across parallel `cargo test` runs are avoided by mixing pid +
    /// nanos. The dir is NOT auto-cleaned (CI runs in a fresh container
    /// anyway); cleanup is best-effort via `fs::remove_dir_all` at the
    /// end of each test.
    fn unique_tmpdir(label: &str) -> PathBuf {
        let pid = std::process::id();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("eratw-rust-test-{}-{}-{}", label, pid, ts));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn best_effort_cleanup(p: &Path) {
        let _ = fs::remove_dir_all(p);
    }

    #[test]
    fn kojo_source_accepts_project_erb_and_direct_directory() {
        let root = unique_tmpdir("kojo-source");
        let erb = root.join("ERB");
        let kojo = erb.join(KOJO_DIR_NAME);
        fs::create_dir_all(&kojo).unwrap();

        let project = resolve_kojo_source_root(&root).unwrap();
        let erb_selected = resolve_kojo_source_root(&erb).unwrap();
        let direct = resolve_kojo_source_root(&kojo).unwrap();

        assert_eq!(project.0, kojo);
        assert_eq!(project.1, "project-root");
        assert_eq!(erb_selected.0, direct.0);
        assert_eq!(erb_selected.1, "erb-directory");
        assert_eq!(direct.1, "kojo-directory");
        best_effort_cleanup(&root);
    }

    #[test]
    fn kojo_source_rejects_unrelated_directory() {
        let root = unique_tmpdir("not-kojo-source");
        let validation = validate_kojo_source_path(root.to_string_lossy().into_owned());
        best_effort_cleanup(&root);
        assert!(!validation.is_valid);
        assert!(validation.kojo_root.is_none());
        assert!(validation.error.is_some());
    }
}
