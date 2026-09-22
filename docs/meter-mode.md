# METER mode

A level and spectrum display for the running engine, with the apodizing-event history laid on the same time axis so a burst of events can be placed against what the source was doing when it happened.

## Access

METER is a mode, not a tab, on the same footing as LIVE (`App.js`): on, it replaces the tab bar, the tab body and the pending bar; the header stays. The switch is a header instrument, a three-band mini spectrum beside the apodizing lamp, and clicking it opens the page. LIVE and METER sit together as the header's mode pair; the lamp and the mini spectrum are its readout pair; the preset picker stays a control.

The mini spectrum rides the existing status poll. `/api/status` carries three band levels, low, mid and high, integrated by the backend over the poll interval, and the bars ease toward each reading with `--sweep`. Nothing else in the header changes cadence, and no feed is opened on a tab that is not METER.

## Data

Everything source-side comes from hqplayerd's metering stream on port 4322 (`docs/protocol.md` §7): per channel, `peakMax`, `peak`, `rms` and `rmsMax` in dBFS plus a 1025-bin transform, one frame per hop, at the source rate. The tap sits before oversampling, so the spectrum ends at the source Nyquist and shows nothing of the output side. `pre_before_meter` decides whether the playback filter is applied before the tap.

Bin width is the source rate over 2048: 21.5 Hz at 44.1 kHz, 46.9 Hz at 96 kHz. On a log axis the bottom decade holds a handful of bins, and the display draws those as wide bars sharing one bin rather than interpolating detail that is not there.

On a 1-bit source the stream sends no frames. The page shows a stated no-metering state for DSD; the apodizing strip, which reads `Status.apod` on the control channel, stays live.

Apodizing events come from `Status.apod`, a cumulative counter polled at the page cadence, so their resolution is one poll and no finer. `store/apodhistory.js` already turns the counter into per-poll bins and handles track boundaries; the page reads those bins.

## Feed

The page opens a Server-Sent Events stream from a new endpoint while it is up and closes it when the mode is left. Stock uvicorn serves it; no new transport dependency. The backend sends every second to fourth frame, 20 to 30 a second, carrying per-channel levels with `peak` max-held across the skipped frames and the spectrum reduced to 1/12-octave bands averaged across them. About 15 KB/s per open page.

`MeteringReader` (`hqptuner/engine/metering.py`) ingests every frame and fans out to two consumers: the junk-filter advisor's aggregate it already keeps, and the live broadcaster. The socket rule stands: connected only while the engine reports playing. The broadcaster sends only while a page is attached. numpy is a runtime dependency, for the per-frame band reduction.

## Page

Live meters, at feed rate:

- Level meters per channel: peak and RMS bars, a peak-hold mark, a clip flag from the `Status.clips` delta. Fast attack and slow release on the client; the dB floor is selectable.
- Spectrum: bars or a line; log or linear frequency; selectable dB range, averaging and band resolution; a peak-hold trace; summed or per-channel; markers at the source Nyquist and at the 20k, 30k, 40k and 50k playback-filter corners.
- Advisor overlay: the reader's windowed minimum spectrum drawn under the live one, with bins the advisor currently holds as spurs marked. It shows what the junk-filter advice is looking at.

Chart recorder, at poll rate, one column per poll, newest at the right:

- Level history: RMS per column.
- Spectrogram: frequency on the vertical axis, level as color on the `--spec-*` ramp.
- Apodizing density: `ApodStrip`, a component of its own that takes its time axis from the recorder and is also what Engine Health draws.

The three share one time axis and one window control, backed by the existing `apodWindow` preference. Hovering a column reads all three at that second.

When the engine is not playing, meters park and the page dims, as Engine Health does.

## Drawing

Spectrum bars are SVG rects updated in place per frame, outside preact's render. The spectrogram is a canvas; it reads the ramp and surface colors from the CSS tokens with `getComputedStyle` once and again on a theme change, and `docs/design-system.md` gains the rule that canvas takes its colors from tokens that way and from nowhere else.

## Settings

Every adjustable, dB floor, frequency scale, dB range, averaging, band resolution, peak hold, channel mode and spectrogram on or off, is a `prefs.js` signal persisted in localStorage.

## Copy

Every label, option, caption and idle message is owner-approved verbatim before it ships.

## Open

Whether `peakMax` and `rmsMax` hold since connection or since the track began is unmeasured; the level meters' peak-hold mark is computed on the client either way.
