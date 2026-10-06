; One installer for both architectures: the Arm64 files on Arm64 Windows and the
; x64 files everywhere else. scripts/package-windows.sh installer compiles it,
; with HQPTUNER_VERSION in the environment. With HQPTUNER_SIGN_THUMBPRINT there
; too, the installer and the uninstaller are signed by the sign tool that
; script defines as "hqptuner".
;
; The install is per user, so it asks for no elevation. Removing it leaves the
; stores under %LOCALAPPDATA%\HQPTuner where they are.

#define Version GetEnv("HQPTUNER_VERSION")
#if Version == ""
  #error HQPTUNER_VERSION is not set
#endif

[Setup]
AppId={{8F3B6C1E-5A47-4D0B-9E2C-7B1A64D3F0A9}
AppName=HQPTuner
AppVersion={#Version}
DefaultDirName={autopf}\HQPTuner
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible or arm64
ArchitecturesInstallIn64BitMode=x64compatible or arm64
UninstallDisplayIcon={app}\HQPTuner.exe
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
; Paths below are relative to the repository root.
SourceDir=..\..
OutputDir=dist
OutputBaseFilename=HQPTuner-{#Version}-setup
#if GetEnv("HQPTUNER_SIGN_THUMBPRINT") != ""
SignTool=hqptuner
SignedUninstaller=yes
#endif

[Files]
Source: "dist\windows\arm64\HQPTuner\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion; Check: PreferArm64Files
Source: "dist\windows\x64\HQPTuner\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion solidbreak; Check: PreferX64Files

[Icons]
Name: "{autoprograms}\HQPTuner"; Filename: "{app}\HQPTuner.exe"

[Run]
Filename: "{app}\HQPTuner.exe"; Description: "{cm:LaunchProgram,HQPTuner}"; Flags: nowait postinstall skipifsilent

[Code]
function PreferArm64Files: Boolean;
begin
  Result := IsArm64;
end;

function PreferX64Files: Boolean;
begin
  Result := not PreferArm64Files and IsX64Compatible;
end;
