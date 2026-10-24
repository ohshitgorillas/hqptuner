import { signal, effect } from "@preact/signals";
import { health } from "./signals.js";
import { panelOpen } from "./faceplate/view.js";
import { api as defaultApi } from "../lib/api.js";

/** @typedef {import("../lib/clock.js").Clock} Clock */
/** @typedef {Pick<typeof import("../lib/api.js").api, "connection" | "saveConnection" | "discoverDaemons">} ConnectionApi */
/** @typedef {"no-host" | "connecting" | "saved" | "refused" | "no-8088" | "no-answer" | "unreachable" | null} Verdict */

/** The connection panel state for one page. */
class ConnectionPanel {
  /** @param {ConnectionApi} api */
  constructor(api) {
    this.api = api;
  }
  pageHost = signal("");
  discovering = signal(false);
  form = signal({ host: "", username: "", password: "", remember: true, hasPassword: false });
  hostTouched = signal(false);
  verdict = signal(/** @type {Verdict} */ (null));
  autoOpened = false;
  awaitingVerdict = false;
  closeOnSuccess = false;
  /** @type {string | null} */
  savedLane = null;
  /** @type {(() => void) | undefined} */
  dispose;
  openPanel = () => {
    panelOpen.value = true;
    void this.loadConnection().then(this.runDiscovery);
  };
  closePanel = () => {
    panelOpen.value = false;
  };
  /** @param {Record<string, unknown>} h */
  judgeSave = (h) => {
    if (h.phase === "Ready") {
      this.verdict.value = "saved";
      this.awaitingVerdict = false;
      if (this.closeOnSuccess) this.closePanel();
      return;
    }
    if (this.savedLane === "refused") this.verdict.value = "refused";
    else if (h.address_found === false) this.verdict.value = "unreachable";
    else if (h.phase === "Reachable" && this.savedLane === "no_credentials") this.verdict.value = "no-8088";
    else if (h.phase === "Reachable" && this.savedLane === "no_answer") this.verdict.value = "no-answer";
    else this.verdict.value = "connecting";
  };
  initPanel = () => {
    this.dispose?.();
    this.autoOpened = false;
    this.awaitingVerdict = false;
    this.savedLane = null;
    this.verdict.value = null;
    this.dispose = effect(() => {
      if (!panelOpen.value && this.awaitingVerdict) {
        this.awaitingVerdict = false;
        this.verdict.value = null;
      }
      const h = /** @type {Record<string, unknown> | null} */ (health.value);
      if (!h) return;
      if (this.awaitingVerdict) {
        this.judgeSave(h);
        return;
      }
      if (this.autoOpened || panelOpen.value) return;
      if (h.credentials_ok === false || h.address_found === false) {
        this.autoOpened = true;
        this.openPanel();
      }
    });
    return /** @type {() => void} */ (this.dispose);
  };
  runDiscovery = async () => {
    this.discovering.value = true;
    try {
      const found = await this.api.discoverDaemons();
      const answered = Array.isArray(found) ? found : [];
      if (answered.length === 1 && !this.hostTouched.value) {
        this.form.value = { ...this.form.value, host: answered[0].address };
      }
    } catch {
      // An unanswered sweep leaves the field as it stands.
    } finally {
      this.discovering.value = false;
    }
  };
  detectHosts = async () => {
    this.hostTouched.value = false;
    await this.runDiscovery();
  };
  loadConnection = async () => {
    this.hostTouched.value = false;
    this.verdict.value = null;
    try {
      const c = await this.api.connection();
      this.form.value = {
        host: c.host || "",
        username: c.username || "",
        password: "",
        remember: c.remember === true,
        hasPassword: c.has_password === true,
      };
    } catch {
      // An unanswered backend still leaves a panel to type into.
    }
  };
  /** @param {boolean} [andClose] */
  submitConnection = async (andClose = false) => {
    const f = this.form.value;
    const host = f.host.trim();
    this.closeOnSuccess = andClose;
    if (!host) {
      this.verdict.value = "no-host";
      return;
    }
    this.verdict.value = "connecting";
    this.awaitingVerdict = true;
    /** @type {Record<string, unknown>} */
    const body = { host, username: f.username, remember: f.remember };
    if (f.password) body.password = f.password;
    const answer = await this.api.saveConnection(body);
    if (!this.awaitingVerdict) return;
    this.savedLane = answer && answer.lane;
    this.judgeSave(/** @type {Record<string, unknown>} */ (health.value) || {});
  };
  /** @param {string} address */
  fillHost = (address) => {
    this.hostTouched.value = true;
    this.form.value = { ...this.form.value, host: address };
  };
}

/** Create a connection panel with its own form and health watch.
 * @param {{ clock?: Clock, api?: ConnectionApi }} [options]
 */
export function createConnPanel(options = {}) {
  return new ConnectionPanel(options.api ?? defaultApi);
}

/** @typedef {ReturnType<typeof createConnPanel>} ConnPanelStore */
