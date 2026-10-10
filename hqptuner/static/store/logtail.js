// The hqplayerd log tail as /api/log serves it: the last lines of the daemon's
// log file, and the sentence to show when the request fails. Each refresh
// replaces the whole buffer with the answer.
import { signal } from "@preact/signals";
import { api } from "../lib/api.js";
import { endSentence, errText } from "../lib/errtext.js";

const LOG_ABSENT_CODE = "daemon_log_absent";

export const logLines = signal([]);
export const logMessage = signal(""); // set on a failed fetch; empty on success

/**
 * Fetch the log tail and replace the buffer with it; on a failed request, empty the buffer and set the message, which gives the error's own message and ends in one full stop.
 * @param {number} [count] how many trailing lines to ask for; the API's own default when omitted
 * @returns {Promise<void>} resolves once both signals hold the outcome
 */
export async function refreshLogTail(count) {
  try {
    const r = await api.log(count);
    logLines.value = r.lines || [];
    logMessage.value = "";
  } catch (e) {
    logLines.value = [];
    if (e instanceof Error && "code" in e && e.code === LOG_ABSENT_CODE) {
      logMessage.value = "HQPlayer is not serving a log file.";
      return;
    }
    logMessage.value = `Could not read HQPlayer's log: ${endSentence(errText(e))}`;
  }
}
