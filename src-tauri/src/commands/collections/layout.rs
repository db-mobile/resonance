//! Naming rules for the files and directories a collection occupies.

use std::fs;
use std::path::{Path, PathBuf};

/// File names reserved inside a collection directory. A request whose name
/// slugifies to one of these gets a numeric suffix instead.
pub(crate) const COLLECTION_YAML: &str = "collection.yaml";
pub(crate) const VARIABLES_YAML: &str = "variables.yaml";
pub(crate) const OPENAPI_YAML: &str = "openapi.yaml";
pub(crate) const FOLDER_YAML: &str = "_folder.yaml";

/// The v1 marker, kept so a directory written by an older build is still
/// recognised and can be converted.
pub(crate) const COLLECTION_JSON: &str = "collection.json";

const RESERVED_STEMS: &[&str] = &["collection", "variables", "openapi"];

/// Longest file stem we derive from a request name, so a long name cannot
/// produce a path the filesystem rejects.
const MAX_STEM_LEN: usize = 60;

/// Reports whether a stem would collide with a file the layout owns.
///
/// `_folder` needs no check: slugify only ever emits `[a-z0-9-]`, so no
/// request stem can start with an underscore.
///
/// @param stem - Candidate file stem, without extension
/// @returns True when the stem is reserved
pub(crate) fn is_reserved_stem(stem: &str) -> bool {
    RESERVED_STEMS.contains(&stem)
}

/// Derives a request's file stem from its display name.
///
/// @param name - The request's display name
/// @returns A slug of at most MAX_STEM_LEN characters, never empty
pub(crate) fn request_stem(name: &str) -> String {
    let slug = slugify(name);
    let slug = if slug == "collection" && !name.to_ascii_lowercase().contains("collection") {
        "request".to_string()
    } else {
        slug
    };

    if slug.len() <= MAX_STEM_LEN {
        slug
    } else {
        slug[..MAX_STEM_LEN].trim_end_matches('-').to_string()
    }
}

/// Picks a free path for a file, suffixing `-2`, `-3`, ... past anything taken.
///
/// A path the caller already owns counts as free, so an idempotent save keeps
/// its existing name instead of churning to a new suffix on every write.
///
/// @param dir - Directory the file lives in
/// @param stem - Desired file stem
/// @param ext - File extension, without the dot
/// @param current - Path the caller already owns, if any
/// @returns A path that is free, or already the caller's
pub(crate) fn find_available_path(
    dir: &Path,
    stem: &str,
    ext: &str,
    current: Option<&Path>,
) -> PathBuf {
    let taken = |candidate: &Path| current != Some(candidate) && candidate.exists();

    let start = if is_reserved_stem(stem) {
        let candidate = dir.join(format!("{}-2.{}", stem, ext));
        if !taken(&candidate) {
            return candidate;
        }
        3
    } else {
        let candidate = dir.join(format!("{}.{}", stem, ext));
        if !taken(&candidate) {
            return candidate;
        }
        2
    };

    let mut counter = start;
    loop {
        let candidate = dir.join(format!("{}-{}.{}", stem, counter, ext));
        if !taken(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

pub(crate) fn slugify(input: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for c in input.chars() {
        let ch = c.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            last_was_dash = false;
        } else if !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "collection".to_string()
    } else {
        slug
    }
}

pub(crate) fn sanitize_file_component(input: &str) -> String {
    let mut out = String::new();
    for c in input.chars() {
        let ch = c.to_ascii_lowercase();
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }

    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "item".to_string()
    } else {
        out
    }
}

pub(crate) fn find_available_dir(
    parent: &Path,
    base_name: &str,
    current_dir: Option<&Path>,
) -> PathBuf {
    let mut candidate = parent.join(base_name);
    if current_dir == Some(candidate.as_path()) || !candidate.exists() {
        return candidate;
    }

    let mut counter = 2;
    loop {
        candidate = parent.join(format!("{}-{}", base_name, counter));
        if current_dir == Some(candidate.as_path()) || !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

pub(crate) fn desired_endpoint_file_name(endpoint_name: &str, endpoint_id: &str) -> String {
    format!(
        "{}--{}.json",
        slugify(endpoint_name),
        sanitize_file_component(endpoint_id)
    )
}

pub(crate) fn find_endpoint_data_file(
    requests_dir: &Path,
    endpoint_id: &str,
) -> Result<Option<PathBuf>, String> {
    let legacy_file = requests_dir.join(format!("{}.json", endpoint_id));
    if legacy_file.exists() {
        return Ok(Some(legacy_file));
    }

    if !requests_dir.exists() {
        return Ok(None);
    }

    let suffix = format!("--{}.json", sanitize_file_component(endpoint_id));
    let entries =
        fs::read_dir(requests_dir).map_err(|e| format!("Failed to read requests dir: {}", e))?;

    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();

        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
                if name.ends_with(&suffix) {
                    return Ok(Some(path));
                }
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn slug_lowercases_and_collapses_separators() {
        assert_eq!(slugify("My Pet Store"), "my-pet-store");
        assert_eq!(slugify("API   v2"), "api-v2");
        assert_eq!(slugify("a/b/c"), "a-b-c");
    }

    #[test]
    fn slug_trims_leading_and_trailing_separators() {
        assert_eq!(slugify("  spaced  "), "spaced");
        assert_eq!(slugify("///x///"), "x");
    }

    #[test]
    fn a_symbol_only_name_falls_back_to_a_default() {
        assert_eq!(slugify("///"), "collection");
        assert_eq!(slugify(""), "collection");
    }

    /// Non-ASCII is dropped rather than transliterated, so a wholly non-ASCII
    /// name collapses to the fallback. Documented so it is a known limitation
    /// rather than a surprise.
    #[test]
    fn non_ascii_characters_are_dropped() {
        assert_eq!(slugify("Ünïcödé"), "n-c-d");
        assert_eq!(slugify("日本語"), "collection");
    }

    #[test]
    fn sanitize_keeps_dashes_and_underscores() {
        assert_eq!(sanitize_file_component("custom_3"), "custom_3");
        assert_eq!(sanitize_file_component("req-abc"), "req-abc");
    }

    #[test]
    fn sanitize_falls_back_for_symbol_only_input() {
        assert_eq!(sanitize_file_component("///"), "item");
        assert_eq!(sanitize_file_component(""), "item");
    }

    /// Defect: distinct endpoint ids sanitize to the same file component, so
    /// find_endpoint_data_file's suffix scan can hand one endpoint another's
    /// data file. Pinned here as a characterization of today's behaviour; the
    /// v2 layout drops ids from filenames entirely, which removes the hazard.
    #[test]
    fn distinct_ids_can_collide_after_sanitizing() {
        let collided: Vec<String> = ["a.b", "a b", "a-b", "A-B"]
            .iter()
            .map(|id| sanitize_file_component(id))
            .collect();

        assert_eq!(collided, vec!["a-b", "a-b", "a-b", "a-b"]);
    }

    #[test]
    fn endpoint_file_name_joins_the_slug_and_the_id() {
        assert_eq!(
            desired_endpoint_file_name("List Users", "custom_3"),
            "list-users--custom_3.json"
        );
    }

    #[test]
    fn available_dir_returns_the_plain_name_when_free() {
        let temp = TempDir::new().unwrap();
        let chosen = find_available_dir(temp.path(), "petstore", None);
        assert_eq!(chosen, temp.path().join("petstore"));
    }

    #[test]
    fn available_dir_suffixes_past_an_occupied_name() {
        let temp = TempDir::new().unwrap();
        fs::create_dir(temp.path().join("petstore")).unwrap();
        fs::create_dir(temp.path().join("petstore-2")).unwrap();

        let chosen = find_available_dir(temp.path(), "petstore", None);
        assert_eq!(chosen, temp.path().join("petstore-3"));
    }

    /// A save that does not rename must keep the directory it already owns,
    /// rather than churning to a -2 suffix on every write.
    #[test]
    fn available_dir_keeps_the_directory_the_caller_already_owns() {
        let temp = TempDir::new().unwrap();
        let owned = temp.path().join("petstore");
        fs::create_dir(&owned).unwrap();

        let chosen = find_available_dir(temp.path(), "petstore", Some(owned.as_path()));
        assert_eq!(chosen, owned);
    }

    #[test]
    fn a_request_stem_is_truncated_to_a_sane_length() {
        let long = "a".repeat(200);
        assert!(request_stem(&long).len() <= 60);
    }

    #[test]
    fn a_symbol_only_request_name_falls_back_to_request() {
        assert_eq!(request_stem("///"), "request");
        assert_eq!(request_stem(""), "request");
    }

    #[test]
    fn a_request_actually_named_collection_keeps_that_stem() {
        assert_eq!(request_stem("Collection"), "collection");
    }

    #[test]
    fn reserved_stems_are_recognised() {
        assert!(is_reserved_stem("collection"));
        assert!(is_reserved_stem("variables"));
        assert!(is_reserved_stem("openapi"));
        assert!(!is_reserved_stem("pets"));
    }

    #[test]
    fn an_available_path_uses_the_plain_stem_when_free() {
        let temp = TempDir::new().unwrap();
        assert_eq!(
            find_available_path(temp.path(), "pets", "yaml", None),
            temp.path().join("pets.yaml")
        );
    }

    #[test]
    fn an_available_path_suffixes_past_a_taken_name() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("pets.yaml"), "").unwrap();
        assert_eq!(
            find_available_path(temp.path(), "pets", "yaml", None),
            temp.path().join("pets-2.yaml")
        );
    }

    #[test]
    fn an_available_path_keeps_the_file_the_caller_owns() {
        let temp = TempDir::new().unwrap();
        let owned = temp.path().join("pets.yaml");
        fs::write(&owned, "").unwrap();

        assert_eq!(
            find_available_path(temp.path(), "pets", "yaml", Some(&owned)),
            owned
        );
    }

    #[test]
    fn a_reserved_stem_never_claims_the_layout_file() {
        let temp = TempDir::new().unwrap();
        let chosen = find_available_path(temp.path(), "collection", "yaml", None);

        assert_eq!(chosen, temp.path().join("collection-2.yaml"));
        assert_ne!(chosen, temp.path().join("collection.yaml"));
    }

    #[test]
    fn finds_a_data_file_by_its_id_suffix() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("list-users--custom_3.json");
        fs::write(&file, "{}").unwrap();

        let found = find_endpoint_data_file(temp.path(), "custom_3").unwrap();
        assert_eq!(found, Some(file));
    }

    #[test]
    fn finds_a_legacy_data_file_named_only_by_id() {
        let temp = TempDir::new().unwrap();
        let file = temp.path().join("custom_3.json");
        fs::write(&file, "{}").unwrap();

        let found = find_endpoint_data_file(temp.path(), "custom_3").unwrap();
        assert_eq!(found, Some(file));
    }

    #[test]
    fn prefers_the_legacy_name_when_both_exist() {
        let temp = TempDir::new().unwrap();
        let legacy = temp.path().join("custom_3.json");
        fs::write(&legacy, "{}").unwrap();
        fs::write(temp.path().join("list-users--custom_3.json"), "{}").unwrap();

        let found = find_endpoint_data_file(temp.path(), "custom_3").unwrap();
        assert_eq!(found, Some(legacy));
    }

    #[test]
    fn reports_no_file_for_an_unknown_id() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("list-users--custom_3.json"), "{}").unwrap();

        assert_eq!(
            find_endpoint_data_file(temp.path(), "custom_9").unwrap(),
            None
        );
    }

    #[test]
    fn a_missing_requests_dir_is_not_an_error() {
        let temp = TempDir::new().unwrap();
        let absent = temp.path().join("requests");

        assert_eq!(find_endpoint_data_file(&absent, "custom_3").unwrap(), None);
    }

    /// Defect: the suffix match is unanchored on the left, so an id that is a
    /// tail of another id's filename can match the wrong file.
    #[test]
    fn suffix_matching_is_unanchored_on_the_left() {
        let temp = TempDir::new().unwrap();
        let other = temp.path().join("req--a--b.json");
        fs::write(&other, "{}").unwrap();

        let found = find_endpoint_data_file(temp.path(), "b").unwrap();
        assert_eq!(found, Some(other));
    }
}
