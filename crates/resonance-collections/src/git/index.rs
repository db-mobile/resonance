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
const SIZE_OFFSET: usize = 36;
const EXTENDED_FLAG: u16 = 0x4000;
const STAGE_SHIFT: u16 = 12;
const STAGE_MASK: u16 = 0x3;

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
}

/// Parses the entry list of an index file.
///
/// @param bytes - Raw contents of `.git/index`
/// @returns The entries in index order, or None for a version 4, foreign, or truncated file
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
        entries.push(entry);
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
/// @returns The entry and its padded length, or None when the file ends first
fn parse_entry(bytes: &[u8], start: usize, version: u32) -> Option<(IndexEntry, usize)> {
    let size = be_u32(bytes, start + SIZE_OFFSET)?;
    let oid: [u8; OID_LEN] = bytes
        .get(start + STAT_LEN..start + FLAGS_OFFSET)?
        .try_into()
        .ok()?;
    let flags = be_u16(bytes, start + FLAGS_OFFSET)?;
    let fixed = if version == 3 && flags & EXTENDED_FLAG != 0 {
        EXTENDED_FIXED_LEN
    } else {
        FIXED_LEN
    };

    let name_start = start + fixed;
    let name_len = bytes.get(name_start..)?.iter().position(|b| *b == 0)?;
    let path = std::str::from_utf8(&bytes[name_start..name_start + name_len])
        .ok()?
        .to_string();
    let padded_len = (fixed + name_len + 8) & !7;
    bytes.get(start..start + padded_len)?;

    let entry = IndexEntry {
        path,
        oid,
        size,
        stage: ((flags >> STAGE_SHIFT) & STAGE_MASK) as u8,
    };
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

    /// One entry to encode: path, blob id, recorded size, and raw flags.
    pub(crate) struct Spec<'a> {
        pub path: &'a str,
        pub oid: [u8; OID_LEN],
        pub size: u32,
        pub flags: u16,
    }

    pub(crate) fn plain<'a>(path: &'a str, oid: [u8; OID_LEN], size: u32) -> Spec<'a> {
        Spec {
            path,
            oid,
            size,
            flags: path.len().min(0xFFF) as u16,
        }
    }

    pub(crate) fn index(version: u32, specs: &[Spec<'_>]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&version.to_be_bytes());
        out.extend_from_slice(&(specs.len() as u32).to_be_bytes());
        for spec in specs {
            let start = out.len();
            out.extend_from_slice(&[0u8; SIZE_OFFSET]);
            out.extend_from_slice(&spec.size.to_be_bytes());
            out.extend_from_slice(&spec.oid);
            out.extend_from_slice(&spec.flags.to_be_bytes());
            if version == 3 && spec.flags & EXTENDED_FLAG != 0 {
                out.extend_from_slice(&0u16.to_be_bytes());
            }
            out.extend_from_slice(spec.path.as_bytes());
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
    use super::encode::{Spec, index, plain};
    use super::*;
    use tempfile::TempDir;

    fn oid(seed: u8) -> [u8; OID_LEN] {
        [seed; OID_LEN]
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
                IndexEntry {
                    path: "a.yaml".into(),
                    oid: oid(1),
                    size: 10,
                    stage: 0
                },
                IndexEntry {
                    path: "dir/b.yaml".into(),
                    oid: oid(2),
                    size: 20,
                    stage: 0
                },
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
                Spec {
                    path: "skip.yaml",
                    oid: oid(3),
                    size: 5,
                    flags: EXTENDED_FLAG | 9,
                },
                plain("after.yaml", oid(4), 6),
            ],
        );

        let entries = parse_index(&bytes).unwrap();

        assert_eq!(entries[0].path, "skip.yaml");
        assert_eq!(entries[1].path, "after.yaml");
        assert_eq!(entries[1].size, 6);
    }

    #[test]
    fn reads_the_stage_from_the_flags() {
        let bytes = index(
            2,
            &[Spec {
                path: "conflict.yaml",
                oid: oid(5),
                size: 5,
                flags: (2 << STAGE_SHIFT) | 13,
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
