// The Station builder's mock checks: the wizard's checks against the engine (IPv6, USB listings, the 48k-family DSD
// check) run as mock sequences that print the wizard's lines a tick apart, then the verdict, and repaint while their step
// shows. Outcomes come from the mock flags (`#ipv6-fail`, `#usb-fail-gone` / `#usb-fail-none`, `#dsd48-no`).

import { checkSequence } from "../../model/timing.js";
import { DEVICES, RATE_TIERS } from "../../data/output.js";
import { STB_IPV6, STB_USB, STB_RATES } from "../../data/station-builder.js";
import { ipv6Verdict, usbVerdict, dsd48Verdict } from "../../model/station.js";

const TICK = 700; // mock: one line of a check

/**
 * Run a mock check: print each line a tick apart, then the verdict; repaint while its step shows. A check started for
 * another edit (the station switched) is dropped.
 *
 * @param {object} sb  the builder's state
 * @param {{ key: string, steps: string[], verdict: () => [boolean, string, (() => void)?], restarts?: boolean }} c
 */
export function runCheck(sb, { key, steps, verdict, restarts = true }) {
  const run = { lines: [], done: false, ok: false };
  sb.runs[key] = run;
  const mine = sb.e;
  if (restarts) sb.o.onRescan?.(); // the IPv6 test restarts the daemon, a rescan stops it (wizard): the knob reads Applying…
  checkSequence(
    steps,
    TICK,
    (t) => {
      if (sb.e !== mine) return;
      run.lines.push(t);
      if (sb.at === key) sb.show(sb.at);
    },
    () => {
      if (sb.e !== mine) return;
      const [ok, line, apply] = verdict();
      run.lines.push(line);
      run.done = true;
      run.ok = ok;
      apply?.();
      sb.show(sb.at);
    },
    sb.clock,
  );
  sb.show(sb.at);
}

/** The IPv6 check: `ask2` is the I-don't-know test (two lines), else the Yes answer's one. */
export function testV6(sb, ask2) {
  const fail = sb.flags.ipv6Fail;
  const steps = ask2 ? STB_IPV6.unknown.steps : [STB_IPV6.yes.run];
  runCheck(sb, {
    key: "ipv6",
    steps,
    verdict: () => {
      const v = ipv6Verdict(fail);
      const copy = ask2 ? STB_IPV6.unknown : STB_IPV6.yes;
      return [
        v.ok,
        v.ok ? copy.ok : copy.fail,
        () => {
          sb.e.rec.v6 = v.v6;
        },
      ];
    },
  });
}

/** The USB listings check: the listing that survives the DAC going down is locked in. */
export function disambiguate(sb) {
  const why = sb.flags.usbFail;
  const x = sb.e.rec;
  runCheck(sb, {
    key: "usb",
    steps: [STB_USB.run],
    verdict: () => {
      const v = usbVerdict(why, x.listings, why ? [] : DEVICES[x.backend].list); // mock: the later listing answers
      return v.ok
        ? [
            true,
            `${STB_USB.ok}`,
            () => {
              x.resolved = v.resolved;
            },
          ]
        : [
            false,
            STB_USB.fail(STB_USB.why[why]),
            () => {
              x.resolved = null;
            },
          ];
    },
  });
}

/** The 48k-family DSD check: the device announces the Output drawer's limits and native DSD. */
export function detect48(sb) {
  const no = sb.flags.dsd48No;
  runCheck(sb, {
    key: "rates",
    steps: [STB_RATES.check],
    restarts: false,
    verdict: () => [
      true,
      STB_RATES.ok,
      () => {
        Object.assign(sb.e.rec, dsd48Verdict(sb.e.rec, !no, RATE_TIERS.limits));
      },
    ],
  });
}
