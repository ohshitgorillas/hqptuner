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
#           snapshot of the config form and of the live State; copy HQPTuner's
#           seven own stores beside those, with a manifest saying which existed
#           and what each held; record the newest audit seq; write
#           state/abuse/current.
#   close   DELETE /api/config/pending; read the audit records the run added;
#           if an apply, a live write or a preset store write landed, POST
#           /api/restore with the baseline (the daemon reloads on it) and poll
#           until every field the run applied reads its baseline form value and
#           every live State field reads its snapshot value; put the volume back
#           by POST /api/volume when a live write moved it; then put the seven
#           stores back from the manifest, last, because the baseline upload
#           writes one of them. Print the run's records either way. current is
#           removed only on success, so a failed close can be re-run.
#
# Everything goes through HQPTuner's own routes on 127.0.0.1:8090, never
# hqplayerd directly. The pre-apply zip HQPTuner writes on every apply is not
# the baseline: two applies in one run would overwrite it.
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root
API=${HQPTUNER_ABUSE_API:-http://127.0.0.1:8090}
# Where HQPTuner keeps everything it writes — the bind mount's host side.
STATE=${HQPTUNER_ABUSE_STATE:-state}
DIR=$STATE/abuse
CURRENT=$DIR/current
# HQPTuner's own stores, the seven user-owned paths Dockerfile's ENV block names.
# state/backups holds the rolling pre-apply zip HQPTuner writes for itself, and
# the two .jsonl files are append-only records close itself reads — neither is a
# store a run can damage, and rewinding a log would erase what the run did.
STORES="presets live-presets.json favorites.json descriptions.json narrowing.json matrixmodes.json autopilot.json"
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
# The live State fields a live write can move and the restore reload resets.
LIVE_KEYS='["mode","filter1x","filterNx","shaper","filter_junk","adaptive"]'
live_of() { get /api/state | jq -c --argjson k "$LIVE_KEYS" '.data | with_entries(select(.key as $x | $k + ["volume"] | index($x)))'; }
# One store's contents as {relative path: sha256}, or null when it is not there.
# A directory is a per-file map rather than one aggregate, so close can name the
# file that moved; a plain file answers under ".".
digest_of() {
  local p=$1
  if [ -d "$p" ]; then
    find "$p" -type f -exec sha256sum {} + 2>/dev/null | sed "s| $p/| |" \
      | jq -SRnc '[inputs | capture("^(?<d>[0-9a-f]+) +(?<f>.*)$") | {(.f): .d}] | add // {}'
  elif [ -f "$p" ]; then
    sha256sum "$p" | jq -SRnc '[inputs | capture("^(?<d>[0-9a-f]+) ") | {".": .d}] | add'
  else
    echo null
  fi
}
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
    live_of > "$DIR/$stamp/live.json" || die "GET /api/state failed"
    # HQPTuner's own stores, which no daemon backup carries: a run writing live
    # fields folds them into the active preset when auto-save is on, and every
    # other store has a write route of its own. A store that does not exist is a
    # legitimate empty install, recorded as absent rather than refused.
    mkdir -p "$DIR/$stamp/stores"
    man='{}'
    kept=0; missing=0
    for s in $STORES; do
      if [ -e "$STATE/$s" ]; then
        cp -a "$STATE/$s" "$DIR/$stamp/stores/$s" || die "snapshot of $STATE/$s failed"
        d=$(digest_of "$STATE/$s") || die "digest of $STATE/$s failed"
        man=$(echo "$man" | jq -c --arg s "$s" --argjson d "$d" '.[$s] = {present: true, files: $d}')
        kept=$((kept + 1))
      else
        man=$(echo "$man" | jq -c --arg s "$s" '.[$s] = {present: false}')
        missing=$((missing + 1))
      fi
    done
    echo "$man" > "$DIR/$stamp/stores/manifest.json"
    since=$(top_seq)
    printf '%s %s\n' "$stamp" "$since" > "$CURRENT"
    say "open"
    echo "  state:    idle"
    echo "  baseline: $DIR/$stamp/settings.zip ($(stat -c %s "$DIR/$stamp/settings.zip") bytes)"
    echo "  stores:   $kept snapshotted, $missing absent"
    echo "  seq:      $since"
    ;;
  close)
    [ -e "$CURRENT" ] || die "no run open"
    read -r stamp since < "$CURRENT"
    zip=$DIR/$stamp/settings.zip
    base=$DIR/$stamp/form.json
    livebase=$DIR/$stamp/live.json
    [ -s "$zip" ] || die "baseline missing: $zip"
    [ -s "$base" ] || die "form snapshot missing: $base"
    [ -s "$livebase" ] || die "live snapshot missing: $livebase"
    say "discard"
    curl -sf -X DELETE "$API/api/config/pending" | jq -c . || die "DELETE /api/config/pending failed"
    say "audit since seq $since"
    records=$(get "/api/audit?limit=100000" | jq -c --argjson s "$since" '[.records[] | select(.seq > $s)]') \
      || die "GET /api/audit failed"
    echo "$records" | jq -c '.[] | {seq, event, http, live, ok}'
    applied=$(echo "$records" | jq '[.[] | select(.event == "apply" and .ok == true)] | length')
    echo "  applies landed: $applied"
    lived=$(echo "$records" | jq '[.[] | select(.event == "live.write" and .ok == true)] | length')
    echo "  live writes landed: $lived"
    # A preset write, load or delete mirrors into the daemon's own data/cfgs, so
    # it needs the baseline upload too. Those records carry no ok field, unlike
    # apply and live.write, so they are counted by event name alone.
    presetted=$(echo "$records" | jq '[.[] | select(.event == "preset.write" or .event == "preset.load" or .event == "preset.delete")] | length')
    echo "  preset store writes landed: $presetted"
    if [ "$applied" -gt 0 ] || [ "$lived" -gt 0 ] || [ "$presetted" -gt 0 ]; then
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
        if now=$(form_of) && livenow=$(live_of) \
          && [ "$(jq -n --argjson k "$keys" --argjson b "$baseline" --argjson n "$now" '[$k[] | $b[.] == $n[.]] | all')" = "true" ] \
          && [ "$(jq -n --argjson k "$LIVE_KEYS" --argjson b "$(cat "$livebase")" --argjson n "$livenow" '[$k[] | $b[.] == $n[.]] | all')" = "true" ]; then
          settled=1; break
        fi
        sleep 2
      done
      [ -n "$settled" ] || die "applied fields or live State never read back at baseline; baseline kept at $zip"
      echo "  readback: $(jq -nc --argjson k "$keys" --argjson n "$now" '[$k[] | {(.): $n[.]}] | add')"
      echo "  live:     $livenow"
      want=$(jq -r .volume "$livebase"); have=$(echo "$livenow" | jq -r .volume)
      if [ "$want" != "$have" ]; then
        curl -sf -X POST -H 'Content-Type: application/json' -d "{\"level\":\"$want\"}" "$API/api/volume" >/dev/null || die "POST /api/volume failed; volume left at $have, was $want"
        echo "  volume:   $have -> $want"
      fi
    fi
    # Last writing step, deliberately: the baseline upload above is itself a
    # writer of one of these stores. POST /api/restore takes HQPTuner's own
    # descriptions member out of the archive and folds it into this install's
    # store, and the fold is a merge, so a name the run added under a name the
    # baseline does not carry outlives it. Putting the stores back afterwards is
    # what removes it.
    say "stores"
    manfile=$DIR/$stamp/stores/manifest.json
    # Without the manifest there is no telling an install whose stores were empty
    # at open from a snapshot that went missing, and those want opposite actions.
    [ -s "$manfile" ] || die "store manifest missing: $manfile; stores left untouched"
    for s in $STORES; do
      want=$(jq -Sc --arg s "$s" '.[$s].files // null' "$manfile")
      now=$(digest_of "$STATE/$s")
      if [ "$now" = "$want" ]; then
        echo "  $s: unchanged"
      elif [ "$want" = "null" ]; then
        rm -rf "$STATE/$s"
        echo "  $s: deleted (absent at open)"
      else
        # Build beside the store and swap it in: an interrupted close leaves
        # either the old store or the new one, never half of either. Wholesale,
        # which is what takes out the files the run added.
        rm -rf "$STATE/$s.abuse-new" "$STATE/$s.abuse-old"
        cp -a "$DIR/$stamp/stores/$s" "$STATE/$s.abuse-new" || die "restore of $STATE/$s failed"
        [ ! -e "$STATE/$s" ] || mv "$STATE/$s" "$STATE/$s.abuse-old"
        mv "$STATE/$s.abuse-new" "$STATE/$s"
        rm -rf "$STATE/$s.abuse-old"
        echo "  $s: restored"
      fi
      back=$(digest_of "$STATE/$s")
      [ "$back" = "$want" ] || die "$STATE/$s does not read back at its snapshot: $back vs $want; snapshot kept at $DIR/$stamp/stores"
    done
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
