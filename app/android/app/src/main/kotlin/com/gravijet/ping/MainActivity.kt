package com.gravijet.ping

import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Exposes the device's primary CPU ABI so the in-app updater can fetch the
        // matching per-ABI APK split (a much smaller download than the universal).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "ping/native")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "primaryAbi" -> result.success(Build.SUPPORTED_ABIS.firstOrNull() ?: "")
                    else -> result.notImplemented()
                }
            }
    }
}
