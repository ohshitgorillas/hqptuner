// Logging: http: log_enabled, log_file; live tail read-only (HQPTuner).
// Mock state: log on at /tmp/hqplayerd.log (6.0.4 form fixture).

import { OFF_ON } from "./common.js";

const MAN = {
  logEnabled:
    "Log file can be enabled for troubleshooting purposes. After changing this setting, restart HQPlayer for the change to take full effect. If a log file is not defined, stderr output is used and captured to systemd journal when running as a service.",
  logPath:
    "[optional] Full path and name of the log file. If not defined, stderr output is used and captured to systemd journal when running as a service.",
  logTail: "Live stream of the hqplayerd log (file or journal). Read-only.",
};

// Gray reason. Log path: v1 gray.js.
const LOG_OFF = "Enable logging to set a log file path.";

/** @type {import('../stages/output.js').DrawerSchema} */
export const LOGGING_DRAWER = {
  id: "logging",
  title: "Logging",
  aria: "Logging settings",
  restart: false,
  tabs: [
    {
      id: "logging",
      label: "Logging",
      body: [
        {
          row: {
            label: "Enable log",
            restart: true,
            man: MAN.logEnabled,
            control: { type: "seg", id: "logon", aria: "Enable log", value: "1", options: OFF_ON },
          },
        },
        {
          row: {
            label: "Log path",
            restart: true,
            man: MAN.logPath,
            control: {
              type: "text",
              id: "logpath",
              value: "/tmp/hqplayerd.log",
              maxlength: 256,
              aria: "Log path",
              gray: (v) => (v.logon === "1" ? "" : LOG_OFF),
            },
          },
        },
        { block: "logtail" },
      ],
    },
  ],
};

export const LOG_TAIL = {
  lines: 50, // v1 LINES
  man: MAN.logTail,
  // Placeholder lines (v1's tests use the same shape); a real hqplayerd log sample replaces these.
  mock: Array.from({ length: 50 }, (_, i) => `log line ${i + 11}`),
};
