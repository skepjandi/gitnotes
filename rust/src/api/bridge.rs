//! UniFFI-exported facade (the FFI surface host apps bind against).

use std::path::PathBuf;
use std::sync::Arc;

use crate::api::types::{
    Author, BlobReadResult, BranchInfo, CommitInfo, ConflictBlobs, ConflictEntry, CredentialSource,
    FileDiff, FileHistoryResult, FileStatus, GeneratedKey, HunkSelection, ProgressEvent,
    PullResult, PushIntegrateResult, PushResult, RemoteInfo, RepairReport, RepoInfo, RepoStatus,
};
use crate::engine::{self, android_ca, EngineError};

/// Configure git2's SSL CA certificate file for Android.
///
/// This **must** be called from the host app's module-initialization entry point
/// (`OnCreate` / `applicationDidFinishLaunching`) **before** any engine operation
/// is dispatched. The Kotlin host builds a PEM bundle from the Android system CA
/// directories and passes the path here; on non-Android platforms the equivalent
/// bundle path from the host platform's CA store should be passed.
///
/// Returns `Ok(())` when the certificate file was configured successfully.
/// Returns `Err(BridgeError)` when `set_ssl_cert_file` failed.
#[uniffi::export]
pub fn set_ssl_cert_file(cert_file: String) -> Result<(), BridgeError> {
    let path = std::path::Path::new(&cert_file);
    android_ca::set_ssl_cert_file(path).map_err(|e| BridgeError::Other {
        message: e.to_string(),
        corruption: false,
    })
}

/// Sets the SSL certificate directory for Android.
///
/// On Android, this is preferred over `set_ssl_cert_file` because OpenSSL's
/// directory mode uses hash-based certificate lookup, which works directly
/// with Android's `/apex/com.android.conscrypt/cacerts` directory without
/// requiring a bundled PEM file.
///
/// This must be called from the host app's module-initialization entry point
/// (`OnCreate` / `applicationDidFinishLaunching`) **before** any engine operation
/// is dispatched.
#[uniffi::export]
pub fn set_ssl_cert_directory(cert_dir: String) -> Result<(), BridgeError> {
    let path = std::path::Path::new(&cert_dir);
    android_ca::set_ssl_cert_directory(path).map_err(|e| BridgeError::Other {
        message: e.to_string(),
        corruption: false,
    })
}

#[uniffi::export]
pub fn set_ssl_cert_locations(cert_file: String, cert_dir: String) -> Result<(), BridgeError> {
    let file_path = std::path::Path::new(&cert_file);
    let dir_path = std::path::Path::new(&cert_dir);
    let file_exists = file_path.exists();
    let dir_exists = dir_path.exists();
    android_ca::set_ssl_cert_locations(
        file_exists.then_some(file_path),
        dir_exists.then_some(dir_path),
    )
    .map_err(|e| BridgeError::Other {
        message: e.to_string(),
        corruption: false,
    })
}

/// Errors surfaced across the FFI boundary.
///
/// Kept separate from `EngineError` because UniFFI error types must be
/// `Clone` (git2 errors are not). Every variant carries `corruption`, set from
/// `EngineError::is_corruption_error`, so host apps can route corrupt-repo
/// failures into the repair flow.
#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum BridgeError {
    #[error("git error: {message}")]
    Git { message: String, corruption: bool },
    #[error("io error: {message}")]
    Io { message: String, corruption: bool },
    #[error("invalid input: {message}")]
    Invalid { message: String, corruption: bool },
    #[error("repository is busy: {message}")]
    Busy { message: String, corruption: bool },
    #[error("not a git repository: {path}")]
    NotARepository { path: String, corruption: bool },
    #[error("operation not supported: {message}")]
    Unsupported { message: String, corruption: bool },
    #[error("{message}")]
    Other { message: String, corruption: bool },
}

impl BridgeError {
    fn of(error: EngineError) -> Self {
        let corruption = error.is_corruption_error();
        match error {
            EngineError::Git(e) => BridgeError::Git {
                message: e.message().to_string(),
                corruption,
            },
            EngineError::Io(e) => BridgeError::Io {
                message: e.to_string(),
                corruption,
            },
            EngineError::Invalid(message) => BridgeError::Invalid {
                message,
                corruption,
            },
            EngineError::Busy(message) => BridgeError::Busy {
                message,
                corruption,
            },
            EngineError::NotARepository(path) => BridgeError::NotARepository { path, corruption },
            EngineError::Unsupported(message) => BridgeError::Unsupported {
                message,
                corruption,
            },
            EngineError::Other(message) => BridgeError::Other {
                message,
                corruption,
            },
        }
    }
}

impl From<EngineError> for BridgeError {
    fn from(error: EngineError) -> Self {
        Self::of(error)
    }
}

/// Progress sink implemented by the host app (Swift/Kotlin side).
///
/// Invoked from the worker thread running the git op; implementations must
/// hop to their own event-dispatch thread before touching UI/JS runtimes.
#[uniffi::export(foreign)]
pub trait ProgressListener: Send + Sync {
    fn on_progress(&self, event: ProgressEvent);
}

/// Crate/engine version string.
#[uniffi::export]
pub fn version() -> String {
    crate::version().to_string()
}

/// Stable engine identifier (`gitnotes-git2`).
#[uniffi::export]
pub fn engine_name() -> String {
    crate::ENGINE_NAME.to_string()
}

/// Whether another process currently holds the op lock for `path`.
#[uniffi::export]
pub fn is_repo_locked(path: String) -> bool {
    engine::ops::is_locked(std::path::Path::new(&path))
}

/// Register the credential the engine should use for `repo_id`'s remotes.
/// Subsequent remote ops (clone/fetch/pull/push) resolve it by repo id.
#[uniffi::export]
pub fn set_credential(repo_id: String, credential: CredentialSource) {
    engine::credentials::set_credential(&repo_id, credential);
}

/// Read back the registered credential for `repo_id` (for QA/debug screens).
#[uniffi::export]
pub fn get_credential(repo_id: String) -> Option<CredentialSource> {
    engine::credentials::get_credential(&repo_id)
}

/// Drop the registered credential for `repo_id`. Returns true when one was
/// present.
#[uniffi::export]
pub fn clear_credential(repo_id: String) -> bool {
    engine::credentials::clear_credential(&repo_id)
}

/// Generate an ed25519 SSH keypair, returning the public key (for the user to
/// add to a provider) and the private key PEM (optionally passphrase-encrypted).
#[uniffi::export]
pub fn generate_ssh_key(passphrase: Option<String>) -> Result<GeneratedKey, BridgeError> {
    let (private_key, public_key) = engine::keys::generate_ed25519_key(passphrase.as_deref())?;
    Ok(GeneratedKey {
        public_key,
        private_key,
    })
}

/// Clone `url` into `dest`, streaming progress to `listener`. Credentials come
/// from `credential_source` or the per-repo registry (`repo_id`).
#[uniffi::export]
pub fn clone_repo_with_progress(
    url: String,
    dest: String,
    repo_id: Option<String>,
    credential_source: Option<CredentialSource>,
    listener: Arc<dyn ProgressListener>,
) -> Result<String, BridgeError> {
    let dest_path = PathBuf::from(&dest);
    let source = engine::credentials::resolve(credential_source.as_ref(), repo_id.as_deref());
    engine::ops_remote::clone_repo(&url, &dest_path, source.as_ref(), move |event| {
        listener.on_progress(event);
    })?;
    Ok(dest)
}

/// Delete a repository working tree (guarded: only `.git`-bearing dirs).
#[uniffi::export]
pub fn remove_repo(path: String) -> Result<(), BridgeError> {
    engine::ops_repair::remove_repo(std::path::Path::new(&path))?;
    Ok(())
}

/// Initialise a new repository at `path` (`bare` = push-ready local remote).
#[uniffi::export]
pub fn init_repo(path: String, bare: bool) -> Result<(), BridgeError> {
    engine::ops_repair::init_repo(std::path::Path::new(&path), bare)?;
    Ok(())
}

/// High-level repo state (counts + ahead/behind + lock state).
#[uniffi::export]
pub fn repo_status(repo_id: String, path: String) -> Result<RepoStatus, BridgeError> {
    Ok(engine::ops::repo_status(
        &repo_id,
        std::path::Path::new(&path),
    )?)
}

/// Per-file working-tree statuses.
#[uniffi::export]
pub fn list_statuses(path: String) -> Result<Vec<FileStatus>, BridgeError> {
    Ok(engine::ops::list_statuses(std::path::Path::new(&path))?)
}

/// Combined file+line diff of the whole working tree.
#[uniffi::export]
pub fn diff_all(path: String) -> Result<Vec<FileDiff>, BridgeError> {
    Ok(engine::ops::diff_all(std::path::Path::new(&path))?)
}

/// Line-level diff of one file against HEAD.
#[uniffi::export]
pub fn diff_file(path: String, file_path: String) -> Result<FileDiff, BridgeError> {
    Ok(engine::ops::diff_file(
        std::path::Path::new(&path),
        &file_path,
    )?)
}

/// Stage (git add) the given paths.
#[uniffi::export]
pub fn stage_paths(path: String, paths: Vec<String>) -> Result<(), BridgeError> {
    engine::ops::stage_paths(std::path::Path::new(&path), &paths)?;
    Ok(())
}

/// Unstage (git reset HEAD) the given paths.
#[uniffi::export]
pub fn unstage_paths(path: String, paths: Vec<String>) -> Result<(), BridgeError> {
    engine::ops::unstage_paths(std::path::Path::new(&path), &paths)?;
    Ok(())
}

#[uniffi::export]
pub fn discard_files(path: String, paths: Vec<String>) -> Result<(), BridgeError> {
    engine::ops::discard_files(std::path::Path::new(&path), &paths)?;
    Ok(())
}

#[uniffi::export]
pub fn remove_paths(
    path: String,
    paths: Vec<String>,
    keep_worktree: bool,
) -> Result<(), BridgeError> {
    engine::ops::remove_paths(std::path::Path::new(&path), &paths, keep_worktree)?;
    Ok(())
}

/// LINE-LEVEL PARTIAL STAGING: stage only the selected diff lines.
#[uniffi::export]
pub fn stage_file_lines(
    path: String,
    file_path: String,
    hunks: Vec<HunkSelection>,
) -> Result<(), BridgeError> {
    engine::ops::stage_file_lines(std::path::Path::new(&path), &file_path, &hunks)?;
    Ok(())
}

/// Commit the staged index with `author` as identity.
#[uniffi::export]
pub fn commit_changes(
    path: String,
    message: String,
    author: Author,
) -> Result<CommitInfo, BridgeError> {
    Ok(engine::ops::commit_changes(
        std::path::Path::new(&path),
        &message,
        &author,
    )?)
}

/// Recent commit history.
#[uniffi::export]
pub fn recent_commits(path: String, skip: u32, limit: u32) -> Result<Vec<CommitInfo>, BridgeError> {
    Ok(engine::ops::recent_commits(
        std::path::Path::new(&path),
        skip,
        limit,
    )?)
}

/// Per-file diff of one commit against its first parent (`git show`-style).
#[uniffi::export]
pub fn commit_diff(path: String, commit_id: String) -> Result<Vec<FileDiff>, BridgeError> {
    Ok(engine::ops::commit_diff(
        std::path::Path::new(&path),
        &commit_id,
    )?)
}

/// File-scoped commit history: only commits touching `file_path` from `ref`.
#[uniffi::export]
pub fn file_history(
    path: String,
    rev: String,
    file_path: String,
    limit: u32,
    skip: u32,
) -> Result<FileHistoryResult, BridgeError> {
    Ok(engine::ops::file_history(
        std::path::Path::new(&path),
        &rev,
        &file_path,
        limit,
        skip,
    )?)
}

/// Read the blob at `file_path` for `ref` (commit/tag/branch). Returns typed
/// content or an explicit error (missing/binary/shallow/too-large).
#[uniffi::export]
pub fn read_blob_at_ref(
    path: String,
    rev: String,
    file_path: String,
) -> Result<BlobReadResult, BridgeError> {
    Ok(engine::ops::read_blob_at_ref(
        std::path::Path::new(&path),
        &rev,
        &file_path,
    )?)
}

/// Unresolved merge conflicts.
#[uniffi::export]
pub fn get_conflicts(path: String) -> Result<Vec<ConflictEntry>, BridgeError> {
    Ok(engine::ops::get_conflicts(std::path::Path::new(&path))?)
}

/// Resolve a conflicted path by staging the working-tree content.
#[uniffi::export]
pub fn resolve_conflict(path: String, file_path: String) -> Result<(), BridgeError> {
    engine::ops::resolve_conflict(std::path::Path::new(&path), &file_path)?;
    Ok(())
}

/// Text content of the conflict stages (base/ours/theirs) for one conflicted
/// file. Binary conflict content is rejected as unsupported.
#[uniffi::export]
pub fn get_conflict_blobs(path: String, file_path: String) -> Result<ConflictBlobs, BridgeError> {
    Ok(engine::ops_conflict::get_conflict_blobs(
        std::path::Path::new(&path),
        &file_path,
    )?)
}

/// Mark a conflicted path resolved: stage the working-tree content as final
/// (`index.add_path` + `index.write`), clearing its conflict state.
#[uniffi::export]
pub fn mark_conflict_resolved(path: String, file_path: String) -> Result<(), BridgeError> {
    engine::ops_conflict::mark_conflict_resolved(std::path::Path::new(&path), &file_path)?;
    Ok(())
}

/// Fetch `remote_name`, streaming progress to `listener`.
#[uniffi::export]
pub fn fetch_repo_with_progress(
    path: String,
    remote_name: String,
    repo_id: Option<String>,
    credential_source: Option<CredentialSource>,
    listener: Arc<dyn ProgressListener>,
) -> Result<(), BridgeError> {
    let source = engine::credentials::resolve(credential_source.as_ref(), repo_id.as_deref());
    engine::ops_remote::fetch_repo(
        std::path::Path::new(&path),
        &remote_name,
        source.as_ref(),
        move |event| listener.on_progress(event),
    )?;
    Ok(())
}

/// Fetch + integrate remote changes into the current branch.
#[uniffi::export]
pub fn pull_repo(
    path: String,
    remote_name: String,
    repo_id: Option<String>,
    credential_source: Option<CredentialSource>,
    listener: Arc<dyn ProgressListener>,
) -> Result<PullResult, BridgeError> {
    let source = engine::credentials::resolve(credential_source.as_ref(), repo_id.as_deref());
    Ok(engine::ops_remote::pull_repo(
        std::path::Path::new(&path),
        &remote_name,
        source.as_ref(),
        move |event| listener.on_progress(event),
    )?)
}

/// Push the current branch. `force` is engine-internal API parity only.
#[uniffi::export]
pub fn push_repo(
    path: String,
    remote_name: String,
    repo_id: Option<String>,
    credential_source: Option<CredentialSource>,
    force: bool,
    listener: Arc<dyn ProgressListener>,
) -> Result<PushResult, BridgeError> {
    let source = engine::credentials::resolve(credential_source.as_ref(), repo_id.as_deref());
    Ok(engine::ops_remote::push_repo(
        std::path::Path::new(&path),
        &remote_name,
        source.as_ref(),
        force,
        move |event| listener.on_progress(event),
    )?)
}

/// Push the current branch, fetching + integrating (rebase, or merge on rebase
/// conflicts) when the remote rejects a non-fast-forward push, then re-pushing.
#[uniffi::export]
pub fn push_repo_with_integrate(
    path: String,
    remote_name: String,
    repo_id: Option<String>,
    credential_source: Option<CredentialSource>,
    listener: Arc<dyn ProgressListener>,
) -> Result<PushIntegrateResult, BridgeError> {
    let source = engine::credentials::resolve(credential_source.as_ref(), repo_id.as_deref());
    Ok(engine::ops_remote::push_with_integrate(
        std::path::Path::new(&path),
        &remote_name,
        source.as_ref(),
        move |event| listener.on_progress(event),
    )?)
}

/// List local + remote branches with ahead/behind counts.
#[uniffi::export]
pub fn list_branches(path: String, remote_name: String) -> Result<Vec<BranchInfo>, BridgeError> {
    Ok(engine::ops::list_branches(
        std::path::Path::new(&path),
        &remote_name,
    )?)
}

/// Create a branch (from `source` or current HEAD) without switching.
#[uniffi::export]
pub fn create_branch(
    path: String,
    name: String,
    source: Option<String>,
) -> Result<BranchInfo, BridgeError> {
    Ok(engine::ops::create_branch(
        std::path::Path::new(&path),
        &name,
        source.as_deref(),
    )?)
}

/// Check out a branch, creating a tracking branch from the remote if needed.
#[uniffi::export]
pub fn checkout_branch(path: String, name: String, remote_name: String) -> Result<(), BridgeError> {
    engine::ops::checkout_branch(std::path::Path::new(&path), &name, &remote_name)?;
    Ok(())
}

/// Delete a local branch.
#[uniffi::export]
pub fn delete_branch(path: String, name: String) -> Result<(), BridgeError> {
    engine::ops::delete_branch(std::path::Path::new(&path), &name)?;
    Ok(())
}

/// Rename a local branch.
#[uniffi::export]
pub fn rename_branch(
    path: String,
    name: String,
    new_name: String,
) -> Result<BranchInfo, BridgeError> {
    Ok(engine::ops::rename_branch(
        std::path::Path::new(&path),
        &name,
        &new_name,
    )?)
}

/// Detach HEAD at a commit (requires a clean tracked tree).
#[uniffi::export]
pub fn checkout_commit(path: String, commit_id: String) -> Result<(), BridgeError> {
    engine::ops::checkout_commit(std::path::Path::new(&path), &commit_id)?;
    Ok(())
}

/// `git reset --soft` to a commit: moves HEAD, keeps index + working tree.
#[uniffi::export]
pub fn reset_soft(path: String, commit_id: String) -> Result<(), BridgeError> {
    engine::ops::reset_soft(std::path::Path::new(&path), &commit_id)?;
    Ok(())
}

/// `git revert` a commit and immediately commit the inverse change.
#[uniffi::export]
pub fn revert_commit(
    path: String,
    commit_id: String,
    author: Author,
) -> Result<CommitInfo, BridgeError> {
    Ok(engine::ops::revert_commit(
        std::path::Path::new(&path),
        &commit_id,
        &author,
    )?)
}

/// List configured remotes.
#[uniffi::export]
pub fn list_remotes(path: String) -> Result<Vec<RemoteInfo>, BridgeError> {
    Ok(engine::ops::list_remotes(std::path::Path::new(&path))?)
}

/// Add a remote.
#[uniffi::export]
pub fn add_remote(path: String, name: String, url: String) -> Result<(), BridgeError> {
    engine::ops::add_remote(std::path::Path::new(&path), &name, &url)?;
    Ok(())
}

/// Remove a remote.
#[uniffi::export]
pub fn remove_remote(path: String, name: String) -> Result<(), BridgeError> {
    engine::ops::remove_remote(std::path::Path::new(&path), &name)?;
    Ok(())
}

/// Update the URL of an existing remote (`git remote set-url`).
#[uniffi::export]
pub fn set_remote_url(path: String, name: String, url: String) -> Result<(), BridgeError> {
    engine::ops::set_remote_url(std::path::Path::new(&path), &name, &url)?;
    Ok(())
}

/// High-level repository metadata.
#[uniffi::export]
pub fn repo_info(path: String) -> Result<RepoInfo, BridgeError> {
    Ok(engine::ops::repo_info(std::path::Path::new(&path))?)
}

/// Repair a corrupted repository. Never auto-runs.
#[uniffi::export]
pub fn repair_repo(path: String) -> Result<RepairReport, BridgeError> {
    Ok(engine::ops_repair::repair_repo(std::path::Path::new(
        &path,
    ))?)
}

/// Rename a corrupt repo dir to `<name>-corrupt-backup-<ts>` (never delete).
#[uniffi::export]
pub fn backup_corrupt_repo(path: String) -> Result<String, BridgeError> {
    Ok(engine::ops_repair::backup_corrupt_repo(
        std::path::Path::new(&path),
    )?)
}
