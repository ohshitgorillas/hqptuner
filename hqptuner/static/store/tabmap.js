// Field → tab, for accenting a tab whose staged edits are hidden behind the
// pending bar. Schema `group` is NOT the tab: the "dsp" group straddles the
// Resampling and DSP tabs, and dsp-group fields like `channels` render on
// Output. The mapping is sourced from the k= fields each tab component actually
// renders — keep these sets in sync with tabs/*.js and ResamplingTab.js. The DSP
// tab ("matrix") is the fallback: the remaining dsp-group fields (crossfeed_*,
// matrix_*) light it without being enumerated.
import { computed } from "@preact/signals";
import { schema } from "./schema.js";
import { isDirty } from "./state.js";

const TAB_KEYS = {
  output: new Set([
    "output_mode",
    "backend",
    "channels",
    "pcm_rate",
    "sdm_rate",
    "short_buffer",
    "quick_pause",
    "idle_time",
    "upnp_freewheel",
    "gain_comp",
    "dac_correction_enabled",
    "dac_correction_profile",
    "alsa_device",
    "alsa_bits",
    "alsa_dop",
    "alsa_anydsd",
    "alsa_offset",
    "alsa_period",
    "net_device",
    "net_bits",
    "net_dop",
    "net_anydsd",
    "net_ipv6",
    "net_period",
  ]),
  volume: new Set([
    "fixed_volume",
    "fixed_volume_enabled",
    "adaptive_volume",
    "optimal_iso",
    "playlist_album_gain",
    "loudness_enabled",
    "loudness_low_freq",
    "loudness_low_level",
    "loudness_low_steep",
    "loudness_low_type",
    "loudness_high_freq",
    "loudness_high_level",
    "loudness_high_steep",
    "loudness_high_type",
    "loudness_range_low",
    "loudness_range_high",
  ]),
  resampling: new Set([
    "pcm_filter_1x",
    "pcm_filter_nx",
    "pcm_dither",
    "noise_filter",
    "pcm_conversion",
    "dsd_gain_6db",
    "sdm_filter_1x",
    "sdm_filter_nx",
    "sdm_modulator",
    "sdm_integrator",
    "sdm_conversion",
    "fft_size",
    "direct_sdm",
  ]),
  system: new Set(["log_enabled", "log_file", "pre_before_meter"]),
};

function tabForKey(key) {
  for (const tab in TAB_KEYS) if (TAB_KEYS[tab].has(key)) return tab;
  return "matrix";
}

// Tab ids that currently hold staged (unapplied) edits — TabBar accents them so
// changes are not lost behind an inactive tab.
export const dirtyTabs = computed(() => new Set(Object.keys(schema).filter(isDirty).map(tabForKey)));
