#!/usr/bin/env bash
# Install a built installer silently, run the app once, stop it, then uninstall.
# A silent install without /LAUNCH must start nothing. A silent install with it
# must start the app, and that app, which the installer itself started, must
# answer at the runner's own network address. So must the installed app when it
# is started the way a Start Menu launch starts it.
# Installing over the previous release must leave an app that starts, keeps
# running, shows no visible window and holds a tray icon of its own, and the
# uninstaller must still work after it. That holds whether the previous release's
# app was quit first or left running; when it was left running, none of it may
# remain once the installer returns. After either, the uninstaller must leave no
# install directory.
# The tray judgment runs on a desktop that has finished first logon: before the
# upgrade, any WWAHost.exe the runner left running (the first-logon privacy
# screen of the Arm64 image) is stopped by PID, and the taskbar must exist.
# An upgraded app whose bundled tray image is missing must fail that same check:
# a control starts one and requires the rejection to name the error dialog.
# Given a bundle directory instead, run the app from it with no install around it.
# With --signed, Windows must also accept the signature on the installer, the
# executable and the uninstaller, each with a timestamp.
# An installer target also needs --previous, the setup.exe of the release it
# upgrades; a missing or absent one is refused rather than skipping the upgrade.
# usage: packaging/windows/smoke.sh <setup.exe|bundle-dir> <x64|arm64> [--signed] [--previous <setup.exe>]
set -euo pipefail

die() { echo "FAIL: $*" >&2; exit 1; }

USAGE="usage: smoke.sh <setup.exe|bundle-dir> <x64|arm64> [--signed] [--previous <setup.exe>]"
[ $# -ge 2 ] || die "$USAGE"
[ -e "$1" ] || die "step 1: target not found: $1"
TARGET=$1
case "$2" in
  x64)   MACHINE=8664 ;;
  arm64) MACHINE=aa64 ;;
  *) die "$USAGE" ;;
esac
SIGNED=""
PREVIOUS=""
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --signed) SIGNED=--signed; shift ;;
    --previous)
      [ $# -ge 2 ] || die "$USAGE"
      PREVIOUS=$2; shift 2 ;;
    *) die "$USAGE" ;;
  esac
done
if [ ! -d "$TARGET" ]; then
  [ -n "$PREVIOUS" ] || die "step 1: an installer target needs --previous, the installer of the release it upgrades"
  [ -f "$PREVIOUS" ] || die "step 1: the previous installer is not found: $PREVIOUS"
fi
BASE_URL="http://127.0.0.1:8090"
LISTEN_HOST=""
SHORTCUT="$APPDATA/Microsoft/Windows/Start Menu/Programs/HQPTuner.lnk"
PID=""
STANDIN_PID=""
INSTALLED_PID=""
PREV_PID=""
UP_PID=""
BROKEN_PID=""
UPGRADE_APP=""
UPGRADE_DATA=""
UPGRADE_LOG=""
WORK=$(mktemp -d)

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  if [ -n "$STANDIN_PID" ]; then kill "$STANDIN_PID" 2>/dev/null || true; fi
  for WINPID in $INSTALLED_PID $PREV_PID $UP_PID $BROKEN_PID; do stop_windows_pid "$WINPID" || true; done
  rm -rf "$WORK" || true
}
trap cleanup EXIT

# A variable from the user's environment in the registry, empty when unset.
user_env() {
  powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('$1', 'User')" | tr -d '\r'
}

# The runner's first IPv4 address that is neither loopback nor link-local. The
# lookup goes through CIM and is slow on the Arm64 runner, and the address does
# not change during a run, so the first answer is kept in $WORK.
lan_address() {
  local cache="$WORK/lan-address"
  if [ ! -s "$cache" ]; then
    powershell -NoProfile -Command \
      'Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127|169\.254)\." } | Select-Object -First 1 -ExpandProperty IPAddress' \
      | tr -d '\r' > "$cache"
  fi
  cat "$cache"
}

# Every top-level window of the process with Windows PID $1, one line each, tab
# separated: handle, class name, 1 or 0 for visible, the HRESULT that
# Shell_NotifyIconGetRect returns for an icon registered by that window with uID
# 0 (0x00000000 is S_OK, so an icon is there), and the title. A last line "end"
# proves the whole script ran. The query only reads: no window is closed, shown
# or sent input, and no icon is touched. The script travels in a file and the
# values in the environment, because PowerShell reads everything after -Command as
# script text. Invoke-Expression runs it, so no execution policy applies.
app_windows() {
  local script="$WORK/app-windows.ps1" out
  if [ ! -s "$script" ]; then
    cat > "$script" <<'POWERSHELL'
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SmokeWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct IconId { public uint Size; public IntPtr Wnd; public uint Id; public Guid Item; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref IconId id, out Rect r);
  static string Clean(string s) { return s.Replace("\t", " ").Replace("\r", " ").Replace("\n", " "); }
  public static string[] Report(uint pid) {
    var lines = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint owner;
      GetWindowThreadProcessId(h, out owner);
      if (owner != pid) return true;
      var cls = new StringBuilder(256);
      GetClassNameW(h, cls, cls.Capacity);
      var title = new StringBuilder(512);
      GetWindowTextW(h, title, title.Capacity);
      var id = new IconId();
      id.Size = (uint)Marshal.SizeOf(typeof(IconId));
      id.Wnd = h;
      id.Id = 0;
      Rect r;
      int hr = Shell_NotifyIconGetRect(ref id, out r);
      lines.Add(string.Format("{0:X}\t{1}\t{2}\t0x{3:X8}\t{4}", h.ToInt64(), Clean(cls.ToString()), IsWindowVisible(h) ? 1 : 0, hr, Clean(title.ToString())));
      return true;
    }, IntPtr.Zero);
    return lines.ToArray();
  }
}
'@
[SmokeWindows]::Report([uint32]$env:SMOKE_WINDOWS_PID)
"end"
POWERSHELL
  fi
  out=$(SMOKE_WINDOWS_PID="$1" SMOKE_SCRIPT="$(cygpath -w "$script")" powershell -NoProfile -Command \
    'Get-Content -Raw -LiteralPath $env:SMOKE_SCRIPT | Invoke-Expression' | tr -d '\r') || return 1
  printf '%s\n' "$out" | tail -n 1 | grep -qx end || { printf '%s\n' "$out" >&2; return 1; }
  printf '%s\n' "$out"
}

# The handle of the runner's taskbar, the top-level window of class
# Shell_TrayWnd, as hex, or "none" when there is no such window. A last line
# "end" proves the whole script ran. The query only reads. It travels in a file
# for the reasons app_windows gives.
taskbar_window() {
  local script="$WORK/taskbar-window.ps1" out
  if [ ! -s "$script" ]; then
    cat > "$script" <<'POWERSHELL'
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SmokeTaskbar {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowW(string cls, string title);
  public static string Handle() {
    IntPtr h = FindWindowW("Shell_TrayWnd", null);
    return h == IntPtr.Zero ? "none" : h.ToInt64().ToString("X");
  }
}
'@
[SmokeTaskbar]::Handle()
"end"
POWERSHELL
  fi
  out=$(SMOKE_SCRIPT="$(cygpath -w "$script")" powershell -NoProfile -Command \
    'Get-Content -Raw -LiteralPath $env:SMOKE_SCRIPT | Invoke-Expression' | tr -d '\r') || return 1
  printf '%s\n' "$out" | tail -n 1 | grep -qx end || { printf '%s\n' "$out" >&2; return 1; }
  printf '%s\n' "$out" | sed -n 1p
}

# The Windows PIDs of every running WWAHost.exe, whether or not it owns a window.
wwahost_pids() {
  windows_processes | awk -F'\t' '{ n = split($2, part, /[\\\/]/); if (tolower(part[n]) ~ /^wwahost(\.exe)?$/) print $1 }'
}

# Bring the runner's desktop to a finished first logon before the tray is
# judged. The Arm64 image starts jobs while WWAHost.exe, its first-logon privacy
# screen, is still running. Each WWAHost.exe is stopped by PID and given 10 s to
# go; Explorer is not restarted and no other image is stopped. Where none runs,
# nothing is stopped and there is no wait. Then
# no WWAHost.exe may remain and the taskbar must exist, or the row fails here,
# naming the runner's desktop, so a red tray judgment later means the app failed.
settle_desktop() {
  local pids pid taskbar
  pids=$(wwahost_pids)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      echo "step 8 (runner desktop): stopping WWAHost.exe, PID $pid"
      stop_windows_pid "$pid"
    done
    sleep 10
    pids=$(wwahost_pids)
    [ -z "$pids" ] || die "step 8 (runner desktop): WWAHost.exe still running 10 s after stop, PID $(printf '%s ' $pids)"
  else
    echo "step 8 (runner desktop): no WWAHost.exe running, nothing stopped"
  fi
  taskbar=$(taskbar_window) || die "step 8 (runner desktop): the taskbar query failed"
  [ "$taskbar" != none ] || die "step 8 (runner desktop): the runner's desktop has no taskbar (no Shell_TrayWnd window)"
  echo "step 8 (runner desktop): taskbar window 0x$taskbar, no WWAHost.exe running"
}

# The query result for the first visible window titled $2 in the report $1, empty
# when there is none.
titled_window_result() {
  printf '%s\n' "$1" | awk -F'\t' -v title="$2" '!seen && $3 == "1" && $5 == title { print $4; seen = 1 }'
}

# Succeeds when the report $1 holds a window of pystray's tray class that the
# query answers S_OK for. The class name is matched on pystray's suffix alone.
tray_registered() {
  printf '%s\n' "$1" | awk -F'\t' '$2 ~ /SystemTrayIcon$/ && $4 == "0x00000000" { found = 1 } END { exit !found }'
}

# Every running process as one "<Windows PID><TAB><image>" line, from Git Bash's
# ps -W, which is much quicker than WMI. The columns are fixed width and a status
# letter may lead a line, so WINPID and COMMAND are cut at the header's column
# positions, not by field number. A process this shell started is tracked by the
# Cygwin runtime and listed by its program path, as a POSIX path and without
# ".exe" (ps.cc strips the suffix); any other process shows its Windows image
# path. An exited child not yet reaped carries " <defunct>" and is not running,
# so it is dropped.
windows_processes() {
  ps -W | awk '
    NR == 1 { pid_end = index($0, "WINPID") + 5; command = index($0, "COMMAND"); next }
    {
      head = substr($0, 1, pid_end)
      count = split(head, field, " ")
      image = substr($0, command)
      sub(/[ \t]+$/, "", image)
      if (count > 0 && field[count] ~ /^[0-9]+$/ && image != "" && image !~ / <defunct>$/) print field[count] "\t" image
    }'
}

# The Windows PIDs of running HQPTuner processes whose image lies under the
# directory $1. Git Bash's kill and kill -0 do not address a Windows PID. A
# process keeps the spelling of the path it was started with, long or 8.3 short,
# and one this shell started shows a POSIX path without ".exe". So the name is
# matched with or without the suffix, and the directory of each candidate and the
# directory $1 are made absolute long Windows paths before they are compared,
# without regard to case. The directory exists, so it converts where a suffixless
# file name might not.
running_under() {
  local dir image base imagedir winpid
  dir=$(cygpath -awl "$1")
  dir="${dir,,}\\"
  while IFS=$'\t' read -r winpid image; do
    base=${image##*[\\/]}
    base=${base,,}
    [ "${base%.exe}" = hqptuner ] || continue
    case "$image" in
      *[\\/]*) imagedir=$(cygpath -awl "${image%[\\/]*}") ;;
      *) continue ;;
    esac
    imagedir="${imagedir,,}\\"
    if [ "${imagedir#"$dir"}" != "$imagedir" ]; then echo "$winpid"; fi
  done < <(windows_processes)
}

# What running_under saw, for a log: the directory in each spelling it matched
# on, the raw ps -W header and every ps -W line naming HQPTuner (what the lookup
# parsed), and every process named like HQPTuner with its parent and image path
# from CIM.
describe_lookup() {
  echo "lookup under: $(cygpath -aw "$1") | $(cygpath -awl "$1") | $(cygpath -aws "$1")" >&2
  ps -W | awk 'NR == 1 { print "ps -W header [" $0 "]"; next } tolower($0) ~ /hqptuner/ { print "ps -W line [" $0 "]" }' >&2 || true
  powershell -NoProfile -Command \
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*HQPTuner*" } | ForEach-Object { "process $($_.ProcessId) parent $($_.ParentProcessId) name $($_.Name) image [$($_.ExecutablePath)]" }' \
    | tr -d '\r' >&2 || true
  echo "lookup end" >&2
}

windows_pid_alive() {
  windows_processes | awk -F'\t' -v pid="$1" '$1 == pid { found = 1 } END { exit !found }'
}

# Native taskkill by PID; the path conversion must not turn /PID and /F into paths.
# A process that is already gone is not an error.
stop_windows_pid() {
  [ -n "$1" ] || return 0
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' taskkill /PID "$1" /F > /dev/null 2>&1 || true
}

# Run the uninstaller of the install at $2, by default $APP, and wait, at most
# 10 s, for it to finish. The uninstaller hands off to a temp copy and returns at
# once; that copy removes the exe and then the uninstaller itself, so both must
# be gone.
uninstall() {
  local dir=${2:-$APP}
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$dir/unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART \
    || die "$1: the uninstaller failed"
  for _ in $(seq 1 10); do
    if [ ! -e "$dir/HQPTuner.exe" ] && [ ! -e "$dir/unins000.exe" ]; then return 0; fi
    sleep 1
  done
  [ ! -e "$dir/HQPTuner.exe" ] || die "$1: $dir/HQPTuner.exe still present 10 s after uninstall"
  die "$1: $dir/unins000.exe still present 10 s after uninstall"
}

# Fail an upgrade path. Setup's own log and the process lookup come first, so a
# red run shows what Setup did with the old files.
upgrade_die() {
  if [ -f "$UPGRADE_LOG" ]; then
    echo "--- Setup log $UPGRADE_LOG ---" >&2
    cat "$UPGRADE_LOG" >&2
    echo "--- end of Setup log ---" >&2
  fi
  describe_lookup "$UPGRADE_APP"
  die "$*"
}

# Point the upgrade helpers at their own directories under $WORK.
upgrade_begin() {
  UPGRADE_APP="$WORK/$1/app"
  UPGRADE_DATA="$WORK/$1/data"
  UPGRADE_LOG="$WORK/$1/setup.log"
  mkdir -p "$UPGRADE_DATA"
}

# Install the previous release into $UPGRADE_APP and start its app. That release
# has no /LAUNCH, so the app is started here and tracked by its Windows PID. It
# gets the stores and the BROWSER of step 3, and no listen host, so it is
# loopback only. Returns once its health answers and its tray has been built.
start_previous() {
  [ "$(status "$BASE_URL/api/health")" = 000 ] || die "$1: something already answers on $BASE_URL"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$PREVIOUS" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART \
    "/DIR=$(cygpath -w "$UPGRADE_APP")" || die "$1: the previous installer failed"
  env -u HQPTUNER_LISTEN_HOST LOCALAPPDATA="$(cygpath -w "$UPGRADE_DATA")" BROWSER="$(cygpath -w /usr/bin/true)" \
    "$UPGRADE_APP/HQPTuner.exe" &
  for _ in $(seq 1 10); do
    PREV_PID=$(running_under "$UPGRADE_APP")
    if [ -n "$PREV_PID" ]; then break; fi
    sleep 1
  done
  case "$PREV_PID" in
    ''|*[!0-9]*)
      describe_lookup "$UPGRADE_APP"
      die "$1: expected one previous-release HQPTuner.exe, found: '$PREV_PID'" ;;
  esac
  local code=000
  for _ in $(seq 1 30); do
    code=$(status "$BASE_URL/api/health")
    if [ "$code" = 200 ]; then break; fi
    windows_pid_alive "$PREV_PID" || die "$1: the previous-release app exited before GET /api/health answered"
    sleep 1
  done
  [ "$code" = 200 ] || die "$1: GET /api/health answered $code after 30 tries on the previous-release app"
  for _ in $(seq 1 5); do
    windows_pid_alive "$PREV_PID" || die "$1: the previous-release app exited within 5 s of answering"
    sleep 1
  done
}

# Stop the process $2 by PID and wait, at most 10 s, for it to be gone.
stop_and_wait() {
  stop_windows_pid "$2"
  for _ in $(seq 1 10); do
    windows_pid_alive "$2" || return 0
    sleep 1
  done
  die "$1: PID $2 still running 10 s after stop"
}

# Run the installer under test over $UPGRADE_APP, with the environment of step
# 2a, so /LAUNCH starts the app the way a wizard upgrade that keeps its finish
# page box ticked does. The previous release's stores are reused, as a user's are.
install_over() {
  env -u HQPTUNER_LISTEN_HOST LOCALAPPDATA="$(cygpath -w "$UPGRADE_DATA")" BROWSER="$(cygpath -w /usr/bin/true)" \
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$TARGET" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LAUNCH \
    "/DIR=$(cygpath -w "$UPGRADE_APP")" "/LOG=$(cygpath -w "$UPGRADE_LOG")" \
    || upgrade_die "$1: the installer failed over the previous release"
}

# The visible windows in the report $1 as one line: each title and class.
visible_windows() {
  printf '%s\n' "$1" | awk -F'\t' '$3 == "1" { printf "%s\"%s\" (class %s)", sep, $5, $2; sep = ", " }'
}

# The judgment on an upgraded app with Windows PID $1 that has answered
# /api/health. It prints one finding per line and succeeds when there are none.
# The app must stay alive for 5 s, show no visible top-level window, and hold a
# tray icon of its own. check_upgraded and the broken-tray control both call it,
# so they cannot drift.
judge_upgraded() {
  local report visible
  for _ in $(seq 1 5); do
    if ! windows_pid_alive "$1"; then
      echo "the upgraded app exited within 5 s of answering"
      return 1
    fi
    sleep 1
  done
  report=$(app_windows "$1") || { echo "the window report for the upgraded app failed"; return 1; }
  echo "judgment: windows of PID $1 (handle, class, visible, tray query, title):" >&2
  printf '%s\n' "$report" >&2
  visible=$(visible_windows "$report")
  [ -z "$visible" ] || echo "the upgraded app shows a visible window: $visible"
  tray_registered "$report" || echo "no tray icon is registered for the upgraded app"
  [ -z "$visible" ] && tray_registered "$report"
}

# The app the upgrade started must be the only one under $UPGRADE_APP, answer on
# loopback, pass the judgment, answer at the runner's network address, and stop
# when asked.
check_upgraded() {
  for _ in $(seq 1 10); do
    UP_PID=$(running_under "$UPGRADE_APP")
    if [ -n "$UP_PID" ]; then break; fi
    sleep 1
  done
  case "$UP_PID" in
    ''|*[!0-9]*) upgrade_die "$1: expected one upgraded HQPTuner.exe, found: '$UP_PID'" ;;
  esac
  local code=000
  for _ in $(seq 1 30); do
    code=$(status "$BASE_URL/api/health")
    if [ "$code" = 200 ]; then break; fi
    windows_pid_alive "$UP_PID" || upgrade_die "$1: the upgraded app exited before GET /api/health answered"
    sleep 1
  done
  [ "$code" = 200 ] || upgrade_die "$1: GET /api/health answered $code after 30 tries on the upgraded app"
  local findings
  if ! findings=$(judge_upgraded "$UP_PID"); then upgrade_die "$1: ${findings//$'\n'/; }"; fi
  ADDRESS=$(lan_address)
  [ -n "$ADDRESS" ] || upgrade_die "$1: the runner has no network address besides loopback"
  code=$(status "http://$ADDRESS:8090/api/health")
  [ "$code" = 200 ] || upgrade_die "$1: address check: the upgraded app at $ADDRESS answered $code"
  stop_and_wait "$1" "$UP_PID"
  UP_PID=""
}

# The reported symptom: the upgraded install lacks the bundled tray image, the
# app's tray load raises, and the windowed bootloader leaves the process alive
# behind an "Unhandled exception in script" dialog. This removes that one file,
# starts the app, and requires three things of it before the judgment runs: the
# dialog is a visible window, the tray query answers that window with no icon,
# and no tray icon is registered. Then the judgment must reject the app and name
# the dialog. The app's /api/health is never read, because its server may never
# answer. The app is stopped by PID before the verdict is acted on.
broken_tray_control() {
  local label="$1: control" image="$UPGRADE_APP/_internal/data/tray.png"
  local dialog="Unhandled exception in script" report="" result="" findings verdict=0
  [ -f "$image" ] || die "$label: $image is not in the upgraded install, so removing it proves nothing"
  rm -f "$image"
  HQPTUNER_LISTEN_HOST="$LISTEN_HOST" LOCALAPPDATA="$(cygpath -w "$UPGRADE_DATA")" BROWSER="$(cygpath -w /usr/bin/true)" \
    "$UPGRADE_APP/HQPTuner.exe" &
  for _ in $(seq 1 10); do
    BROKEN_PID=$(running_under "$UPGRADE_APP")
    if [ -n "$BROKEN_PID" ]; then break; fi
    sleep 1
  done
  case "$BROKEN_PID" in
    ''|*[!0-9]*) upgrade_die "$label: expected one HQPTuner.exe without its tray image, found: '$BROKEN_PID'" ;;
  esac
  for _ in $(seq 1 20); do
    report=$(app_windows "$BROKEN_PID") || upgrade_die "$label: the window report for PID $BROKEN_PID failed"
    result=$(titled_window_result "$report" "$dialog")
    if [ -n "$result" ]; then break; fi
    windows_pid_alive "$BROKEN_PID" || upgrade_die "$label: the app without its tray image exited and showed no dialog"
    sleep 1
  done
  echo "$label: windows of PID $BROKEN_PID (handle, class, visible, tray query, title):" >&2
  printf '%s\n' "$report" >&2
  [ -n "$result" ] || upgrade_die "$label: no visible window titled '$dialog' after 20 tries"
  [ "$result" != 0x00000000 ] || upgrade_die "$label: the tray query answered S_OK for the '$dialog' window"
  if tray_registered "$report"; then upgrade_die "$label: a tray icon is registered for the app without its tray image"; fi
  findings=$(judge_upgraded "$BROKEN_PID") || verdict=$?
  stop_and_wait "$label" "$BROKEN_PID"
  BROKEN_PID=""
  [ "$verdict" -ne 0 ] || upgrade_die "$label: the upgraded-app check accepted an install whose tray image is missing"
  echo "$label: the upgraded-app check rejected it: ${findings//$'\n'/; }" >&2
  case "$findings" in
    *"$dialog"*) ;;
    *) upgrade_die "$label: the upgraded-app check rejected the app without naming '$dialog': ${findings//$'\n'/; }" ;;
  esac
}

# Uninstall the upgraded install. The uninstaller removes the directory after
# its own executable, so the directory gets at most 10 s to go.
uninstall_upgraded() {
  uninstall "$1" "$UPGRADE_APP"
  for _ in $(seq 1 10); do
    if [ ! -e "$UPGRADE_APP" ]; then return 0; fi
    sleep 1
  done
  die "$1: $UPGRADE_APP still present 10 s after uninstall"
}

# The previous release, quit before the installer runs.
upgrade_quit() {
  upgrade_begin upgrade-quit
  start_previous "step 8 (previous release quit)"
  stop_and_wait "step 8 (previous release quit)" "$PREV_PID"
  PREV_PID=""
  install_over "step 8 (previous release quit)"
  check_upgraded "step 8 (previous release quit)"
  broken_tray_control "step 8 (previous release quit)"
  uninstall_upgraded "step 8 (previous release quit)"
}

# The previous release, left running while the installer runs. Setup must have
# closed it by the time it returns. A survivor holds port 8090 and sits under the
# directory, so this check comes before the upgraded app is looked up.
upgrade_running() {
  local label="step 9 (previous release running)"
  upgrade_begin upgrade-running
  start_previous "$label"
  install_over "$label"
  if windows_pid_alive "$PREV_PID"; then
    upgrade_die "$label: previous-release PID $PREV_PID still running when the installer returned"
  fi
  PREV_PID=""
  check_upgraded "$label"
  uninstall_upgraded "$label"
}

status() { curl -s -o /dev/null --max-time "${2:-2}" -w '%{http_code}' "${@:3}" "$1" || true; }

# The address hqplayerd's 8088 would have, as step 3 pins the app to it.
STANDIN_ADDRESS=127.0.0.2
STANDIN_PORT=8088

# Answer the credential wire where the app dials: 401 and a Digest challenge to a
# request with no Authorization header, 200 to one with it, on every path. The
# job has no Python, so this is an HttpListener. It never checks a digest, so it
# proves the app is logged in before it asks for discovery, not that a pair is
# right. The script travels in a file for the reasons app_windows gives.
start_standin() {
  local script="$WORK/standin.ps1"
  [ "$(status "http://$STANDIN_ADDRESS:$STANDIN_PORT/")" = 000 ] || die "step 4: something already answers on $STANDIN_ADDRESS:$STANDIN_PORT"
  cat > "$script" <<'POWERSHELL'
$ErrorActionPreference = "Stop"
$challenge = 'Digest realm="com.signalyst.hqplayer.embedded", qop="auth", algorithm=MD5, nonce="1f3a9c2b4d5e6f70", opaque="0a1b2c3d4e5f6071", charset=UTF-8'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://$($env:STANDIN_ADDRESS):$($env:STANDIN_PORT)/")
$listener.Start()
while ($true) {
  $context = $listener.GetContext()
  $response = $context.Response
  if ($context.Request.Headers["Authorization"]) {
    $response.StatusCode = 200
  } else {
    $response.StatusCode = 401
    $response.AddHeader("WWW-Authenticate", $challenge)
  }
  $response.ContentLength64 = 0
  $response.Close()
}
POWERSHELL
  STANDIN_ADDRESS=$STANDIN_ADDRESS STANDIN_PORT=$STANDIN_PORT SMOKE_SCRIPT="$(cygpath -w "$script")" powershell -NoProfile -Command \
    'Get-Content -Raw -LiteralPath $env:SMOKE_SCRIPT | Invoke-Expression' &
  STANDIN_PID=$!
}

# Wait for the stand-in to answer 401, at most 120 s: its PowerShell takes about
# 50 s to reach its first line on the Arm64 runner. A stand-in that has exited
# fails at once.
wait_standin() {
  local deadline=$((SECONDS + 120))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if [ "$(status "http://$STANDIN_ADDRESS:$STANDIN_PORT/")" = 401 ]; then return 0; fi
    kill -0 "$STANDIN_PID" 2>/dev/null || die "step 4: the daemon stand-in exited before it answered"
    sleep 1
  done
  die "step 4: the daemon stand-in did not answer 401 within 120 s"
}

# Stop the stand-in by PID and wait, at most 10 s, for it to be gone.
stop_standin() {
  kill "$STANDIN_PID" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 "$STANDIN_PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$STANDIN_PID" 2>/dev/null; then die "step 4: daemon stand-in PID $STANDIN_PID still running 10 s after kill"; fi
  wait "$STANDIN_PID" || true
  STANDIN_PID=""
}

# A session login with the app's stock pair, naming no host; the cookie goes into
# $WORK/cookies. A login that asked to be saved would write a record and a secret
# under the app's data directory.
login_app() {
  local code
  code=$(curl -s -o /dev/null --max-time 10 -c "$WORK/cookies" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -d '{"username": "hqplayer", "password": "password", "remember": false}' "$BASE_URL/api/login" || true)
  [ "$code" = 200 ] || die "step 4: POST /api/login answered $code"
}

# The machine field of a PE file's header, as four hex digits.
machine() {
  local at
  at=$(od -An -tu4 -j60 -N4 "$1" | tr -d ' ')
  od -An -tx2 -j"$((at + 4))" -N2 "$1" | tr -d ' '
}

# Under --signed, a file passes with a signature Windows accepts that carries a
# timestamp. The path travels in the environment because PowerShell reads
# everything after -Command as script text.
signed() {
  [ -n "$SIGNED" ] || return 0
  local verdict
  verdict=$(SIGNED_FILE="$(cygpath -w "$1")" powershell -NoProfile -Command \
    '$s = Get-AuthenticodeSignature -LiteralPath $env:SIGNED_FILE; "$($s.Status) $($null -ne $s.TimeStamperCertificate)"' | tr -d '\r') || true
  [ "$verdict" = "Valid True" ] || die "$2: the signature on $1 is '$verdict', not 'Valid True'"
}

# ---- 1. install, unless the target is a bundle ------------------------------
# Git Bash rewrites an argument that starts with a slash into a path, and every
# Inno Setup switch is one, so the conversion is off for those calls.
if [ -d "$TARGET" ]; then
  APP=$TARGET
else
  signed "$TARGET" "step 1"
  APP="$WORK/app"
  MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$TARGET" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART \
    "/DIR=$(cygpath -w "$APP")" || die "step 1: the installer failed"
  [ -f "$SHORTCUT" ] || die "step 1: no Start Menu shortcut at $SHORTCUT"
  LISTEN_HOST=$(user_env HQPTUNER_LISTEN_HOST)
  [ "$LISTEN_HOST" = 0.0.0.0 ] || die "step 1: the user's HQPTUNER_LISTEN_HOST is '$LISTEN_HOST', not '0.0.0.0'"
  # The installer has returned, and its run entries ran before it did.
  RUNNING=$(running_under "$APP")
  if [ -n "$RUNNING" ]; then describe_lookup "$APP"; fi
  [ -z "$RUNNING" ] || die "step 1: a silent install without /LAUNCH left HQPTuner.exe running, PID $RUNNING"
fi
BIN="$APP/HQPTuner.exe"

# ---- 2. the executable ------------------------------------------------------
[ -f "$BIN" ] || die "step 2: $BIN missing"
FOUND=$(machine "$BIN")
[ "$FOUND" = "$MACHINE" ] || die "step 2: the executable's machine type is $FOUND, not $MACHINE"
signed "$BIN" "step 2"
if [ ! -d "$TARGET" ]; then signed "$APP/unins000.exe" "step 2"; fi

# ---- 2a. the app the installer starts, unless the target is a bundle --------
# The first install is removed so that this one does not install over it. The
# stores go under their own LOCALAPPDATA and BROWSER keeps the launch from
# opening a real browser, as in step 3; the installer's child inherits both. The
# installer's environment carries no HQPTUNER_LISTEN_HOST, so the app listens as
# it does for a user whose first launch is the one the installer offers.
if [ ! -d "$TARGET" ]; then
  uninstall "step 2a"
  mkdir "$WORK/installed-data"
  env -u HQPTUNER_LISTEN_HOST LOCALAPPDATA="$(cygpath -w "$WORK/installed-data")" BROWSER="$(cygpath -w /usr/bin/true)" \
    MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$TARGET" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LAUNCH \
    "/DIR=$(cygpath -w "$APP")" || die "step 2a: the installer failed"
  # The installer does not wait for the app it starts, so the lookup gets 10 tries.
  INSTALLED_PID=""
  for _ in $(seq 1 10); do
    INSTALLED_PID=$(running_under "$APP")
    if [ -n "$INSTALLED_PID" ]; then break; fi
    sleep 1
  done
  case "$INSTALLED_PID" in
    ''|*[!0-9]*)
      describe_lookup "$APP"
      die "step 2a: expected one HQPTuner.exe started by the installer, found: '$INSTALLED_PID'" ;;
  esac
  CODE=000
  for _ in $(seq 1 30); do
    CODE=$(status "$BASE_URL/api/health")
    if [ "$CODE" = 200 ]; then break; fi
    windows_pid_alive "$INSTALLED_PID" || die "step 2a: the installer-started app exited before GET /api/health answered"
    sleep 1
  done
  [ "$CODE" = 200 ] || die "step 2a: GET /api/health answered $CODE after 30 tries"
  ADDRESS=$(lan_address)
  [ -n "$ADDRESS" ] || die "step 2a: the runner has no network address besides loopback"
  CODE=$(status "http://$ADDRESS:8090/api/health")
  [ "$CODE" = 200 ] || die "step 2a: address check: the installer-started app at $ADDRESS answered $CODE"
  stop_windows_pid "$INSTALLED_PID"
  for _ in $(seq 1 10); do
    windows_pid_alive "$INSTALLED_PID" || break
    sleep 1
  done
  if windows_pid_alive "$INSTALLED_PID"; then die "step 2a: installer-started PID $INSTALLED_PID still running 10 s after stop"; fi
  INSTALLED_PID=""
fi

# ---- 3. start the binary ----------------------------------------------------
# The stores go under LOCALAPPDATA, so the run gets its own. BROWSER keeps the
# launch from opening a real browser. A launch from the Start Menu gets the
# user's environment the installer wrote, so this one gets it too.
[ "$(status "$BASE_URL/api/health")" = 000 ] || die "step 3: something already answers on $BASE_URL"
mkdir "$WORK/data"
if [ -n "$LISTEN_HOST" ]; then export HQPTUNER_LISTEN_HOST=$LISTEN_HOST; fi
# The stand-in starts first: its PowerShell is slow to launch on the Arm64 runner,
# so the app's startup and the health wait cover most of it.
start_standin
LOCALAPPDATA="$(cygpath -w "$WORK/data")" BROWSER="$(cygpath -w /usr/bin/true)" HQPTUNER_HQP_HOST=127.0.0.2 "$BIN" &
PID=$!

# ---- 4. health, at most 30 tries --------------------------------------------
CODE=000
for _ in $(seq 1 30); do
  CODE=$(status "$BASE_URL/api/health")
  if [ "$CODE" = 200 ]; then break; fi
  kill -0 "$PID" 2>/dev/null || die "step 4: binary exited before GET /api/health answered"
  sleep 1
done
[ "$CODE" = 200 ] || die "step 4: GET /api/health answered $CODE after 30 tries"
# The lookup behind step 1's check and step 2a must find this running binary, or
# an empty answer in step 1 proved nothing.
FOUND=$(running_under "$APP")
if [ -z "$FOUND" ]; then describe_lookup "$APP"; fi
[ -n "$FOUND" ] || die "step 4: the process lookup does not find the running $BIN"
CODE=$(status "$BASE_URL/")
[ "$CODE" = 200 ] || die "step 4: GET / answered $CODE"
# Discovery is behind the login. The job has no hqplayerd, so a stand-in answers
# the credential wire at the address step 3 pinned the app to (a login naming
# another host is refused as pinned), and the app is logged in for the session
# only, with its stock pair.
wait_standin
login_app
# A sweep nobody answers is still an answer: this is discovery's socket calls
# on the Windows event loop.
CODE=$(status "$BASE_URL/api/discover" 30 -b "$WORK/cookies")
[ "$CODE" = 200 ] || die "step 4: GET /api/discover answered $CODE"
stop_standin
# The bundle carries no environment of its own; the installer supplies it.
if [ -n "$LISTEN_HOST" ]; then
  ADDRESS=$(lan_address)
  [ -n "$ADDRESS" ] || die "step 4: the runner has no network address besides loopback"
  CODE=$(status "http://$ADDRESS:8090/api/health")
  [ "$CODE" = 200 ] || die "step 4: GET /api/health at $ADDRESS answered $CODE"
else
  echo "step 4: a bundle run, so no check at the runner's network address"
fi

# ---- 5. still running -------------------------------------------------------
# The tray icon is built after the server answers, and a launch that cannot
# build it exits.
for _ in $(seq 1 5); do
  kill -0 "$PID" 2>/dev/null || die "step 5: binary exited within 5 s of answering"
  sleep 1
done

# ---- 6. stop ----------------------------------------------------------------
kill "$PID"
for _ in $(seq 1 10); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$PID" 2>/dev/null; then die "step 6: binary PID $PID still running 10 s after kill"; fi
wait "$PID" || true
PID=""

# ---- 7. uninstall, unless the target is a bundle ----------------------------
if [ ! -d "$TARGET" ]; then
  uninstall "step 7"
  [ ! -e "$SHORTCUT" ] || die "step 7: the Start Menu shortcut is still present"
  LEFT=$(user_env HQPTUNER_LISTEN_HOST)
  [ -z "$LEFT" ] || die "step 7: the user's HQPTUNER_LISTEN_HOST is still '$LEFT'"
fi

# ---- 8. upgrade over the previous release, unless the target is a bundle ----
if [ ! -d "$TARGET" ]; then
  settle_desktop
  upgrade_quit
  upgrade_running
fi

echo "smoke: OK"
