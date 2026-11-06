#!/usr/bin/env bash
# Install a built installer silently, run the app once, stop it, then uninstall.
# A silent install without /LAUNCH must start nothing. A silent install with it
# must start the app, and that app, which the installer itself started, must
# answer at the runner's own network address. So must the installed app when it
# is started the way a Start Menu launch starts it.
# Installing over the previous release must leave an app that starts and keeps
# running, and the uninstaller must still work after it. That holds whether the
# previous release's app was quit first or left running; when it was left
# running, none of it may remain once the installer returns. After either, the
# uninstaller must leave no install directory.
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
INSTALLED_PID=""
PREV_PID=""
UP_PID=""
UPGRADE_APP=""
UPGRADE_DATA=""
UPGRADE_LOG=""
WORK=$(mktemp -d)

cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; fi
  for WINPID in $INSTALLED_PID $PREV_PID $UP_PID; do stop_windows_pid "$WINPID" || true; done
  rm -rf "$WORK" || true
}
trap cleanup EXIT

# A variable from the user's environment in the registry, empty when unset.
user_env() {
  powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('$1', 'User')" | tr -d '\r'
}

# The runner's first IPv4 address that is neither loopback nor link-local.
lan_address() {
  powershell -NoProfile -Command \
    'Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127|169\.254)\." } | Select-Object -First 1 -ExpandProperty IPAddress' \
    | tr -d '\r'
}

# The Windows PIDs of running HQPTuner.exe processes whose image lies under the
# directory $1. Git Bash's kill and kill -0 do not address a Windows PID. A
# process keeps the spelling of the path it was started with, long or 8.3 short,
# so all three spellings of the directory are tried, each made absolute because
# a process image path always is. The directories travel in the environment
# because PowerShell reads everything after -Command as script text.
running_under() {
  RUN_DIR_W="$(cygpath -aw "$1")" RUN_DIR_L="$(cygpath -awl "$1")" RUN_DIR_S="$(cygpath -aws "$1")" powershell -NoProfile -Command \
    '$dirs = $env:RUN_DIR_W, $env:RUN_DIR_L, $env:RUN_DIR_S | ForEach-Object { $_ + [IO.Path]::DirectorySeparatorChar }; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "HQPTuner.exe" -and $_.ExecutablePath } | Where-Object { $p = $_.ExecutablePath; $dirs | Where-Object { $p.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) } } | ForEach-Object { $_.ProcessId }' \
    | tr -d '\r'
}

# What running_under saw, for a log: the directory in each spelling it matched
# on, and every process named like HQPTuner with its parent and image path.
describe_lookup() {
  echo "lookup under: $(cygpath -aw "$1") | $(cygpath -awl "$1") | $(cygpath -aws "$1")" >&2
  powershell -NoProfile -Command \
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -like "*HQPTuner*" } | ForEach-Object { "process $($_.ProcessId) parent $($_.ParentProcessId) name $($_.Name) image [$($_.ExecutablePath)]" }' \
    | tr -d '\r' >&2 || true
  echo "lookup end" >&2
}

windows_pid_alive() {
  [ -n "$(WIN_PID="$1" powershell -NoProfile -Command \
    'Get-Process -Id ([int]$env:WIN_PID) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }' | tr -d '\r')" ]
}

stop_windows_pid() {
  WIN_PID="$1" powershell -NoProfile -Command \
    'Stop-Process -Id ([int]$env:WIN_PID) -Force -ErrorAction SilentlyContinue'
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

# The app the upgrade started must be the only one under $UPGRADE_APP, answer on
# loopback, still be running after its tray is built, answer at the runner's
# network address, and stop when asked.
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
  for _ in $(seq 1 5); do
    windows_pid_alive "$UP_PID" || upgrade_die "$1: the upgraded app exited within 5 s of answering"
    sleep 1
  done
  ADDRESS=$(lan_address)
  [ -n "$ADDRESS" ] || upgrade_die "$1: the runner has no network address besides loopback"
  code=$(status "http://$ADDRESS:8090/api/health")
  [ "$code" = 200 ] || upgrade_die "$1: address check: the upgraded app at $ADDRESS answered $code"
  stop_and_wait "$1" "$UP_PID"
  UP_PID=""
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

status() { curl -s -o /dev/null --max-time "${2:-2}" -w '%{http_code}' "$1" || true; }

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
# A sweep nobody answers is still an answer: this is discovery's socket calls
# on the Windows event loop.
CODE=$(status "$BASE_URL/api/discover" 30)
[ "$CODE" = 200 ] || die "step 4: GET /api/discover answered $CODE"
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
  upgrade_quit
  upgrade_running
fi

echo "smoke: OK"
