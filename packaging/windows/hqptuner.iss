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

#define ListenHost "0.0.0.0"

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
ChangesEnvironment=yes
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

[Registry]
; The app listens on every address, as the Linux service and the container do.
Root: HKCU; Subkey: "Environment"; ValueType: string; ValueName: "HQPTUNER_LISTEN_HOST"; ValueData: "{#ListenHost}"; Flags: uninsdeletevalue

[Icons]
Name: "{autoprograms}\HQPTuner"; Filename: "{app}\HQPTuner.exe"

[Run]
Filename: "{app}\HQPTuner.exe"; Description: "{cm:LaunchProgram,HQPTuner}"; Flags: nowait postinstall; Check: LaunchWanted

[Code]
function SetEnvironmentVariableW(Name, Value: String): Integer;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

function PreferArm64Files: Boolean;
begin
  Result := IsArm64;
end;

function PreferX64Files: Boolean;
begin
  Result := not PreferArm64Files and IsX64Compatible;
end;

// The finish page offers the launch. A silent install starts the app only when
// its command line carries /LAUNCH.
function LaunchWanted: Boolean;
var
  I: Integer;
begin
  Result := not WizardSilent;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/LAUNCH') = 0 then
      Result := True;
end;

// The registry value above reaches only processes started after it is written.
// Setup's own environment is what the launch from [Run] inherits.
function InitializeSetup: Boolean;
begin
  SetEnvironmentVariableW('HQPTUNER_LISTEN_HOST', '{#ListenHost}');
  Result := True;
end;
