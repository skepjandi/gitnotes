//! Remote repository operations (pure git2): clone, fetch, pull (fast-forward
//! or merge via merge analysis), and push with non-fast-forward detection.
//!
//! Ported from GitSync (`clone_repository` 819, `fetch_remote` 2202,
//! `pull_changes` 2311, `push_changes` 2576). All network ops stream
//! `ProgressEvent`s and run under the per-repo flock.

use std::path::Path;
use std::sync::{Arc, Mutex};

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    AnnotatedCommit, FetchOptions, Index, MergeOptions, PushOptions, RebaseOptions,
    RemoteCallbacks, Repository,
};

use crate::api::types::{
    ConflictEntry, ConflictFile, CredentialSource, ProgressEvent, ProgressKind, PullKind,
    PullResult, PushIntegrateKind, PushIntegrateResult, PushResult,
};
use crate::engine::credentials::{callbacks_from, capture_push_rejections};
use crate::engine::error::{EngineError, Result};
use crate::engine::lock::run_with_lock;
use crate::engine::ops::{configured_merge_branch, open_repo};
use crate::engine::timeout::{configure_network_timeouts, StallDetector, STALL_TIMEOUT_SECS};

/// Clone `url` into `dest`, streaming transfer/sideband/checkout progress.
pub fn clone_repo(
    url: &str,
    dest: &Path,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<()> {
    // Remove any pre-existing directory so clone starts clean.
    if dest.exists() {
        std::fs::remove_dir_all(dest)?;
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let on_progress = Arc::new(Mutex::new(on_progress));

    let transfer_sink = Arc::clone(&on_progress);
    let callbacks = progress_callbacks(source, move |event| transfer_sink.lock().unwrap()(event));
    let mut fetch_options = FetchOptions::new();
    fetch_options.remote_callbacks(callbacks);

    let checkout_sink = Arc::clone(&on_progress);
    let mut checkout = CheckoutBuilder::new();
    checkout.progress(move |path, completed, total| {
        let percent = (completed as u64)
            .checked_mul(100)
            .and_then(|scaled| scaled.checked_div(total.max(1) as u64))
            .unwrap_or(0) as u32;
        checkout_sink.lock().unwrap()(ProgressEvent {
            kind: ProgressKind::Checkout,
            text: path.map(|p| p.display().to_string()).unwrap_or_default(),
            received: completed as u64,
            indexed: completed as u64,
            total: total as u64,
            percent,
        });
    });

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_options);
    builder.with_checkout(checkout);
    builder.clone(url, dest).map_err(EngineError::Git)?;
    Ok(())
}

/// Fetch `remote_name` into the repo at `path`, streaming progress events.
pub fn fetch_repo(
    path: &Path,
    remote_name: &str,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<()> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        configure_network_timeouts(&repo);
        let callbacks = progress_callbacks(source, on_progress);
        let mut fetch_options = FetchOptions::new();
        fetch_options.prune(git2::FetchPrune::On);
        fetch_options.update_fetchhead(true);
        fetch_options.download_tags(git2::AutotagOption::All);
        fetch_options.remote_callbacks(callbacks);

        let mut remote = repo.find_remote(remote_name)?;
        remote
            .fetch::<&str>(&[], Some(&mut fetch_options), None)
            .map_err(EngineError::Git)
    })
}

/// Fetch + integrate remote changes into the current branch.
///
/// Fast-forwards when the analysis allows it, otherwise performs a real merge
/// via `merge_analysis`/`merge_trees`. On conflict the repository is left in a
/// resolvable merge state and `PullResult::Conflict` (with entries) is
/// returned. Refuses to integrate when the working tree is dirty.
pub fn pull_repo(
    path: &Path,
    remote_name: &str,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<PullResult> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        configure_network_timeouts(&repo);
        fetch_repo_unlocked(&repo, remote_name, source, on_progress)?;

        let head = match repo.head() {
            Ok(head) => head,
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                return Ok(PullResult {
                    kind: PullKind::Unborn,
                    message: "unborn HEAD: nothing to pull".to_string(),
                    conflicts: Vec::new(),
                });
            }
            Err(e) => return Err(EngineError::Git(e)),
        };
        let Some(branch) = head.shorthand().ok() else {
            return Ok(PullResult {
                kind: PullKind::NoUpstream,
                message: "detached HEAD: cannot pull".to_string(),
                conflicts: Vec::new(),
            });
        };
        let tracking = format!("refs/remotes/{}/{}", remote_name, branch);
        let tracking_ref = match repo.find_reference(&tracking) {
            Ok(reference) => reference,
            Err(e) if e.code() == git2::ErrorCode::NotFound => {
                let Some(upstream_branch) = configured_merge_branch(&repo, branch) else {
                    return Ok(PullResult {
                        kind: PullKind::NoUpstream,
                        message: format!("no upstream tracking ref {}", tracking),
                        conflicts: Vec::new(),
                    });
                };
                let fallback_tracking = format!("refs/remotes/{}/{}", remote_name, upstream_branch);
                match repo.find_reference(&fallback_tracking) {
                    Ok(reference) => reference,
                    Err(fallback_error) if fallback_error.code() == git2::ErrorCode::NotFound => {
                        return Ok(PullResult {
                            kind: PullKind::NoUpstream,
                            message: format!("no upstream tracking ref {}", tracking),
                            conflicts: Vec::new(),
                        });
                    }
                    Err(fallback_error) => return Err(EngineError::Git(fallback_error)),
                }
            }
            Err(e) => return Err(EngineError::Git(e)),
        };
        let fetch_commit = repo.reference_to_annotated_commit(&tracking_ref)?;
        let (analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if analysis.is_up_to_date() {
            return Ok(PullResult {
                kind: PullKind::UpToDate,
                message: "already up to date".to_string(),
                conflicts: Vec::new(),
            });
        }

        let has_local_changes = has_local_changes(&repo)?;

        if analysis.is_fast_forward() {
            if has_local_changes {
                return Ok(PullResult {
                    kind: PullKind::Dirty,
                    message: "working tree has uncommitted changes; fast-forward skipped"
                        .to_string(),
                    conflicts: Vec::new(),
                });
            }
            fast_forward(&repo, &tracking, &fetch_commit, branch)?;
            return Ok(PullResult {
                kind: PullKind::FastForward,
                message: format!("fast-forwarded {} to {}", branch, fetch_commit.id()),
                conflicts: Vec::new(),
            });
        }

        if analysis.is_normal() {
            if has_local_changes {
                return Ok(PullResult {
                    kind: PullKind::Dirty,
                    message: "working tree has uncommitted changes; merge skipped".to_string(),
                    conflicts: Vec::new(),
                });
            }
            let mut merge_options = MergeOptions::new();
            merge_options.find_renames(true);
            let mut checkout = CheckoutBuilder::new();
            checkout.allow_conflicts(true);
            checkout.conflict_style_merge(true);
            checkout.force();
            repo.merge(
                &[&fetch_commit],
                Some(&mut merge_options),
                Some(&mut checkout),
            )
            .map_err(EngineError::Git)?;

            let mut index = repo.index()?;
            if index.has_conflicts() {
                let conflicts: Vec<ConflictEntry> = index
                    .conflicts()
                    .ok()
                    .map(|iter| {
                        iter.flatten()
                            .filter_map(|c| {
                                c.our
                                    .as_ref()
                                    .or(c.their.as_ref())
                                    .or(c.ancestor.as_ref())
                                    .map(|entry| ConflictEntry {
                                        path: String::from_utf8_lossy(&entry.path).into_owned(),
                                        ours: c.our.as_ref().map(|e| e.id.to_string()),
                                        theirs: c.their.as_ref().map(|e| e.id.to_string()),
                                        ancestor: c.ancestor.as_ref().map(|e| e.id.to_string()),
                                        status: "unresolved".to_string(),
                                    })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                return Ok(PullResult {
                    kind: PullKind::Conflict,
                    message: format!(
                        "merge of {} produced {} conflicts",
                        tracking,
                        conflicts.len()
                    ),
                    conflicts,
                });
            }

            let tree = repo.find_tree(index.write_tree()?)?;
            let head_commit = repo.head()?.peel_to_commit()?;
            let remote_commit = repo.find_commit(fetch_commit.id())?;
            let signature = repo
                .signature()
                .or_else(|_| git2::Signature::now("GitNotes", "gitnotes@local"))?;
            let message = format!(
                "Merge remote-tracking branch '{}' into {}",
                tracking, branch
            );
            repo.commit(
                Some("HEAD"),
                &signature,
                &signature,
                &message,
                &tree,
                &[&head_commit, &remote_commit],
            )?;
            repo.cleanup_state().ok();
            return Ok(PullResult {
                kind: PullKind::Merged,
                message: format!("merged {} into {}", tracking, branch),
                conflicts: Vec::new(),
            });
        }

        Ok(PullResult {
            kind: PullKind::NoUpstream,
            message: "merge analysis yielded no applicable action".to_string(),
            conflicts: Vec::new(),
        })
    })
}

/// Push the current branch to `remote_name`.
///
/// `force` is engine-internal API parity only — no UI path in the app ever
/// sets it (force-push stays forbidden at the app level). Non-fast-forward
/// rejections are detected via `ErrorCode::NotFastForward` and the
/// `push_update_reference` callback and reported as `PushResult`.
pub fn push_repo(
    path: &Path,
    remote_name: &str,
    source: Option<&CredentialSource>,
    force: bool,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<PushResult> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        configure_network_timeouts(&repo);
        push_repo_unlocked(&repo, remote_name, source, on_progress, force)
    })
}

/// Push helper running on an already-open repo (the caller holds the flock).
fn push_repo_unlocked(
    repo: &Repository,
    remote_name: &str,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
    force: bool,
) -> Result<PushResult> {
    let mut remote = repo.find_remote(remote_name)?;
    let head = repo.head()?;
    if !head.is_branch() {
        return Err(EngineError::Invalid(
            "cannot push: HEAD is detached; check out a branch first".to_string(),
        ));
    }
    let branch = head.shorthand()?;
    let refname = format!("refs/heads/{}", branch);
    let remote_branch = configured_merge_branch(repo, branch).unwrap_or_else(|| branch.to_string());
    // Force-push is engine-internal API parity only (never set by any UI
    // path in the app); implemented as a `+` refspec, the libgit2-native
    // way of forcing a push without a lease.
    let push_spec = if force {
        format!("+{}:refs/heads/{}", refname, remote_branch)
    } else if remote_branch == branch {
        refname.clone()
    } else {
        format!("{}:refs/heads/{}", refname, remote_branch)
    };

    let mut callbacks = progress_callbacks(source, on_progress);
    let captured = capture_push_rejections(&mut callbacks);
    let mut push_options = PushOptions::new();
    push_options.remote_callbacks(callbacks);

    match remote.push(&[&push_spec], Some(&mut push_options)) {
        Ok(()) => {
            if let Some(msg) = captured.lock().unwrap().take() {
                return Err(EngineError::Other(format!("push rejected: {}", msg)));
            }
            Ok(PushResult {
                pushed: true,
                non_fast_forward: false,
                message: format!("pushed {} to {}/{}", refname, remote_name, remote_branch),
            })
        }
        Err(e) if e.code() == git2::ErrorCode::NotFastForward => Ok(PushResult {
            pushed: false,
            non_fast_forward: true,
            message: format!(
                "non-fast-forward: {} is behind its remote counterpart (rejected: {})",
                branch,
                e.message()
            ),
        }),
        Err(e) => Err(EngineError::Git(e)),
    }
}

/// Outcome of the rebase step of `push_with_integrate`.
enum RebaseOutcome {
    Conflicted,
    Failed(EngineError),
}

impl From<git2::Error> for RebaseOutcome {
    fn from(error: git2::Error) -> Self {
        RebaseOutcome::Failed(EngineError::Git(error))
    }
}

/// Replay the local commits that diverge from `remote_tip` on top of it using
/// `git2::Rebase`. On a conflict the rebase is aborted (restoring the
/// pre-rebase state) and `RebaseOutcome::Conflicted` is returned.
fn rebase_onto_remote(
    repo: &Repository,
    remote_tip: &AnnotatedCommit,
) -> std::result::Result<(), RebaseOutcome> {
    let mut rebase_options = RebaseOptions::new();
    let mut merge_opts = MergeOptions::new();
    merge_opts.find_renames(true);
    rebase_options.merge_options(merge_opts);
    rebase_options.checkout_options(CheckoutBuilder::new());

    let mut rebase = repo.rebase(None, Some(remote_tip), None, Some(&mut rebase_options))?;
    loop {
        match rebase.next() {
            Some(Ok(_operation)) => {
                if repo.index()?.has_conflicts() {
                    rebase.abort()?;
                    return Err(RebaseOutcome::Conflicted);
                }
                let signature = repo
                    .signature()
                    .or_else(|_| git2::Signature::now("GitNotes", "gitnotes@local"))?;
                rebase.commit(None, &signature, None)?;
            }
            Some(Err(e)) if e.code() == git2::ErrorCode::Unmerged => {
                rebase.abort()?;
                return Err(RebaseOutcome::Conflicted);
            }
            Some(Err(e)) => return Err(RebaseOutcome::Failed(EngineError::Git(e))),
            None => break,
        }
    }
    rebase.finish(None)?;
    Ok(())
}

/// Conflict entries as `ConflictFile` (base/ours/theirs blob ids).
fn conflict_files(index: &Index) -> Result<Vec<ConflictFile>> {
    let mut out = Vec::new();
    if let Ok(iter) = index.conflicts() {
        for conflict in iter.flatten() {
            let path = conflict
                .our
                .as_ref()
                .or(conflict.their.as_ref())
                .or(conflict.ancestor.as_ref())
                .map(|entry| String::from_utf8_lossy(&entry.path).into_owned())
                .unwrap_or_default();
            out.push(ConflictFile {
                path,
                base: conflict.ancestor.as_ref().map(|entry| entry.id.to_string()),
                ours: conflict.our.as_ref().map(|entry| entry.id.to_string()),
                theirs: conflict.their.as_ref().map(|entry| entry.id.to_string()),
            });
        }
    }
    Ok(out)
}

/// Reusable forwarding sink so `on_progress` can be shared across the
/// fetch/push phases of one `push_with_integrate` op.
fn forward_progress<F: FnMut(ProgressEvent) + 'static>(
    sink: &Arc<Mutex<F>>,
) -> impl FnMut(ProgressEvent) + 'static {
    let sink = Arc::clone(sink);
    move |event: ProgressEvent| sink.lock().unwrap()(event)
}

/// Push the current branch, transparently integrating when the remote rejects
/// a non-fast-forward push: fetch the remote tip, rebase local commits onto it
/// (via `merge_analysis`, falling back to a merge when the rebase conflicts),
/// then push again.
///
/// Returns `PushIntegrateResult`; on real conflicts the repo is left in a
/// resolvable merge-conflict state (`get_conflicts`) and the conflicted paths
/// are reported. Force-push is never used. Refuses to integrate over a dirty
/// working tree.
pub fn push_with_integrate(
    path: &Path,
    remote_name: &str,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<PushIntegrateResult> {
    run_with_lock(path, || {
        let repo = open_repo(path)?;
        configure_network_timeouts(&repo);
        let sink = Arc::new(Mutex::new(on_progress));

        let plain =
            |kind: PushIntegrateKind, integrated: bool, message: String| -> PushIntegrateResult {
                PushIntegrateResult {
                    pushed: false,
                    integrated,
                    kind,
                    conflicts: Vec::new(),
                    message,
                }
            };

        let initial =
            push_repo_unlocked(&repo, remote_name, source, forward_progress(&sink), false)?;
        if initial.pushed {
            return Ok(PushIntegrateResult {
                pushed: true,
                integrated: false,
                kind: PushIntegrateKind::Direct,
                conflicts: Vec::new(),
                message: initial.message,
            });
        }
        if !initial.non_fast_forward {
            return Ok(plain(PushIntegrateKind::None, false, initial.message));
        }

        if has_local_changes(&repo)? {
            return Ok(plain(
                PushIntegrateKind::None,
                false,
                "non-fast-forward push rejected; the working tree has uncommitted changes, so integration was skipped"
                    .to_string(),
            ));
        }

        fetch_repo_unlocked(&repo, remote_name, source, forward_progress(&sink))?;

        let head = repo.head()?;
        if !head.is_branch() {
            return Err(EngineError::Invalid(
                "cannot integrate: HEAD is detached; check out a branch first".to_string(),
            ));
        }
        let branch = head.shorthand()?.to_string();
        let upstream_branch =
            configured_merge_branch(&repo, &branch).unwrap_or_else(|| branch.clone());
        let tracking = format!("refs/remotes/{}/{}", remote_name, upstream_branch);
        let tracking_ref = match repo.find_reference(&tracking) {
            Ok(reference) => reference,
            Err(e) if e.code() == git2::ErrorCode::NotFound => {
                return Ok(plain(
                    PushIntegrateKind::None,
                    false,
                    format!(
                        "no upstream tracking ref {} after fetch; integration skipped",
                        tracking
                    ),
                ));
            }
            Err(e) => return Err(EngineError::Git(e)),
        };
        let remote_tip = repo.reference_to_annotated_commit(&tracking_ref)?;
        let (analysis, _) = repo.merge_analysis(&[&remote_tip])?;

        if analysis.is_up_to_date() {
            return Ok(plain(
                PushIntegrateKind::None,
                true,
                "already up to date with the remote".to_string(),
            ));
        }
        if analysis.is_fast_forward() {
            fast_forward(&repo, &tracking, &remote_tip, &branch)?;
            return Ok(plain(
                PushIntegrateKind::FastForward,
                true,
                format!("fast-forwarded {} to {}", branch, remote_tip.id()),
            ));
        }

        match rebase_onto_remote(&repo, &remote_tip) {
            Ok(()) => {
                let repush =
                    push_repo_unlocked(&repo, remote_name, source, forward_progress(&sink), false)?;
                Ok(PushIntegrateResult {
                    pushed: repush.pushed,
                    integrated: true,
                    kind: PushIntegrateKind::Rebased,
                    conflicts: Vec::new(),
                    message: if repush.pushed {
                        format!("rebased {} onto {} and pushed", branch, remote_tip.id())
                    } else {
                        format!(
                            "rebased {} onto {} but the re-push was rejected: {}",
                            branch,
                            remote_tip.id(),
                            repush.message
                        )
                    },
                })
            }
            Err(RebaseOutcome::Conflicted) => {
                let mut merge_options = MergeOptions::new();
                merge_options.find_renames(true);
                let mut checkout = CheckoutBuilder::new();
                checkout.allow_conflicts(true);
                checkout.conflict_style_merge(true);
                checkout.force();
                repo.merge(
                    &[&remote_tip],
                    Some(&mut merge_options),
                    Some(&mut checkout),
                )
                .map_err(EngineError::Git)?;

                let mut index = repo.index()?;
                if index.has_conflicts() {
                    let conflicts = conflict_files(&index)?;
                    let count = conflicts.len();
                    return Ok(PushIntegrateResult {
                        pushed: false,
                        integrated: false,
                        kind: PushIntegrateKind::Conflicts,
                        conflicts,
                        message: format!(
                            "non-fast-forward push: integration produced {} conflicted file(s)",
                            count
                        ),
                    });
                }

                let tree = repo.find_tree(index.write_tree()?)?;
                let head_commit = repo.head()?.peel_to_commit()?;
                let remote_commit = repo.find_commit(remote_tip.id())?;
                let signature = repo
                    .signature()
                    .or_else(|_| git2::Signature::now("GitNotes", "gitnotes@local"))?;
                let merge_message = format!(
                    "Merge remote-tracking branch '{}' into {}",
                    tracking, branch
                );
                repo.commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    &merge_message,
                    &tree,
                    &[&head_commit, &remote_commit],
                )?;
                repo.cleanup_state().ok();

                let repush =
                    push_repo_unlocked(&repo, remote_name, source, forward_progress(&sink), false)?;
                Ok(PushIntegrateResult {
                    pushed: repush.pushed,
                    integrated: true,
                    kind: PushIntegrateKind::Merged,
                    conflicts: Vec::new(),
                    message: if repush.pushed {
                        format!("merged {} into {} and pushed", tracking, branch)
                    } else {
                        format!(
                            "merged {} into {} but the re-push was rejected: {}",
                            tracking, branch, repush.message
                        )
                    },
                })
            }
            Err(RebaseOutcome::Failed(e)) => Err(e),
        }
    })
}

fn fetch_repo_unlocked(
    repo: &Repository,
    remote_name: &str,
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> Result<()> {
    configure_network_timeouts(repo);
    let callbacks = progress_callbacks(source, on_progress);
    let mut fetch_options = FetchOptions::new();
    fetch_options.prune(git2::FetchPrune::On);
    fetch_options.update_fetchhead(true);
    fetch_options.download_tags(git2::AutotagOption::All);
    fetch_options.remote_callbacks(callbacks);

    let mut remote = repo.find_remote(remote_name)?;
    remote
        .fetch::<&str>(&[], Some(&mut fetch_options), None)
        .map_err(EngineError::Git)
}

fn fast_forward(
    repo: &Repository,
    tracking_ref: &str,
    fetch_commit: &AnnotatedCommit,
    branch: &str,
) -> Result<()> {
    let refname = format!("refs/heads/{}", branch);
    let mut reference = repo.find_reference(&refname)?;
    reference.set_target(
        fetch_commit.id(),
        &format!("Fast-Forward: {} to {}", tracking_ref, fetch_commit.id()),
    )?;
    repo.set_head(&refname)?;
    let mut checkout = CheckoutBuilder::default();
    checkout.allow_conflicts(true);
    checkout.conflict_style_merge(true);
    checkout.force();
    repo.checkout_head(Some(&mut checkout))
        .map_err(EngineError::Git)
}

fn has_local_changes(repo: &Repository) -> Result<bool> {
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true);
    opts.include_ignored(false);
    opts.update_index(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    let relevant = git2::Status::INDEX_NEW
        | git2::Status::INDEX_MODIFIED
        | git2::Status::INDEX_DELETED
        | git2::Status::WT_NEW
        | git2::Status::WT_MODIFIED
        | git2::Status::WT_DELETED
        | git2::Status::CONFLICTED;
    Ok(statuses
        .iter()
        .any(|entry| entry.status().intersects(relevant)))
}

/// Build remote callbacks with credentials + transfer/sideband/push progress.
fn progress_callbacks(
    source: Option<&CredentialSource>,
    on_progress: impl FnMut(ProgressEvent) + 'static,
) -> RemoteCallbacks<'static> {
    let mut callbacks = callbacks_from(source);
    let on_progress = Arc::new(Mutex::new(on_progress));
    let stall = Arc::new(StallDetector::new(STALL_TIMEOUT_SECS));

    let transfer_sink = Arc::clone(&on_progress);
    let stall_clone = Arc::clone(&stall);
    callbacks.transfer_progress(move |stats| {
        let total = stats.total_objects() as u64;
        let percent = (stats.indexed_objects() as u64)
            .checked_mul(100)
            .and_then(|scaled| scaled.checked_div(total))
            .unwrap_or(0) as u32;
        transfer_sink.lock().unwrap()(ProgressEvent {
            kind: ProgressKind::Transfer,
            text: String::new(),
            received: stats.received_bytes() as u64,
            indexed: stats.indexed_objects() as u64,
            total,
            percent,
        });
        stall_clone.check(stats.received_bytes() as u64)
    });

    let sideband_sink = Arc::clone(&on_progress);
    callbacks.sideband_progress(move |msg| {
        sideband_sink.lock().unwrap()(ProgressEvent {
            kind: ProgressKind::Sideband,
            text: String::from_utf8_lossy(msg).trim_end().to_string(),
            received: 0,
            indexed: 0,
            total: 0,
            percent: 0,
        });
        true
    });

    let push_sink = Arc::clone(&on_progress);
    callbacks.push_transfer_progress(move |current, total, _bytes| {
        let percent = (current)
            .checked_mul(100)
            .and_then(|scaled| scaled.checked_div(total.max(1)))
            .unwrap_or(0) as u32;
        push_sink.lock().unwrap()(ProgressEvent {
            kind: ProgressKind::Push,
            text: String::new(),
            received: current as u64,
            indexed: 0,
            total: total as u64,
            percent,
        });
    });

    callbacks
}
