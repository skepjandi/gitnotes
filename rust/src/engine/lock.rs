//! flock-based per-repo operation lock.
//!
//! Serializes git operations on one repository, porting GitSync's
//! `run_with_lock` concept (git_manager.rs:245). A dedicated lock file is held
//! with an exclusive flock for the duration of the operation; the flock is
//! released on drop or process death, so no stale lock can ever persist.
//!
//! Lock files live inside `.git/` when present (invisible to `git status`),
//! falling back to a `.gitnotes.lock` file in the repo root. The file itself
//! is intentionally never deleted: deleting a file while holding its flock
//! races concurrent waiters (the classic unlink-flock race), whereas leaving
//! the empty file in place is harmless and standard practice.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
use uuid::Uuid;

use crate::engine::error::{EngineError, Result};

/// File name of the fallback lock in the repo root (outside `.git`).
const FALLBACK_LOCK_FILE_NAME: &str = ".gitnotes.lock";
/// File name of the lock inside `.git/`.
const GIT_DIR_LOCK_FILE_NAME: &str = "gitnotes.lock";

/// An acquired exclusive lock on one repository's operations.
pub struct RepoLock {
    file: File,
    path: PathBuf,
}

impl RepoLock {
    /// Acquire the exclusive op lock for `repo_dir`, blocking until any
    /// current holder releases.
    pub fn acquire(repo_dir: &Path) -> Result<Self> {
        Self::acquire_inner(repo_dir, true)
    }

    /// Non-blocking probe: succeeds iff no other process holds the lock.
    pub fn try_acquire(repo_dir: &Path) -> Result<Self> {
        Self::acquire_inner(repo_dir, false)
    }

    /// Whether another process currently holds the op lock for `repo_dir`.
    pub fn is_locked(repo_dir: &Path) -> bool {
        let path = Self::lock_path(repo_dir);
        let Ok(file) = open_lock_file(&path) else {
            return false;
        };
        file.try_lock_exclusive().is_err()
    }

    /// Path of the lock file for `repo_dir`.
    pub fn lock_path(repo_dir: &Path) -> PathBuf {
        let git_dir = repo_dir.join(".git");
        if git_dir.is_dir() {
            git_dir.join(GIT_DIR_LOCK_FILE_NAME)
        } else {
            repo_dir.join(FALLBACK_LOCK_FILE_NAME)
        }
    }

    /// Path of the lock file backing this lock.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn acquire_inner(repo_dir: &Path, blocking: bool) -> Result<Self> {
        let path = Self::lock_path(repo_dir);
        let mut file = open_lock_file(&path)?;
        let lock_result = if blocking {
            file.lock_exclusive()
        } else {
            file.try_lock_exclusive()
        };
        lock_result.map_err(|_| {
            if blocking {
                EngineError::Busy(format!(
                    "could not acquire repository lock at {}",
                    path.display()
                ))
            } else {
                EngineError::Busy(format!("repository is busy: {}", path.display()))
            }
        })?;
        // Stamp the lock file with a fresh token so concurrent waiters and
        // tooling can see who holds it.
        file.set_len(0).map_err(EngineError::Io)?;
        writeln!(file, "{}", Uuid::new_v4()).map_err(EngineError::Io)?;
        Ok(Self { file, path })
    }
}

impl Drop for RepoLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

fn open_lock_file(path: &Path) -> Result<File> {
    OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(path)
        .map_err(EngineError::Io)
}

/// Run `op` while holding the per-repo exclusive flock.
///
/// Ported from GitSync `run_with_lock` (git_manager.rs:245) — serializes all
/// git operations on one repository so two concurrent ops can never race the
/// working tree or index. Callers that want to fail fast when busy should use
/// `RepoLock::try_acquire` directly.
pub fn run_with_lock<T>(repo_dir: &Path, op: impl FnOnce() -> Result<T>) -> Result<T> {
    let _lock = RepoLock::acquire(repo_dir)?;
    op()
}

/// Run `op` only when no other operation currently holds the repo lock.
pub fn try_run_with_lock<T>(repo_dir: &Path, op: impl FnOnce() -> Result<T>) -> Result<T> {
    let _lock = RepoLock::try_acquire(repo_dir)?;
    op()
}
