package com.gravijet.ping

import android.os.Build
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

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
                    else -> result.notImplemented()
                }
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
