//! Core repository operations (pure git2): open, status, diff, staging,
//! commits, history, conflicts, branches, remotes, and repo metadata.
//!
//! Remote operations (clone/fetch/pull/push) live in `ops_remote`; corruption
//! repair lives in `ops_repair`. Every op that touches the working tree runs
//! under the per-repo flock (`run_with_lock`).

use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{
    BranchType, Diff, DiffOptions, Index, ObjectType, Oid, Repository, Signature, Sort, Status,
    StatusOptions,
};

use crate::api::types::{
    Author, BranchInfo, CommitInfo, ConflictEntry, DiffLine, DiffLineOrigin, FileDiff, FileStatus,
    FileStatusKind, HunkSelection, RemoteInfo, RepoInfo, RepoStatus,
};
use crate::engine::error::{EngineError, Result};
use crate::engine::lock::{run_with_lock, try_run_with_lock, RepoLock};

/// Open the repository at `path`.
pub fn open_repo(path: &Path) -> Result<Repository> {
    Repository::open(path).map_err(|_| EngineError::NotARepository(path.display().to_string()))
}

/// Snapshot of the working-tree state of the repo at `path`, including
/// ahead/behind counts against the current branch's upstream and the flock
/// busy state.
pub fn repo_status(repo_id: &str, path: &Path) -> Result<RepoStatus> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        ensure_index_present(&repo)?;
        let mut status = RepoStatus {
            repo_id: repo_id.to_string(),
            path: path.display().to_string(),
            is_repo: true,
            current_branch: head_branch(&repo)?,
            ahead: 0,
            behind: 0,
            staged_count: 0,
            modified_count: 0,
            untracked_count: 0,
            conflicted_count: 0,
            is_locked: RepoLock::is_locked(path),
            last_op_error: None,
        };
        fill_ahead_behind(&repo, &mut status)?;
        for entry in repo.statuses(Some(&mut status_options()))?.iter() {
            let (kind, staged, _) = classify_status(entry.status());
            match kind {
                FileStatusKind::Conflicted => status.conflicted_count += 1,
                FileStatusKind::Untracked => status.untracked_count += 1,
                FileStatusKind::Unmodified => {}
                _ if staged => status.staged_count += 1,
                _ => status.modified_count += 1,
            }
        }
        Ok(status)
    })
}

/// Per-file working-tree statuses for the repo at `path`.
pub fn list_statuses(path: &Path) -> Result<Vec<FileStatus>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        ensure_index_present(&repo)?;
        let mut out = Vec::new();
        for entry in repo.statuses(Some(&mut status_options()))?.iter() {
            let (kind, staged, conflicted) = classify_status(entry.status());
            if kind == FileStatusKind::Unmodified {
                continue;
            }
            out.push(FileStatus {
                path: entry.path().unwrap_or_default().to_string(),
                status: kind,
                staged,
                conflicted,
                index_status: status_bit_names(entry.status(), true),
                workdir_status: status_bit_names(entry.status(), false),
            });
        }
        Ok(out)
    })
}

/// Combined file+line diff of the whole working tree (HEAD tree vs workdir
/// with index, plus untracked files as synthetic additions). Mirrors
/// `git diff HEAD`.
pub fn diff_all(path: &Path) -> Result<Vec<FileDiff>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        ensure_index_present(&repo)?;
        let mut out = Vec::new();
        for entry in repo.statuses(Some(&mut status_options()))?.iter() {
            let path_str = entry.path().unwrap_or_default();
            if path_str.is_empty() {
                continue;
            }
            let (kind, _, _) = classify_status(entry.status());
            if kind == FileStatusKind::Unmodified {
                continue;
            }
            if kind == FileStatusKind::Untracked {
                out.push(untracked_diff(&repo, path_str, &mut 0)?);
                continue;
            }
            out.push(diff_file_unlocked(&repo, path_str, &mut 0)?);
        }
        Ok(out)
    })
}

/// Line-level diff of a single file against HEAD (with the index applied).
pub fn diff_file(path: &Path, file_path: &str) -> Result<FileDiff> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        diff_file_unlocked(&repo, file_path, &mut 0)
    })
}

/// Stage the given paths (add to the index). `git add`; also resolves any
/// conflict entries for those paths.
pub fn stage_paths(path: &Path, paths: &[String]) -> Result<()> {
    run_with_lock(path, || {
        if paths.is_empty() {
            return Ok(());
        }
        let repo = open_repo(path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| EngineError::Invalid("Not a working directory".into()))?;
        let mut index = repo.index()?;
        for path in paths {
            let file_path = Path::new(path);
            if workdir.join(file_path).exists() {
                index.add_path(file_path)?;
            } else if let Err(error) = index.remove_path(file_path) {
                if error.code() != git2::ErrorCode::NotFound {
                    return Err(EngineError::Git(error));
                }
            }
        }
        index.write().map_err(EngineError::Git)
    })
}

/// Unstage the given paths back to the HEAD state. `git reset HEAD <paths>`.
pub fn unstage_paths(path: &Path, paths: &[String]) -> Result<()> {
    run_with_lock(path, || {
        if paths.is_empty() {
            return Ok(());
        }
        let repo = open_repo(path)?;
        let mut index = repo.index()?;
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        repo.reset_default(Some(commit.as_object()), paths.iter())
            .map_err(EngineError::Git)?;
        index.write().map_err(EngineError::Git)
    })
}

/// Remove paths from the index and the working tree. `git rm`.
pub fn remove_paths(path: &Path, paths: &[String], keep_worktree: bool) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut index = repo.index()?;
        let mut removed = Vec::new();
        for p in paths {
            match index.remove_path(Path::new(p)) {
                Ok(()) => removed.push(p.clone()),
                Err(e) if e.code() == git2::ErrorCode::NotFound => {}
                Err(e) => return Err(EngineError::Git(e)),
            }
        }
        index.write().map_err(EngineError::Git)?;
        if !keep_worktree && !removed.is_empty() {
            let mut checkout = CheckoutBuilder::new();
            checkout.remove_untracked(true);
            for p in &removed {
                checkout.path(Path::new(p));
            }
            repo.checkout_index(Some(&mut index), Some(&mut checkout))
                .map_err(EngineError::Git)?;
        }
        Ok(())
    })
}

/// Discard working tree changes for the given paths: restore them to HEAD state.
/// This is `git checkout HEAD -- <paths>`.
pub fn discard_files(path: &Path, paths: &[String]) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let workdir = repo
            .workdir()
            .ok_or_else(|| EngineError::Invalid("Not a working directory".into()))?;
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        let tree = commit.tree()?;
        for p in paths {
            let target_path = workdir.join(p);
            match tree.get_path(Path::new(p)) {
                Ok(entry) => {
                    let blob = repo.find_blob(entry.id())?;
                    std::fs::write(&target_path, blob.content())?;
                }
                Err(e) if e.code() == git2::ErrorCode::NotFound => {
                    if target_path.exists() {
                        std::fs::remove_file(&target_path)?;
                    }
                }
                Err(e) => return Err(EngineError::Git(e)),
            }
        }
        Ok(())
    })
}

/// LINE-LEVEL PARTIAL STAGING. Stages only the selected diff lines of
/// `file_path`, leaving the rest unstaged. Ported from GitSync
/// `stage_file_lines` (git_manager.rs:1718).
pub fn stage_file_lines(path: &Path, file_path: &str, hunks: &[HunkSelection]) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let selected: std::collections::HashSet<u32> = hunks
            .iter()
            .flat_map(|h| h.line_indices.iter().copied())
            .collect();
        if selected.is_empty() {
            return Ok(());
        }

        let head_tree = match repo.head() {
            Ok(head) => Some(head.peel_to_tree()?),
            Err(_) => None,
        };

        // Pass 1 — default-context diff, identical to what `diff_file` shows
        // the UI, so the caller's line indices map 1:1 onto these lines.
        // Resolve the selection to old/new line numbers so it survives a
        // context-width change.
        let mut diff_opts = DiffOptions::new();
        diff_opts.pathspec(file_path);
        diff_opts.include_untracked(true);
        diff_opts.recurse_untracked_dirs(true);
        let diff =
            repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))?;

        let mut lines = Vec::new();
        collect_diff_lines(&diff, &mut lines, &mut 0)?;
        if lines.is_empty() {
            return Ok(());
        }

        let mut selected_old: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let mut selected_new: std::collections::HashSet<u32> = std::collections::HashSet::new();
        let is_changed = |line: &DiffLine| {
            !matches!(
                line.origin,
                DiffLineOrigin::Context | DiffLineOrigin::ContextEof
            )
        };
        let mut block: Vec<&DiffLine> = Vec::new();
        let flush_block =
            |block: Vec<&DiffLine>,
             selected_old: &mut std::collections::HashSet<u32>,
             selected_new: &mut std::collections::HashSet<u32>| {
                // Invariant: a replacement block stages atomically — staging its
                // additions without its deletions would duplicate the old lines.
                let has_selected_addition = block.iter().any(|line| {
                    matches!(
                        line.origin,
                        DiffLineOrigin::Addition | DiffLineOrigin::AdditionEof
                    ) && selected.contains(&line.index)
                });
                for line in block {
                    match line.origin {
                        DiffLineOrigin::Addition | DiffLineOrigin::AdditionEof => {
                            if selected.contains(&line.index) {
                                if let Some(lineno) = line.new_lineno {
                                    selected_new.insert(lineno);
                                }
                            }
                        }
                        DiffLineOrigin::Deletion | DiffLineOrigin::DeletionEof => {
                            if selected.contains(&line.index) || has_selected_addition {
                                if let Some(lineno) = line.old_lineno {
                                    selected_old.insert(lineno);
                                }
                            }
                        }
                        DiffLineOrigin::Context | DiffLineOrigin::ContextEof => {}
                    }
                }
            };
        for line in &lines {
            if is_changed(line) {
                block.push(line);
            } else if !block.is_empty() {
                flush_block(
                    std::mem::take(&mut block),
                    &mut selected_old,
                    &mut selected_new,
                );
            }
        }
        if !block.is_empty() {
            flush_block(block, &mut selected_old, &mut selected_new);
        }

        // Pass 2 — whole-file context so every HEAD line appears in the diff.
        // Rebuilding the staged content from a default-context diff silently
        // dropped unchanged regions between hunks (corrupting the file).
        let mut full_opts = DiffOptions::new();
        full_opts.pathspec(file_path);
        full_opts.include_untracked(true);
        full_opts.recurse_untracked_dirs(true);
        full_opts.context_lines(u32::MAX);
        let full_diff =
            repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut full_opts))?;

        let mut full_lines = Vec::new();
        collect_diff_lines(&full_diff, &mut full_lines, &mut 0)?;
        if full_lines.is_empty() {
            return Ok(());
        }

        let mut staged_content = String::new();
        for line in &full_lines {
            match line.origin {
                DiffLineOrigin::Context | DiffLineOrigin::ContextEof => {
                    staged_content.push_str(&line.content);
                }
                DiffLineOrigin::Deletion | DiffLineOrigin::DeletionEof => {
                    if line
                        .old_lineno
                        .is_none_or(|lineno| !selected_old.contains(&lineno))
                    {
                        staged_content.push_str(&line.content);
                    }
                }
                DiffLineOrigin::Addition | DiffLineOrigin::AdditionEof => {
                    if line
                        .new_lineno
                        .is_some_and(|lineno| selected_new.contains(&lineno))
                    {
                        staged_content.push_str(&line.content);
                    }
                }
            }
        }

        let mut index = repo.index()?;
        let file_bytes = file_path.as_bytes();
        let entry = match index.get_path(Path::new(file_path), 0) {
            Some(existing) => git2::IndexEntry {
                ctime: existing.ctime,
                mtime: existing.mtime,
                dev: existing.dev,
                ino: existing.ino,
                mode: existing.mode,
                uid: existing.uid,
                gid: existing.gid,
                file_size: staged_content.len() as u32,
                id: Oid::ZERO_SHA1,
                flags: existing.flags,
                flags_extended: existing.flags_extended,
                path: file_bytes.to_vec(),
            },
            None => git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o100644,
                uid: 0,
                gid: 0,
                file_size: staged_content.len() as u32,
                id: Oid::ZERO_SHA1,
                flags: 0,
                flags_extended: 0,
                path: file_bytes.to_vec(),
            },
        };
        index.add_frombuffer(&entry, staged_content.as_bytes())?;
        index.write().map_err(EngineError::Git)
    })
}

/// Create a commit from the staged index, using `author` as identity.
/// Returns the created commit.
pub fn commit_changes(path: &Path, message: &str, author: &Author) -> Result<CommitInfo> {
    try_run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut index = repo.index()?;
        if index.has_conflicts() {
            let paths = conflict_paths(&index)?;
            return Err(EngineError::Invalid(format!(
                "cannot commit: unresolved merge conflicts ({})",
                paths.join(", ")
            )));
        }
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = Signature::now(&author.name, &author.email)?;
        let mut parents: Vec<git2::Commit> = match repo.head() {
            Ok(head) => vec![head.peel_to_commit()?],
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Vec::new(),
            Err(e) => return Err(EngineError::Git(e)),
        };
        // Mid-merge commit: MERGE_HEAD becomes the second parent so the
        // resolution lands as a real merge commit.
        let is_merge_commit = if let Ok(merge_head) = repo.find_reference("MERGE_HEAD") {
            if let Ok(merge_commit) = merge_head.peel_to_commit() {
                parents.push(merge_commit);
                true
            } else {
                false
            }
        } else {
            false
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?;
        if is_merge_commit {
            repo.cleanup_state().ok();
        }
        let commit = repo.find_commit(oid)?;
        commit_to_info(&commit)
    })
}

/// Recent commit history (`git log`), newest first.
pub fn recent_commits(path: &Path, skip: u32, limit: u32) -> Result<Vec<CommitInfo>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut revwalk = repo.revwalk()?;
        revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
        match revwalk.push_head() {
            Ok(()) => {}
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(Vec::new()),
            Err(e) => return Err(EngineError::Git(e)),
        }
        let out: Vec<CommitInfo> = revwalk
            .skip(skip as usize)
            .take(limit.max(1) as usize)
            .map(|oid| commit_to_info(&repo.find_commit(oid?)?))
            .collect::<std::result::Result<Vec<_>, EngineError>>()?;
        Ok(out)
    })
}

/// Per-file diff of one commit against its first parent (`git show`-style).
/// Root commits diff against the empty tree; merge commits diff against their
/// first parent. Line indices are sequential across all files of the commit.
pub fn commit_diff(path: &Path, oid_str: &str) -> Result<Vec<FileDiff>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let commit = repo.find_commit(parse_oid(oid_str)?)?;
        let new_tree = commit.tree()?;
        let old_tree = match commit.parent_count() {
            0 => None,
            _ => Some(commit.parent(0)?.tree()?),
        };
        let diff = repo.diff_tree_to_tree(old_tree.as_ref(), Some(&new_tree), None)?;
        let out: std::cell::RefCell<Vec<FileDiff>> = std::cell::RefCell::new(Vec::new());
        let mut counter: u32 = 0;
        diff.foreach(
            &mut |delta, _| {
                let path_str = delta
                    .new_file()
                    .path()
                    .or_else(|| delta.old_file().path())
                    .map(|p| p.display().to_string())
                    .unwrap_or_default();
                out.borrow_mut().push(FileDiff {
                    path: path_str,
                    status: delta_status_kind(delta.status()),
                    is_binary: delta.flags().contains(git2::DiffFlags::BINARY),
                    added: 0,
                    deleted: 0,
                    lines: Vec::new(),
                });
                true
            },
            None,
            Some(&mut |_, _| true),
            Some(&mut |_, _, line| {
                let mut diffs = out.borrow_mut();
                if let Some(current) = diffs.last_mut() {
                    let origin = map_diff_line_origin(line.origin());
                    match origin {
                        DiffLineOrigin::Addition | DiffLineOrigin::AdditionEof => {
                            current.added += 1;
                        }
                        DiffLineOrigin::Deletion | DiffLineOrigin::DeletionEof => {
                            current.deleted += 1;
                        }
                        _ => {}
                    }
                    current.lines.push(DiffLine {
                        index: counter,
                        origin,
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                        content: String::from_utf8_lossy(line.content()).to_string(),
                    });
                    counter += 1;
                }
                true
            }),
        )?;
        Ok(out.into_inner())
    })
}

/// Unresolved merge conflicts in the index.
pub fn get_conflicts(path: &Path) -> Result<Vec<ConflictEntry>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        conflict_entries(&repo.index()?)
    })
}

/// Resolve a conflicted path by staging the working-tree content as final.
pub fn resolve_conflict(path: &Path, file_path: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut index = repo.index()?;
        index
            .add_path(Path::new(file_path))
            .map_err(EngineError::Git)?;
        index.write().map_err(EngineError::Git)
    })
}

/// List local + remote branches with upstream ahead/behind counts.
pub fn list_branches(path: &Path, remote_name: &str) -> Result<Vec<BranchInfo>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let current = head_branch(&repo)?;
        let mut out = Vec::new();
        let branches = repo.branches(Some(BranchType::Local))?;
        for branch in branches.flatten() {
            let (branch, _) = branch;
            let name = branch.name()?.unwrap_or_default().to_string();
            let upstream_name = branch
                .upstream()
                .ok()
                .and_then(|u| u.name().ok().flatten().map(str::to_string));
            let is_current = Some(name.as_str()) == current.as_deref();
            let (ahead, behind) =
                ahead_behind(&repo, &branch, remote_name, &name, false).unwrap_or((0, 0));
            out.push(BranchInfo {
                name,
                upstream: upstream_name,
                is_current,
                is_remote: false,
                ahead,
                behind,
            });
        }
        let branches = repo.branches(Some(BranchType::Remote))?;
        for branch in branches.flatten() {
            let (branch, _) = branch;
            let full = branch.name()?.unwrap_or_default().to_string();
            if full.ends_with("/HEAD") {
                continue;
            }
            let name = full
                .strip_prefix(&format!("{}/", remote_name))
                .unwrap_or(&full)
                .to_string();
            out.push(BranchInfo {
                name,
                upstream: Some(full.clone()),
                is_current: false,
                is_remote: true,
                ahead: 0,
                behind: 0,
            });
        }
        Ok(out)
    })
}

/// Create a new local branch at `source` (default: current HEAD) without
/// switching to it.
pub fn create_branch(path: &Path, name: &str, source: Option<&str>) -> Result<BranchInfo> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let commit = match source {
            Some(source) => repo
                .find_branch(source, BranchType::Local)?
                .get()
                .peel_to_commit()?,
            None => match repo.head() {
                Ok(head) => head.peel_to_commit()?,
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                    return Err(EngineError::Invalid(
                        "cannot create a branch: repository has no commits".to_string(),
                    ));
                }
                Err(e) => return Err(EngineError::Git(e)),
            },
        };
        let branch = repo.branch(name, &commit, false)?;
        let (ahead, behind) = ahead_behind(&repo, &branch, "", name, false).unwrap_or((0, 0));
        Ok(BranchInfo {
            name: name.to_string(),
            upstream: None,
            is_current: false,
            is_remote: false,
            ahead,
            behind,
        })
    })
}

/// Check out `name`, creating a local tracking branch from the remote when it
/// does not exist locally (ported from GitSync `checkout_branch`).
pub fn checkout_branch(path: &Path, name: &str, remote_name: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let branch = match repo.find_branch(name, BranchType::Local) {
            Ok(branch) => branch,
            Err(e) if e.code() == git2::ErrorCode::NotFound => {
                let remote_branch_name = format!("{}/{}", remote_name, name);
                let remote_branch = repo.find_branch(&remote_branch_name, BranchType::Remote)?;
                let target = remote_branch
                    .get()
                    .target()
                    .ok_or_else(|| EngineError::Invalid("invalid remote branch".to_string()))?;
                repo.branch(name, &repo.find_commit(target)?, false)?
            }
            Err(e) => return Err(EngineError::Git(e)),
        };
        let object = branch.get().peel(ObjectType::Commit)?;
        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder.force();
        repo.checkout_tree(&object, Some(&mut checkout_builder))?;
        let refname = format!("refs/heads/{}", name);
        repo.set_head(&refname)?;
        Ok(())
    })
}

/// Delete a local branch (fails for the current branch).
pub fn delete_branch(path: &Path, name: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        if branch.is_head() {
            return Err(EngineError::Invalid(
                "cannot delete the current branch".to_string(),
            ));
        }
        branch.delete().map_err(EngineError::Git)
    })
}

/// Rename a local branch (fails when `new_name` already exists).
pub fn rename_branch(path: &Path, name: &str, new_name: &str) -> Result<BranchInfo> {
    run_with_lock(path, || {
        if new_name.trim().is_empty() {
            return Err(EngineError::Invalid(
                "new branch name is required".to_string(),
            ));
        }
        let repo = open_repo(path)?;
        let mut branch = repo.find_branch(name, BranchType::Local)?;
        branch.rename(new_name, false)?;
        let upstream = branch
            .upstream()
            .ok()
            .and_then(|u| u.name().ok().flatten().map(str::to_string));
        let current = head_branch(&repo)?;
        let remote_name = first_remote(&repo)?.unwrap_or_default();
        let (ahead, behind) =
            ahead_behind(&repo, &branch, &remote_name, new_name, false).unwrap_or((0, 0));
        Ok(BranchInfo {
            name: new_name.to_string(),
            upstream,
            is_current: current.as_deref() == Some(new_name),
            is_remote: false,
            ahead,
            behind,
        })
    })
}

/// Detach HEAD at `oid` (`git checkout <commit>`). Refuses to run while
/// tracked files have staged/unstaged changes; untracked files are kept.
pub fn checkout_commit(path: &Path, oid_str: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        require_clean_tracked_tree(&repo)?;
        let oid = parse_oid(oid_str)?;
        let commit = repo.find_commit(oid)?;
        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        repo.checkout_tree(commit.as_object(), Some(&mut checkout))?;
        repo.set_head_detached(oid)?;
        Ok(())
    })
}

/// Move HEAD (and the current branch ref) to `oid`, keeping index and working
/// tree untouched (`git reset --soft`).
pub fn reset_soft(path: &Path, oid_str: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let commit = repo.find_commit(parse_oid(oid_str)?)?;
        repo.reset(commit.as_object(), git2::ResetType::Soft, None)
            .map_err(EngineError::Git)
    })
}

/// Revert `oid` (`git revert`): applies the inverse diff and immediately
/// commits it as `Revert "<summary>"`. Merge commits are rejected; a dirty
/// tracked tree is rejected up front; revert conflicts are surfaced as typed
/// errors with the conflicted paths (repo left in a resolvable state).
pub fn revert_commit(path: &Path, oid_str: &str, author: &Author) -> Result<CommitInfo> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        require_clean_tracked_tree(&repo)?;
        let commit = repo.find_commit(parse_oid(oid_str)?)?;
        if commit.parent_count() > 1 {
            return Err(EngineError::Unsupported(
                "reverting merge commits is not supported".to_string(),
            ));
        }
        let revert_result = repo.revert(&commit, None);
        let mut index = repo.index()?;
        if let Err(error) = revert_result {
            if index.has_conflicts() {
                let paths = conflict_paths(&index)?;
                return Err(EngineError::Invalid(format!(
                    "revert produced conflicts ({}); resolve them in the Conflicts section",
                    paths.join(", ")
                )));
            }
            return Err(EngineError::Git(error));
        }
        if index.has_conflicts() {
            let paths = conflict_paths(&index)?;
            return Err(EngineError::Invalid(format!(
                "revert produced conflicts ({}); resolve them in the Conflicts section",
                paths.join(", ")
            )));
        }
        let tree_oid = index.write_tree()?;
        let tree = repo.find_tree(tree_oid)?;
        let sig = Signature::now(&author.name, &author.email)?;
        let parents: Vec<git2::Commit> = match repo.head() {
            Ok(head) => vec![head.peel_to_commit()?],
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Vec::new(),
            Err(e) => return Err(EngineError::Git(e)),
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
        let summary = commit.summary().ok().flatten().unwrap_or_default();
        let message = format!(
            "Revert \"{}\"\n\nThis reverts commit {}.",
            summary,
            commit.id()
        );
        let new_oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)?;
        let reverted = repo.find_commit(new_oid)?;
        commit_to_info(&reverted)
    })
}

/// List configured remotes.
pub fn list_remotes(path: &Path) -> Result<Vec<RemoteInfo>> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let mut out = Vec::new();
        for name in repo.remotes()?.iter().flatten().flatten() {
            let remote = repo.find_remote(name)?;
            let fetch_specs = remote
                .fetch_refspecs()
                .map(|specs| {
                    specs
                        .iter()
                        .flatten()
                        .flatten()
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();
            let push_specs = remote
                .push_refspecs()
                .map(|specs| {
                    specs
                        .iter()
                        .flatten()
                        .flatten()
                        .map(|s| s.to_string())
                        .collect()
                })
                .unwrap_or_default();
            out.push(RemoteInfo {
                name: name.to_string(),
                url: remote.url().ok().map(str::to_string),
                fetch_specs,
                push_specs,
            });
        }
        Ok(out)
    })
}

/// Add a remote.
pub fn add_remote(path: &Path, name: &str, url: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        repo.remote(name, url).map(|_| ()).map_err(EngineError::Git)
    })
}

/// Remove a remote.
pub fn remove_remote(path: &Path, name: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        repo.remote_delete(name).map_err(EngineError::Git)
    })
}

/// Update the URL of an existing remote (`git remote set-url`).
pub fn set_remote_url(path: &Path, name: &str, url: &str) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        repo.remote_set_url(name, url).map_err(EngineError::Git)
    })
}

/// High-level repository metadata.
pub fn repo_info(path: &Path) -> Result<RepoInfo> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        let branch = head_branch(&repo)?;
        let head_oid = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok())
            .map(|c| c.id().to_string());
        let remotes: Vec<String> = repo
            .remotes()?
            .iter()
            .flatten()
            .flatten()
            .map(str::to_string)
            .collect();
        let mut revwalk = repo.revwalk()?;
        revwalk.push_head().ok();
        let total_commits = revwalk.count() as u64;
        let is_clean = !repo
            .statuses(Some(&mut status_options()))?
            .iter()
            .any(|entry| classify_status(entry.status()).0 != FileStatusKind::Unmodified);
        Ok(RepoInfo {
            path: path.display().to_string(),
            is_repo: true,
            current_branch: branch,
            head_oid,
            remotes,
            total_commits,
            is_clean,
        })
    })
}

/// Whether another process currently holds the op lock for `path`.
pub fn is_locked(path: &Path) -> bool {
    RepoLock::is_locked(path)
}

fn diff_file_unlocked(
    repo: &Repository,
    file_path: &str,
    index_offset: &mut u32,
) -> Result<FileDiff> {
    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true);
    status_opts.recurse_untracked_dirs(true);
    let untracked = repo.statuses(Some(&mut status_opts))?.iter().any(|entry| {
        entry.path().ok() == Some(file_path)
            && classify_status(entry.status()).0 == FileStatusKind::Untracked
    });
    if untracked {
        return untracked_diff(repo, file_path, index_offset);
    }
    let head_tree = match repo.head() {
        Ok(head) => Some(head.peel_to_tree()?),
        Err(_) => None,
    };
    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(file_path);
    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))?;
    let (added, deleted) = diff_stats(&diff)?;
    let is_binary = diff
        .deltas()
        .next()
        .map(|delta| delta.flags().contains(git2::DiffFlags::BINARY))
        .unwrap_or(false);
    let mut lines = Vec::new();
    collect_diff_lines(&diff, &mut lines, index_offset)?;
    Ok(FileDiff {
        path: file_path.to_string(),
        status: FileStatusKind::Modified,
        is_binary,
        added,
        deleted,
        lines,
    })
}

fn untracked_diff(repo: &Repository, file_path: &str, index_offset: &mut u32) -> Result<FileDiff> {
    let workdir = repo.workdir().map(Path::to_path_buf).unwrap_or_default();
    let full_path = workdir.join(file_path);
    let bytes = match std::fs::read(&full_path) {
        Ok(b) => b,
        Err(_) => {
            return Ok(FileDiff {
                path: file_path.to_string(),
                status: FileStatusKind::Untracked,
                is_binary: false,
                added: 0,
                deleted: 0,
                lines: Vec::new(),
            });
        }
    };
    if bytes.contains(&0u8) {
        return Ok(FileDiff {
            path: file_path.to_string(),
            status: FileStatusKind::Untracked,
            is_binary: true,
            added: 0,
            deleted: 0,
            lines: Vec::new(),
        });
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    let mut last_index = *index_offset;
    for raw in text.split_inclusive('\n') {
        let line = DiffLine {
            index: last_index,
            origin: DiffLineOrigin::Addition,
            old_lineno: None,
            new_lineno: Some(last_index),
            content: format!("+{}", raw),
        };
        last_index += 1;
        lines.push(line);
    }
    *index_offset = last_index;
    Ok(FileDiff {
        path: file_path.to_string(),
        status: FileStatusKind::Untracked,
        is_binary: false,
        added: lines.len() as u32,
        deleted: 0,
        lines,
    })
}

fn collect_diff_lines(diff: &Diff, out: &mut Vec<DiffLine>, index_offset: &mut u32) -> Result<()> {
    let offset = *index_offset;
    let mut counter = offset;
    let mut collected = Vec::new();
    diff.foreach(
        &mut |_, _| true,
        None,
        Some(&mut |_, _| true),
        Some(&mut |_, _, line| {
            let origin = map_diff_line_origin(line.origin());
            collected.push(DiffLine {
                index: counter,
                origin,
                old_lineno: line.old_lineno(),
                new_lineno: line.new_lineno(),
                content: String::from_utf8_lossy(line.content()).to_string(),
            });
            counter += 1;
            true
        }),
    )?;
    *index_offset = counter;
    out.append(&mut collected);
    Ok(())
}

fn diff_stats(diff: &Diff) -> Result<(u32, u32)> {
    let stats = diff.stats()?;
    Ok((stats.insertions() as u32, stats.deletions() as u32))
}

fn map_diff_line_origin(c: char) -> DiffLineOrigin {
    match c {
        ' ' => DiffLineOrigin::Context,
        '+' => DiffLineOrigin::Addition,
        '-' => DiffLineOrigin::Deletion,
        '=' => DiffLineOrigin::ContextEof,
        '>' => DiffLineOrigin::AdditionEof,
        '<' => DiffLineOrigin::DeletionEof,
        _ => DiffLineOrigin::Context,
    }
}

fn parse_oid(oid_str: &str) -> Result<Oid> {
    Oid::from_str(oid_str)
        .map_err(|_| EngineError::Invalid(format!("invalid commit id: {}", oid_str)))
}

fn delta_status_kind(status: git2::Delta) -> FileStatusKind {
    match status {
        git2::Delta::Added | git2::Delta::Untracked | git2::Delta::Copied => FileStatusKind::Added,
        git2::Delta::Deleted => FileStatusKind::Deleted,
        git2::Delta::Renamed => FileStatusKind::Renamed,
        git2::Delta::Typechange => FileStatusKind::TypeChange,
        _ => FileStatusKind::Modified,
    }
}

/// Reject ops that rewrite HEAD when tracked files carry staged or unstaged
/// changes (untracked files are allowed to survive).
fn require_clean_tracked_tree(repo: &Repository) -> Result<()> {
    for entry in repo.statuses(Some(&mut status_options()))?.iter() {
        let (kind, _, _) = classify_status(entry.status());
        if kind != FileStatusKind::Unmodified && kind != FileStatusKind::Untracked {
            return Err(EngineError::Invalid(
                "commit or discard your local changes first".to_string(),
            ));
        }
    }
    Ok(())
}

fn fill_ahead_behind(repo: &Repository, status: &mut RepoStatus) -> Result<()> {
    let Some(branch) = head_branch(repo)? else {
        return Ok(());
    };
    let Some(remote_name) = first_remote(repo)? else {
        return Ok(());
    };
    let upstream_branch = configured_merge_branch(repo, &branch).unwrap_or(branch);
    let tracking = format!("refs/remotes/{}/{}", remote_name, upstream_branch);
    let local_oid = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id());
    let remote_oid = repo.refname_to_id(&tracking).ok();
    let (Some(local_oid), Some(remote_oid)) = (local_oid, remote_oid) else {
        return Ok(());
    };
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, remote_oid)?;
    status.ahead = ahead as u32;
    status.behind = behind as u32;
    Ok(())
}

pub(crate) fn configured_merge_branch(repo: &Repository, branch: &str) -> Option<String> {
    let merge_key = format!("branch.{}.merge", branch);
    let merge_ref = repo.config().ok()?.get_string(&merge_key).ok()?;
    merge_ref.strip_prefix("refs/heads/").map(str::to_string)
}

fn ahead_behind(
    repo: &Repository,
    branch: &git2::Branch,
    remote_name: &str,
    branch_name: &str,
    is_remote: bool,
) -> Result<(u32, u32)> {
    let Some(local_oid) = branch.get().target() else {
        return Ok((0, 0));
    };
    let Ok(branch_obj) = repo.find_commit(local_oid) else {
        return Ok((0, 0));
    };
    if is_remote {
        return Ok((0, 0));
    }
    let tracking = format!("refs/remotes/{}/{}", remote_name, branch_name);
    let Ok(remote_oid) = repo.refname_to_id(&tracking) else {
        return Ok((0, 0));
    };
    let Ok(remote_commit) = repo.find_commit(remote_oid) else {
        return Ok((0, 0));
    };
    let (ahead, behind) = repo.graph_ahead_behind(branch_obj.id(), remote_commit.id())?;
    Ok((ahead as u32, behind as u32))
}

fn first_remote(repo: &Repository) -> Result<Option<String>> {
    Ok(repo
        .remotes()?
        .iter()
        .flatten()
        .flatten()
        .next()
        .map(str::to_string))
}

fn conflict_paths(index: &Index) -> Result<Vec<String>> {
    Ok(conflict_entries(index)?
        .into_iter()
        .map(|c| c.path)
        .collect())
}

fn conflict_entries(index: &Index) -> Result<Vec<ConflictEntry>> {
    let mut out = Vec::new();
    if let Ok(iter) = index.conflicts() {
        for conflict in iter.flatten() {
            let path = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).into_owned())
                .unwrap_or_default();
            out.push(ConflictEntry {
                path,
                ours: conflict.our.as_ref().map(|e| e.id.to_string()),
                theirs: conflict.their.as_ref().map(|e| e.id.to_string()),
                ancestor: conflict.ancestor.as_ref().map(|e| e.id.to_string()),
                status: "unresolved".to_string(),
            });
        }
    }
    Ok(out)
}

fn commit_to_info(commit: &git2::Commit) -> Result<CommitInfo> {
    let author = commit.author();
    Ok(CommitInfo {
        id: commit.id().to_string(),
        short_id: commit.id().to_string().chars().take(7).collect(),
        message: commit.message().unwrap_or_default().to_string(),
        summary: commit
            .summary()
            .ok()
            .flatten()
            .unwrap_or_default()
            .to_string(),
        author_name: author.name().map(str::to_string).unwrap_or_default(),
        author_email: author.email().map(str::to_string).unwrap_or_default(),
        author_time: commit.time().seconds(),
        committer_time: commit.committer().when().seconds(),
        parent_count: commit.parent_count() as u32,
        parents: commit.parent_ids().map(|oid| oid.to_string()).collect(),
    })
}

fn status_options() -> StatusOptions {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    opts.recurse_untracked_dirs(true);
    opts.include_unreadable(true);
    opts.renames_head_to_index(true);
    opts.renames_index_to_workdir(true);
    opts
}

/// Surface a missing/corrupt index file as a typed corruption error.
///
/// libgit2 silently tolerates a deleted `.git/index` (it treats the repo as
/// freshly-initialised), so a repo whose HEAD exists but whose index file is
/// gone must be flagged explicitly — the app routes `corruption` errors into
/// the repair flow. The error carries `ErrorClass::Index` so the classifier
/// marks it as corruption.
fn ensure_index_present(repo: &Repository) -> Result<()> {
    if !repo.path().join("index").exists() && repo.head().is_ok() {
        return Err(EngineError::Git(git2::Error::new(
            git2::ErrorCode::NotFound,
            git2::ErrorClass::Index,
            "index file is missing (corrupted repository)",
        )));
    }
    Ok(())
}

/// Short name of the checked-out branch, or `None` on a detached/empty HEAD.
fn head_branch(repo: &Repository) -> Result<Option<String>> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(None),
        Err(e) => return Err(EngineError::Git(e)),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    match head.shorthand() {
        Ok(name) => Ok(Some(name.to_string())),
        Err(e) => Err(EngineError::Git(e)),
    }
}

/// Map a raw git2 `Status` bitflags value to our wire representation.
fn classify_status(status: Status) -> (FileStatusKind, bool, bool) {
    if status.contains(Status::CONFLICTED) {
        return (FileStatusKind::Conflicted, false, true);
    }
    if status.contains(Status::WT_NEW) {
        return (FileStatusKind::Untracked, false, false);
    }
    if status.contains(Status::INDEX_NEW) {
        return (FileStatusKind::Added, true, false);
    }
    if status.contains(Status::INDEX_DELETED) {
        return (FileStatusKind::Deleted, true, false);
    }
    if status.contains(Status::INDEX_MODIFIED)
        || status.contains(Status::INDEX_RENAMED)
        || status.contains(Status::INDEX_TYPECHANGE)
    {
        return (FileStatusKind::Modified, true, false);
    }
    if status.contains(Status::WT_DELETED) {
        return (FileStatusKind::Deleted, false, false);
    }
    if status.contains(Status::WT_MODIFIED)
        || status.contains(Status::WT_RENAMED)
        || status.contains(Status::WT_TYPECHANGE)
    {
        return (FileStatusKind::Modified, false, false);
    }
    (FileStatusKind::Unmodified, false, false)
}

/// Human-readable flag names for the index or workdir half of a status value.
fn status_bit_names(status: Status, index: bool) -> String {
    let flags: &[(Status, &str)] = if index {
        &[
            (Status::INDEX_NEW, "INDEX_NEW"),
            (Status::INDEX_MODIFIED, "INDEX_MODIFIED"),
            (Status::INDEX_DELETED, "INDEX_DELETED"),
            (Status::INDEX_RENAMED, "INDEX_RENAMED"),
            (Status::INDEX_TYPECHANGE, "INDEX_TYPECHANGE"),
        ]
    } else {
        &[
            (Status::WT_NEW, "WT_NEW"),
            (Status::WT_MODIFIED, "WT_MODIFIED"),
            (Status::WT_DELETED, "WT_DELETED"),
            (Status::WT_RENAMED, "WT_RENAMED"),
            (Status::WT_TYPECHANGE, "WT_TYPECHANGE"),
        ]
    };
    flags
        .iter()
        .filter(|(flag, _)| status.contains(*flag))
        .map(|(_, name)| *name)
        .collect::<Vec<_>>()
        .join("|")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch_repo(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gitnotes-ops-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        Repository::init(&dir).unwrap();
        dir
    }

    fn commit_file(dir: &Path, rel: &str, content: &str, message: &str) {
        fs::write(dir.join(rel), content).unwrap();
        let repo = open_repo(dir).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new(rel)).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("QA", "qa@gitnotes.test").unwrap();
        let parent = repo.head().ok().and_then(|head| head.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .unwrap();
    }

    fn staged_blob_content(dir: &Path, rel: &str) -> String {
        let repo = open_repo(dir).unwrap();
        let index = repo.index().unwrap();
        let entry = index.get_path(Path::new(rel), 0).unwrap();
        let blob = repo.find_blob(entry.id).unwrap();
        String::from_utf8(blob.content().to_vec()).unwrap()
    }

    #[test]
    fn commit_changes_returns_busy_when_lock_is_held() {
        let dir = scratch_repo("commit-busy");
        commit_file(&dir, "README", "baseline\n", "baseline");
        fs::write(dir.join("README"), "changed\n").unwrap();
        {
            let repo = open_repo(&dir).unwrap();
            let mut index = repo.index().unwrap();
            index.add_path(Path::new("README")).unwrap();
            index.write().unwrap();
        }

        let holder = RepoLock::acquire(&dir).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let commit_dir = dir.clone();
        let join = std::thread::spawn(move || {
            let result = commit_changes(
                &commit_dir,
                "should fail while busy",
                &Author {
                    name: "QA".to_string(),
                    email: "qa@gitnotes.test".to_string(),
                },
            );
            sender.send(result).unwrap();
        });

        let observed_before_release = receiver.recv_timeout(std::time::Duration::from_millis(100));
        let returned_before_release = observed_before_release.is_ok();
        drop(holder);
        let result = observed_before_release
            .or_else(|_| {
                receiver
                    .recv()
                    .map_err(|_| std::sync::mpsc::RecvTimeoutError::Disconnected)
            })
            .unwrap();
        join.join().unwrap();

        assert!(
            returned_before_release,
            "commit_changes did not return while the repository lock was held"
        );
        assert!(
            matches!(result, Err(EngineError::Busy(_))),
            "commit_changes should return Busy while the repository lock is held"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stage_file_lines_keeps_regions_outside_the_selected_hunk() {
        let dir = scratch_repo("partial");
        let baseline = "RIVAL third conflicting change\nline 2\nline 3\nline 4\nline 5\n\
                        line 6\nline 7\nline 8\nline 9\nline 10\nline 11\nline 12\n\
                        line 13\nfinal line\n";
        commit_file(&dir, "README", baseline, "baseline");

        let modified = "RIVAL third conflicting change (hunk A)\nline 2\nline 3\nline 4\n\
                        line 5\nline 6\nline 7\nline 8\nline 9\nline 10\nline 11\nline 12\n\
                        line 13\nfinal line (hunk B)\n";
        fs::write(dir.join("README"), modified).unwrap();

        let diff = diff_file(&dir, "README").unwrap();
        let hunk_a = diff
            .lines
            .iter()
            .find(|line| {
                matches!(line.origin, DiffLineOrigin::Addition) && line.content.contains("hunk A")
            })
            .unwrap();

        stage_file_lines(
            &dir,
            "README",
            &[HunkSelection {
                line_indices: vec![hunk_a.index],
            }],
        )
        .unwrap();

        let expected = "RIVAL third conflicting change (hunk A)\nline 2\nline 3\nline 4\n\
                        line 5\nline 6\nline 7\nline 8\nline 9\nline 10\nline 11\nline 12\n\
                        line 13\nfinal line\n";
        assert_eq!(staged_blob_content(&dir, "README"), expected);
        fs::remove_dir_all(&dir).ok();
    }

    fn head_oid(dir: &Path) -> Oid {
        let repo = open_repo(dir).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        head.id()
    }

    #[test]
    fn commit_diff_reports_files_of_a_commit() {
        let dir = scratch_repo("commit-diff");
        commit_file(&dir, "README", "one\n", "baseline");
        commit_file(&dir, "notes.md", "hello\nworld\n", "add notes");
        let head = head_oid(&dir);

        let diffs = commit_diff(&dir, &head.to_string()).unwrap();
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "notes.md");
        assert_eq!(diffs[0].status, FileStatusKind::Added);
        assert_eq!(diffs[0].added, 2);
        assert_eq!(diffs[0].deleted, 0);

        assert_eq!(diffs[0].lines[0].index, 0);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn commit_diff_of_root_commit_diffs_against_empty_tree() {
        let dir = scratch_repo("commit-diff-root");
        commit_file(&dir, "README", "one\ntwo\n", "baseline");
        let head = head_oid(&dir);

        let diffs = commit_diff(&dir, &head.to_string()).unwrap();
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0].path, "README");
        assert_eq!(diffs[0].added, 2);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reset_soft_moves_head_and_keeps_changes_staged() {
        let dir = scratch_repo("reset-soft");
        commit_file(&dir, "README", "one\n", "first");
        let first = head_oid(&dir);
        commit_file(&dir, "README", "one\ntwo\n", "second");

        reset_soft(&dir, &first.to_string()).unwrap();
        assert_eq!(head_oid(&dir), first);

        let statuses = list_statuses(&dir).unwrap();
        let readme = statuses.iter().find(|s| s.path == "README").unwrap();
        assert_eq!(readme.status, FileStatusKind::Modified);
        assert!(readme.staged);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn revert_commit_creates_inverse_commit() {
        let dir = scratch_repo("revert");
        commit_file(&dir, "README", "one\n", "first");
        commit_file(&dir, "README", "one\ntwo\n", "second");

        let reverted = revert_commit(
            &dir,
            &head_oid(&dir).to_string(),
            &Author {
                name: "QA".to_string(),
                email: "qa@gitnotes.test".to_string(),
            },
        )
        .unwrap();
        assert!(reverted.summary.starts_with("Revert \"second\""));
        assert_eq!(fs::read_to_string(dir.join("README")).unwrap(), "one\n");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn revert_commit_rejects_dirty_tree() {
        let dir = scratch_repo("revert-dirty");
        commit_file(&dir, "README", "one\n", "first");
        fs::write(dir.join("README"), "one\nstaged-later\n").unwrap();

        let result = revert_commit(
            &dir,
            &head_oid(&dir).to_string(),
            &Author {
                name: "QA".to_string(),
                email: "qa@gitnotes.test".to_string(),
            },
        );
        assert!(matches!(result, Err(EngineError::Invalid(_))));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rename_branch_renames_local_branch() {
        let dir = scratch_repo("rename-branch");
        commit_file(&dir, "README", "one\n", "first");
        create_branch(&dir, "qa-branch", None).unwrap();

        let renamed = rename_branch(&dir, "qa-branch", "qa-renamed").unwrap();
        assert_eq!(renamed.name, "qa-renamed");

        let names: Vec<String> = list_branches(&dir, "origin")
            .unwrap()
            .into_iter()
            .filter(|b| !b.is_remote)
            .map(|b| b.name)
            .collect();
        assert!(names.contains(&"qa-renamed".to_string()));
        assert!(!names.contains(&"qa-branch".to_string()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn set_remote_url_updates_the_url() {
        let dir = scratch_repo("set-url");
        add_remote(&dir, "origin", "file:///tmp/one.git").unwrap();
        set_remote_url(&dir, "origin", "file:///tmp/two.git").unwrap();

        let remotes = list_remotes(&dir).unwrap();
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].url.as_deref(), Some("file:///tmp/two.git"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolves_configured_upstream_branch() {
        let dir = scratch_repo("upstream-branch");
        let repo = open_repo(&dir).unwrap();
        repo.config()
            .unwrap()
            .set_str("branch.main.merge", "refs/heads/master")
            .unwrap();

        assert_eq!(
            configured_merge_branch(&repo, "main"),
            Some("master".to_string())
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn status_counts_commits_against_configured_upstream_branch() {
        let dir = scratch_repo("upstream-status");
        {
            let repo = open_repo(&dir).unwrap();
            repo.set_head("refs/heads/main").unwrap();
            repo.config()
                .unwrap()
                .set_str("branch.main.merge", "refs/heads/master")
                .unwrap();
        }
        add_remote(&dir, "origin", "file:///tmp/origin.git").unwrap();
        commit_file(&dir, "README", "one\n", "first");
        let upstream = head_oid(&dir);
        {
            let repo = open_repo(&dir).unwrap();
            repo.reference("refs/remotes/origin/master", upstream, true, "test")
                .unwrap();
        }
        commit_file(&dir, "README", "one\ntwo\n", "second");

        let status = repo_status("test", &dir).unwrap();
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 0);
        fs::remove_dir_all(&dir).ok();
    }

    /// Replica of the app's todo-delete flow for a COMMITTED file:
    /// worktree file removed first (FileSystem.deleteAsync), then
    /// `remove_paths` (git rm). The deletion must surface as a staged
    /// "Deleted" entry so the Changes tab lists it.
    #[test]
    fn remove_paths_stages_deletion_of_committed_file() {
        let dir = scratch_repo("rm-committed");
        fs::create_dir_all(dir.join("todos")).unwrap();
        commit_file(&dir, "todos/a.json", "{}", "add todo");

        fs::remove_file(dir.join("todos/a.json")).unwrap();
        remove_paths(&dir, &["todos/a.json".to_string()], false).unwrap();

        let statuses = list_statuses(&dir).unwrap();
        let entry = statuses.iter().find(|s| s.path == "todos/a.json");
        assert!(entry.is_some(), "deletion must be visible in statuses");
        let entry = entry.unwrap();
        assert_eq!(entry.status, FileStatusKind::Deleted);
        assert!(entry.staged);
        fs::remove_dir_all(&dir).ok();
    }

    /// Replica of the app's todo-delete flow for a file that was staged
    /// (CloneSyncService.save upsert) but never committed: the delete
    /// cancels the staged add, leaving no Changes-tab entry.
    #[test]
    fn remove_paths_after_uncommitted_stage_leaves_no_status() {
        let dir = scratch_repo("rm-uncommitted");
        fs::create_dir_all(dir.join("todos")).unwrap();
        fs::write(dir.join("todos/a.json"), "{}").unwrap();
        stage_paths(&dir, &["todos/a.json".to_string()]).unwrap();

        fs::remove_file(dir.join("todos/a.json")).unwrap();
        remove_paths(&dir, &["todos/a.json".to_string()], false).unwrap();

        let statuses = list_statuses(&dir).unwrap();
        assert!(statuses.iter().all(|s| s.path != "todos/a.json"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stage_paths_replaces_a_partial_index_without_patch_failure() {
        let dir = scratch_repo("stage-all-after-partial");
        commit_file(&dir, "README", "one\ntwo\nthree\n", "baseline");

        fs::write(dir.join("README"), "one\nselected\nthree\n").unwrap();
        let diff = diff_file(&dir, "README").unwrap();
        let selected = diff
            .lines
            .iter()
            .find(|line| {
                matches!(line.origin, DiffLineOrigin::Addition) && line.content.contains("selected")
            })
            .unwrap();
        stage_file_lines(
            &dir,
            "README",
            &[HunkSelection {
                line_indices: vec![selected.index],
            }],
        )
        .unwrap();

        fs::write(dir.join("README"), "one\nselected\nthree\nfinal\n").unwrap();
        stage_paths(&dir, &["README".to_string()]).unwrap();

        assert_eq!(
            staged_blob_content(&dir, "README"),
            "one\nselected\nthree\nfinal\n"
        );
        let statuses = list_statuses(&dir).unwrap();
        assert_eq!(statuses.len(), 1);
        assert!(statuses[0].staged);
        assert!(statuses[0].workdir_status.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn checkout_commit_detaches_head_and_requires_clean_tree() {
        let dir = scratch_repo("checkout-commit");
        commit_file(&dir, "README", "one\n", "first");
        let first = head_oid(&dir);
        commit_file(&dir, "README", "one\ntwo\n", "second");
        let second = head_oid(&dir);

        checkout_commit(&dir, &first.to_string()).unwrap();
        let repo = open_repo(&dir).unwrap();
        assert!(!repo.head().unwrap().is_branch());
        assert_eq!(fs::read_to_string(dir.join("README")).unwrap(), "one\n");

        fs::write(dir.join("README"), "dirty\n").unwrap();
        let result = checkout_commit(&dir, &second.to_string());
        assert!(matches!(result, Err(EngineError::Invalid(_))));
        fs::remove_dir_all(&dir).ok();
    }
}
