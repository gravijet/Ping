package com.gravijet.ping

import android.app.ActivityManager
import android.app.DownloadManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.widget.Toast
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File

// Internal broadcast action our PackageInstaller sessions report their status to.
private const val INSTALL_STATUS_ACTION = "com.gravijet.ping.INSTALL_STATUS"

class MainActivity : FlutterActivity() {
    // Kept so a notification/shortcut intent that arrives while the app is
    // already running can be pushed straight to Dart (see onNewIntent).
    private var channel: MethodChannel? = null

    // A deep-link route ("chat:<id>" / "route:<name>") captured from the launch
    // intent, consumed by Dart on startup via "consumeLaunchRoute".
    private var pendingRoute: String? = null

    // The human-readable reason the last in-app update install failed (set by the
    // PackageInstaller status receiver), polled + cleared by Dart via "installError".
    private var lastInstallError: String? = null

    // Receiver for PackageInstaller session status callbacks. Registered lazily on
    // the first install attempt, torn down in onDestroy.
    private var installReceiver: BroadcastReceiver? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ping/native")
        channel!!.setMethodCallHandler { call, result ->
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
                    // Hand a finished download to the system package installer via
                    // the PackageInstaller session API (far more reliable than an
                    // ACTION_VIEW handoff on OEM ROMs, and it reports the real
                    // failure reason). "apkInstall" installs a finished
                    // DownloadManager download by id; "apkInstallPath" installs a
                    // file the in-process downloader produced.
                    "apkInstall" -> result.success(installApk(call))
                    "apkInstallPath" -> result.success(installApkPath(call))
                    // Poll + clear the reason the last install failed (e.g. blocked
                    // by Samsung Auto Blocker / Play Protect), so Dart can show it.
                    "installError" -> result.success(consumeInstallError())
                    // Pre-flight: whether this app is allowed to install APKs at all
                    // (the per-source "Install unknown apps" consent on Android 8+).
                    // Without it every update install silently fails — so the sheet
                    // checks this first and, if false, routes the user to grant it.
                    "canInstallPackages" -> result.success(canInstallPackages())
                    "requestInstallPermission" -> {
                        requestInstallPermission()
                        result.success(null)
                    }
                    // --- Device intelligence: read-only hardware/OS diagnostics ---
                    // None of these need a runtime permission; each is wrapped so a
                    // vendor quirk degrades to a partial/empty map rather than a
                    // PlatformException on the Dart side.
                    "deviceInfo" -> result.success(deviceInfo())
                    "batteryStatus" -> result.success(batteryStatus())
                    "thermalStatus" -> result.success(thermalStatus())
                    "networkType" -> result.success(networkType())
                    "storageInfo" -> result.success(storageInfo())
                    "memoryInfo" -> result.success(memoryInfo())
                    // A short, distinct haptic via the system Vibrator (the
                    // VIBRATE permission is already declared). pattern ∈
                    // tick|click|heavy|success|error.
                    "vibrate" -> {
                        vibratePattern(call)
                        result.success(null)
                    }
                    // --- Launcher integration -------------------------------------
                    // Publish dynamic launcher shortcuts (long-press the app icon →
                    // jump straight into a recent chat). Fed the recent chats by Dart.
                    "setChatShortcuts" -> {
                        setChatShortcuts(call)
                        result.success(null)
                    }
                    // The route a launching shortcut/notification asked for, consumed
                    // once on startup (null on a plain launch).
                    "consumeLaunchRoute" -> {
                        val r = pendingRoute
                        pendingRoute = null
                        result.success(r)
                    }
                    else -> result.notImplemented()
                }
            }
        captureRoute(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        captureRoute(intent)
        // Already running → hand the route to Dart immediately instead of waiting
        // for a consumeLaunchRoute poll.
        val r = pendingRoute
        if (r != null) {
            pendingRoute = null
            runOnUiThread { channel?.invokeMethod("launchRoute", r) }
        }
    }

    // --- Screenshot detection (0.34.0) -----------------------------------------
    // Android 14+ exposes a permission-light callback that fires when the user
    // screenshots while our activity is visible — no storage access, just the
    // event. We forward it to Dart, which posts a privacy notice to the open
    // chat. Older Android has no comparable API, so this is a best-effort 14+
    // feature. Registered only while the activity is resumed. The callback is
    // held as Any? so the API-34 type never appears at class scope (keeps the
    // NewApi lint happy); the actual API calls live behind @TargetApi(34).
    private var screenCaptureCb: Any? = null

    @android.annotation.TargetApi(34)
    private fun registerScreenCapture() {
        val cb = (screenCaptureCb as? android.app.Activity.ScreenCaptureCallback)
            ?: android.app.Activity.ScreenCaptureCallback {
                runOnUiThread { channel?.invokeMethod("screenshot", null) }
            }.also { screenCaptureCb = it }
        registerScreenCaptureCallback(mainExecutor, cb)
    }

    @android.annotation.TargetApi(34)
    private fun unregisterScreenCapture() {
        (screenCaptureCb as? android.app.Activity.ScreenCaptureCallback)?.let {
            unregisterScreenCaptureCallback(it)
        }
    }

    override fun onResume() {
        super.onResume()
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            try {
                registerScreenCapture()
            } catch (_: Throwable) { /* unsupported / no permission — ignore */ }
        }
    }

    override fun onPause() {
        super.onPause()
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            try {
                unregisterScreenCapture()
            } catch (_: Throwable) { /* never registered — ignore */ }
        }
    }

    /** Pull a "ping.chatId"/"ping.route" extra off [intent] into [pendingRoute]. */
    private fun captureRoute(intent: Intent?) {
        if (intent == null) return
        val chatId = intent.getStringExtra("ping.chatId")
        val route = intent.getStringExtra("ping.route")
        when {
            !chatId.isNullOrEmpty() -> pendingRoute = "chat:$chatId"
            !route.isNullOrEmpty() -> pendingRoute = "route:$route"
        }
    }

    /**
     * Replace the app's dynamic launcher shortcuts with the given recent chats.
     * Each shortcut launches MainActivity with a "ping.chatId" extra that
     * captureRoute() turns into a deep link. API 25+ only (older launchers have
     * no shortcut surface); silently no-ops on a vendor that rejects them.
     */
    private fun setChatShortcuts(call: MethodCall) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.N_MR1) return
        val mgr = getSystemService(ShortcutManager::class.java) ?: return
        @Suppress("UNCHECKED_CAST")
        val items = (call.argument<List<Map<String, String>>>("chats")) ?: emptyList()
        try {
            val max = mgr.maxShortcutCountPerActivity.coerceAtLeast(1)
            val shortcuts = items.take(minOf(max, 4)).mapNotNull { item ->
                val id = item["chatId"] ?: return@mapNotNull null
                val label = (item["label"] ?: "Chat").take(24)
                val intent = Intent(this, MainActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                    putExtra("ping.chatId", id)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                ShortcutInfo.Builder(this, "chat_$id")
                    .setShortLabel(label)
                    .setLongLabel(label)
                    .setIntent(intent)
                    .build()
            }
            mgr.dynamicShortcuts = shortcuts
        } catch (_: Exception) {
            /* best effort — shortcuts are a nicety, never fail the call */
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
     * Install a finished DownloadManager download (by id) via the PackageInstaller
     * session API, falling back to the legacy ACTION_VIEW handoff if the session
     * can't be created. Returns true once the install has been handed off.
     */
    private fun installApk(call: MethodCall): Boolean {
        val id = (call.argument<Number>("id"))?.toLong() ?: return false
        val uri: Uri = try {
            downloadManager().getUriForDownloadedFile(id)
        } catch (_: Exception) {
            null
        } ?: return false
        lastInstallError = null
        if (installViaSession { contentResolver.openInputStream(uri) }) return true
        // Last resort on a device where the session API misbehaves.
        return installApkViaView(uri)
    }

    /**
     * Install an APK the in-process downloader wrote to [path] via the
     * PackageInstaller session API. Returns false (so Dart can fall back to
     * opening the file itself) if the session can't be created.
     */
    private fun installApkPath(call: MethodCall): Boolean {
        val path = call.argument<String>("path") ?: return false
        val file = File(path)
        if (!file.exists()) return false
        lastInstallError = null
        return installViaSession { file.inputStream() }
    }

    /**
     * Stream an APK (from [openInput]) into a PackageInstaller session and commit
     * it. The system then asks the user to confirm (our [installReceiver] forwards
     * that prompt) and, on failure, reports the *actual* reason — unlike the
     * generic "App nicht installiert" the old ACTION_VIEW path left users with.
     */
    private fun installViaSession(openInput: () -> java.io.InputStream?): Boolean {
        return try {
            ensureInstallReceiver()
            val installer = packageManager.packageInstaller
            val params =
                PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                session.openWrite("ping-update", 0, -1).use { out ->
                    val input = openInput() ?: throw IllegalStateException("no apk stream")
                    input.use { it.copyTo(out) }
                    session.fsync(out)
                }
                val statusIntent = Intent(INSTALL_STATUS_ACTION).setPackage(packageName)
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        PendingIntent.FLAG_MUTABLE
                    } else {
                        0
                    }
                val pi = PendingIntent.getBroadcast(this, sessionId, statusIntent, flags)
                session.commit(pi.intentSender)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    /** The legacy view-intent install, kept only as a fallback. */
    private fun installApkViaView(uri: Uri): Boolean {
        return try {
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

    /** Register the PackageInstaller status receiver once (idempotent). */
    private fun ensureInstallReceiver() {
        if (installReceiver != null) return
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val status = intent.getIntExtra(
                    PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE
                )
                when (status) {
                    PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                        // The normal case: the system needs the user to confirm the
                        // install. Launch the confirmation activity it handed back.
                        val confirm = installConfirmIntent(intent)
                        if (confirm != null) {
                            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            try {
                                startActivity(confirm)
                            } catch (_: Exception) {
                                /* nothing else we can do */
                            }
                        }
                    }
                    PackageInstaller.STATUS_SUCCESS -> lastInstallError = null
                    else -> {
                        val reason = humanInstallReason(
                            status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                        )
                        lastInstallError = reason
                        runOnUiThread {
                            try {
                                Toast.makeText(this@MainActivity, reason, Toast.LENGTH_LONG).show()
                            } catch (_: Exception) {
                                /* best effort */
                            }
                        }
                    }
                }
            }
        }
        installReceiver = receiver
        val filter = IntentFilter(INSTALL_STATUS_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(receiver, filter)
        }
    }

    @Suppress("DEPRECATION")
    private fun installConfirmIntent(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            intent.getParcelableExtra(Intent.EXTRA_INTENT)
        }

    /** Map a PackageInstaller failure status to actionable German guidance. */
    private fun humanInstallReason(status: Int, msg: String?): String = when (status) {
        PackageInstaller.STATUS_FAILURE_ABORTED -> "Installation abgebrochen."
        PackageInstaller.STATUS_FAILURE_BLOCKED ->
            "Die Installation wurde von einer Sicherheitsfunktion blockiert " +
                "(z. B. Samsung „Auto Blocker\" oder Play Protect). Schalte sie kurz " +
                "aus und versuche es erneut."
        PackageInstaller.STATUS_FAILURE_CONFLICT ->
            "Konflikt mit der installierten Version. Deinstalliere die alte " +
                "Ping-Version einmal und installiere danach neu."
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
            "Diese Version passt nicht zu deinem Gerät."
        PackageInstaller.STATUS_FAILURE_INVALID ->
            "Die Update-Datei ist beschädigt. Lade das Update erneut herunter."
        PackageInstaller.STATUS_FAILURE_STORAGE ->
            "Zu wenig Speicherplatz für das Update. Gib etwas Speicher frei und " +
                "versuche es erneut."
        else -> msg?.takeIf { it.isNotBlank() } ?: "Installation fehlgeschlagen."
    }

    private fun consumeInstallError(): String? {
        val e = lastInstallError
        lastInstallError = null
        return e
    }

    /**
     * Whether this app may install packages. Android 8+ gates sideloading behind a
     * per-app "Install unknown apps" consent; without it every update install
     * fails. Older versions allow it outright (manifest permission suffices).
     */
    private fun canInstallPackages(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            packageManager.canRequestPackageInstalls()
        } else {
            true
        }

    /** Open the system screen where the user grants this app the install consent. */
    private fun requestInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val withPkg = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
            .setData(Uri.parse("package:$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(withPkg)
        } catch (_: Exception) {
            // Some ROMs reject the package-scoped form; fall back to the list screen.
            try {
                startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (_: Exception) {
                /* nothing else we can do */
            }
        }
    }

    override fun onDestroy() {
        installReceiver?.let {
            try {
                unregisterReceiver(it)
            } catch (_: Exception) {
                /* already gone */
            }
        }
        installReceiver = null
        super.onDestroy()
    }

    // ---- Device intelligence -------------------------------------------------

    /** Static device + OS identity, including the Linux kernel version string. */
    private fun deviceInfo(): Map<String, Any?> = mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "brand" to Build.BRAND,
        "model" to Build.MODEL,
        "device" to Build.DEVICE,
        "product" to Build.PRODUCT,
        "androidRelease" to Build.VERSION.RELEASE,
        "sdkInt" to Build.VERSION.SDK_INT,
        "securityPatch" to Build.VERSION.SECURITY_PATCH,
        "abis" to Build.SUPPORTED_ABIS.toList(),
        "kernel" to (System.getProperty("os.version") ?: ""),
        "bootloader" to Build.BOOTLOADER,
        "uptimeMillis" to SystemClock.elapsedRealtime(),
    )

    /**
     * Live battery readings from the sticky ACTION_BATTERY_CHANGED broadcast
     * (a null receiver returns the last sticky intent without registering).
     */
    private fun batteryStatus(): Map<String, Any?> {
        return try {
            val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                ?: return emptyMap()
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            val pct = if (level >= 0 && scale > 0) Math.round(level * 100f / scale) else -1
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            val plug = when (intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)) {
                BatteryManager.BATTERY_PLUGGED_AC -> "ac"
                BatteryManager.BATTERY_PLUGGED_USB -> "usb"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
                0 -> "unplugged"
                else -> "unknown"
            }
            val health = when (intent.getIntExtra(BatteryManager.EXTRA_HEALTH, -1)) {
                BatteryManager.BATTERY_HEALTH_GOOD -> "good"
                BatteryManager.BATTERY_HEALTH_OVERHEAT -> "overheat"
                BatteryManager.BATTERY_HEALTH_DEAD -> "dead"
                BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "over_voltage"
                BatteryManager.BATTERY_HEALTH_COLD -> "cold"
                BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "failure"
                else -> "unknown"
            }
            val tempTenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
            val voltage = intent.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1)
            mapOf(
                "level" to pct,
                "charging" to charging,
                "plugged" to plug,
                "health" to health,
                // Tenths of a degree °C → °C; mV stays as-is.
                "temperature" to if (tempTenths != Int.MIN_VALUE) tempTenths / 10.0 else null,
                "voltage" to if (voltage > 0) voltage else null,
                "technology" to intent.getStringExtra(BatteryManager.EXTRA_TECHNOLOGY),
            )
        } catch (_: Exception) {
            emptyMap()
        }
    }

    /** Thermal throttling + power-saving state from PowerManager. */
    private fun thermalStatus(): Map<String, Any?> {
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
        val thermal = if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            when (pm.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "none"
                PowerManager.THERMAL_STATUS_LIGHT -> "light"
                PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
                PowerManager.THERMAL_STATUS_SEVERE -> "severe"
                PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
                PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
                PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutdown"
                else -> "unknown"
            }
        } else {
            null
        }
        return mapOf(
            "thermal" to thermal,
            "powerSave" to (pm?.isPowerSaveMode ?: false),
            "deviceIdle" to (pm?.isDeviceIdleMode ?: false),
        )
    }

    /** Active transport + whether the system considers it metered. */
    private fun networkType(): Map<String, Any?> {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return mapOf("type" to "unknown", "metered" to false)
        return try {
            val net = cm.activeNetwork ?: return mapOf("type" to "none", "metered" to false)
            val caps = cm.getNetworkCapabilities(net)
                ?: return mapOf("type" to "none", "metered" to false)
            val type = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_BLUETOOTH) -> "bluetooth"
                else -> "other"
            }
            mapOf(
                "type" to type,
                "metered" to !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED),
                "validated" to caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED),
                "downKbps" to caps.linkDownstreamBandwidthKbps,
            )
        } catch (_: Exception) {
            mapOf("type" to "unknown", "metered" to false)
        }
    }

    /** Internal-storage volume figures plus this app's own on-disk footprint. */
    private fun storageInfo(): Map<String, Any?> {
        return try {
            val data = StatFs(Environment.getDataDirectory().path)
            val total = data.blockCountLong * data.blockSizeLong
            val free = data.availableBlocksLong * data.blockSizeLong
            val appBytes = dirSize(cacheDir) + dirSize(filesDir) +
                (externalCacheDir?.let { dirSize(it) } ?: 0L)
            mapOf(
                "total" to total,
                "free" to free,
                "used" to (total - free),
                "appBytes" to appBytes,
            )
        } catch (_: Exception) {
            emptyMap()
        }
    }

    private fun dirSize(dir: File?): Long {
        if (dir == null || !dir.exists()) return 0L
        return try {
            dir.walkBottomUp().filter { it.isFile }.map { it.length() }.sum()
        } catch (_: Exception) {
            0L
        }
    }

    /** System RAM figures via ActivityManager.MemoryInfo. */
    private fun memoryInfo(): Map<String, Any?> {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            ?: return emptyMap()
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        return mapOf(
            "total" to mi.totalMem,
            "avail" to mi.availMem,
            "used" to (mi.totalMem - mi.availMem),
            "lowMemory" to mi.lowMemory,
            "threshold" to mi.threshold,
        )
    }

    /** Fire a short, distinct haptic. Best-effort; silently does nothing where
        the device has no vibrator or the OS denies it. */
    private fun vibratePattern(call: MethodCall) {
        val pattern = call.argument<String>("pattern") ?: "tick"
        try {
            val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (vibrator == null || !vibrator.hasVibrator()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val effect = when (pattern) {
                    "success" -> VibrationEffect.createWaveform(longArrayOf(0, 24, 55, 24), -1)
                    "error" -> VibrationEffect.createWaveform(longArrayOf(0, 55, 45, 55, 45, 55), -1)
                    "heavy" -> VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE)
                    "click" -> VibrationEffect.createOneShot(18, VibrationEffect.DEFAULT_AMPLITUDE)
                    else -> VibrationEffect.createOneShot(12, VibrationEffect.DEFAULT_AMPLITUDE)
                }
                vibrator.vibrate(effect)
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(18)
            }
        } catch (_: Exception) {
            /* best effort */
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
