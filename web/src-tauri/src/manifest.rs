//! Manifest reader — Phase 2.1 + 2.2 + 2.3 + 2.3-kojo.
//!
//! Reads pre-generated JSON manifests from disk and returns them as
//! `serde_json::Value`. The build pipeline (modernization/scripts/build-manifests.ts)
//! writes nine files:
//!   - variable-sizes.json   (Phase 2.1)
//!   - characters.json       (Phase 2.1)
//!   - flags.json            (Phase 2.1)
//!   - resources.json        (Phase 2.2)
//!   - plugin-dicts.json     (Phase 2.2)
//!   - functions.json        (Phase 2.3)
//!   - commands.json         (Phase 2.3)
//!   - kojos.json            (Phase 2.3-kojo)
//!   - event-messages.json   (Phase 2.3-kojo)
//!
//! Layout convention: manifest dir is `<projectRoot>/../modernization/out/`.
//! projectRoot is the eraTW project (e.g. `aigame/eratw-sub-modding-main/`),
//! so manifest dir is `aigame/modernization/out/`. This is a fixed layout;
//! if it ever changes, update both this function and the build script.
//!
//! Phase 2.3 and 2.3-kojo do **not** add any new IPC command.
//! `validate_name` already allows `[A-Za-z0-9_-]`, so the new names
//! (`functions`, `commands`, `kojos`, `event-messages`) flow through
//! `get_manifest` without changes to the validation logic.
//!
//! Importer logic itself lives in TypeScript under `modernization/importer/`.
//! Rust only reads.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Information about the resolved manifest dir, returned alongside the data
/// so the UI can show provenance (and so errors are debuggable).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEnvelope {
    pub name: String,
    pub path: String,
    pub data: serde_json::Value,
}

/// Hard validation: manifest name must be a safe slug. No slashes, no dots,
/// no `..`. This blocks path-traversal even if the JS side is somehow
/// compromised or buggy.
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err(format!("invalid manifest name length: {:?}", name));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!(
            "invalid manifest name {:?}: only [A-Za-z0-9_-] allowed",
            name
        ));
    }
    Ok(())
}

fn resolve_manifest_dir(project_root: &str) -> Result<PathBuf, String> {
    let pr = Path::new(project_root);
    let parent = pr
        .parent()
        .ok_or_else(|| format!("project root has no parent: {}", project_root))?;
    Ok(parent.join("modernization").join("out"))
}

#[tauri::command]
pub fn get_manifest(project_root: String, name: String) -> Result<ManifestEnvelope, String> {
    validate_name(&name)?;
    let dir = resolve_manifest_dir(&project_root)?;
    let path = dir.join(format!("{}.json", name));

    let text = std::fs::read_to_string(&path).map_err(|e| {
        format!(
            "read {}: {} (run `pnpm build-manifests` first?)",
            path.display(),
            e
        )
    })?;

    let data: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse {}: {}", path.display(), e))?;

    Ok(ManifestEnvelope {
        name,
        path: path.to_string_lossy().into_owned(),
        data,
    })
}

#[cfg(test)]
mod tests {
    //! Phase 3 audit P3 — path-traversal guard tests for `validate_name`.
    //!
    //! `validate_name` is the only line of defense if the JS side ever
    //! passes a malicious or buggy name to `get_manifest`. These tests
    //! pin the rejection of every class of "looks plausible but is
    //! unsafe" input: empty, slash, dot, `..`, overlong, non-ASCII.
    //!
    //! Pre-audit: 0 Rust tests. Post-audit: 6 tests.

    use super::*;

    #[test]
    fn accepts_every_canonical_manifest_name() {
        // The 9 frozen manifest names — must all pass.
        for name in [
            "variable-sizes",
            "characters",
            "flags",
            "resources",
            "plugin-dicts",
            "functions",
            "commands",
            "kojos",
            "event-messages",
        ] {
            assert!(validate_name(name).is_ok(), "expected ok for {:?}", name);
        }
    }

    #[test]
    fn rejects_empty_name() {
        assert!(validate_name("").is_err());
    }

    #[test]
    fn rejects_name_with_slash() {
        assert!(validate_name("foo/bar").is_err());
        assert!(validate_name("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_name_with_dot() {
        // A bare dot would resolve to "current dir"; reject.
        assert!(validate_name(".").is_err());
        assert!(validate_name("foo.bar").is_err());
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        // `..` would resolve to parent dir; reject even though our
        // char-class check already filters the dot, the explicit test
        // pins the intent.
        assert!(validate_name("..").is_err());
        assert!(validate_name("../foo").is_err());
        assert!(validate_name("foo/../bar").is_err());
    }

    #[test]
    fn rejects_overlong_name() {
        // 65 chars > 64-char cap.
        let name = "a".repeat(65);
        assert!(validate_name(&name).is_err());
        // Exactly 64 must still pass.
        let name = "a".repeat(64);
        assert!(validate_name(&name).is_ok());
    }

    #[test]
    fn rejects_non_ascii_or_punctuation() {
        // CJK / kana — modernized core is ASCII-only at the manifest
        // name layer; a non-ASCII name would be a contract violation.
        assert!(validate_name("命令").is_err());
        assert!(validate_name("変数").is_err());
        // Spaces, semicolons, quotes — all must be rejected.
        assert!(validate_name("foo bar").is_err());
        assert!(validate_name("foo;rm").is_err());
        assert!(validate_name("foo'bar").is_err());
    }
}