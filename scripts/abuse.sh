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
#           buffer is empty; save GET /api/backup as the baseline beside a
#           snapshot of the config form; record the newest audit seq; write
#           state/abuse/current.
#   close   DELETE /api/config/pending; read the audit records the run added;
#           if an apply landed, POST /api/restore with the baseline (the daemon
#           reloads on it) and poll the config form until every field the run
#           applied reads its baseline value again; print the run's records
#           either way. current is removed only on success, so a failed close
#           can be re-run.
#
# Everything goes through HQPTuner's own routes on 127.0.0.1:8090, never
# hqplayerd directly. The pre-apply zip HQPTuner writes on every apply is not
# the baseline: two applies in one run would overwrite it.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
API=${HQPTUNER_ABUSE_API:-http://127.0.0.1:8090}
DIR=state/abuse
CURRENT=$DIR/current
# Upload retries and readback polls, 2 s apart: two minutes each, well past the
# half minute a reload takes.
TRIES=60
say()  { echo; echo "== $* =="; }
die()  { echo "FAIL: $*" >&2; exit 1; }
usage() { echo "usage: scripts/abuse.sh open | close | status" >&2; exit 2; }
get()  { curl -sf "$API$1"; }

[ $# -eq 1 ] || usage
CMD=$1

state_of()   { get /api/state | jq -r '.data.state'; }
pending_of() { get /api/config/pending | jq -c '{http, live}'; }
top_seq()    { get "/api/audit?limit=1" | jq -r '.records[-1].seq // 0'; }
# The config form as {field: value}, the shape open snapshots and close reads back.
form_of() { get /api/config | jq -c '[.data.fields[] | {key: .name, value: .value}] | from_entries'; }
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
    form_of > "$DIR/$stamp/form.json" || die "GET /api/config failed"
    since=$(top_seq)
    printf '%s %s\n' "$stamp" "$since" > "$CURRENT"
    say "open"
    echo "  state:    idle"
    echo "  baseline: $DIR/$stamp/settings.zip ($(stat -c %s "$DIR/$stamp/settings.zip") bytes)"
    echo "  seq:      $since"
    ;;
  close)
    [ -e "$CURRENT" ] || die "no run open"
    read -r stamp since < "$CURRENT"
    zip=$DIR/$stamp/settings.zip
    base=$DIR/$stamp/form.json
    [ -s "$zip" ] || die "baseline missing: $zip"
    [ -s "$base" ] || die "form snapshot missing: $base"
    say "discard"
    curl -sf -X DELETE "$API/api/config/pending" | jq -c . || die "DELETE /api/config/pending failed"
    say "audit since seq $since"
    records=$(get "/api/audit?limit=100000" | jq -c --argjson s "$since" '[.records[] | select(.seq > $s)]') \
      || die "GET /api/audit failed"
    echo "$records" | jq -c '.[] | {seq, event, http, live, ok}'
    applied=$(echo "$records" | jq '[.[] | select(.event == "apply" and .ok == true)] | length')
    echo "  applies landed: $applied"
    if [ "$applied" -gt 0 ]; then
      say "restore baseline"
      s=$(state_of) || s="?"
      if [ "$s" != "0" ]; then
        echo "  buffer discarded, but the daemon is not idle (State state=\"$s\")."
        die "config still carries the run's apply; stop playback and re-run close"
      fi
      # The daemon reloads on every persistent apply and again on the restore,
      # dropping 4321 and refusing 8088 while it does, and it reconnects before
      # the new config is in force. So neither a connection nor a timestamp says
      # the restore took: the upload is retried until 8088 accepts it, and the
      # restore is proven by readback, the fields the run applied reading their
      # baseline values again, the way HQPTuner's own persistent lane verifies.
      keys=$(echo "$records" | jq -c '[.[] | select(.event == "apply" and .ok == true) | .http | keys[]] | unique')
      echo "  fields to read back: $keys"
      uploaded=""
      for _ in $(seq "$TRIES"); do
        if out=$(curl -sf -F "cfgfile=@$zip" "$API/api/restore"); then uploaded=$out; break; fi
        sleep 2
      done
      [ -n "$uploaded" ] || die "POST /api/restore refused for ${TRIES} tries; baseline kept at $zip"
      echo "  upload: $uploaded"
      baseline=$(cat "$base")
      settled=""
      for _ in $(seq "$TRIES"); do
        # The polled form is the copy taken at connect; refresh refetches it
        # from the daemon (and rescans devices, which is what the route is for).
        curl -sf -X POST "$API/api/config/refresh" >/dev/null 2>&1 || true
        if now=$(form_of) && [ "$(jq -n --argjson k "$keys" --argjson b "$baseline" --argjson n "$now" '[$k[] | $b[.] == $n[.]] | all')" = "true" ]; then
          settled=1; break
        fi
        sleep 2
      done
      [ -n "$settled" ] || die "applied fields never read back at baseline; baseline kept at $zip"
      echo "  readback: $(jq -nc --argjson k "$keys" --argjson n "$now" '[$k[] | {(.): $n[.]}] | add')"
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
