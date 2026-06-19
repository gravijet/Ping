package com.gravijet.ping

import android.content.SharedPreferences
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * A Quick Settings tile that snoozes Ping's message notifications for an hour —
 * a true OS-surface control the user can reach from the notification shade
 * without opening the app. Tapping toggles snooze on/off.
 *
 * State lives in the *same* preferences store Flutter uses
 * (`FlutterSharedPreferences`, `flutter.`-prefixed keys), so the app — and the
 * notification code in both the foreground and the background isolate — reads
 * `ping_snooze_until` and stays silent while it is in the future. No extra IPC.
 */
class PingTileService : TileService() {
    private val key = "flutter.ping_snooze_until"
    private val snoozeMs = 60L * 60L * 1000L // one hour

    private fun prefs(): SharedPreferences =
        getSharedPreferences("FlutterSharedPreferences", MODE_PRIVATE)

    override fun onStartListening() {
        super.onStartListening()
        updateTile()
    }

    override fun onClick() {
        super.onClick()
        val now = System.currentTimeMillis()
        val until = prefs().getLong(key, 0L)
        val next = if (until > now) 0L else now + snoozeMs
        prefs().edit().putLong(key, next).apply()
        updateTile()
    }

    private fun updateTile() {
        val tile = qsTile ?: return
        val snoozed = prefs().getLong(key, 0L) > System.currentTimeMillis()
        tile.state = if (snoozed) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        tile.label = "Ping"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = if (snoozed) "Stumm (1 Std.)" else "Benachrichtigungen an"
        }
        tile.updateTile()
    }
}
