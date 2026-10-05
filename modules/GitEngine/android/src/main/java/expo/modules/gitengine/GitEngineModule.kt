// allow: SIZE_OK — complete Android mirror of ios-local/GitEngineModule.swift; the two
// files expose the same JS surface and must be kept in sync method-for-method.
package expo.modules.gitengine

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.gitnotes_git2.*

internal class GitEngineException(message: String) : CodedException(message)

class GitEngineModule : Module() {
  private var engineLoadError: Throwable? = null

  /// Android APEX CA store path (Android 10+).
  private companion object {
    private const val ANDROID_CA_APEX = "/apex/com.android.conscrypt/cacerts"
    private const val ANDROID_CA_LEGACY = "/system/etc/security/cacerts"
    private const val CA_BUNDLE_FILENAME = "gitnotes_ca_bundle.pem"
  }

  /// Configure git2's SSL certificate store on Android.
  ///
  /// Strategy (tries in order, stops at first success):
  /// 1. set_ssl_cert_file  — the PEM bundle built from Android CA directories.
  /// 2. set_ssl_cert_directory — the Android APEX/legacy CA directory (works when the
  ///    bundle file has permissions issues but the dir is accessible).
  ///
  /// If both fail with X509_R_LOADED_CERT it means git2's SSL_CTX was already
  /// populated by its internal openssl_init call; git2 will use whatever cert store
  /// it already has (may be empty on some Android builds — SSL errors will result).
  /// In that case we log a clear warning so the failure is not silent.
  private fun configureAndroidCaBundle() {
    val caDir = findAndroidCaDir()
    val bundlePath = caDir?.let { buildAndroidCaBundle() }

    if (bundlePath != null) {
      try {
        setSslCertLocations(bundlePath, caDir.absolutePath)
        android.util.Log.i("GitEngine", "configureAndroidCaBundle: SSL certs configured via file (bundle=$bundlePath)")
        return
      } catch (e: Throwable) {
        // X509_R_LOADED_CERT: git2 already populated the SSL_CTX with its own store.
        // Fall through to try the directory approach.
        android.util.Log.w("GitEngine", "configureAndroidCaBundle: setSslCertLocations(file) failed: ${e.message}, trying directory")
      }
    }

    if (caDir != null) {
      try {
        setSslCertDirectory(caDir.absolutePath)
        android.util.Log.i("GitEngine", "configureAndroidCaBundle: SSL certs configured via directory (dir=${caDir.absolutePath})")
        return
      } catch (e: Throwable) {
        android.util.Log.w("GitEngine", "configureAndroidCaBundle: setSslCertDirectory also failed: ${e.message}")
      }
    }

    // Both approaches failed — this is not silent; git2 may still work if its internal
    // openssl_init found the system CA store, otherwise SSL ops will fail with a clear
    // git error (not an obscure native-load error).
    android.util.Log.e("GitEngine", "configureAndroidCaBundle: neither PEM bundle nor CA directory was available; git2 SSL verification may fail on this device")
  }

  /// Returns the path to the CA bundle, building it if necessary.
  /// Returns null if neither Android CA directory exists (not on Android).
  private fun buildAndroidCaBundle(): String? {
    val filesDir = appContext.reactContext?.filesDir ?: run {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: filesDir is null (reactContext not ready)")
      return null
    }
    val bundleFile = java.io.File(filesDir, CA_BUNDLE_FILENAME)
    android.util.Log.i("GitEngine", "buildAndroidCaBundle: filesDir=$filesDir bundle=${bundleFile.absolutePath}")

    // Skip rebuild if bundle already exists and is non-empty.
    if (bundleFile.isFile && bundleFile.length() > 0) {
      android.util.Log.i("GitEngine", "buildAndroidCaBundle: using existing bundle (${bundleFile.length()} bytes)")
      return bundleFile.absolutePath
    }

    // Find the best available CA directory.
    val caDir = findAndroidCaDir() ?: run {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: findAndroidCaDir returned null")
      return null
    }
    android.util.Log.i("GitEngine", "buildAndroidCaBundle: found caDir=${caDir.absolutePath}")

    // Read all readable regular files (Android CA files are named like "01419da9.0").
    val caFiles = caDir.listFiles { file ->
      file.isFile && file.canRead()
    }?.sortedBy { it.name } ?: run {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: listFiles returned null")
      return null
    }
    android.util.Log.i("GitEngine", "buildAndroidCaBundle: found ${caFiles.size} CA files")

    if (caFiles.isEmpty()) {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: no CA files found")
      return null
    }

    // Write atomically: temp file + rename.
    val tempFile = java.io.File(filesDir, "$CA_BUNDLE_FILENAME.tmp")
    try {
      tempFile.outputStream().buffered().writer().use { writer ->
        for (caFile in caFiles) {
          extractPemBlock(caFile)?.let { pem ->
            writer.write(pem)
            writer.write("\n")
          }
        }
      }
      if (!tempFile.renameTo(bundleFile)) {
        throw java.io.IOException("Failed to atomically rename $tempFile to $bundleFile")
      }
    } catch (e: Throwable) {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: write failed", e)
      tempFile.delete()
      throw e
    }

    if (bundleFile.length() == 0L) {
      android.util.Log.e("GitEngine", "buildAndroidCaBundle: bundle is empty after write")
      bundleFile.delete()
      return null
    }

    android.util.Log.i("GitEngine", "buildAndroidCaBundle: success, bundle size=${bundleFile.length()}")
    return bundleFile.absolutePath
  }

  /// Returns the best available Android CA certificate directory.
  /// Prefers APEX path; falls back to legacy path.
  private fun findAndroidCaDir(): java.io.File? {
    val apex = java.io.File(ANDROID_CA_APEX)
    if (apex.exists() && apex.isDirectory) {
      return apex
    }
    val legacy = java.io.File(ANDROID_CA_LEGACY)
    if (legacy.exists() && legacy.isDirectory) {
      return legacy
    }
    return null
  }

  /// Extracts the PEM certificate block from a CA file.
  /// Android CA files contain metadata after the PEM block (e.g. "Certificate:"
  /// and "SHA1 Fingerprint=..."), so only the -----BEGIN/END CERTIFICATE-----
  /// range is copied into the bundle.
  private fun extractPemBlock(caFile: java.io.File): String? {
    val content = caFile.readText()
    val start = content.indexOf("-----BEGIN CERTIFICATE-----")
    if (start < 0) return null
    val end = content.indexOf("-----END CERTIFICATE-----")
    if (end < 0) return null
    // inclusive of END marker
    return content.substring(start, end + "-----END CERTIFICATE-----".length)
  }

  private fun ensureEngineLoaded() {
    val error = engineLoadError ?: return
    throw GitEngineException(
      "GitEngine native library unavailable: ${error.message ?: error}. " +
        "Run `yarn build:rust:android` and rebuild the app."
    )
  }

  private fun <T> engineOp(block: () -> T): T {
    ensureEngineLoaded()
    return try {
      block()
    } catch (error: BridgeException) {
      throw GitEngineException(bridgeErrorText(error))
    }
  }

  private fun bridgeErrorText(error: BridgeException): String = when (error) {
    is BridgeException.Git -> "git error: ${error.errorMessage}"
    is BridgeException.Io -> "io error: ${error.errorMessage}"
    is BridgeException.Invalid -> "invalid input: ${error.errorMessage}"
    is BridgeException.Busy -> "repository is busy: ${error.errorMessage}"
    is BridgeException.NotARepository -> "not a git repository: ${error.path}"
    is BridgeException.Unsupported -> "operation not supported: ${error.errorMessage}"
    is BridgeException.Other -> error.errorMessage
  }

  // Forwards Rust progress events to JS from the engine's worker thread
  // (sendEvent dispatches onto the JS queue internally).
  private fun progressForwarder(): ProgressListener = object : ProgressListener {
    override fun onProgress(event: ProgressEvent) {
      val payload = progressPayload(event)
      sendEvent("onCloneProgress", payload)
      sendEvent("onEngineProgress", payload)
    }
  }

  private fun credentialSourceFromJs(dict: Map<String, Any?>): CredentialSource? {
    return when (dict["kind"] as? String) {
      "userpass" -> CredentialSource.UserPass(
        username = dict["username"] as? String ?: "git",
        password = dict["password"] as? String ?: "",
      )
      "ssh" -> CredentialSource.SshKey(
        username = dict["username"] as? String ?: "git",
        privateKey = dict["privateKey"] as? String ?: "",
        publicKey = dict["publicKey"] as? String,
        passphrase = dict["passphrase"] as? String,
      )
      "default" -> CredentialSource.Default
      "none" -> CredentialSource.None
      else -> null
    }
  }

  private fun credentialToJs(source: CredentialSource): Map<String, Any?> = when (source) {
    is CredentialSource.None -> mapOf("kind" to "none")
    is CredentialSource.UserPass -> mapOf(
      "kind" to "userpass",
      "username" to source.username,
      "password" to source.password,
    )
    is CredentialSource.SshKey -> mapOf(
      "kind" to "ssh",
      "username" to source.username,
      "privateKey" to source.privateKey,
      "publicKey" to source.publicKey,
      "passphrase" to source.passphrase,
    )
    is CredentialSource.Default -> mapOf("kind" to "default")
    is CredentialSource.GitHubOAuth -> mapOf(
      "kind" to "userpass",
      "username" to "x-access-token",
      "password" to source.token,
    )
    is CredentialSource.GitHubAppInstallation -> mapOf(
      "kind" to "userpass",
      "username" to "x-access-token",
      "password" to source.token,
    )
  }

  private fun hunksFromJs(hunks: List<Map<String, Any?>>): List<HunkSelection> = hunks.map { hunk ->
    val indices = (hunk["lineIndices"] as? List<*>)
      ?.mapNotNull { (it as? Number)?.toInt()?.toUInt() }
      ?: emptyList()
    HunkSelection(indices)
  }

  override fun definition() = ModuleDefinition {
    Name("GitEngine")

    Events("onCloneProgress", "onEngineProgress")

    OnCreate {
      engineLoadError = try {
        System.loadLibrary("gitnotes_git2")
        uniffiEnsureInitialized()
        // Configure Android CA store for git2's OpenSSL adapter before any
        // engine operation is dispatched. Must happen after the cdylib is
        // loaded and UniFFI is initialized, but before any engine op uses
        // the TLS stack.
        //
        // The Kotlin host builds a PEM bundle from the Android CA directories
        // and passes the path to Rust. This avoids the OpenSSL directory-mode
        // incompatibility with Android's hash-named PEM files.
        configureAndroidCaBundle()
        null
      } catch (error: Throwable) {
        // Throwable catches Error (e.g. ExceptionInInitializerError) and Exception
        error
      }
    }

    AsyncFunction("version") Coroutine { ->
      engineOp { version() }
    }

    AsyncFunction("engineName") Coroutine { ->
      engineOp { engineName() }
    }

    AsyncFunction("isRepoLocked") Coroutine { path: String ->
      engineOp { isRepoLocked(fsPath(path)) }
    }

    AsyncFunction("setCredential") Coroutine { repoId: String, credential: Map<String, Any?> ->
      engineOp {
        val source = credentialSourceFromJs(credential)
          ?: throw GitEngineException("invalid credential shape")
        setCredential(repoId, source)
      }
    }

    AsyncFunction("getCredential") Coroutine { repoId: String ->
      engineOp { getCredential(repoId)?.let(::credentialToJs) }
    }

    AsyncFunction("clearCredential") Coroutine { repoId: String ->
      engineOp { clearCredential(repoId) }
    }

    AsyncFunction("generateSshKey") Coroutine { passphrase: String? ->
      engineOp {
        val key = generateSshKey(passphrase)
        mapOf("publicKey" to key.publicKey, "privateKey" to key.privateKey)
      }
    }

    AsyncFunction("clone") Coroutine { url: String, dest: String, repoId: String? ->
      engineOp { cloneRepoWithProgress(url, fsPath(dest), repoId, null, progressForwarder()) }
    }

    AsyncFunction("removeRepo") Coroutine { path: String ->
      engineOp { removeRepo(fsPath(path)) }
    }

    AsyncFunction("initRepo") Coroutine { path: String, bare: Boolean ->
      engineOp { initRepo(fsPath(path), bare) }
    }

    AsyncFunction("repoStatus") Coroutine { repoId: String, path: String ->
      engineOp { statusDict(repoStatus(repoId, fsPath(path))) }
    }

    AsyncFunction("listStatuses") Coroutine { path: String ->
      engineOp { listStatuses(fsPath(path)).map(::fileStatusDict) }
    }

    AsyncFunction("diffAll") Coroutine { path: String ->
      engineOp { diffAll(fsPath(path)).map(::fileDiffDict) }
    }

    AsyncFunction("diffFile") Coroutine { path: String, filePath: String ->
      engineOp { fileDiffDict(diffFile(fsPath(path), filePath)) }
    }

    AsyncFunction("stagePaths") Coroutine { path: String, paths: List<String> ->
      engineOp { stagePaths(fsPath(path), paths) }
    }

    AsyncFunction("unstagePaths") Coroutine { path: String, paths: List<String> ->
      engineOp { unstagePaths(fsPath(path), paths) }
    }

    AsyncFunction("removePaths") Coroutine { path: String, paths: List<String>, keepWorktree: Boolean ->
      engineOp { removePaths(fsPath(path), paths, keepWorktree) }
    }

    AsyncFunction("discardFiles") Coroutine { path: String, paths: List<String> ->
      engineOp { discardFiles(fsPath(path), paths) }
    }

    AsyncFunction("stageFileLines") Coroutine { path: String, filePath: String, hunks: List<Map<String, Any?>> ->
      engineOp { stageFileLines(fsPath(path), filePath, hunksFromJs(hunks)) }
    }

    AsyncFunction("commit") Coroutine { path: String, message: String, authorName: String, authorEmail: String ->
      engineOp { commitDict(commitChanges(fsPath(path), message, Author(authorName, authorEmail))) }
    }

    AsyncFunction("recentCommits") Coroutine { path: String, skip: Int, limit: Int ->
      engineOp { recentCommits(fsPath(path), skip.toUInt(), limit.toUInt()).map(::commitDict) }
    }

    AsyncFunction("commitDiff") Coroutine { path: String, commitId: String ->
      engineOp { commitDiff(fsPath(path), commitId).map(::fileDiffDict) }
    }

    AsyncFunction("checkoutCommit") Coroutine { path: String, commitId: String ->
      engineOp { checkoutCommit(fsPath(path), commitId) }
    }

    AsyncFunction("resetSoft") Coroutine { path: String, commitId: String ->
      engineOp { resetSoft(fsPath(path), commitId) }
    }

    AsyncFunction("revertCommit") Coroutine { path: String, commitId: String, authorName: String, authorEmail: String ->
      engineOp { commitDict(revertCommit(fsPath(path), commitId, Author(authorName, authorEmail))) }
    }

    AsyncFunction("getConflicts") Coroutine { path: String ->
      engineOp { getConflicts(fsPath(path)).map(::conflictDict) }
    }

    AsyncFunction("resolveConflict") Coroutine { path: String, filePath: String ->
      engineOp { resolveConflict(fsPath(path), filePath) }
    }

    AsyncFunction("getConflictBlobs") Coroutine { path: String, filePath: String ->
      engineOp { conflictBlobsDict(getConflictBlobs(fsPath(path), filePath)) }
    }

    AsyncFunction("markConflictResolved") Coroutine { path: String, filePath: String ->
      engineOp { markConflictResolved(fsPath(path), filePath) }
    }

    AsyncFunction("fetch") Coroutine { path: String, remoteName: String, repoId: String? ->
      engineOp { fetchRepoWithProgress(fsPath(path), remoteName, repoId, null, progressForwarder()) }
    }

    AsyncFunction("pull") Coroutine { path: String, remoteName: String, repoId: String? ->
      engineOp { pullDict(pullRepo(fsPath(path), remoteName, repoId, null, progressForwarder())) }
    }

    AsyncFunction("push") Coroutine { path: String, remoteName: String, repoId: String?, force: Boolean ->
      engineOp { pushDict(pushRepo(fsPath(path), remoteName, repoId, null, force, progressForwarder())) }
    }

    AsyncFunction("pushWithIntegrate") Coroutine { path: String, remoteName: String, repoId: String? ->
      engineOp {
        pushIntegrateDict(pushRepoWithIntegrate(fsPath(path), remoteName, repoId, null, progressForwarder()))
      }
    }

    AsyncFunction("listBranches") Coroutine { path: String, remoteName: String ->
      engineOp { listBranches(fsPath(path), remoteName).map(::branchDict) }
    }

    AsyncFunction("createBranch") Coroutine { path: String, name: String, source: String? ->
      engineOp { branchDict(createBranch(fsPath(path), name, source)) }
    }

    AsyncFunction("checkoutBranch") Coroutine { path: String, name: String, remoteName: String ->
      engineOp { checkoutBranch(fsPath(path), name, remoteName) }
    }

    AsyncFunction("deleteBranch") Coroutine { path: String, name: String ->
      engineOp { deleteBranch(fsPath(path), name) }
    }

    AsyncFunction("renameBranch") Coroutine { path: String, name: String, newName: String ->
      engineOp { branchDict(renameBranch(fsPath(path), name, newName)) }
    }

    AsyncFunction("listRemotes") Coroutine { path: String ->
      engineOp { listRemotes(fsPath(path)).map(::remoteDict) }
    }

    AsyncFunction("addRemote") Coroutine { path: String, name: String, url: String ->
      engineOp { addRemote(fsPath(path), name, url) }
    }

    AsyncFunction("removeRemote") Coroutine { path: String, name: String ->
      engineOp { removeRemote(fsPath(path), name) }
    }

    AsyncFunction("setRemoteUrl") Coroutine { path: String, name: String, url: String ->
      engineOp { setRemoteUrl(fsPath(path), name, url) }
    }

    AsyncFunction("repoInfo") Coroutine { path: String ->
      engineOp { repoInfoDict(repoInfo(fsPath(path))) }
    }

    AsyncFunction("repairRepo") Coroutine { path: String ->
      engineOp { repairDict(repairRepo(fsPath(path))) }
    }

    AsyncFunction("backupCorruptRepo") Coroutine { path: String ->
      engineOp { backupCorruptRepo(fsPath(path)) }
    }
  }
}
