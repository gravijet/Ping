#include "flutter_window.h"

#include <shobjidl_core.h>
#include <windows.h>

#include <optional>

#include "flutter/generated_plugin_registrant.h"
#include "resource.h"

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  // "ping/native": the web client (via the Dart shell) asks for a real taskbar
  // overlay badge and a taskbar flash — capabilities no Flutter plugin exposes.
  native_channel_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          flutter_controller_->engine()->messenger(), "ping/native",
          &flutter::StandardMethodCodec::GetInstance());
  native_channel_->SetMethodCallHandler(
      [this](const auto& call, auto result) {
        HandleNative(call, std::move(result));
      });

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_FONTCHANGE:
      flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}

void FlutterWindow::HandleNative(
    const flutter::MethodCall<flutter::EncodableValue>& call,
    std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
  const std::string& method = call.method_name();
  if (method == "flash") {
    FlashTaskbar();
    result->Success();
  } else if (method == "overlayBadge") {
    int count = 0;
    if (const auto* args = std::get_if<flutter::EncodableMap>(call.arguments())) {
      auto it = args->find(flutter::EncodableValue("count"));
      if (it != args->end()) {
        if (const auto* v = std::get_if<int>(&it->second)) count = *v;
        else if (const auto* v64 = std::get_if<int64_t>(&it->second))
          count = static_cast<int>(*v64);
      }
    }
    SetOverlayBadge(count);
    result->Success();
  } else {
    result->NotImplemented();
  }
}

// A static red dot baked into the resources (correct alpha) is toggled as the
// taskbar overlay icon; the exact unread count rides along in the window title
// and tray tooltip. No runtime GDI alpha juggling — robust and cheap.
void FlutterWindow::SetOverlayBadge(int count) {
  HWND hwnd = GetHandle();
  if (!hwnd) return;
  ITaskbarList3* taskbar = nullptr;
  if (FAILED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&taskbar)))) {
    return;
  }
  if (SUCCEEDED(taskbar->HrInit())) {
    if (count > 0) {
      HICON icon = static_cast<HICON>(
          LoadImage(GetModuleHandle(nullptr), MAKEINTRESOURCE(IDI_APP_ICON_BADGE),
                    IMAGE_ICON, GetSystemMetrics(SM_CXSMICON),
                    GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR));
      taskbar->SetOverlayIcon(hwnd, icon, L"Ungelesene Nachrichten");
      if (icon) DestroyIcon(icon);
    } else {
      taskbar->SetOverlayIcon(hwnd, nullptr, L"");
    }
  }
  taskbar->Release();
}

void FlutterWindow::FlashTaskbar() {
  HWND hwnd = GetHandle();
  if (!hwnd || GetForegroundWindow() == hwnd) return;
  FLASHWINFO fi = {sizeof(FLASHWINFO)};
  fi.hwnd = hwnd;
  fi.dwFlags = FLASHW_TRAY | FLASHW_TIMERNOFG;
  fi.uCount = 3;
  fi.dwTimeout = 0;
  FlashWindowEx(&fi);
}
