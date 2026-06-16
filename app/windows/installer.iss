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

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
