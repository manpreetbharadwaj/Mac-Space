use crate::dto::ScannedFileDto;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

const SAMPLE_BYTES: u64 = 64 * 1024;

/// Cheap duplicate-candidate fingerprint: file size plus a hash of the first
/// and last 64KB. This never reads a whole large file, only a few KB regardless
/// of size, while still catching genuinely-identical files with high confidence
/// (unlike a name-only heuristic). Confirmed duplicates would need a full hash;
/// this is presented to the user as a "candidate", matching the mock prototype's
/// existing duplicate-detection language.
fn fingerprint(path: &str, size: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(size.to_le_bytes());

    let mut head = vec![0u8; SAMPLE_BYTES.min(size) as usize];
    file.read_exact(&mut head).ok()?;
    hasher.update(&head);

    if size > SAMPLE_BYTES {
        let tail_len = SAMPLE_BYTES.min(size) as usize;
        file.seek(SeekFrom::End(-(tail_len as i64))).ok()?;
        let mut tail = vec![0u8; tail_len];
        file.read_exact(&mut tail).ok()?;
        hasher.update(&tail);
    }

    Some(format!("{:x}", hasher.finalize()))
}

/// Groups files that share an exact size, fingerprints only within those
/// groups (so unique-sized files never get hashed), and assigns a shared
/// `duplicate_group` id to any fingerprint shared by more than one path.
pub fn mark_duplicate_candidates(files: &mut [ScannedFileDto]) {
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (idx, file) in files.iter().enumerate() {
        by_size.entry(file.size_bytes).or_default().push(idx);
    }

    let mut group_counter = 0usize;

    for (_, indices) in by_size.into_iter().filter(|(_, idxs)| idxs.len() > 1) {
        let mut by_fingerprint: HashMap<String, Vec<usize>> = HashMap::new();
        for idx in indices {
            let (path, size) = (files[idx].path.clone(), files[idx].size_bytes);
            if let Some(fp) = fingerprint(&path, size) {
                by_fingerprint.entry(fp).or_default().push(idx);
            }
        }

        for (_, matching) in by_fingerprint.into_iter().filter(|(_, idxs)| idxs.len() > 1) {
            group_counter += 1;
            let group_id = format!("dup-{group_counter}");
            for idx in matching {
                files[idx].duplicate_group = Some(group_id.clone());
            }
        }
    }
}
