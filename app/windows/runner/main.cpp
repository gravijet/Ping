#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include "flutter_window.h"
#include "utils.h"

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t *command_line, _In_ int show_command) {
  // Attach to console when present (e.g., 'flutter run') or create a
  // new console when running with a debugger.
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  // Single instance: if Ping is already running (e.g. launched again from the
  // tray shortcut or at login), focus the existing window instead of opening a
  // second copy. The mutex handle is intentionally leaked for the process life.
  HANDLE singleton = ::CreateMutexW(nullptr, TRUE, L"Local\\PingDesktopSingleInstance");
  if (singleton != nullptr && ::GetLastError() == ERROR_ALREADY_EXISTS) {
    HWND existing = nullptr;
    while ((existing = ::FindWindowExW(nullptr, existing,
                                       L"FLUTTER_RUNNER_WIN32_WINDOW", nullptr)) != nullptr) {
      wchar_t title[256] = {0};
      ::GetWindowTextW(existing, title, 256);
      const bool is_ping = title[0] == L'P' && title[1] == L'i' &&
                           title[2] == L'n' && title[3] == L'g';
      if (is_ping) {
        ::ShowWindow(existing, SW_SHOW);
        if (::IsIconic(existing)) ::ShowWindow(existing, SW_RESTORE);
        ::SetForegroundWindow(existing);
        break;
      }
    }
    return EXIT_SUCCESS;
  }

  // Initialize COM, so that it is available for use in the library and/or
  // plugins.
  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");

  std::vector<std::string> command_line_arguments =
      GetCommandLineArguments();

  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  Win32Window::Point origin(10, 10);
  Win32Window::Size size(1100, 760);
  if (!window.Create(L"Ping", origin, size)) {
    return EXIT_FAILURE;
  }
  window.SetQuitOnClose(true);

  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
