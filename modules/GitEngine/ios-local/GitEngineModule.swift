import ExpoModulesCore
import Foundation

final class GitEngineException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}

/// Forwards Rust `ProgressEvent`s into the JS runtime. Emits both the legacy
/// `onCloneProgress` event (spike-gate screen) and the generic
/// `onEngineProgress` event consumed by the GitEngine facade.
final class ProgressForwarder: ProgressListener, @unchecked Sendable {
  private weak var module: GitEngineModule?

  init(module: GitEngineModule) {
    self.module = module
  }

  func onProgress(event: ProgressEvent) {
    let payload: [String: Any] = [
      "kind": ProgressForwarder.label(for: event.kind),
      "text": event.text,
      "received": event.received,
      "indexed": event.indexed,
      "total": event.total,
      "percent": event.percent,
    ]
    DispatchQueue.main.async { [weak module] in
      module?.sendEvent("onCloneProgress", payload)
      module?.sendEvent("onEngineProgress", payload)
    }
  }

  private static func label(for kind: ProgressKind) -> String {
    switch kind {
    case .transfer:
      return "Transfer"
    case .indexing:
      return "Indexing"
    case .sideband:
      return "Sideband"
    case .checkout:
      return "Checkout"
    case .push:
      return "Push"
    case .rebase:
      return "Rebase"
    case .merge:
      return "Merge"
    }
  }
}

private func statusKindLabel(_ kind: FileStatusKind) -> String {
  switch kind {
  case .unmodified:
    return "Unmodified"
  case .untracked:
    return "Untracked"
  case .added:
    return "Added"
  case .modified:
    return "Modified"
  case .deleted:
    return "Deleted"
  case .renamed:
    return "Renamed"
  case .typeChange:
    return "TypeChange"
  case .conflicted:
    return "Conflicted"
  }
}

private func originLabel(_ origin: DiffLineOrigin) -> String {
  switch origin {
  case .context:
    return "Context"
  case .addition:
    return "Addition"
  case .deletion:
    return "Deletion"
  case .contextEof:
    return "ContextEof"
  case .additionEof:
    return "AdditionEof"
  case .deletionEof:
    return "DeletionEof"
  }
}

private func pullKindLabel(_ kind: PullKind) -> String {
  switch kind {
  case .upToDate:
    return "UpToDate"
  case .fastForward:
    return "FastForward"
  case .merged:
    return "Merged"
  case .conflict:
    return "Conflict"
  case .dirty:
    return "Dirty"
  case .noUpstream:
    return "NoUpstream"
  case .unborn:
    return "Unborn"
  }
}

private func statusDict(_ status: RepoStatus) -> [String: Any] {
  [
    "repoId": status.repoId,
    "path": status.path,
    "isRepo": status.isRepo,
    "currentBranch": status.currentBranch as Any,
    "ahead": status.ahead,
    "behind": status.behind,
    "stagedCount": status.stagedCount,
    "modifiedCount": status.modifiedCount,
    "untrackedCount": status.untrackedCount,
    "conflictedCount": status.conflictedCount,
    "isLocked": status.isLocked,
    "lastOpError": status.lastOpError as Any,
  ]
}

private func fileStatusDict(_ status: FileStatus) -> [String: Any] {
  [
    "path": status.path,
    "status": statusKindLabel(status.status),
    "staged": status.staged,
    "conflicted": status.conflicted,
    "indexStatus": status.indexStatus,
    "workdirStatus": status.workdirStatus,
  ]
}

private func lineDict(_ line: DiffLine) -> [String: Any] {
  [
    "index": line.index,
    "origin": originLabel(line.origin),
    "oldLineno": line.oldLineno as Any,
    "newLineno": line.newLineno as Any,
    "content": line.content,
  ]
}

private func fileDiffDict(_ diff: FileDiff) -> [String: Any] {
  [
    "path": diff.path,
    "status": statusKindLabel(diff.status),
    "isBinary": diff.isBinary,
    "added": diff.added,
    "deleted": diff.deleted,
    "lines": diff.lines.map(lineDict),
  ]
}

private func commitDict(_ commit: CommitInfo) -> [String: Any] {
  [
    "id": commit.id,
    "shortId": commit.shortId,
    "message": commit.message,
    "summary": commit.summary,
    "authorName": commit.authorName,
    "authorEmail": commit.authorEmail,
    "authorTime": commit.authorTime,
    "committerTime": commit.committerTime,
    "parentCount": commit.parentCount,
    "parents": commit.parents,
  ]
}

private func conflictDict(_ conflict: ConflictEntry) -> [String: Any] {
  [
    "path": conflict.path,
    "ours": conflict.ours as Any,
    "theirs": conflict.theirs as Any,
    "ancestor": conflict.ancestor as Any,
    "status": conflict.status,
  ]
}

private func conflictBlobsDict(_ blobs: ConflictBlobs) -> [String: Any] {
  [
    "path": blobs.path,
    "base": blobs.base as Any,
    "ours": blobs.ours,
    "theirs": blobs.theirs,
  ]
}

private func branchDict(_ branch: BranchInfo) -> [String: Any] {
  [
    "name": branch.name,
    "upstream": branch.upstream as Any,
    "isCurrent": branch.isCurrent,
    "isRemote": branch.isRemote,
    "ahead": branch.ahead,
    "behind": branch.behind,
  ]
}

private func remoteDict(_ remote: RemoteInfo) -> [String: Any] {
  [
    "name": remote.name,
    "url": remote.url as Any,
    "fetchSpecs": remote.fetchSpecs,
    "pushSpecs": remote.pushSpecs,
  ]
}

private func repoInfoDict(_ info: RepoInfo) -> [String: Any] {
  [
    "path": info.path,
    "isRepo": info.isRepo,
    "currentBranch": info.currentBranch as Any,
    "headOid": info.headOid as Any,
    "remotes": info.remotes,
    "totalCommits": info.totalCommits,
    "isClean": info.isClean,
  ]
}

private func pullDict(_ result: PullResult) -> [String: Any] {
  [
    "kind": pullKindLabel(result.kind),
    "message": result.message,
    "conflicts": result.conflicts.map(conflictDict),
  ]
}

private func pushDict(_ result: PushResult) -> [String: Any] {
  [
    "pushed": result.pushed,
    "nonFastForward": result.nonFastForward,
    "message": result.message,
  ]
}

private func conflictFileDict(_ file: ConflictFile) -> [String: Any] {
  [
    "path": file.path,
    "base": file.base as Any,
    "ours": file.ours as Any,
    "theirs": file.theirs as Any,
  ]
}

private func pushIntegrateKindLabel(_ kind: PushIntegrateKind) -> String {
  switch kind {
  case .direct:
    return "Direct"
  case .rebased:
    return "Rebased"
  case .merged:
    return "Merged"
  case .fastForward:
    return "FastForward"
  case .conflicts:
    return "Conflicts"
  case .none:
    return "None"
  }
}

private func pushIntegrateDict(_ result: PushIntegrateResult) -> [String: Any] {
  [
    "pushed": result.pushed,
    "integrated": result.integrated,
    "kind": pushIntegrateKindLabel(result.kind),
    "conflicts": result.conflicts.map(conflictFileDict),
    "message": result.message,
  ]
}

private func repairDict(_ report: RepairReport) -> [String: Any] {
  [
    "indexRebuilt": report.indexRebuilt,
    "looseObjectsPruned": report.looseObjectsPruned,
    "fetchHeadDeleted": report.fetchHeadDeleted,
    "repaired": report.repaired,
    "unrecoverable": report.unrecoverable,
    "isHealthy": report.isHealthy,
  ]
}

/// Maps the JS-side credential shape to the UniFFI `CredentialSource` enum.
/// `nil` means "anonymous"; `.none` is treated the same by the engine.
private func credentialSource(from dict: [String: Any]?) -> CredentialSource? {
  guard let dict = dict, let kind = dict["kind"] as? String else { return nil }
  switch kind {
  case "userpass":
    return .userPass(
      username: dict["username"] as? String ?? "git",
      password: dict["password"] as? String ?? ""
    )
  case "ssh":
    return .sshKey(
      username: dict["username"] as? String ?? "git",
      privateKey: dict["privateKey"] as? String ?? "",
      publicKey: dict["publicKey"] as? String,
      passphrase: dict["passphrase"] as? String
    )
  case "default":
    return .default
  case "none":
    return .none
  default:
    return nil
  }
}

/// Round-trips a `CredentialSource` back to the JS dict shape.
private func credentialDict(_ source: CredentialSource) -> [String: Any]? {
  switch source {
  case .none:
    return ["kind": "none"]
  case .userPass(let username, let password):
    return ["kind": "userpass", "username": username, "password": password]
  case .sshKey(let username, let privateKey, let publicKey, let passphrase):
    var dict: [String: Any] = [
      "kind": "ssh", "username": username, "privateKey": privateKey,
    ]
    if let publicKey { dict["publicKey"] = publicKey }
    if let passphrase { dict["passphrase"] = passphrase }
    return dict
  case .default:
    return ["kind": "default"]
  case .gitHubOAuth(let token):
    return ["kind": "userpass", "username": "x-access-token", "password": token]
  case .gitHubAppInstallation(let token):
    return ["kind": "userpass", "username": "x-access-token", "password": token]
  }
}

public class GitEngineModule: Module {
  /// Concurrent so ops on different repos run in parallel; the per-repo flock
  /// inside the engine serializes same-repo ops.
  private let engineQueue = DispatchQueue(
    label: "com.xaventra.gitnotes.git-engine",
    qos: .userInitiated,
    attributes: .concurrent
  )

  /// Expo file-system URIs (`file:///...`) arrive as URIs; the engine wants a
  /// plain filesystem path.
  private static func fsPath(_ value: String) -> String {
    guard value.hasPrefix("file://") else { return value }
    if let components = URLComponents(string: value) {
      let path = components.path
      if !path.isEmpty {
        return path
      }
    }
    return String(value.dropFirst("file://".count))
  }

  public func definition() -> ModuleDefinition {
    Name("GitEngine")

    Events("onCloneProgress", "onEngineProgress")

    AsyncFunction("version") { () -> String in
      return version()
    }

    AsyncFunction("engineName") { () -> String in
      return engineName()
    }

    AsyncFunction("isRepoLocked") { (path: String) -> Bool in
      isRepoLocked(path: GitEngineModule.fsPath(path))
    }

    AsyncFunction("setCredential") { (repoId: String, credential: [String: Any]) in
      guard let source = credentialSource(from: credential) else {
        throw GitEngineException("invalid credential shape")
      }
      setCredential(repoId: repoId, credential: source)
    }.runOnQueue(engineQueue)

    AsyncFunction("getCredential") { (repoId: String) -> [String: Any]? in
      getCredential(repoId: repoId).flatMap(credentialDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("clearCredential") { (repoId: String) -> Bool in
      clearCredential(repoId: repoId)
    }.runOnQueue(engineQueue)

    AsyncFunction("generateSshKey") { (passphrase: String?) -> [String: Any] in
      let key = try generateSshKey(passphrase: passphrase)
      return ["publicKey": key.publicKey, "privateKey": key.privateKey]
    }.runOnQueue(engineQueue)

    AsyncFunction("clone") { (url: String, dest: String, repoId: String?, promise: Promise) in
      let forwarder = ProgressForwarder(module: self)
      let destPath = GitEngineModule.fsPath(dest)
      do {
        let result = try cloneRepoWithProgress(
          url: url,
          dest: destPath,
          repoId: repoId,
          credentialSource: nil,
          listener: forwarder
        )
        promise.resolve(result)
      } catch {
        promise.reject(GitEngineException("\(error)"))
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("removeRepo") { (path: String) in
      try removeRepo(path: GitEngineModule.fsPath(path))
    }.runOnQueue(engineQueue)

    AsyncFunction("initRepo") { (path: String, bare: Bool) in
      try initRepo(path: GitEngineModule.fsPath(path), bare: bare)
    }.runOnQueue(engineQueue)

    AsyncFunction("repoStatus") { (repoId: String, path: String) -> [String: Any] in
      statusDict(try repoStatus(repoId: repoId, path: GitEngineModule.fsPath(path)))
    }.runOnQueue(engineQueue)

    AsyncFunction("listStatuses") { (path: String) -> [[String: Any]] in
      try listStatuses(path: GitEngineModule.fsPath(path)).map(fileStatusDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("diffAll") { (path: String) -> [[String: Any]] in
      try diffAll(path: GitEngineModule.fsPath(path)).map(fileDiffDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("diffFile") { (path: String, filePath: String) -> [String: Any] in
      fileDiffDict(try diffFile(path: GitEngineModule.fsPath(path), filePath: filePath))
    }.runOnQueue(engineQueue)

    AsyncFunction("stagePaths") { (path: String, paths: [String]) in
      try stagePaths(path: GitEngineModule.fsPath(path), paths: paths)
    }.runOnQueue(engineQueue)

    AsyncFunction("unstagePaths") { (path: String, paths: [String]) in
      try unstagePaths(path: GitEngineModule.fsPath(path), paths: paths)
    }.runOnQueue(engineQueue)

    AsyncFunction("removePaths") { (path: String, paths: [String], keepWorktree: Bool) in
      try removePaths(
        path: GitEngineModule.fsPath(path), paths: paths, keepWorktree: keepWorktree)
    }.runOnQueue(engineQueue)

    AsyncFunction("discardFiles") { (path: String, paths: [String]) in
      try discardFiles(path: GitEngineModule.fsPath(path), paths: paths)
    }.runOnQueue(engineQueue)

    AsyncFunction("stageFileLines") { (path: String, filePath: String, hunks: [[String: Any]]) in
      let selections = hunks.map { hunk -> HunkSelection in
        let indices = (hunk["lineIndices"] as? [NSNumber] ?? []).map { $0.uint32Value }
        return HunkSelection(lineIndices: indices)
      }
      try stageFileLines(
        path: GitEngineModule.fsPath(path), filePath: filePath, hunks: selections)
    }.runOnQueue(engineQueue)

    AsyncFunction("commit") { (path: String, message: String, authorName: String, authorEmail: String) -> [String: Any] in
      commitDict(
        try commitChanges(
          path: GitEngineModule.fsPath(path),
          message: message,
          author: Author(name: authorName, email: authorEmail)
        )
      )
    }.runOnQueue(engineQueue)

    AsyncFunction("recentCommits") { (path: String, skip: UInt32, limit: UInt32) -> [[String: Any]] in
      try recentCommits(path: GitEngineModule.fsPath(path), skip: skip, limit: limit).map(commitDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("commitDiff") { (path: String, commitId: String) -> [[String: Any]] in
      try commitDiff(path: GitEngineModule.fsPath(path), commitId: commitId).map(fileDiffDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("checkoutCommit") { (path: String, commitId: String) in
      try checkoutCommit(path: GitEngineModule.fsPath(path), commitId: commitId)
    }.runOnQueue(engineQueue)

    AsyncFunction("resetSoft") { (path: String, commitId: String) in
      try resetSoft(path: GitEngineModule.fsPath(path), commitId: commitId)
    }.runOnQueue(engineQueue)

    AsyncFunction("revertCommit") { (path: String, commitId: String, authorName: String, authorEmail: String) -> [String: Any] in
      commitDict(
        try revertCommit(
          path: GitEngineModule.fsPath(path),
          commitId: commitId,
          author: Author(name: authorName, email: authorEmail)
        )
      )
    }.runOnQueue(engineQueue)

    AsyncFunction("getConflicts") { (path: String) -> [[String: Any]] in
      try getConflicts(path: GitEngineModule.fsPath(path)).map(conflictDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("resolveConflict") { (path: String, filePath: String) in
      try resolveConflict(path: GitEngineModule.fsPath(path), filePath: filePath)
    }.runOnQueue(engineQueue)

    AsyncFunction("getConflictBlobs") { (path: String, filePath: String) -> [String: Any] in
      conflictBlobsDict(
        try getConflictBlobs(path: GitEngineModule.fsPath(path), filePath: filePath))
    }.runOnQueue(engineQueue)

    AsyncFunction("markConflictResolved") { (path: String, filePath: String) in
      try markConflictResolved(path: GitEngineModule.fsPath(path), filePath: filePath)
    }.runOnQueue(engineQueue)

    AsyncFunction("fetch") { (path: String, remoteName: String, repoId: String?, promise: Promise) in
      let forwarder = ProgressForwarder(module: self)
      do {
        try fetchRepoWithProgress(
          path: GitEngineModule.fsPath(path),
          remoteName: remoteName,
          repoId: repoId,
          credentialSource: nil,
          listener: forwarder
        )
        promise.resolve(nil)
      } catch {
        promise.reject(GitEngineException("\(error)"))
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("pull") { (path: String, remoteName: String, repoId: String?, promise: Promise) in
      let forwarder = ProgressForwarder(module: self)
      do {
        let result = try pullRepo(
          path: GitEngineModule.fsPath(path),
          remoteName: remoteName,
          repoId: repoId,
          credentialSource: nil,
          listener: forwarder
        )
        promise.resolve(pullDict(result))
      } catch {
        promise.reject(GitEngineException("\(error)"))
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("push") { (path: String, remoteName: String, repoId: String?, force: Bool, promise: Promise) in
      let forwarder = ProgressForwarder(module: self)
      do {
        let result = try pushRepo(
          path: GitEngineModule.fsPath(path),
          remoteName: remoteName,
          repoId: repoId,
          credentialSource: nil,
          force: force,
          listener: forwarder
        )
        promise.resolve(pushDict(result))
      } catch {
        promise.reject(GitEngineException("\(error)"))
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("pushWithIntegrate") { (path: String, remoteName: String, repoId: String?, promise: Promise) in
      let forwarder = ProgressForwarder(module: self)
      do {
        let result = try pushRepoWithIntegrate(
          path: GitEngineModule.fsPath(path),
          remoteName: remoteName,
          repoId: repoId,
          credentialSource: nil,
          listener: forwarder
        )
        promise.resolve(pushIntegrateDict(result))
      } catch {
        promise.reject(GitEngineException("\(error)"))
      }
    }.runOnQueue(engineQueue)

    AsyncFunction("listBranches") { (path: String, remoteName: String) -> [[String: Any]] in
      try listBranches(path: GitEngineModule.fsPath(path), remoteName: remoteName).map(branchDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("createBranch") { (path: String, name: String, source: String?) -> [String: Any] in
      branchDict(try createBranch(path: GitEngineModule.fsPath(path), name: name, source: source))
    }.runOnQueue(engineQueue)

    AsyncFunction("checkoutBranch") { (path: String, name: String, remoteName: String) in
      try checkoutBranch(
        path: GitEngineModule.fsPath(path), name: name, remoteName: remoteName)
    }.runOnQueue(engineQueue)

    AsyncFunction("deleteBranch") { (path: String, name: String) in
      try deleteBranch(path: GitEngineModule.fsPath(path), name: name)
    }.runOnQueue(engineQueue)

    AsyncFunction("renameBranch") { (path: String, name: String, newName: String) -> [String: Any] in
      branchDict(
        try renameBranch(path: GitEngineModule.fsPath(path), name: name, newName: newName))
    }.runOnQueue(engineQueue)

    AsyncFunction("listRemotes") { (path: String) -> [[String: Any]] in
      try listRemotes(path: GitEngineModule.fsPath(path)).map(remoteDict)
    }.runOnQueue(engineQueue)

    AsyncFunction("addRemote") { (path: String, name: String, url: String) in
      try addRemote(path: GitEngineModule.fsPath(path), name: name, url: url)
    }.runOnQueue(engineQueue)

    AsyncFunction("removeRemote") { (path: String, name: String) in
      try removeRemote(path: GitEngineModule.fsPath(path), name: name)
    }.runOnQueue(engineQueue)

    AsyncFunction("setRemoteUrl") { (path: String, name: String, url: String) in
      try setRemoteUrl(path: GitEngineModule.fsPath(path), name: name, url: url)
    }.runOnQueue(engineQueue)

    AsyncFunction("repoInfo") { (path: String) -> [String: Any] in
      repoInfoDict(try repoInfo(path: GitEngineModule.fsPath(path)))
    }.runOnQueue(engineQueue)

    AsyncFunction("repairRepo") { (path: String) -> [String: Any] in
      repairDict(try repairRepo(path: GitEngineModule.fsPath(path)))
    }.runOnQueue(engineQueue)

    AsyncFunction("backupCorruptRepo") { (path: String) -> String in
      try backupCorruptRepo(path: GitEngineModule.fsPath(path))
    }.runOnQueue(engineQueue)
  }
}
