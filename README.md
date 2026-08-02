# HQPTuner: an improved configuration interface for HQPlayer Embedded

A polished and enhanced configuration interface for HQPlayer Embedded.

<img width="1189" height="1430" alt="image" src="https://github.com/user-attachments/assets/653d74ff-aefc-4297-885d-52ddfd4a0298" />

*The Output tab during DSD512 playback: live signal path across the top, Backend / Mode / Rate master switches, and every setting explained in place.*

## Inspiration

HQPlayer is, in my humble opinion, the best deal in all of high-end digital audio, with two caveats:
1. You may go broke trying to afford CPUs and GPUs to feed it the power it craves.
2. The UI is _bad_.

The second point is the inspiration for HQPTuner. It's not just that the default UI is poorly organized with zero aesthetic appeal, but that I saw so much untapped and wasted potential. And let's be honest: HQPlayer is a complex program that takes time to learn. A bad UI doesn't just frustrate experienced users, it holds newbies back and drives away potential users. HQPTuner's mission is to demystify and enhance the HQPlayer experience as much as possible. It's a UI that both newbies and experts should be able to use with ease.

Let's take filter narrowing as an example. This is, in my very humble opinion, HQPTuner's #1 flagship feature and the one thing most badly missing from the stock UI.

The web interface presents you with four dropdowns: 1x and Nx filters for PCM and SDM, each populated by over 50 filters with baffling names like `poly-sinc-gauss-halfband`. To select one, you open the manual, do your best to parse the descriptions (if you even know what "minimum phase" means), find one that seems appropriate, and pick it out of the dropdown. If you're listening to Redbook content (16bit/44.1kHz), you'll want an apodizing filter to correct for mastering errors. Which of the 50+ are apodizing? The dropdown won't tell you. If you want the manual's information in the web UI, clicking "Help" takes you to another page with everything listed out rote-style for you to Ctrl+F through.

HQPTuner instead integrates all of the manual's knowledge directly into the interface, so filters can be narrowed by quality, genre, focus, phase, length, and/or rate limits. A simple checkbox restricts the 1x lists to apodizing filters only and is selected by default. Your dropdown is only a handful of relevant filters in a few clicks.

The same philosophy runs through the whole project: you shouldn't need a PDF or separate tab open to figure out what you're doing in HQPlayer.

## Features and Improvements

HQPTuner offers the following features and improvements over the stock web configuration UI.

**1. Filter narrowing.** The manual's knowledge folded into the filter lists, so 50 opaque names narrow to the few that fit in a few clicks.

**2. Headphone Auto EQ.** A built-in AutoEq library of 8850+ headphone models: search your headphones, A/B the correction curve against your current response, and load it into a stereo pipeline pair in one click. AutoEq/REW ParametricEQ text files import directly too, and every EQ band becomes a draggable dot on the live response plot. Tune by ear, REW-style, without leaving the page.

**3. Crossfeed, two ways.** HQPlayer ships Bauer crossfeed: a three-preset model with a crossover frequency and a level in dB, which are coefficients of its own filter rather than anything you can picture. It's good, but it's not my jam. So I built in an alternative: structural crossfeed feature modelling an actual head and an actual pair of speakers, from Brown & Duda's structural HRTF model. Three controls, all quantities you can picture: **speaker angle**, **head circumference**, and **center character** (ok, the last one is hard to picture, but the plots make it easy to understand). It compiles to sixteen matrix pipelines carrying an explicit interaural delay and a head-shadow filter; the shadow filter factors exactly into a flat row plus a first-order lowpass, so nothing is numerically fitted and nothing is sample-rate-bound. Integrates with and doesn't disturb your EQ curve.

<img width="1193" height="954" alt="image" src="https://github.com/user-attachments/assets/75313c1d-2d13-45f6-b621-1d6df856b0b1" />

*The Resampling tab showing filter narrowing options.*

The above three features are my flagships, but the following benefits are offered as well:

* **Surface the manual's knowledge**: Every feature has its manual's description printed right underneath it. This can be converted to hover tips for those who prefer a cleaner interface.
* **More sensible organization**: Settings are organized into five tabs: Output, Volume, Resampling, DSP, and System.
* **Easier rate selection**: No more memorizing raw Hz values: select, e.g., PCM 4x or DSD512 from the rate selection menu.
* **Idiot proofing**: Only see options that are appropriate for the settings you're running. Don't waste time trying to figure out the best Integrator if you're only outputting PCM. Running DSD512? Modulators that only work at DSD1024 are grayed out _with reasons_.
* **Full matrix pipeline editing**: Visual signal-flow editing of matrix pipelines, with a stage editor for every plugin type, headphone EQ import, and live response plots.
* **Live response plots**: Crossfeed, loudness, and matrix pipelines all render their frequency response as you adjust them — and EQ bands are draggable dots right on the plot, REW-style.
* **Live volume control**: For those who rely on HQPlayer for volume adjustment.
* **LIVE mode**: A switch at the top drops the tabs for a single page of everything the running engine can change in place — mode, rate, both filter chains, dither, volume, matrix profile. No Apply: each control writes when you change it. Save the lot as a **live preset** and load it back in one click, output mode included, so a DSD preset applies while PCM is playing by switching the engine over. Nothing on the page is saved to the configuration; it lasts until the daemon restarts.
* **Exposes more options**: Critical hardware acceleration options like multicore DSP, CUDA mode, and E-core modes are all exposed and explained.
* **Consistent behavior**: No unexpected profile switches or surprise default profile loads; HQPTuner always comes back with the settings you sent.
* **Log tail in the browser**: The daemon's log, right in the System tab.

<img width="1195" height="1876" alt="image" src="https://github.com/user-attachments/assets/0cf921af-7f43-4503-917c-988b77561383" />

*The Matrix tab demonstrating the effects of structural crossfeed mode on the Matrix Response plot.*

## Drawbacks of HQPTuner

While it should cover the vast majority of use cases, this is **not** a full-featured configuration interface.

Unavailable features:
* Media playback and library management (use Roon)
* The convolution engine (use Matrix DSP)

Furthermore, to maintain "friendly" output rate options, the "Auto-rate family" option is always forced and setting the max rate to 32kHz multiples is impossible. If you're one of those 32kHz weirdos, HQPTuner may not be for you.

**HQPTuner works with HQPlayer Embedded only.** HQPlayer Desktop has no web interface — the port-8088 configuration lane HQPTuner depends on doesn't exist there. Sorry!

## How it works

HQPTuner is a single small Python backend plus a no-build-step web frontend. It talks to a running `hqplayerd` over two lanes:

* **Control API (TCP 4321)** — live, restart-free settings (filters, dither/modulator, mode, rate, volume, matrix profile switching) plus status and enumerations. The running engine is the sole authority for filter/modulator names and IDs; HQPTuner never trusts shipped lists.
* **HTTP configuration interface (TCP 8088, Digest auth)** — persistent settings. Every change — including the ones the daemon's config form never exposed (CUDA offload, multicore DSP, E-core allocation, blocks/cycle) — goes through a backup → surgical `hqplayerd.xml` edit → `POST /restore` cycle; the daemon self-restarts (~5.6 s), and HQPTuner rides that out and verifies by readback.

Edits are staged in a pending-changes bar showing the live/restart split before you apply. Presets are full-config XML snapshots stored and managed by HQPTuner itself (the daemon's native profile subsystem proved unreliable), mirrored into the daemon's own config directory so the stock UI stays populated.

Descriptions, tooltips, and constraint data (e.g. each modulator's minimum rate) are extracted once from the HQPlayer manual into JSON and joined against the live engine's enumerations by name at runtime. The headphone EQ library is a pinned, vendored snapshot of [AutoEq](https://github.com/jaakkopasanen/AutoEq) (MIT).

## Requirements

* A running HQPlayer **Embedded** daemon (developed and verified against 6.0.4; Desktop is not supported — see above)
* The hqplayerd management credential (set via `hqplayerd -u/-s` or the `/auth` page) — required for persistent-config writes and presets; read-only use and live settings work without it

## Install & run

### Docker (recommended)

Grab [`compose.yaml`](compose.yaml) and start:

```sh
mkdir -p state   # backups + presets live here; create it first so it's owned by you
docker compose up -d
```

Credentials default to hqplayerd's stock management credential (`hqplayer` / `password`). If your daemon's auth was re-provisioned, put yours in a `.env` file next to the compose file:

```sh
printf 'HQPTUNER_HQP_USERNAME=<user>\nHQPTUNER_HQP_PASSWORD=<pass>\n' > .env
```

Start the container:

```sh
sudo docker compose -f /path/to/compose.yaml up -d
```

Then open `http://<serverIP>:8090`.

Images are published to `ghcr.io/ohshitgorillas/hqptuner` (amd64 + arm64) in two channels:

| Tag | Branch | Who it's for |
|---|---|---|
| `:latest` | `main` | Everyone. The stable channel. |
| `:beta` | `beta` | Testers trying a fix before it ships. Expect rough edges. |
| `:vX.Y.Z` | version tags | Pinned to one release. |

To try a beta build, point the image at `ghcr.io/ohshitgorillas/hqptuner:beta` in your `compose.yaml` and `docker compose up -d`. Switch back by setting it to `:latest` and pulling again.

### From a clone (no Docker)

```sh
python3 -m venv .venv
.venv/bin/pip install -e .

.venv/bin/python -m hqptuner
# non-stock daemon credential:
# HQPTUNER_HQP_USERNAME=<user> HQPTUNER_HQP_PASSWORD=<pass> .venv/bin/python -m hqptuner
```

## Configuration reference

All knobs are environment variables (see `hqptuner/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `HQPTUNER_HQP_HOST` | `127.0.0.1` | hqplayerd host |
| `HQPTUNER_HQP_CONTROL_PORT` | `4321` | Control API port |
| `HQPTUNER_HQP_HTTP_PORT` | `8088` | hqplayerd web config port |
| `HQPTUNER_HQP_USERNAME` | `hqplayer` | Management username (Digest auth); default is hqplayerd's stock credential |
| `HQPTUNER_HQP_PASSWORD` | `password` | Management password; default is hqplayerd's stock credential |
| `HQPTUNER_HQP_HOME` | `/var/lib/hqplayer/home` | hqplayerd's data/home directory on the daemon host (uploaded convolution impulses land here) |
| `HQPTUNER_LISTEN_HOST` | `127.0.0.1` | HQPTuner bind address |
| `HQPTUNER_LISTEN_PORT` | `8090` | HQPTuner port |
| `HQPTUNER_POLL_INTERVAL` | `2.0` | Status poll cadence (s) |
| `HQPTUNER_ALARM_THRESHOLD` | `15.0` | Seconds unreachable before alarm |
| `HQPTUNER_REQUEST_TIMEOUT` | `5.0` | Per-request timeout (s) |
| `HQPTUNER_DATA_DIR` | packaged `hqptuner/data/` | Static metadata JSON |
| `HQPTUNER_BACKUP_DIR` | `backups/` | Pre-apply config backups |
| `HQPTUNER_PRESET_DIR` | `presets/` | HQPTuner-owned preset store |

## Development

Backend and frontend carry matching gate suites. Run `npm install` once alongside the venv — the JS tooling is dev-only and never ships. The Python dev tools are the `dev` extra:

```sh
.venv/bin/pip install -e ".[dev]"
```


* `make check` — everything below. Must be green before every commit.
* `make lint` — Python: ruff, black, xenon complexity, vulture, strict mypy, file-length and test-assertion checks.
* `make lint-js` — frontend, one-for-one with the above: eslint (ruff), prettier (black), `tsc --checkJs` (mypy), knip (vulture), file-length, plus the CSS design-token (`check_css_tokens.py`) and control-catalog (`check_control_catalog.py`) gates. The complexity ceiling is 10, matching `xenon --max-absolute B`.
* `make test` — offline Python suite (fake daemons speaking the real wire protocol).
* `make test-live` — adds `live`-marked tests; needs a reachable hqplayerd.
* `make test-js` — frontend suite on node's built-in runner. No browser, no bundler: a loader hook reads the importmap out of `index.html` so tests exercise the same vendored preact/htm the browser loads, and components render through `preact-render-to-string`.

Pre-commit runs both lint suites and the Python tests; the JS suite is `make check` only, to keep the commit path from carrying two full suites.

Design and reference docs:

* `docs/architecture.md` — architecture, integration lanes, and the normative rules (enumeration volatility, behavior rules, presets)
* `docs/protocol.md` — Control API + HTTP lane wire reference (derived from the official MIT-licensed `hqp-control` source, verified against a live daemon)
* `docs/matrix-spec.md` — matrix pipeline editing design of record, probe findings, delivery checklist
* `docs/settings-classification.md` — every setting tagged live vs restart
* `docs/crossfeed-math.md` — structural crossfeed model, derivation, and matrix realization
* `docs/eq-export.md` — REW / Equalizer APO export format reference
* `docs/testing.md` — binding testing policy
* `docs/eq-assistant/eq-assistant-plan.md` — EQ Assistant implementation plan (not yet built), alongside its research base in the same directory

## Status

**Beta.** Backend and frontend are feature-complete and live-validated against hqplayerd 6.0.4, and Docker packaging is in. Testers welcome — especially advanced matrix users: pipeline setups beyond stereo EQ (multichannel routing, crossovers, per-stage convolution chains) have had far less real-world exercise than the rest of the app. Expect rough edges; back up your config (System → About → Backup) before experimenting. Bug reports with the raw pipeline strings involved are gold.

## License

[MIT](LICENSE). The Control API implementation is derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. The vendored headphone EQ database is from [AutoEq](https://github.com/jaakkopasanen/AutoEq) (MIT).
