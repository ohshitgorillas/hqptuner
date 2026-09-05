// Rejected management credentials — one fixed-copy alert-strip row.
//
// The 4321 handshake that decides `reachable` is unauthenticated, so a health
// poll can report a connected daemon while every 8088 configuration read is
// being refused: connected status, empty settings. `credentials_ok` is the 8088
// lane's own verdict — absent or null until that lane has answered, so only the
// exact value `false` counts as a refusal.
//
// Unlike the engine-health alerts this row does not depend on playback state:
// an install with rejected credentials is usually idle, and that is exactly
// when the row has to show.
import { computed } from "@preact/signals";
import { health } from "../signals.js";

// Owner-approved copy, verbatim (CLAUDE.md): reworded only with its own
// approval. It deliberately duplicates the same sentence in conf/httpconf.py
// (`AUTH_REFUSED_MESSAGE`) — /api/health carries a boolean rather than a
// sentence, so the frontend has nothing to render but its own copy.
const AUTH_REFUSED_MESSAGE =
  "Authentication rejected: username and password are bad. " + "Fix and restart HQPTuner with the correct credentials.";

/** The rejected-credentials alert row for the strip, or null when the daemon has not refused them. */
export const credentialsAlert = computed(() => {
  if ((health.value || {}).credentials_ok !== false) return null;
  return { kind: "credentials-rejected", sev: "crit", text: AUTH_REFUSED_MESSAGE };
});
