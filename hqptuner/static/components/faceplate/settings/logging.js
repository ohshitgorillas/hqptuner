// The Logging drawer's schema: the logging switch, the log path, grayed by its schema rule while logging is off, and the
// live log tail as a block; and its two Settings rail readouts, which print what the daemon is running.

import { runningValue } from "../../../store/resolve.js";
import { truthy } from "../../../lib/coerce.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */

const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

/** @type {DrawerSchema} */
export const LOGGING_DRAWER = {
  id: "logging",
  title: "Logging",
  aria: "Logging settings",
  tabs: [
    {
      id: "logging",
      label: "Logging",
      body: [
        { row: { key: "log_enabled", label: "Enable log" } },
        { row: { key: "log_file", label: "Log path" } },
        { block: "logtail" },
      ],
    },
  ],
};

/** @type {SettingsReadout[]} */
export const LOGGING_READOUTS = [
  {
    id: "logon",
    label: "Enable log",
    control: { type: "seg", options: OFF_ON },
    value: () => (truthy(runningValue("log_enabled")) ? "1" : "0"),
  },
  {
    id: "logpath",
    label: "Log path",
    wide: true,
    control: { type: "text" },
    value: () => String(runningValue("log_file") ?? ""),
  },
];
