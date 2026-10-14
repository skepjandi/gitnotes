//! Wire types shared between the Rust engine and host apps.
//!
//! All types derive `serde` + `Debug`/`Clone`/`PartialEq` so they can be
//! serialized for UniFFI record/error types and for the JS bridge.

use serde::{Deserialize, Serialize};

/// How a credential should be resolved for a git operation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Enum)]
pub enum CredentialSource {
    /// No credentials; only works for anonymous/public endpoints.
    None,
    /// HTTPS basic auth: PAT or OAuth token used as the password.
    UserPass { username: String, password: String },
    /// SSH keypair, loaded from memory (private key PEM text).
    SshKey {
        username: String,
        private_key: String,
        public_key: Option<String>,
        passphrase: Option<String>,
    },
    /// Let libgit2 try its default paths (ssh agent, config, credential helpers).
    Default,
    /// GitHub OAuth access token — used as a bearer for HTTPS auth.
    GitHubOAuth { token: String },
    /// GitHub App installation token scoped to selected repositories.
    GitHubAppInstallation { token: String },
}

/// Kind of a working-tree/index change for a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum FileStatusKind {
    Unmodified,
    Untracked,
    Added,
    Modified,
    Deleted,
    Renamed,
    TypeChange,
    Conflicted,
}

/// Per-file working-tree status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FileStatus {
    /// Repo-relative path, POSIX separators.
    pub path: String,
    pub status: FileStatusKind,
    /// True when the change is staged in the index.
    pub staged: bool,
    /// True when the path is involved in an unresolved merge conflict.
    pub conflicted: bool,
    /// Raw git2 index status code as a string (e.g. `INDEX_NEW|INDEX_MODIFIED`).
    pub index_status: String,
    /// Raw git2 workdir status code as a string (e.g. `WT_MODIFIED`).
    pub workdir_status: String,
}

/// High-level state of a repository after an op completes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct RepoStatus {
    /// Uuid of the repo as registered by the host app.
    pub repo_id: String,
    /// Absolute path to the repository working tree.
    pub path: String,
    /// Whether `path` contains a valid git repository.
    pub is_repo: bool,
    /// Current branch short name, if any.
    pub current_branch: Option<String>,
    /// Commits ahead of the upstream (pushed later).
    pub ahead: u32,
    /// Commits behind the upstream (pull needed).
    pub behind: u32,
    pub staged_count: u32,
    pub modified_count: u32,
    pub untracked_count: u32,
    pub conflicted_count: u32,
    /// True when another operation currently holds the per-repo lock.
    pub is_locked: bool,
    /// Short human text of the last failed op, if any.
    pub last_op_error: Option<String>,
}

/// Origin of a diff line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum DiffLineOrigin {
    Context,
    Addition,
    Deletion,
    ContextEof,
    AdditionEof,
    DeletionEof,
}

/// One line of a unified diff.
///
/// `content` carries the raw line bytes including the origin prefix
/// (`+`, `-`, ` `) and trailing newline, matching libgit2's `DiffLine`
/// content — the partial-staging path reconstructs file content by
/// concatenating these raw lines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct DiffLine {
    /// Index of this line in the flattened diff-line list of its file
    /// (`diff_file`). Partial staging (`stage_file_lines`) references lines by
    /// this index.
    pub index: u32,
    pub origin: DiffLineOrigin,
    /// 1-based line number in the old (left) file, when applicable.
    pub old_lineno: Option<u32>,
    /// 1-based line number in the new (right) file, when applicable.
    pub new_lineno: Option<u32>,
    /// Raw line content: origin prefix + text + newline.
    pub content: String,
}

/// Per-file diff (file-level summary + line-level details).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FileDiff {
    /// Repo-relative path.
    pub path: String,
    pub status: FileStatusKind,
    /// True when the file is binary (no line diff available).
    pub is_binary: bool,
    pub added: u32,
    pub deleted: u32,
    /// Line-level changes (empty when `is_binary` or unmodified).
    pub lines: Vec<DiffLine>,
}

/// A commit author identity (resolved from the app's account layer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, uniffi::Record)]
pub struct Author {
    pub name: String,
    pub email: String,
}

/// Result of SSH key generation (ed25519 only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, uniffi::Record)]
pub struct GeneratedKey {
    /// Public key in OpenSSH `authorized_keys` format (`ssh-ed25519 AAAA…`).
    pub public_key: String,
    /// Private key in OpenSSH PEM format, passphrase-encrypted when the caller
    /// provided a passphrase. ~400 bytes for ed25519 (fits secure-store).
    pub private_key: String,
}

/// Selection of diff lines to stage for one file (LINE-LEVEL PARTIAL
/// STAGING). Indices refer to `DiffLine.index` from `diff_file`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, uniffi::Record)]
pub struct HunkSelection {
    pub line_indices: Vec<u32>,
}

/// A local or remote branch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct BranchInfo {
    /// Short branch name (no `refs/heads/` prefix).
    pub name: String,
    /// Upstream remote branch (`origin/main`), when tracking is configured.
    pub upstream: Option<String>,
    /// True when this branch is the current HEAD.
    pub is_current: bool,
    /// True for remote-tracking branches.
    pub is_remote: bool,
    /// Commits this branch is ahead of its upstream.
    pub ahead: u32,
    /// Commits this branch is behind its upstream.
    pub behind: u32,
}

/// A configured remote.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct RemoteInfo {
    pub name: String,
    /// Remote URL, if configured.
    pub url: Option<String>,
    /// Fetch refspecs.
    pub fetch_specs: Vec<String>,
    /// Push refspecs.
    pub push_specs: Vec<String>,
}

/// High-level repository metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct RepoInfo {
    pub path: String,
    pub is_repo: bool,
    pub current_branch: Option<String>,
    /// HEAD commit id, when one exists.
    pub head_oid: Option<String>,
    pub remotes: Vec<String>,
    pub total_commits: u64,
    /// True when there are no staged/unstaged/untracked changes.
    pub is_clean: bool,
}

/// Outcome of a `pull` operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum PullKind {
    /// Already up to date; nothing was integrated.
    UpToDate,
    /// Local branch fast-forwarded to the remote tip.
    FastForward,
    /// Remote changes were merged with a new merge commit.
    Merged,
    /// A merge produced conflicts (repo left in merge-conflict state).
    Conflict,
    /// Pull refused because the working tree is dirty.
    Dirty,
    /// No upstream tracking ref exists for the current branch.
    NoUpstream,
    /// Unborn HEAD (empty repository).
    Unborn,
}

/// Result of `pull`, including conflict details when a merge conflicted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct PullResult {
    pub kind: PullKind,
    /// Human-readable outcome text.
    pub message: String,
    /// Conflicted paths when `kind == Conflict`.
    pub conflicts: Vec<ConflictEntry>,
}

/// Result of a `push` attempt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct PushResult {
    /// True when the branch was pushed to the remote.
    pub pushed: bool,
    /// True when the remote rejected the push as non-fast-forward.
    pub non_fast_forward: bool,
    pub message: String,
}

/// What `push_with_integrate` did after detecting a non-fast-forward push.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum PushIntegrateKind {
    /// Pushed on the first attempt; no integration was needed.
    Direct,
    /// Non-fast-forward: local commits were rebased onto the remote tip.
    Rebased,
    /// Non-fast-forward: the divergence was merged (merge commit created).
    Merged,
    /// Local was strictly behind the remote; the branch fast-forwarded.
    FastForward,
    /// Integration produced conflicts; the repo is left in a resolvable
    /// merge-conflict state (see `conflicts` / `get_conflicts`).
    Conflicts,
    /// No integration happened (up to date, dirty tree, or non-rejection).
    None,
}

/// One conflicted file reported by `push_with_integrate` (or the engine's
/// conflict list). `base`/`ours`/`theirs` are blob ids of the stage-1/2/3
/// entries when present.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ConflictFile {
    /// Repo-relative path of the conflicted file.
    pub path: String,
    /// Stage-1 (merge base) blob id, if present.
    pub base: Option<String>,
    /// Stage-2 ("ours") blob id, if present.
    pub ours: Option<String>,
    /// Stage-3 ("theirs") blob id, if present.
    pub theirs: Option<String>,
}

/// Text content of the conflict stages for one conflicted file, as read from
/// the index's stage-1/2/3 blobs. Powers the unified-editor conflict UI:
/// `ours`/`theirs` are always present (an absent stage decodes to an empty
/// string), `base` only when a stage-1 (ancestor) blob exists.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ConflictBlobs {
    /// Repo-relative path of the conflicted file.
    pub path: String,
    /// Stage-1 (merge base) blob content, if present.
    pub base: Option<String>,
    /// Stage-2 ("ours") blob content (empty when the stage is absent).
    pub ours: String,
    /// Stage-3 ("theirs") blob content (empty when the stage is absent).
    pub theirs: String,
}

/// Outcome of `push_with_integrate`: a push that transparently fetches and
/// integrates when the remote rejects it as non-fast-forward.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct PushIntegrateResult {
    /// True when the branch ended up pushed to the remote.
    pub pushed: bool,
    /// True when the engine integrated local/remote history (rebase, merge, or
    /// fast-forward) as part of this op.
    pub integrated: bool,
    pub kind: PushIntegrateKind,
    /// Conflicted paths when `kind == Conflicts` (repo left mid-merge).
    pub conflicts: Vec<ConflictFile>,
    pub message: String,
}

/// Report of what a repository-repair pass fixed (or could not fix).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct RepairReport {
    /// True when a missing/corrupt index was rebuilt from HEAD.
    pub index_rebuilt: bool,
    /// Number of corrupted loose objects pruned.
    pub loose_objects_pruned: u32,
    /// True when a stale FETCH_HEAD was deleted.
    pub fetch_head_deleted: bool,
    /// Human descriptions of repairs performed.
    pub repaired: Vec<String>,
    /// Human descriptions of repair steps that failed.
    pub unrecoverable: Vec<String>,
    /// True when the repository passes a final health check (`status` works).
    pub is_healthy: bool,
}

/// A commit as shown in history.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CommitInfo {
    /// Full 40-char hex object id.
    pub id: String,
    /// Short (7-char) hex id.
    pub short_id: String,
    /// Full commit message (may contain newlines).
    pub message: String,
    /// First paragraph of the message.
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Author timestamp, unix seconds.
    pub author_time: i64,
    /// Committer timestamp, unix seconds.
    pub committer_time: i64,
    /// Number of parents (0 = root).
    pub parent_count: u32,
    /// Parent commit ids.
    pub parents: Vec<String>,
}

/// One unresolved merge conflict entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ConflictEntry {
    /// Repo-relative path of the conflicted file.
    pub path: String,
    /// Stage-2 ("ours") blob id, if present.
    pub ours: Option<String>,
    /// Stage-3 ("theirs") blob id, if present.
    pub theirs: Option<String>,
    /// Stage-1 (merge base / ancestor) blob id, if present.
    pub ancestor: Option<String>,
    /// Short human description of the conflict state.
    pub status: String,
}

/// Kind of a progress event emitted during a network/merge op.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum ProgressKind {
    Transfer,
    Indexing,
    Sideband,
    Checkout,
    Push,
    Rebase,
    Merge,
}

/// Progress event streamed out of a long-running git op.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ProgressEvent {
    pub kind: ProgressKind,
    /// Human-readable task line (e.g. sideband progress text).
    pub text: String,
    pub received: u64,
    pub indexed: u64,
    pub total: u64,
    /// 0-100 percent of the transfer/indexing phase.
    pub percent: u32,
}

/// Maximum blob size for `read_blob_at_ref` (10 MB).
pub const BLOB_SIZE_LIMIT: usize = 10 * 1024 * 1024;

/// Kind of error when reading a blob at a ref.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
pub enum BlobReadErrorKind {
    /// The given ref (branch/tag/commit) does not exist.
    RefNotFound,
    /// The ref exists but is a shallow commit (history truncated by `git clone --depth`).
    ShallowHistory,
    /// The file path does not exist at the given ref.
    PathNotFound,
    /// The file at the ref is binary (content contains a null byte).
    BinaryContent,
    /// The file exceeds the configured size limit.
    TooLarge { size: u64, limit: u64 },
    /// Native module unavailable.
    NativeUnavailable,
}

/// Error when reading a blob at a ref.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct BlobReadError {
    pub kind: BlobReadErrorKind,
    /// Human-readable message.
    pub message: String,
}

/// Content of a blob at a ref, or an explicit error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Enum)]
pub enum BlobReadResult {
    /// Blob content was read successfully.
    Content {
        /// Git object id of the blob.
        oid: String,
        /// Raw bytes of the blob.
        content: Vec<u8>,
        /// True when the content was truncated to `BLOB_SIZE_LIMIT`.
        truncated: bool,
        /// Detected MIME type based on content (e.g. `text/plain`, `application/octet-stream`).
        mime_type: String,
    },
    /// Reading the blob failed with a typed error.
    Error(BlobReadError),
}

/// A commit as it appears in file history (path-specific commits).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FileHistoryEntry {
    /// Full 40-char hex object id.
    pub id: String,
    /// Short (7-char) hex id.
    pub short_id: String,
    /// Full commit message (may contain newlines).
    pub message: String,
    /// First paragraph of the message.
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    /// Author timestamp, unix seconds.
    pub author_time: i64,
    /// Committer timestamp, unix seconds.
    pub committer_time: i64,
    /// Number of parents (0 = root).
    pub parent_count: u32,
    /// Parent commit ids.
    pub parents: Vec<String>,
}

/// Result of `file_history`, including a flag when the history may be shallow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct FileHistoryResult {
    pub entries: Vec<FileHistoryEntry>,
    /// True when the history may be shallow (e.g., `git clone --depth` was used).
    pub shallow: bool,
}
