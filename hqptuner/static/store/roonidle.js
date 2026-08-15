// Roon idle-time warning — one fixed-copy alert-strip row.
//
// Roon (song == "Roon" in the Status metadata, the only wire marker it leaves)
// stops and restarts the whole playback engine between tracks whenever the
// engine idle time is at its default of 0 ms. The daemon persists no Roon
// trace anywhere — config XML, /config form, backup archive are all clean —
// so the metadata child during playback is the entire detection surface: no
// latch, no history, the row simply exists while a Roon track is loaded and
// the effective idle_time is still default.
//
// Reads the pending picture (`effective`, staged over loaded) like the
// shaperfit alerts do, so staging a non-default idle time clears the row
// before apply.
import { computed } from "@preact/signals";
import { engineStatus } from "./signals.js";
import { effective } from "./resolve.js";

const TEXT =
  "Recommend setting Engine idle time (System tab) to 10 or longer; " +
  "at default idle time, Roon inefficiently restarts the engine between tracks.";

/** The roon-idle alert row for the strip, or null when the scenario doesn't hold. */
export const roonIdleAlert = computed(() => {
  const meta = (engineStatus.value || {}).metadata;
  if (!meta || meta.song !== "Roon") return null;
  if (String(effective("idle_time") ?? "0") !== "0") return null;
  return { sev: "warn", text: TEXT };
});
