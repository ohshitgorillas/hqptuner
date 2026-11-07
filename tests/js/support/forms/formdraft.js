import { formDraft } from "../../../../hqptuner/static/store/core/forms.js";
import { failures, op } from "../../../../hqptuner/static/store/core/ops.js";
import { engineRestarting } from "../../../../hqptuner/static/store/enginewrite.js";
import { ok, stagingWire } from "../wire/wire.js";

export const BASE = { gain: 2, delay: 7 };
export const READBACK = { gain: 4, delay: 11 };
const KEYS = ["gain", "delay"];
const AREA = "apply";
export const HEALTH_PATH = "/api/health";
export const STANDING_GENERATION = 61;
const unwired = globalThis.fetch;

export function pending() {
  /** @type {(value: Record<string, unknown>) => void} */
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function settled() {
  await Promise.resolve();
  await Promise.resolve();
}

/** @param {Partial<Parameters<typeof formDraft>[0]>} [options] */
export async function draft(options = {}) {
  const item = formDraft({
    load: async () => BASE,
    write: async () => undefined,
    keys: KEYS,
    area: AREA,
    ...options,
  });
  await settled();
  return item;
}

/**
 * A wire that answers GET /api/health with a Ready reading at the standing generation, and logs each path it is
 * handed into `log`.
 *
 * @param {string[]} log
 */
export function healthWire(log) {
  return stagingWire({
    routes: (path) => {
      const route = path.split("?")[0];
      log.push(route);
      if (route !== HEALTH_PATH) return undefined;
      return ok({
        phase: "Ready",
        generation: STANDING_GENERATION,
        connected_at: "2026-10-25T10:00:00Z",
        credentials_ok: true,
        address_found: true,
      });
    },
  });
}

/** A load that answers BASE until `fail()` is called, then refuses every read. */
export function failingAfter() {
  let refusing = false;
  return {
    load: async () => {
      if (refusing) throw new Error("fixture read refusal");
      return BASE;
    },
    fail: () => {
      refusing = true;
    },
  };
}

/** The errors the form's alert line is showing. */
export function lineErrors() {
  return failures.value.filter((entry) => entry.area === AREA).map((entry) => entry.error);
}

/** Clears the form's alert line, lowers the engine-restart dim and unwires fetch; run after every case. */
export function resetForm() {
  op(AREA).clear();
  engineRestarting.value = false;
  globalThis.fetch = unwired;
}
