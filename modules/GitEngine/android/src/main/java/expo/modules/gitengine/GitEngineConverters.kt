// allow: SIZE_OK — 1:1 translation layer mirroring ios-local/GitEngineModule.swift dict
// builders; every JS field name must stay identical to the Swift module.
package expo.modules.gitengine

import android.net.Uri
import uniffi.gitnotes_git2.BranchInfo
import uniffi.gitnotes_git2.BlobReadResult
import uniffi.gitnotes_git2.BlobReadErrorKind
import uniffi.gitnotes_git2.CommitInfo
import uniffi.gitnotes_git2.ConflictBlobs
import uniffi.gitnotes_git2.ConflictEntry
import uniffi.gitnotes_git2.ConflictFile
import uniffi.gitnotes_git2.DiffLine
import uniffi.gitnotes_git2.DiffLineOrigin
import uniffi.gitnotes_git2.FileDiff
import uniffi.gitnotes_git2.FileHistoryEntry
import uniffi.gitnotes_git2.FileHistoryResult
import uniffi.gitnotes_git2.FileStatus
import uniffi.gitnotes_git2.FileStatusKind
import uniffi.gitnotes_git2.ProgressEvent
import uniffi.gitnotes_git2.ProgressKind
import uniffi.gitnotes_git2.PullKind
import uniffi.gitnotes_git2.PullResult
import uniffi.gitnotes_git2.PushIntegrateKind
import uniffi.gitnotes_git2.PushIntegrateResult
import uniffi.gitnotes_git2.PushResult
import uniffi.gitnotes_git2.RemoteInfo
import uniffi.gitnotes_git2.RepairReport
import uniffi.gitnotes_git2.RepoInfo
import uniffi.gitnotes_git2.RepoStatus

internal fun fsPath(value: String): String {
  if (!value.startsWith("file://")) {
    return value
  }
  val parsed = Uri.parse(value).path
  return if (!parsed.isNullOrEmpty()) parsed else value.removePrefix("file://")
}

internal fun statusKindLabel(kind: FileStatusKind): String = when (kind) {
  FileStatusKind.UNMODIFIED -> "Unmodified"
  FileStatusKind.UNTRACKED -> "Untracked"
  FileStatusKind.ADDED -> "Added"
  FileStatusKind.MODIFIED -> "Modified"
  FileStatusKind.DELETED -> "Deleted"
  FileStatusKind.RENAMED -> "Renamed"
  FileStatusKind.TYPE_CHANGE -> "TypeChange"
  FileStatusKind.CONFLICTED -> "Conflicted"
}

internal fun originLabel(origin: DiffLineOrigin): String = when (origin) {
  DiffLineOrigin.CONTEXT -> "Context"
  DiffLineOrigin.ADDITION -> "Addition"
  DiffLineOrigin.DELETION -> "Deletion"
  DiffLineOrigin.CONTEXT_EOF -> "ContextEof"
  DiffLineOrigin.ADDITION_EOF -> "AdditionEof"
  DiffLineOrigin.DELETION_EOF -> "DeletionEof"
}

internal fun pullKindLabel(kind: PullKind): String = when (kind) {
  PullKind.UP_TO_DATE -> "UpToDate"
  PullKind.FAST_FORWARD -> "FastForward"
  PullKind.MERGED -> "Merged"
  PullKind.CONFLICT -> "Conflict"
  PullKind.DIRTY -> "Dirty"
  PullKind.NO_UPSTREAM -> "NoUpstream"
  PullKind.UNBORN -> "Unborn"
}

internal fun pushIntegrateKindLabel(kind: PushIntegrateKind): String = when (kind) {
  PushIntegrateKind.DIRECT -> "Direct"
  PushIntegrateKind.REBASED -> "Rebased"
  PushIntegrateKind.MERGED -> "Merged"
  PushIntegrateKind.FAST_FORWARD -> "FastForward"
  PushIntegrateKind.CONFLICTS -> "Conflicts"
  PushIntegrateKind.NONE -> "None"
}

internal fun progressKindLabel(kind: ProgressKind): String = when (kind) {
  ProgressKind.TRANSFER -> "Transfer"
  ProgressKind.INDEXING -> "Indexing"
  ProgressKind.SIDEBAND -> "Sideband"
  ProgressKind.CHECKOUT -> "Checkout"
  ProgressKind.PUSH -> "Push"
  ProgressKind.REBASE -> "Rebase"
  ProgressKind.MERGE -> "Merge"
}

internal fun statusDict(status: RepoStatus): Map<String, Any?> = mapOf(
  "repoId" to status.repoId,
  "path" to status.path,
  "isRepo" to status.isRepo,
  "currentBranch" to status.currentBranch,
  "ahead" to status.ahead.toInt(),
  "behind" to status.behind.toInt(),
  "stagedCount" to status.stagedCount.toInt(),
  "modifiedCount" to status.modifiedCount.toInt(),
  "untrackedCount" to status.untrackedCount.toInt(),
  "conflictedCount" to status.conflictedCount.toInt(),
  "isLocked" to status.isLocked,
  "lastOpError" to status.lastOpError,
)

internal fun fileStatusDict(status: FileStatus): Map<String, Any?> = mapOf(
  "path" to status.path,
  "status" to statusKindLabel(status.status),
  "staged" to status.staged,
  "conflicted" to status.conflicted,
  "indexStatus" to status.indexStatus,
  "workdirStatus" to status.workdirStatus,
)

internal fun lineDict(line: DiffLine): Map<String, Any?> = mapOf(
  "index" to line.index.toInt(),
  "origin" to originLabel(line.origin),
  "oldLineno" to line.oldLineno?.toInt(),
  "newLineno" to line.newLineno?.toInt(),
  "content" to line.content,
)

internal fun fileDiffDict(diff: FileDiff): Map<String, Any?> = mapOf(
  "path" to diff.path,
  "status" to statusKindLabel(diff.status),
  "isBinary" to diff.isBinary,
  "added" to diff.added.toInt(),
  "deleted" to diff.deleted.toInt(),
  "lines" to diff.lines.map(::lineDict),
)

internal fun commitDict(commit: CommitInfo): Map<String, Any?> = mapOf(
  "id" to commit.id,
  "shortId" to commit.shortId,
  "message" to commit.message,
  "summary" to commit.summary,
  "authorName" to commit.authorName,
  "authorEmail" to commit.authorEmail,
  "authorTime" to commit.authorTime,
  "committerTime" to commit.committerTime,
  "parentCount" to commit.parentCount.toInt(),
  "parents" to commit.parents,
)

internal fun conflictDict(conflict: ConflictEntry): Map<String, Any?> = mapOf(
  "path" to conflict.path,
  "ours" to conflict.ours,
  "theirs" to conflict.theirs,
  "ancestor" to conflict.ancestor,
  "status" to conflict.status,
)

internal fun conflictBlobsDict(blobs: ConflictBlobs): Map<String, Any?> = mapOf(
  "path" to blobs.path,
  "base" to blobs.base,
  "ours" to blobs.ours,
  "theirs" to blobs.theirs,
)

internal fun branchDict(branch: BranchInfo): Map<String, Any?> = mapOf(
  "name" to branch.name,
  "upstream" to branch.upstream,
  "isCurrent" to branch.isCurrent,
  "isRemote" to branch.isRemote,
  "ahead" to branch.ahead.toInt(),
  "behind" to branch.behind.toInt(),
)

internal fun remoteDict(remote: RemoteInfo): Map<String, Any?> = mapOf(
  "name" to remote.name,
  "url" to remote.url,
  "fetchSpecs" to remote.fetchSpecs,
  "pushSpecs" to remote.pushSpecs,
)

internal fun repoInfoDict(info: RepoInfo): Map<String, Any?> = mapOf(
  "path" to info.path,
  "isRepo" to info.isRepo,
  "currentBranch" to info.currentBranch,
  "headOid" to info.headOid,
  "remotes" to info.remotes,
  "totalCommits" to info.totalCommits.toLong(),
  "isClean" to info.isClean,
)

internal fun pullDict(result: PullResult): Map<String, Any?> = mapOf(
  "kind" to pullKindLabel(result.kind),
  "message" to result.message,
  "conflicts" to result.conflicts.map(::conflictDict),
)

internal fun pushDict(result: PushResult): Map<String, Any?> = mapOf(
  "pushed" to result.pushed,
  "nonFastForward" to result.nonFastForward,
  "message" to result.message,
)

internal fun conflictFileDict(file: ConflictFile): Map<String, Any?> = mapOf(
  "path" to file.path,
  "base" to file.base,
  "ours" to file.ours,
  "theirs" to file.theirs,
)

internal fun pushIntegrateDict(result: PushIntegrateResult): Map<String, Any?> = mapOf(
  "pushed" to result.pushed,
  "integrated" to result.integrated,
  "kind" to pushIntegrateKindLabel(result.kind),
  "conflicts" to result.conflicts.map(::conflictFileDict),
  "message" to result.message,
)

internal fun repairDict(report: RepairReport): Map<String, Any?> = mapOf(
  "indexRebuilt" to report.indexRebuilt,
  "looseObjectsPruned" to report.looseObjectsPruned.toInt(),
  "fetchHeadDeleted" to report.fetchHeadDeleted,
  "repaired" to report.repaired,
  "unrecoverable" to report.unrecoverable,
  "isHealthy" to report.isHealthy,
)

internal fun progressPayload(event: ProgressEvent): Map<String, Any?> = mapOf(
  "kind" to progressKindLabel(event.kind),
  "text" to event.text,
  "received" to event.received.toLong(),
  "indexed" to event.indexed.toLong(),
  "total" to event.total.toLong(),
  "percent" to event.percent.toInt(),
)

internal fun fileHistoryEntryDict(entry: FileHistoryEntry): Map<String, Any?> = mapOf(
  "id" to entry.id,
  "shortId" to entry.shortId,
  "message" to entry.message,
  "summary" to entry.summary,
  "authorName" to entry.authorName,
  "authorEmail" to entry.authorEmail,
  "authorTime" to entry.authorTime,
  "committerTime" to entry.committerTime,
  "parentCount" to entry.parentCount.toInt(),
  "parents" to entry.parents,
)

internal fun fileHistoryResultDict(result: FileHistoryResult): Map<String, Any?> = mapOf(
  "entries" to result.entries.map(::fileHistoryEntryDict),
  "shallow" to result.shallow,
)

private fun blobReadErrorKindLabel(kind: BlobReadErrorKind): String = when (kind) {
  BlobReadErrorKind.RefNotFound -> "RefNotFound"
  BlobReadErrorKind.ShallowHistory -> "ShallowHistory"
  BlobReadErrorKind.PathNotFound -> "PathNotFound"
  BlobReadErrorKind.BinaryContent -> "BinaryContent"
  is BlobReadErrorKind.TooLarge -> "TooLarge"
  BlobReadErrorKind.NativeUnavailable -> "NativeUnavailable"
}

internal fun blobReadResultDict(result: BlobReadResult): Map<String, Any?> = when (result) {
  is BlobReadResult.Content -> mapOf(
    "kind" to "Content",
    "oid" to result.oid,
    "content" to result.content,
    "truncated" to result.truncated,
    "mimeType" to result.mimeType,
  )
  is BlobReadResult.Error -> mapOf(
    "kind" to "Error",
    "error" to mapOf(
      "kind" to blobReadErrorKindLabel(result.v1.kind),
      "message" to result.v1.message,
    ),
  )
}
