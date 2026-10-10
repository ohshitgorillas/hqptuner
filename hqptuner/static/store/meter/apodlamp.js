// The apodizing lamps' level, the header jewel's and the engine row's: the newest
// apodizing bin's reading, lifted onto a floor once it is above zero, times what
// the running filter is already correcting of it.
import { computed } from "@preact/signals";
import { rateOf, intensity } from "../../lib/apodscale.js";
import { apodBins } from "../apodhistory.js";
import { apodLight } from "../ui/prefs.js";
import { engineStatus } from "../signals.js";
import { filterFacets } from "../narrow/facets.js";

// The least a lit lamp shows. Ordinary playback sits low on the shared density
// scale, which reads as a lamp barely on; any reading above zero is rescaled
// onto FLOOR..1 so the lamp is plainly lit and busier passages still read
// brighter. A zero reading stays dark.
const FLOOR = 0.6;

// The newest bin's reading. An empty history is dark rather than absent: the
// preference is on, so the lamp is on the panel, unlit, which is the state that
// tells a reader it works and is quiet.
const peak = computed(() => {
  const all = apodBins.value;
  const bin = all.length ? all[all.length - 1] : null;
  const level = bin ? intensity(rateOf(bin)) : 0;
  return level > 0 ? FLOOR + (1 - FLOOR) * level : 0;
});

// What the running filter is already doing about the events the counter scored.
// Half is read before full: the two facts come off independent bits of the
// enumeration's `arg` (store/narrow/facets.js), so a record can carry both, and
// a record carrying both is a half-apodizing filter — reading full first would
// take it dark instead of to half. A filter the facet table does not hold
// corrects nothing as far as this lamp is concerned, which is the reading that
// keeps a monitor honest when it cannot tell.
const HALF = 0.5;

const correction = computed(() => {
  if (apodLight.value !== "uncorrected") return 1;
  const st = engineStatus.value && engineStatus.value.status;
  const name = st && st.active_filter;
  const facet = name ? filterFacets.value[name] : undefined;
  if (!facet) return 1;
  if (facet.apodizingHalf) return HALF;
  return facet.apodizing ? 0 : 1;
});

export const apodLampLevel = computed(() => peak.value * correction.value);
