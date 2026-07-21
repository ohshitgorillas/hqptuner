# HQPTuner: an improved configuration interface for HQPlayer Embedded

*A polished, free web UI for HQPlayer Embedded's settings — filters, modulators, rates, volume, and hardware acceleration — with the manual's knowledge built in.*

<!-- TODO: screenshot -->

## Inspiration

HQPlayer is, in my humble opinion, the best deal in all of high-end digital audio, with two caveats:
1. You may go broke trying to afford CPUs and GPUs to feed it the power it craves.
2. While everything under the hood works wonderfully, the default UI is bad.

The second point is the inspiration for HQPTuner. It's not just that the default UI is poorly organized with zero aesthetic appeal, but that I saw so much untapped potential. And let's be honest: HQPlayer is a complex program that takes time to learn. A bad UI doesn't just frustrate experienced users, it holds newbies back. HQPTuner's mission is to demystify HQPlayer as much as possible: put the manual's knowledge where the settings are, and let the interface do the teaching.

Let's take filter narrowing as an example—I consider this to be HQPTuner's best feature.

The default UI presents you with four dropdowns: 1x and Nx filters, PCM and SDM, each populated by over 50 filters. To select one, you open the manual, read the descriptions, find one that seems appropriate, and go hunting for it in the dropdown. Say you're listening to Redbook content (16bit/44.1kHz): you probably want an apodizing filter to correct for errors. Which of the 50 are apodizing? The dropdown won't tell you. If you want the manual's information in the web UI, clicking "Help" takes you to another page with everything listed out rote-style for you to Ctrl+F through.

HQPTuner integrates all of the manual's knowledge directly into the interface, so filters can be narrowed by quality, genre, focus, and phase. A simple checkbox restricts the 1x lists to apodizing filters only. Rather than cross-referencing a PDF against a list of 50 items, you're down to 15–20 relevant filters in a few clicks. Select a filter and its description from the manual appears right below the dropdown.

Filter narrowing is the flagship example, but the same philosophy runs through the whole interface: every setting explained in place, every invalid option grayed out with the reason why. You shouldn't need the manual open in another window just to configure your own audio chain.

## Benefits of HQPTuner

HQPTuner is an improvement over the stock web configuration UI in many ways:

* **More sensible organization**: Settings are organized into five tabs: Output, Resampling, DSP, Volume, and System.
* **Easier rate selection**: No more memorizing raw Hz values: select, e.g., PCM x4 or DSD512 from the rate selection menu.
* **Every feature has a description**: All of the information from the manual is optionally surfaced with explanations and descriptions for every feature and filter.
* **Filter narrowing**: Narrow the filter lists by quality, genre, focus, and phase, with an option to only show apodizing filters for 1x material.
* **Smart option availability**: Only see options that are appropriate for the settings you've selected; e.g., PCM options gray out/collapse in SDM output mode, and modulators are grayed below their minimum rate.
* **Live volume control**: For those who rely on HQPlayer for volume adjustment.
* **Live response plots**: Crossfeed and loudness cards render their frequency response as you turn the knobs.
* **Exposes more options**: Critical hardware acceleration options like multicore DSP, CUDA mode, and E-core modes are all exposed and explained.
* **Consistent behavior**: No unexpected profile switches or surprise default profile loads; HQPTuner always comes back with the settings you sent.
* **Log tail in the browser**: The daemon's log, right in the System tab.

## Drawbacks of HQPTuner

While it should cover 95% of use cases, this is **not** a full-featured configuration interface.

Unavailable features:
* Media metadata and controls
* Library management
* Convolution engine

Furthermore, to maintain "friendly" output rate options, the "Auto-rate family" option is always forced and only the most common output rates (multiples of 44.1k and 48k) are available.

## How it works

HQPTuner is a single small Python backend plus a no-build-step web frontend. It talks to a running `hqplayerd` over two lanes:

* **Control API (TCP 4321)** — live, restart-free settings (filters, dither/modulator, mode, rate, volume) plus status and enumerations. The running engine is the sole authority for filter/modulator names and IDs; HQPTuner never trusts shipped lists.
* **HTTP configuration interface (TCP 8088, Digest auth)** — persistent settings. HQPTuner submits the daemon's own config form, and the daemon writes `hqplayerd.xml` itself and restarts (~10 s); HQPTuner rides out the restart and verifies every change by readback. Settings the form doesn't expose (CUDA offload, multicore DSP, E-core allocation, blocks/cycle) go through a backup → surgical XML edit → `/restore` cycle on the same lane.

Edits are staged in a pending-changes bar showing the live/restart split before you apply. Presets are full-config XML snapshots stored and managed by HQPTuner itself (the daemon's native profile subsystem proved unreliable), mirrored into the daemon's own config directory so the stock UI stays populated.

Descriptions, tooltips, and constraint data (e.g. each modulator's minimum rate) are extracted once from the HQPlayer manual into JSON and joined against the live engine's enumerations by name at runtime.

## Requirements

* Python 3.12+
* A running HQPlayer Embedded daemon (developed and verified against 6.0.4)
* The hqplayerd management credential (set via `hqplayerd -u/-s` or the `/auth` page) — required for persistent-config writes and presets; read-only use and live settings work without it
* Same-host installation recommended (enables the log tail; the wire lanes themselves work over the network)

## Install & run

Not yet packaged (Docker + compose are planned for release). From a clone:

```sh
python3 -m venv .venv
.venv/bin/pip install -e .

HQPTUNER_HQP_USERNAME=<user> HQPTUNER_HQP_PASSWORD=<pass> .venv/bin/python -m hqptuner
```

Then open `http://127.0.0.1:8090`.

## Configuration reference

All knobs are environment variables (see `hqptuner/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `HQPTUNER_HQP_HOST` | `127.0.0.1` | hqplayerd host |
| `HQPTUNER_HQP_CONTROL_PORT` | `4321` | Control API port |
| `HQPTUNER_HQP_HTTP_PORT` | `8088` | hqplayerd web config port |
| `HQPTUNER_HQP_USERNAME` | *(empty)* | Management username (Digest auth) |
| `HQPTUNER_HQP_PASSWORD` | *(empty)* | Management password |
| `HQPTUNER_LISTEN_HOST` | `127.0.0.1` | HQPTuner bind address |
| `HQPTUNER_LISTEN_PORT` | `8090` | HQPTuner port |
| `HQPTUNER_POLL_INTERVAL` | `2.0` | Status poll cadence (s) |
| `HQPTUNER_ALARM_THRESHOLD` | `15.0` | Seconds unreachable before alarm |
| `HQPTUNER_REQUEST_TIMEOUT` | `5.0` | Per-request timeout (s) |
| `HQPTUNER_DATA_DIR` | `data/` | Static metadata JSON |
| `HQPTUNER_BACKUP_DIR` | `backups/` | Pre-apply config backups |
| `HQPTUNER_PRESET_DIR` | `presets/` | HQPTuner-owned preset store |

## Development

* `make check` — full gate suite: ruff, black, xenon complexity, vulture, strict mypy, file-length and test-assertion checks, offline tests. Must be green before every commit (pre-commit enforces the same).
* `make test` — offline test suite (fake daemons speaking the real wire protocol).
* `make test-live` — adds `live`-marked tests; needs a reachable hqplayerd.

Design and reference docs:

* `outline.md` — design outline (architecture, UI, behavior rules)
* `roadmap.md` — phase plan and per-phase decisions
* `docs/protocol.md` — Control API + HTTP lane wire reference (derived from the official MIT-licensed `hqp-control` source, verified against a live daemon)
* `docs/settings-classification.md` — every setting tagged live vs restart
* `docs/testing.md` — binding testing policy

## Status

Pre-release. Backend (read + write paths) complete and live-validated; frontend built and hand-walked, with behavior-rule polish and packaging still to come. Expect rough edges and no stability guarantees yet.

## License

MIT (on release). The Control API implementation is derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution.
