#!/usr/bin/env bash
# abuse — bracket a hostile-input run against the live HQPTuner container so
# that nothing it staged survives and nothing it applied stays in hqplayerd.
#
#   scripts/abuse.sh open
#   scripts/abuse.sh close
#   scripts/abuse.sh status
#
# An abuser agent types garbage into the UI. Whatever it stages lands in the
# server's buffer, and the next human Apply writes all of it to the daemon,
# which is how twelve stale fields once took hqplayerd off 4321. So a run is
# opened and closed by this script, each one metered action like pair.sh:
#
#   open    refuse unless the daemon is idle (State state "0") and the staged
#           buffer is empty; save GET /api/backup as the baseline; record the
#           newest audit seq; write state/abuse/current.
#   close   DELETE /api/config/pending; read the audit records the run added;
#           if an apply landed, POST /api/restore with the baseline (the daemon
#           reloads on it) and poll /api/health until reachable; print the
#           run's records either way. current is removed only on success, so
#           a failed close can be re-run.
#
# Everything goes through HQPTuner's own routes on 127.0.0.1:8090, never
# hqplayerd directly. The pre-apply zip HQPTuner writes on every apply is not
# the baseline: two applies in one run would overwrite it.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
API=${HQPTUNER_ABUSE_API:-http://127.0.0.1:8090}
DIR=state/abuse
CURRENT=$DIR/current
HEALTH_WAIT=60
say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }
usage() { echo "usage: scripts/abuse.sh open | close | status" >&2; exit 2; }
get()  { curl -sf "$API$1"; }

[ $# -eq 1 ] || usage
CMD=$1

state_of()   { get /api/state | jq -r '.data.state'; }
pending_of() { get /api/config/pending | jq -c '{http, live}'; }
top_seq()    { get "/api/audit?limit=1" | jq -r '.records[-1].seq // 0'; }
idle_or_die() {
  local s
  s=$(state_of) || die "GET /api/state failed: daemon unreachable or not loaded"
  [ "$s" = "0" ] || die "daemon is not idle (State state=\"$s\"); stop playback first"
}

case "$CMD" in
  open)
    [ ! -e "$CURRENT" ] || die "a run is already open ($(cat "$CURRENT")); close it first"
    idle_or_die
    pend=$(pending_of) || die "GET /api/config/pending failed"
    [ "$pend" = '{"http":{},"live":{}}' ] || die "staged buffer is not empty: $pend"
    get /api/audit?limit=1 >/dev/null || die "audit log is off (no /api/audit); close could not tell apply from no apply"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -p "$DIR/$stamp"
    get /api/backup > "$DIR/$stamp/settings.zip" || die "GET /api/backup failed"
    seq=$(top_seq)
    printf '%s %s\n' "$stamp" "$seq" > "$CURRENT"
    say "open"
    echo "  state:    idle"
    echo "  baseline: $DIR/$stamp/settings.zip ($(stat -c %s "$DIR/$stamp/settings.zip") bytes)"
    echo "  seq:      $seq"
    ;;
  close)
    [ -e "$CURRENT" ] || die "no run open"
    read -r stamp seq < "$CURRENT"
    zip=$DIR/$stamp/settings.zip
    [ -s "$zip" ] || die "baseline missing: $zip"
    say "discard"
    curl -sf -X DELETE "$API/api/config/pending" | jq -c . || die "DELETE /api/config/pending failed"
    say "audit since seq $seq"
    records=$(get "/api/audit?limit=100000" | jq -c --argjson s "$seq" '[.records[] | select(.seq > $s)]')
    echo "$records" | jq -c '.[] | {seq, event, http: (.http // empty), live: (.live // empty), ok: (.ok // empty)}'
    applied=$(echo "$records" | jq '[.[] | select(.event == "apply" and .ok == true)] | length')
    echo "  applies landed: $applied"
    if [ "$applied" -gt 0 ]; then
      say "restore baseline"
      s=$(state_of) || s="?"
      if [ "$s" != "0" ]; then
        echo "  buffer discarded, but the daemon is not idle (State state=\"$s\")."
        die "config still carries the run's apply; stop playback and re-run close"
      fi
      curl -sf -F "cfgfile=@$zip" "$API/api/restore" | jq -c . || die "POST /api/restore failed"
      for _ in $(seq "$HEALTH_WAIT"); do
        if [ "$(get /api/health | jq -r .reachable)" = "true" ]; then break; fi
        sleep 1
      done
      [ "$(get /api/health | jq -r .reachable)" = "true" ] \
        || die "daemon not reachable ${HEALTH_WAIT}s after restore; baseline kept at $zip"
      echo "  restored, daemon reachable"
    fi
    say "readback"
    echo "  pending: $(pending_of)"
    echo "  health:  $(get /api/health | jq -c '{reachable, connected_at}')"
    rm -f "$CURRENT"
    ;;
  status)
    if [ -e "$CURRENT" ]; then echo "open: $(cat "$CURRENT")"; else echo "no run open"; fi
    ;;
  *) usage ;;
esac
