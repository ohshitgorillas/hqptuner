// The Output drawer's schema and blocks. Format: the output mode (PCM or SDM (DSD) only), the rate dial over both
// limits, then each backend's format rows with their band tags. Device: the backend, the Channels row, then each
// backend's device picker and device rows. Only the effective backend's groups and picker show; Combo shows all.
//
// Labels and paragraphs come from the settings metadata through the generic drawer; the strings below are the ones the
// metadata does not hold, verbatim from the mockup (mockup/scripts/data/stages/output.js). A backend group carries
// rows only, so each device picker is a block of its own ahead of its backend's group, and hides itself with it. A row
// has no gray of its own, so Channels is a block: the layout segment beside the `channels` number, the number grayed
// unless the layout is Manual.

import { html } from "../../../lib/dom.js";
import { schema as catalog } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { effective, isDirty } from "../../../store/resolve.js";
import { groupShown } from "../../../store/faceplate/drawer.js";
import { channelLayout, pickChannelLayout } from "../../../store/faceplate/drawers/output.js";
import { DISCOVERY, MODES } from "../../../store/schema/options.js";
import { keyControl, labelHead, segButtons } from "../drawer/controls.js";
import { RateDial } from "./output/RateDial.js";
import { DevicePicker } from "./output/DevicePicker.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").RowSpec} RowSpec */

/** The section header over each backend's rows (output.js:171). */
const BACKEND_NAMES = { network: "Network Audio", alsa: "ALSA" };

/** The Rate row's label and its paragraph, an owner consolidation of the manual's two rate lines (output.js:95,207). */
const RATE = {
  label: "Rate",
  k: "Output rate",
  text: "PCM and SDM target rates. Real values can be equal or lower when auto rate-family is used.",
};

/** The layout segment: the common layouts by channel count, Manual opening the number (output.js:251-258). */
const LAYOUT = {
  aria: "Channel layout",
  options: [
    { value: "2", label: "Stereo" },
    { value: "6", label: "5.1" },
    { value: "8", label: "7.1" },
    { value: "manual", label: "Manual" },
  ],
};

/** The hint after a DAC bits box (output.js:168). */
const BITS_HINT = "0 = default";

/** The output modes the drawer offers: no Auto. */
const MODE_OPTIONS = MODES.filter((o) => o.value !== "auto");

/** Discovery with its default, IPv6 on, leftmost (output.js:289-295). */
const DISCOVERY_OPTIONS = [...DISCOVERY].reverse();

/**
 * One backend's format rows: DSD support and DSD rates tagged SDM, DAC bits tagged PCM.
 *
 * @param {"net" | "alsa"} p  the backend's key prefix
 * @returns {RowSpec[]}
 */
const formatRows = (p) => [
  { key: `${p}_dop`, band: "sdm" },
  { key: `${p}_anydsd`, band: "sdm" },
  { key: `${p}_bits`, band: "pcm", sub: catalog[`${p}_bits`].sublabel, hint: BITS_HINT },
];

/**
 * A buffer time row with the catalog's hint.
 *
 * @param {"net" | "alsa"} p
 * @returns {RowSpec}
 */
const bufferRow = (p) => ({ key: `${p}_period`, hint: catalog[`${p}_period`].hint });

/** @type {DrawerSchema} */
export const OUTPUT_DRAWER = {
  id: "output",
  title: "Output",
  aria: "Output settings",
  group: () => String(effective("backend") ?? ""),
  tabs: [
    {
      id: "format",
      label: "Format",
      body: [
        { row: { key: "output_mode", options: MODE_OPTIONS } },
        { block: "dial", keys: ["pcm_rate", "sdm_rate"] },
        { group: "network", label: BACKEND_NAMES.network, rows: formatRows("net") },
        { group: "alsa", label: BACKEND_NAMES.alsa, rows: formatRows("alsa") },
      ],
    },
    {
      id: "device",
      label: "Device",
      body: [
        { row: { key: "backend" } },
        { block: "channels", keys: ["channels"] },
        { block: "netdev", keys: ["net_device"] },
        {
          group: "network",
          label: BACKEND_NAMES.network,
          rows: [{ key: "net_ipv6", options: DISCOVERY_OPTIONS }, bufferRow("net")],
        },
        { block: "alsadev", keys: ["alsa_device"] },
        { group: "alsa", label: BACKEND_NAMES.alsa, rows: [{ key: "alsa_offset" }, bufferRow("alsa")] },
      ],
    },
  ],
};

/** The Rate row: the dial spanning the row over its paragraph. */
const RateRow = () => html`
  <div class="drow drow-full">
    <div class="ctl">${labelHead(RATE.label)} <${RateDial} /></div>
    <div class="man"><p><b>${RATE.k}</b> ${RATE.text}</p></div>
  </div>
`;

/** The Channels row: the layout segment beside the channel number, the number grayed unless the layout is Manual. */
function ChannelsRow() {
  const entry = catalog.channels;
  const { label, tooltip } = describe(entry, "channels");
  const layout = channelLayout();
  return html`
    <div class="drow" data-k="channels" data-dirty=${isDirty("channels") ? "" : undefined}>
      <div class="ctl">
        ${labelHead(label)}
        <div class="cgrp">
          ${segButtons({ options: LAYOUT.options, value: layout, label: LAYOUT.aria, off: false, pick: pickChannelLayout })}
          ${keyControl({ key: "channels", entry, label, off: layout !== "manual" })}
        </div>
      </div>
      <div class="man"><p>${tooltip}</p></div>
    </div>
  `;
}

/**
 * A backend's device row: its label, the picker with the rescan, the paragraph; nothing while its backend is hidden.
 *
 * @param {{ schema: DrawerSchema, k: string, backend: string }} props
 */
function DeviceRow({ schema, k, backend }) {
  if (!groupShown(schema, backend)) return null;
  const { label, tooltip } = describe(catalog[k], k);
  return html`
    <div class="drow" data-k=${k} data-dirty=${isDirty(k) ? "" : undefined}>
      <div class="ctl">${labelHead(label)} <${DevicePicker} schema=${schema} k=${k} /></div>
      <div class="man"><p>${tooltip}</p></div>
    </div>
  `;
}

/** The components the schema's blocks mount, by name. @type {Record<string, (props: { schema: DrawerSchema }) => unknown>} */
export const OUTPUT_BLOCKS = {
  dial: RateRow,
  channels: ChannelsRow,
  netdev: ({ schema }) => html`<${DeviceRow} schema=${schema} k="net_device" backend="network" />`,
  alsadev: ({ schema }) => html`<${DeviceRow} schema=${schema} k="alsa_device" backend="alsa" />`,
};
