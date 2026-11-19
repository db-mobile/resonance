//! Reader for `.git/index`, the list of paths Git considers tracked.
//!
//! Only the entry list is read: the header, then one record per path with
//! its cached stat data, blob id, and flags. Extensions and the trailing
//! checksum are skipped. Versions 2 and 3 are understood; version 4 compresses
//! paths against their predecessor and is declined, so a repository using
//! `feature.manyFiles` simply gets no markers.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

const MAGIC: &[u8; 4] = b"DIRC";
const HEADER_LEN: usize = 12;
const STAT_LEN: usize = 40;
const OID_LEN: usize = 20;
const FLAGS_OFFSET: usize = STAT_LEN + OID_LEN;
const FIXED_LEN: usize = FLAGS_OFFSET + 2;
const EXTENDED_FIXED_LEN: usize = FIXED_LEN + 2;
const MODE_OFFSET: usize = 24;
const SIZE_OFFSET: usize = 36;
const ASSUME_VALID_FLAG: u16 = 0x8000;
const EXTENDED_FLAG: u16 = 0x4000;
const STAGE_SHIFT: u16 = 12;
const STAGE_MASK: u16 = 0x3;
const SKIP_WORKTREE_EXTENDED_FLAG: u16 = 0x4000;
const INTENT_TO_ADD_EXTENDED_FLAG: u16 = 0x2000;
const MODE_TYPE_MASK: u32 = 0o170000;
const MODE_SYMLINK: u32 = 0o120000;
const MODE_GITLINK: u32 = 0o160000;

/// One tracked path as the index records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexEntry {
    /// Path relative to the working tree root, forward slashes.
    pub path: String,
    /// Object id of the blob the index holds for this path.
    pub oid: [u8; OID_LEN],
    /// File size the index recorded, in bytes.
    pub size: u32,
    /// Merge stage; anything above zero is an unresolved conflict.
    pub stage: u8,
    /// File mode the index recorded, type bits included.
    pub mode: u32,
    /// Set by `git update-index --assume-unchanged`; Git does not compare the file.
    pub assume_valid: bool,
    /// Set by sparse checkout or `--skip-worktree`; the file may be absent on purpose.
    pub skip_worktree: bool,
    /// Set by `git add -N`; the path is tracked but has no content staged yet.
    pub intent_to_add: bool,
}

impl IndexEntry {
    /// @returns Whether the index records a symbolic link
    pub fn is_symlink(&self) -> bool {
        self.mode & MODE_TYPE_MASK == MODE_SYMLINK
    }

    /// @returns Whether the index records a submodule commit rather than a file
    pub fn is_gitlink(&self) -> bool {
        self.mode & MODE_TYPE_MASK == MODE_GITLINK
    }
}

/// Parses the entry list of an index file.
///
/// @param bytes - Raw contents of `.git/index`
/// @returns The entries in index order, without those whose path is not UTF-8, or None for a version 4, foreign, or truncated file
pub fn parse_index(bytes: &[u8]) -> Option<Vec<IndexEntry>> {
    if bytes.get(..MAGIC.len())? != MAGIC {
        return None;
    }
    let version = be_u32(bytes, 4)?;
    if version != 2 && version != 3 {
        return None;
    }
    let count = be_u32(bytes, 8)? as usize;

    let mut entries = Vec::with_capacity(count.min(bytes.len() / FIXED_LEN));
    let mut offset = HEADER_LEN;
    for _ in 0..count {
        let (entry, len) = parse_entry(bytes, offset, version)?;
        entries.extend(entry);
        offset += len;
    }

    Some(entries)
}

/// Reads and parses the index of a Git directory.
///
/// @param git_dir - The Git directory holding the index
/// @returns The entries; an absent index is an empty list, an unreadable or corrupt one is None
pub fn read_index(git_dir: &Path) -> Option<Vec<IndexEntry>> {
    match fs::read(git_dir.join("index")) {
        Ok(bytes) => parse_index(&bytes),
        Err(error) if error.kind() == ErrorKind::NotFound => Some(Vec::new()),
        Err(_) => None,
    }
}

/// Parses one entry starting at `start`.
///
/// @param bytes - The whole index file
/// @param start - Offset of the entry
/// @param version - Index format version
/// @returns The entry (None when its path is not UTF-8) and its padded length, or None when the file ends first
fn parse_entry(bytes: &[u8], start: usize, version: u32) -> Option<(Option<IndexEntry>, usize)> {
    let mode = be_u32(bytes, start + MODE_OFFSET)?;
    let size = be_u32(bytes, start + SIZE_OFFSET)?;
    let oid: [u8; OID_LEN] = bytes
        .get(start + STAT_LEN..start + FLAGS_OFFSET)?
        .try_into()
        .ok()?;
    let flags = be_u16(bytes, start + FLAGS_OFFSET)?;
    let (fixed, extended) = if version == 3 && flags & EXTENDED_FLAG != 0 {
        (EXTENDED_FIXED_LEN, be_u16(bytes, start + FIXED_LEN)?)
    } else {
        (FIXED_LEN, 0)
    };

    let name_start = start + fixed;
    let name_len = bytes.get(name_start..)?.iter().position(|b| *b == 0)?;
    let padded_len = (fixed + name_len + 8) & !7;
    bytes.get(start..start + padded_len)?;

    let entry = std::str::from_utf8(&bytes[name_start..name_start + name_len])
        .ok()
        .map(|path| IndexEntry {
            path: path.to_string(),
            oid,
            size,
            stage: ((flags >> STAGE_SHIFT) & STAGE_MASK) as u8,
            mode,
            assume_valid: flags & ASSUME_VALID_FLAG != 0,
            skip_worktree: extended & SKIP_WORKTREE_EXTENDED_FLAG != 0,
            intent_to_add: extended & INTENT_TO_ADD_EXTENDED_FLAG != 0,
        });
    Some((entry, padded_len))
}

/// Reads a big-endian u32.
///
/// @param bytes - Source buffer
/// @param at - Offset of the first byte
/// @returns The value, or None when the buffer ends first
fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let raw: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
    Some(u32::from_be_bytes(raw))
}

/// Reads a big-endian u16.
///
/// @param bytes - Source buffer
/// @param at - Offset of the first byte
/// @returns The value, or None when the buffer ends first
fn be_u16(bytes: &[u8], at: usize) -> Option<u16> {
    let raw: [u8; 2] = bytes.get(at..at + 2)?.try_into().ok()?;
    Some(u16::from_be_bytes(raw))
}

#[cfg(test)]
pub(crate) mod encode {
    use super::*;

    pub(crate) const MODE_FILE: u32 = 0o100644;
    pub(crate) const MODE_SYMLINK: u32 = super::MODE_SYMLINK;
    pub(crate) const MODE_GITLINK: u32 = super::MODE_GITLINK;
    pub(crate) const ASSUME_VALID: u16 = ASSUME_VALID_FLAG;
    pub(crate) const SKIP_WORKTREE: u16 = SKIP_WORKTREE_EXTENDED_FLAG;
    pub(crate) const INTENT_TO_ADD: u16 = INTENT_TO_ADD_EXTENDED_FLAG;

    /// One entry to encode: raw path bytes, blob id, recorded size, mode, and
    /// both flag words. A non-zero `extended` word needs a version 3 index.
    pub(crate) struct Spec<'a> {
        pub path: &'a [u8],
        pub oid: [u8; OID_LEN],
        pub size: u32,
        pub flags: u16,
        pub mode: u32,
        pub extended: u16,
    }

    impl Spec<'_> {
        pub(crate) fn with_mode(mut self, mode: u32) -> Self {
            self.mode = mode;
            self
        }

        pub(crate) fn with_extended(mut self, extended: u16) -> Self {
            self.flags |= EXTENDED_FLAG;
            self.extended = extended;
            self
        }
    }

    pub(crate) fn plain<'a>(path: &'a str, oid: [u8; OID_LEN], size: u32) -> Spec<'a> {
        raw(path.as_bytes(), oid, size)
    }

    pub(crate) fn raw<'a>(path: &'a [u8], oid: [u8; OID_LEN], size: u32) -> Spec<'a> {
        Spec {
            path,
            oid,
            size,
            flags: path.len().min(0xFFF) as u16,
            mode: MODE_FILE,
            extended: 0,
        }
    }

    pub(crate) fn index(version: u32, specs: &[Spec<'_>]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&version.to_be_bytes());
        out.extend_from_slice(&(specs.len() as u32).to_be_bytes());
        for spec in specs {
            let start = out.len();
            out.extend_from_slice(&[0u8; MODE_OFFSET]);
            out.extend_from_slice(&spec.mode.to_be_bytes());
            out.extend_from_slice(&[0u8; SIZE_OFFSET - MODE_OFFSET - 4]);
            out.extend_from_slice(&spec.size.to_be_bytes());
            out.extend_from_slice(&spec.oid);
            out.extend_from_slice(&spec.flags.to_be_bytes());
            if version == 3 && spec.flags & EXTENDED_FLAG != 0 {
                out.extend_from_slice(&spec.extended.to_be_bytes());
            }
            out.extend_from_slice(spec.path);
            out.push(0);
            while (out.len() - start) % 8 != 0 {
                out.push(0);
            }
        }
        out.extend_from_slice(&[0u8; OID_LEN]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::encode::{self, Spec, index, plain, raw};
    use super::*;
    use tempfile::TempDir;

    fn oid(seed: u8) -> [u8; OID_LEN] {
        [seed; OID_LEN]
    }

    fn file_entry(path: &str, oid: [u8; OID_LEN], size: u32) -> IndexEntry {
        IndexEntry {
            path: path.into(),
            oid,
            size,
            stage: 0,
            mode: encode::MODE_FILE,
            assume_valid: false,
            skip_worktree: false,
            intent_to_add: false,
        }
    }

    #[test]
    fn parses_a_v2_index() {
        let bytes = index(
            2,
            &[plain("a.yaml", oid(1), 10), plain("dir/b.yaml", oid(2), 20)],
        );

        let entries = parse_index(&bytes).unwrap();

        assert_eq!(
            entries,
            vec![
                file_entry("a.yaml", oid(1), 10),
                file_entry("dir/b.yaml", oid(2), 20),
            ]
        );
    }

    #[test]
    fn pads_each_entry_to_eight_bytes() {
        let names = ["a", "abcdef", "abcdefg", "abcdefgh", "abcdefghi"];
        let specs: Vec<Spec<'_>> = names.iter().map(|n| plain(n, oid(1), 1)).collect();
        let bytes = index(2, &specs);

        let entries = parse_index(&bytes).unwrap();

        let paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        assert_eq!(paths, names);
    }

    #[test]
    fn parses_a_v3_entry_with_extended_flags() {
        let bytes = index(
            3,
            &[
                plain("skip.yaml", oid(3), 5).with_extended(encode::SKIP_WORKTREE),
                plain("later.yaml", oid(4), 0).with_extended(encode::INTENT_TO_ADD),
                plain("after.yaml", oid(5), 6),
            ],
        );

        let entries = parse_index(&bytes).unwrap();

        assert_eq!(entries[0].path, "skip.yaml");
        assert!(entries[0].skip_worktree && !entries[0].intent_to_add);
        assert_eq!(entries[1].path, "later.yaml");
        assert!(entries[1].intent_to_add && !entries[1].skip_worktree);
        assert_eq!(entries[2], file_entry("after.yaml", oid(5), 6));
    }

    #[test]
    fn the_extended_bit_of_a_v2_entry_is_not_a_second_word() {
        let mut spec = plain("a.yaml", oid(1), 1);
        spec.flags |= EXTENDED_FLAG;
        let bytes = index(2, &[spec, plain("b.yaml", oid(2), 2)]);

        let entries = parse_index(&bytes).unwrap();

        assert!(!entries[0].skip_worktree);
        assert_eq!(entries[1], file_entry("b.yaml", oid(2), 2));
    }

    #[test]
    fn reads_the_mode_and_the_assume_valid_bit() {
        let mut assumed = plain("assumed.yaml", oid(1), 1);
        assumed.flags |= encode::ASSUME_VALID;
        let bytes = index(
            2,
            &[
                assumed,
                plain("link.yaml", oid(2), 8).with_mode(encode::MODE_SYMLINK),
                plain("vendor", oid(3), 0).with_mode(encode::MODE_GITLINK),
                plain("plain.yaml", oid(4), 4),
            ],
        );

        let entries = parse_index(&bytes).unwrap();

        assert!(entries[0].assume_valid);
        assert_eq!(entries[0].stage, 0);
        assert!(entries[1].is_symlink() && !entries[1].is_gitlink());
        assert!(entries[2].is_gitlink() && !entries[2].is_symlink());
        assert!(!entries[3].is_symlink() && !entries[3].is_gitlink() && !entries[3].assume_valid);
    }

    #[test]
    fn an_entry_with_a_non_utf8_path_is_skipped() {
        let bytes = index(
            2,
            &[
                plain("a.yaml", oid(1), 1),
                raw(b"caf\xe9.yaml", oid(2), 2),
                plain("z.yaml", oid(3), 3),
            ],
        );

        let entries = parse_index(&bytes).unwrap();

        assert_eq!(
            entries,
            vec![
                file_entry("a.yaml", oid(1), 1),
                file_entry("z.yaml", oid(3), 3)
            ]
        );
    }

    #[test]
    fn reads_the_stage_from_the_flags() {
        let bytes = index(
            2,
            &[Spec {
                flags: (2 << STAGE_SHIFT) | 13,
                ..plain("conflict.yaml", oid(5), 5)
            }],
        );

        let entries = parse_index(&bytes).unwrap();

        assert_eq!(entries[0].stage, 2);
    }

    #[test]
    fn rejects_version_4() {
        let bytes = index(4, &[plain("a.yaml", oid(1), 1)]);

        assert_eq!(parse_index(&bytes), None);
    }

    #[test]
    fn rejects_a_bad_magic() {
        let mut bytes = index(2, &[plain("a.yaml", oid(1), 1)]);
        bytes[0] = b'X';

        assert_eq!(parse_index(&bytes), None);
    }

    #[test]
    fn rejects_a_truncated_entry() {
        let bytes = index(2, &[plain("a.yaml", oid(1), 1)]);
        let cut = &bytes[..HEADER_LEN + FIXED_LEN + 2];

        assert_eq!(parse_index(cut), None);
    }

    #[test]
    fn rejects_a_count_beyond_the_file() {
        let mut bytes = index(2, &[plain("a.yaml", oid(1), 1)]);
        bytes[8..12].copy_from_slice(&7u32.to_be_bytes());

        assert_eq!(parse_index(&bytes), None);
    }

    #[test]
    fn an_empty_entry_list_parses() {
        let bytes = index(2, &[]);

        assert_eq!(parse_index(&bytes), Some(Vec::new()));
    }

    #[test]
    fn a_missing_index_is_empty() {
        let temp = TempDir::new().unwrap();

        assert_eq!(read_index(temp.path()), Some(Vec::new()));
    }

    #[test]
    fn an_unreadable_index_is_none() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join("index"), b"garbage").unwrap();

        assert_eq!(read_index(temp.path()), None);
    }

    #[test]
    fn reads_an_index_from_disk() {
        let temp = TempDir::new().unwrap();
        fs::write(
            temp.path().join("index"),
            index(2, &[plain("x.yaml", oid(9), 3)]),
        )
        .unwrap();

        let entries = read_index(temp.path()).unwrap();

        assert_eq!(entries[0].path, "x.yaml");
    }
}
