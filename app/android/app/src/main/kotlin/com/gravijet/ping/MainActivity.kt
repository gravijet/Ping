package com.gravijet.ping

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ping/native")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    // The device's primary CPU ABI so the in-app updater can fetch
                    // the matching per-ABI APK split (a much smaller download).
                    "primaryAbi" -> result.success(Build.SUPPORTED_ABIS.firstOrNull() ?: "")
                    // While a call is ringing/connected, show the call UI over the
                    // lock screen and turn the screen on — like a real phone call.
                    // Reset when the call ends so the lock screen behaves normally.
                    "setCallActive" -> {
                        val active = call.arguments as? Boolean ?: false
                        setCallActive(active)
                        result.success(null)
                    }
                    // --- In-app updater: background APK download ------------------
                    // The download is handed to Android's system DownloadManager so
                    // it keeps running after the app is backgrounded or even killed,
                    // shows a system progress notification, and resumes on its own
                    // when connectivity flaps. Returns the download id (a Long) that
                    // the Dart side persists and later polls / installs by.
                    "apkDownloadStart" -> result.success(startApkDownload(call))
                    // Poll progress: {status, bytes, total, reason, path}.
                    "apkDownloadStatus" -> result.success(apkDownloadStatus(call))
                    // Abort and forget an in-flight (or finished) download.
                    "apkDownloadCancel" -> {
                        cancelApkDownload(call)
                        result.success(null)
                    }
                    // Hand a finished download to the system package installer using
                    // a grantable content:// URI (robust where a raw file path is
                    // refused on newer Android).
                    "apkInstall" -> result.success(installApk(call))
                    else -> result.notImplemented()
                }
            }
    }

    private fun downloadManager(): DownloadManager =
        getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager

    /**
     * Enqueue a background APK download. The file lands in this app's private
     * external Downloads dir (no storage permission needed) under a stable name,
     * so a repeated request for the same build overwrites rather than piling up.
     * Returns the DownloadManager id, or -1 on any failure.
     */
    private fun startApkDownload(call: MethodCall): Long {
        val url = call.argument<String>("url") ?: return -1L
        val fileName = call.argument<String>("fileName") ?: "ping-update.apk"
        val title = call.argument<String>("title") ?: "Ping-Update"
        val allowMetered = call.argument<Boolean>("allowMetered") ?: true
        return try {
            // Clear any leftover file with this name so the destination path is
            // deterministic (DownloadManager would otherwise suffix "-1").
            try {
                File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName).delete()
            } catch (_: Exception) {
                /* best effort */
            }
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(title)
                setDescription("Lädt die neue Version herunter …")
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                setDestinationInExternalFilesDir(
                    this@MainActivity, Environment.DIRECTORY_DOWNLOADS, fileName
                )
                setMimeType("application/vnd.android.package-archive")
                // Don't strand mobile-data users — Ping has no Wi-Fi-only contract.
                setAllowedOverMetered(allowMetered)
                setAllowedOverRoaming(allowMetered)
            }
            downloadManager().enqueue(request)
        } catch (_: Exception) {
            -1L
        }
    }

    /**
     * Query the current state of [id]. `status` is one of pending/running/paused/
     * successful/failed/none; `path` is the local file path once finished.
     */
    private fun apkDownloadStatus(call: MethodCall): Map<String, Any?> {
        val id = (call.argument<Number>("id"))?.toLong() ?: return mapOf("status" to "none")
        return try {
            downloadManager().query(DownloadManager.Query().setFilterById(id)).use { c ->
                if (c == null || !c.moveToFirst()) return mapOf("status" to "none")
                val status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val bytes = c.getLong(
                    c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
                )
                val total = c.getLong(
                    c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
                )
                val reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                val localUri = c.getString(
                    c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI)
                )
                val statusStr = when (status) {
                    DownloadManager.STATUS_PENDING -> "pending"
                    DownloadManager.STATUS_RUNNING -> "running"
                    DownloadManager.STATUS_PAUSED -> "paused"
                    DownloadManager.STATUS_SUCCESSFUL -> "successful"
                    DownloadManager.STATUS_FAILED -> "failed"
                    else -> "unknown"
                }
                val path = localUri?.let {
                    try {
                        Uri.parse(it).path
                    } catch (_: Exception) {
                        null
                    }
                }
                mapOf(
                    "status" to statusStr,
                    "bytes" to bytes,
                    "total" to total,
                    "reason" to reason,
                    "path" to path,
                )
            }
        } catch (_: Exception) {
            mapOf("status" to "none")
        }
    }

    private fun cancelApkDownload(call: MethodCall) {
        val id = (call.argument<Number>("id"))?.toLong() ?: return
        try {
            downloadManager().remove(id)
        } catch (_: Exception) {
            /* best effort */
        }
    }

    /**
     * Launch the system package installer for a finished download. Uses the
     * grantable content:// URI DownloadManager hands out, with a read grant so
     * the installer can read it on Android N+.
     */
    private fun installApk(call: MethodCall): Boolean {
        val id = (call.argument<Number>("id"))?.toLong() ?: return false
        return try {
            val uri: Uri = downloadManager().getUriForDownloadedFile(id) ?: return false
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun setCallActive(active: Boolean) {
        runOnUiThread {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(active)
                setTurnScreenOn(active)
            } else {
                @Suppress("DEPRECATION")
                val flags = (WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
                if (active) window.addFlags(flags) else window.clearFlags(flags)
            }
            if (active) {
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }
}
