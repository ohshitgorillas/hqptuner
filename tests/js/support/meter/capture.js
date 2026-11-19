// The committed capture of the dev container's meter feed and the paint interval it was taken at, for the suites and
// contracts that replay it or generate feeds on the same display. No test() and no assert lives here.

import { secondsToMs } from "../../../../hqptuner/static/lib/timebase.js";

/** The committed capture of the dev container's feed, read, never written. */
export const CAPTURE_FILE = new URL("../../../support/fixtures/meter_feed_capture.json", import.meta.url);

/** One paint of a 60 Hz display, wall ms: the capture's paint interval, a time that is no whole number of eighths of a ms. */
export const PAINT_60HZ_MS = secondsToMs(1) / 60;
