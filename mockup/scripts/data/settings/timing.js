// Timing: http (restore lane, ~5.6 s restart): idle_time (ms on the wire), quick_pause, short_buffer.
// Mock state: idle Default, quick pause off, short buffer Normal.

import { OFF_ON } from "./common.js";

const MAN = {
  idle: "Defines the amount of time the engine is left idling after playback of the current content has ended. This allows a faster playback restart within the idle period.",
  quickPause:
    "Changes the pause operation to play a basic silence pattern. In some cases, this reduces the delay when pressing pause, but it can cause audible glitches, especially when the DAC is directly connected to a power amp without intermediate volume control.",
  shortBuffer:
    "Length of the FIFO (first in, first out buffer) to adjust control responses. This reduces the amount of delay for volume control, for example, but also increases the likelihood of audio drop-outs.",
};

/** @type {import('../stages/output.js').DrawerSchema} */
export const TIMING_DRAWER = {
  id: "timing",
  title: "Timing",
  aria: "Timing settings",
  restart: true,
  tabs: [
    {
      id: "timing",
      label: "Timing",
      body: [
        {
          row: {
            label: "Engine idle time",
            man: MAN.idle,
            control: {
              type: "seg",
              id: "idle",
              aria: "Engine idle time",
              value: "0",
              // 6.0.4 form: value in ms, label in seconds (v1 schema unit: seconds).
              options: [
                { v: "0", label: "Default" },
                ...[10, 20, 30, 60].map((s) => ({ v: String(s * 1000), label: String(s), unit: "s" })),
              ],
            },
          },
        },
        {
          row: {
            label: "Quick pause",
            man: MAN.quickPause,
            control: { type: "seg", id: "qpause", aria: "Quick pause", value: "0", options: OFF_ON },
          },
        },
        {
          row: {
            label: "Short buffer",
            man: MAN.shortBuffer,
            control: {
              type: "seg",
              id: "sbuf",
              aria: "Short buffer",
              value: "0",
              options: [
                { v: "0", label: "Normal" },
                { v: "1", label: "Short" },
                { v: "2", label: "Minimum" },
              ],
            },
          },
        },
      ],
    },
  ],
};
