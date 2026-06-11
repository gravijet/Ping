import 'package:flutter/material.dart';

import '../widgets/update_sheet.dart';
import 'backup_screen.dart';
import 'design_screen.dart';
import 'profile_edit_screen.dart';
import 'saved_messages_screen.dart';
import 'security_screen.dart';
import 'settings_screen.dart';
import 'settings_sections.dart';

/// Open the in-app screen an admin notification deep-links to. Names match the
/// server's `appRouteSchema` (and the admin portal's target dropdown).
void navigateToAppRoute(BuildContext context, String route) {
  switch (route) {
    case 'update':
      showUpdateSheet(context);
      return;
    case 'home':
      return; // already the inbox
  }

  final Widget? screen = switch (route) {
    'settings' => const SettingsScreen(),
    'privacy' => const PrivacySettingsScreen(),
    'notifications' => const NotificationSettingsScreen(),
    'design' => const DesignScreen(),
    'security' => const SecurityScreen(),
    'backup' => const BackupScreen(),
    'saved' => const SavedMessagesScreen(),
    'profile' => const ProfileEditScreen(),
    _ => null,
  };
  if (screen != null) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));
  }
}
