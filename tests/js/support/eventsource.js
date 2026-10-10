// The EventSource stand-in for the suites that read the METER feed. Plain node
// has no EventSource, so a suite installs this fake on the global the page's
// code constructs from, and pushes events into it by hand: the event names and
// JSON payloads are the ones /api/meter/feed sends (api/routes/meter.py).
//
// Not a *.test.js file on purpose: the runner glob would execute it.

/**
 * The global the fake is installed on, viewed as an optional member: the DOM lib
 * declares `EventSource` as a full, always-present constructor, which this fake
 * does not build.
 *
 * @type {{ EventSource?: unknown }}
 */
const env = globalThis;

/** One fake stream: the URL it was opened on, its listeners, and whether it was closed. */
class FakeEventSource {
  /** @type {FakeEventSource[]} */
  static opened = [];

  /** @param {string} url */
  constructor(url) {
    this.url = url;
    this.closed = false;
    /** @type {Map<string, Array<(e: { data: string }) => void>>} */
    this.listeners = new Map();
    FakeEventSource.opened.push(this);
  }

  /**
   * @param {string} type
   * @param {(e: { data: string }) => void} fn
   */
  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  close() {
    this.closed = true;
  }

  /**
   * Deliver one server-sent event, as the browser would, to this stream's listeners.
   *
   * @param {string} type
   * @param {unknown} payload
   */
  emit(type, payload) {
    if (this.closed) return;
    for (const fn of this.listeners.get(type) || []) fn({ data: JSON.stringify(payload) });
  }
}

/** Install the fake with an empty log of opened streams. */
export function useEventSource() {
  FakeEventSource.opened = [];
  env.EventSource = FakeEventSource;
}

/** The stream opened last, or null when none was. @returns {FakeEventSource | null} */
export function lastStream() {
  return FakeEventSource.opened.at(-1) || null;
}
