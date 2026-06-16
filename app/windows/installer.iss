; Inno Setup script for the Ping Windows desktop app.
; Compiled by the GitHub Actions workflow (.github/workflows/windows-build.yml)
; after `flutter build windows --release`. The version and source folder are
; passed in on the ISCC command line:
;   ISCC /DMyAppVersion=0.13.0 /DMySrcDir=...\Release installer.iss
; Produces dist\Ping-Windows-Setup.exe — a stable name so the website can link
; the GitHub "latest release" asset directly.

#define MyAppName "Ping"
#define MyAppPublisher "Ping"
#define MyAppURL "https://example.invalid"
#define MyAppExeName "ping.exe"

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

; Folder holding the Flutter release build (ping.exe + DLLs + data\). Defaults
; to the standard build output relative to this script (app\windows\).
#ifndef MySrcDir
  #define MySrcDir "..\build\windows\x64\runner\Release"
#endif

[Setup]
AppId={{8E1B7C4A-2D5F-4C9A-9F2E-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Per-user install needs no admin rights.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist
OutputBaseFilename=Ping-Windows-Setup
SetupIconFile=runner\resources\app_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The whole release folder: the exe, its runtime DLLs and the data\ bundle.
Source: "{#MySrcDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

; Ping for Windows renders the web client through Microsoft Edge WebView2. The
; Evergreen runtime ships with current Windows 10/11, but on older machines it
; may be missing — so if the workflow bundled the bootstrapper next to this
; script, silently install the runtime first when it's not already present.
#define WV2Bootstrapper "MicrosoftEdgeWebview2Setup.exe"
#if FileExists(WV2Bootstrapper)
[Files]
Source: "{#WV2Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: WebView2Missing
#endif

[Run]
#if FileExists(WV2Bootstrapper)
Filename: "{tmp}\{#WV2Bootstrapper}"; Parameters: "/silent /install"; StatusMsg: "Installiere Microsoft Edge WebView2-Laufzeit ..."; Check: WebView2Missing; Flags: waituntilterminated
#endif
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// True when the WebView2 Evergreen runtime is not registered (per-machine or
// per-user). The GUID is Microsoft's fixed client id for the runtime.
function WebView2Missing(): Boolean;
var
  Pv: string;
const
  Client = 'Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
begin
  Result := True;
  if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\' + Client, 'pv', Pv) and (Pv <> '') and (Pv <> '0.0.0.0') then
    Result := False
  else if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\' + Client, 'pv', Pv) and (Pv <> '') and (Pv <> '0.0.0.0') then
    Result := False
  else if RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\' + Client, 'pv', Pv) and (Pv <> '') and (Pv <> '0.0.0.0') then
    Result := False;
end;
