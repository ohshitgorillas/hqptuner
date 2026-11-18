# Phase 7: what port 4322 does around a track start (AC1 report)

Source: `tests/support/fixtures/meter_start_capture.json`, one held-mode run of 300 s, taken by `scripts/probes/meter/capture_meter_start.py` on the live engine with the owner starting tracks in Roon, owner spectrum offset 0.69 s. Read-only: one bare connection to 4322 and Status reads every 200 ms, no transport and no write.

This report states measurements and their plain reading against the two candidate causes. It proposes no fix and no rule; the ruling is Plan 2's.

## How to reproduce a number

Every number below is printed by one of the blocks A to F. Run a block from the repo root as `cat PRELUDE BLOCK | .venv/bin/python -I -`, where PRELUDE is the prelude block and BLOCK is the block's text. Each block shows the output it printed when this report was written.

The stamp lead used throughout is, for the last frame arrived by wall time `t`: the playback ms the stamps have counted so far, minus `t`. Playback ms per frame is `(bins - 1) / rate * 1000`, with `rate` the metering rate the frame's own header implies (`round((bins - 1) / xform_time)`, as `metering_rate` does in `hqptuner/engine/meterfeed.py`). A positive lead means the stamps run ahead of wall time. The lead is measured from the connect moment (D-03, stamp 0), so it also carries any stretch with no frames.

Prelude:

```python
import json, bisect
r = json.load(open('tests/support/fixtures/meter_start_capture.json'))['runs'][0]
fr, st = r['frames'], r['status']
ev = [e for e in r['events'] if e['event'] == 'frame']
rate = lambda f: round((f['bins'] - 1) / f['xform_time'])
pb = 0.0; T = []; PB = []; RT = []
for f in fr:
    pb += (f['bins'] - 1) / rate(f) * 1000; T.append(f['t_ms']); PB.append(pb); RT.append(rate(f))
```

## What the capture holds

The run has one connection (connect at 0.9 ms) and no end of stream. Frames arrive at two metering rates: 44100 (9081 frames) and 96000 (8270 frames). Status shows six track serials, 30 to 35:

| Serial | Wall ms | What the owner did, as Status shows it | Kind |
|---|---|---|---|
| 30 to 31 | 7107 | State 0 to 2, 44100 | start from stopped, 44100 |
| 31 to 32 | 22679 | State stays 2, 44100 | same-rate change, 44100 |
| 32 to 33 | 37096 | State 0 for about 1 s, then 2, 96000 | rate change, 44100 to 96000 |
| 33 to 34 | 47419 | State stays 2, 96000 | same-rate change, 96000 |
| 34 to 35 | 126021 | State 0 for about 1 s, then 2, 44100 | rate change, 96000 to 44100 |

Block C prints the connection, geometry, stamp-break and per-serial rows:

```python
print('connections:', [(c['kind'], round(c['t_ms'], 1)) for c in r['connections']])
print('geometry events:', [(round(e['t_ms'], 1), e['data']['rate']) for e in r['events'] if e['event'] == 'geometry'])
print('frames per rate:', {k: RT.count(k) for k in sorted(set(RT))})
print('stamp breaks:', sum(1 for a, b in zip(ev, ev[1:]) if b['data']['at'] != a['data']['at'] + a['data']['n']))
print('frames with a header geometry other than 2 ch x 1025 bins:', sum(1 for f in fr if (f['channels'], f['bins']) != (2, 1025)))
prev = None
for s in st:
    if prev is not None and s['status']['track_serial'] != prev['status']['track_serial']:
        t = s['t_ms']; a, p = s['status'], prev['status']
        gaps = [(round(T[k - 1]), round(T[k] - T[k - 1])) for k in range(1, len(T)) if abs(T[k] - t) < 3000 and T[k] - T[k - 1] > 250]
        print('serial %s->%s at %.0f ms: state %s->%s, samplerate %s->%s, frame gaps over 250 ms in +-3 s (start, ms): %s' % (
            p['track_serial'], a['track_serial'], t, p['state'], a['state'], prev['samplerate'], s['samplerate'], gaps))
    prev = s
```

```text
connections: [('connect', 0.9)]
geometry events: [(143.5, 44100), (37312.6, 96000), (126210.0, 44100)]
frames per rate: {44100: 9081, 96000: 8270}
stamp breaks: 0
frames with a header geometry other than 2 ch x 1025 bins: 0
serial 30->31 at 7107 ms: state 0->2, samplerate None->44100, frame gaps over 250 ms in +-3 s (start, ms): []
serial 31->32 at 22679 ms: state 2->2, samplerate 44100->44100, frame gaps over 250 ms in +-3 s (start, ms): []
serial 32->33 at 37096 ms: state 0->2, samplerate None->96000, frame gaps over 250 ms in +-3 s (start, ms): [(36144, 1168)]
serial 33->34 at 47419 ms: state 2->2, samplerate 96000->96000, frame gaps over 250 ms in +-3 s (start, ms): [(47155, 296)]
serial 34->35 at 126021 ms: state 0->2, samplerate None->44100, frame gaps over 250 ms in +-3 s (start, ms): [(125051, 1159)]
```

## Does each kind of change restart the stream

The capture's reader holds its one connection through all five changes, so none ended the stream or needed a reconnect. A stamp break means a frame event whose `at` is not the previous `at` plus `n`; the run has none. Block C gives the rest:

- **Start from stopped, 44100:** no geometry event, no frame gap over 250 ms, no stamp break. Frames were already arriving at the real-time rate for the 7 s before it, with Status state 0 (block A, first rows). The start changed nothing in the stream.
- **Same-rate change, 44100:** no geometry event, no frame gap over 250 ms, no stamp break.
- **Same-rate change, 96000:** no geometry event and no stamp break. One frame gap of 296 ms ends at 47451 ms, where the steady gap is up to 200 ms (block A).
- **Rate change, 44100 to 96000, and back:** one geometry event each (96000 at 37312.6 ms, 44100 at 126210.0 ms), after a 1168 ms and a 1159 ms stretch with no frames while Status state was 0. No stamp break: the stamps carry on from the last `at`. The connection stayed open.

Only the two rate changes emitted a geometry event, and only they had a long stretch with no frames. The capture answers D-04's question for the stream: the start from stopped and both same-rate changes left the stream and the stamps untouched, and each rate change emitted a geometry event.

The capture does not show what the app's own reader does when Status state leaves playing at the two rate changes (State 0 for about 1 s), because this reader holds its connection regardless.

## Stamp lead over wall time

### After a rate change: the stamps run ahead

After a rate change the frames resume about 1.16 s after the frames stopped, and the stamps run ahead of wall time. Block B measures the lead from the first frame of the resumed stream:

```python
# after the stream resumes (a gap over 500 ms), lead relative to the resume's first frame
for i in [k for k in range(1, len(T)) if T[k] - T[k - 1] > 500]:
    t0 = T[i]; b = PB[i] - 1024 / RT[i] * 1000
    seg = lambda dt: (lambda j: PB[j] - b - (T[j] - t0))(bisect.bisect_right(T, t0 + dt) - 1)
    steady = [PB[j] - b - (T[j] - t0) for j in range(i, len(T)) if 5000 <= T[j] - t0 < 9000]
    s = sum(steady) / len(steady)
    reach = next(T[j] - t0 for j in range(i, len(T)) if PB[j] - b - (T[j] - t0) >= s - 50)
    print('resume t=%.0f ms rate=%d gap=%.0f ms' % (t0, RT[i], t0 - T[i - 1]))
    print('  lead at +0,100,200,300,500,1000 ms:', [round(seg(d)) for d in (0, 100, 200, 300, 500, 1000)])
    print('  mean lead +5..+9 s: %.0f ms; first within 50 ms of it at +%.0f ms' % (s, reach))
    for w in (300, 1000):
        print('  frames in first %d ms: %d, real time would be %.1f' % (w, bisect.bisect_right(T, t0 + w) - i, w / 1000 * RT[i] / 1024))
```

```text
resume t=37313 ms rate=96000 gap=1168 ms
  lead at +0,100,200,300,500,1000 ms: [11, 232, 357, 559, 518, 555]
  mean lead +5..+9 s: 514 ms; first within 50 ms of it at +256 ms
  frames in first 300 ms: 80, real time would be 28.1
  frames in first 1000 ms: 140, real time would be 93.8
resume t=126210 ms rate=44100 gap=1159 ms
  lead at +0,100,200,300,500,1000 ms: [23, 221, 434, 566, 536, 524]
  mean lead +5..+9 s: 539 ms; first within 50 ms of it at +231 ms
  frames in first 300 ms: 36, real time would be 12.9
  frames in first 1000 ms: 62, real time would be 43.1
```

Reading, per rate:

- **96000:** the stamps run ahead of wall time by 559 ms at +300 ms. The lead builds over the first 256 ms (to within 50 ms of its +5 to +9 s mean of 514 ms), then holds near 520 to 560 ms. In the first 300 ms, 80 frames arrive where real time would give 28.1.
- **44100:** the stamps run ahead by 566 ms at +300 ms. The lead builds over the first 231 ms (to within 50 ms of its +5 to +9 s mean of 539 ms), then holds near 520 to 540 ms. In the first 300 ms, 36 frames arrive where real time would give 12.9.

In playback ms the rush is the same size at both rates (559 and 566 ms at +300 ms) and lasts about the same time (256 and 231 ms). In frames it differs: 80 against 36 in the first 300 ms, since a 96000 frame lasts 10.7 ms and a 44100 frame 23.2 ms. After the rush the lead is not given back: it holds for the rest of the stretch.

Seen from the connect moment, the same two stretches also carry the 1.16 s with no frames. The mean lead against the connect moment is -44 ms in the first 10 s, -793 ms in the 96000 stretch and -1347 ms in the first 10 s after the second rate change (block F, first bins).

### Start from stopped and same-rate changes: no lead

For the three changes that did not stop the frames, block A gives the median lead in windows after the change against the median over the window before it. No window crosses another change:

```python
# lead = stamp playback ms minus arrival wall ms, per frame; medians over windows around a start; no window crosses another start
def med(a, b):
    v = sorted(PB[i] - T[i] for i in range(len(T)) if a <= T[i] < b)
    return v[len(v) // 2], v[-1] - v[0], len(v)
for name, t0, back in [('serial 31 from stopped, 44100', 7107, 6000), ('serial 32 same rate, 44100', 22679, 5000), ('serial 34 same rate, 96000', 47419, 5000)]:
    base = med(t0 - back, t0)
    near = [T[i] - T[i - 1] for i in range(1, len(T)) if t0 - 2000 <= T[i] < t0 + 5000]
    print('%s: median lead before %.0f ms (spread %.0f, %d frames); longest frame gap in -2..+5 s %.0f ms' % (name, base[0], base[1], base[2], max(near)))
    for a, b in [(0, 300), (300, 1000), (1000, 5000), (5000, 10000)]:
        m = med(t0 + a, t0 + b)
        print('  +%d..+%d ms: median lead %+.0f ms against before (spread %.0f, %d frames)' % (a, b, m[0] - base[0], m[1], m[2]))
```

```text
serial 31 from stopped, 44100: median lead before -41 ms (spread 209, 258 frames); longest frame gap in -2..+5 s 200 ms
  +0..+300 ms: median lead +10 ms against before (spread 82, 12 frames)
  +300..+1000 ms: median lead -17 ms against before (spread 190, 27 frames)
  +1000..+5000 ms: median lead -10 ms against before (spread 217, 176 frames)
  +5000..+10000 ms: median lead +74 ms against before (spread 269, 220 frames)
serial 32 same rate, 44100: median lead before 65 ms (spread 207, 213 frames); longest frame gap in -2..+5 s 199 ms
  +0..+300 ms: median lead -107 ms against before (spread 90, 13 frames)
  +300..+1000 ms: median lead -87 ms against before (spread 118, 32 frames)
  +1000..+5000 ms: median lead -182 ms against before (spread 286, 168 frames)
  +5000..+10000 ms: median lead -197 ms against before (spread 201, 214 frames)
serial 34 same rate, 96000: median lead before -688 ms (spread 187, 450 frames); longest frame gap in -2..+5 s 296 ms
  +0..+300 ms: median lead -138 ms against before (spread 107, 30 frames)
  +300..+1000 ms: median lead -106 ms against before (spread 133, 70 frames)
  +1000..+5000 ms: median lead -107 ms against before (spread 190, 370 frames)
  +5000..+10000 ms: median lead -107 ms against before (spread 187, 470 frames)
```

Reading, per rate:

- **44100, start from stopped:** none. The lead against the window before moves by +10, -17, -10 and +74 ms, inside the 82 to 269 ms spread that the frames' own 100 to 200 ms arrival groups give. No stretch ahead of wall time appears.
- **44100, same-rate change:** none that stands out. The median moves by -107 to -197 ms, with window spreads of 90 to 286 ms and the longest frame gap 199 ms. The shift is not separable from the arrival grouping; a rush would show as a positive lead of several hundred ms, and none appears.
- **96000, same-rate change:** none ahead of wall time, but a stamp lag appears. The median drops by 106 to 138 ms and holds at -107 ms for the following 10 s, after the one 296 ms frame gap. No rush follows to give it back.

### A later steady stretch of the same track

Block F gives the mean lead in the first and the last 10 s bin of each steady stretch, with no start or stop inside a bin:

```python
# mean lead per 10 s bin, first and last full bin of each steady stretch (no start or stop inside a bin)
def binlead(lo):
    v = [PB[i] - T[i] for i in range(len(T)) if lo <= T[i] < lo + 10000]
    return sum(v) / len(v)
def ratio(lo):
    a = bisect.bisect_right(T, lo) - 1; b = bisect.bisect_right(T, lo + 10000) - 1
    return (PB[b] - PB[a]) / (T[b] - T[a])
for name, first, last in [('44100, 0-30 s', 0, 20000), ('96000, 50-120 s', 50000, 110000), ('44100, 130-300 s', 130000, 280000)]:
    rs = [ratio(lo) for lo in range(first, last + 1, 10000)]
    print('%s: mean lead in first bin %.0f ms, in last bin %.0f ms, change %+.0f ms; stamp ms per wall ms over 10 s: %.3f to %.3f' % (name, binlead(first), binlead(last), binlead(last) - binlead(first), min(rs), max(rs)))
```

```text
44100, 0-30 s: mean lead in first bin -44 ms, in last bin -59 ms, change -14 ms; stamp ms per wall ms over 10 s: 0.980 to 1.015
96000, 50-120 s: mean lead in first bin -793 ms, in last bin -793 ms, change -1 ms; stamp ms per wall ms over 10 s: 0.992 to 1.003
44100, 130-300 s: mean lead in first bin -1347 ms, in last bin -900 ms, change +446 ms; stamp ms per wall ms over 10 s: 0.989 to 1.021
```

Reading, per rate:

- **44100, first stretch (0 to 30 s):** flat, a change of -14 ms.
- **96000 (50 to 120 s):** flat, a change of -1 ms.
- **44100, second stretch (130 to 300 s):** the stamps gain on wall time, +446 ms between the first and the last bin. The 10 s stamp rates swing between 0.98 and 1.02 against wall time in the 44100 stretches because of the arrival grouping, so the gain shows over the 150 s between the bins and not in any one 10 s ratio. The capture shows the gain and not its cause. It is the one stretch where the lead does not hold.

## Status position and output_delay

Block E reads the Status samples (every 200 ms) around each serial change:

```python
P = lambda s: float(s['status']['position'])
prev = None
for s in st:
    a = s['status']
    if prev is not None and a['track_serial'] != prev['status']['track_serial']:
        t0 = s['t_ms']
        move = next(x['t_ms'] for x in st if x['t_ms'] >= t0 and x['status']['track_serial'] == a['track_serial'] and P(x) > 0)
        stale = [x['status']['output_delay'] for x in st if t0 <= x['t_ms'] <= t0 + 400]
        print('serial %s at %.0f ms: position first above 0 after %.0f ms; output_delay over next 400 ms: %s' % (a['track_serial'], t0, move - t0, stale))
    prev = s
import collections
c = collections.defaultdict(collections.Counter)
for s in st:
    if s['status']['state'] == '2': c[s['samplerate']][s['status']['output_delay']] += 1
print('output_delay by Status samplerate while playing (us):', {k: dict(v) for k, v in c.items()})
def slope(a, b):
    xs = [(s['t_ms'], P(s)) for s in st if a <= s['t_ms'] <= b and s['status']['state'] == '2']
    return (xs[-1][1] - xs[0][1]) / ((xs[-1][0] - xs[0][0]) / 1000)
print('position seconds per wall second:', [(a, b, round(slope(a, b), 4)) for a, b in [(8000, 22000), (23500, 35900), (38500, 47000), (48500, 124000), (127500, 299900)]])
print('length values seen:', sorted({s['status']['length'] for s in st}))
```

```text
serial 31 at 7107 ms: position first above 0 after 204 ms; output_delay over next 400 ms: ['502358', '502358']
serial 32 at 22679 ms: position first above 0 after 202 ms; output_delay over next 400 ms: ['502358', '502358']
serial 33 at 37096 ms: position first above 0 after 1008 ms; output_delay over next 400 ms: ['502358', '501364']
serial 34 at 47419 ms: position first above 0 after 202 ms; output_delay over next 400 ms: ['501364', '501364']
serial 35 at 126021 ms: position first above 0 after 1009 ms; output_delay over next 400 ms: ['501364', '502358']
output_delay by Status samplerate while playing (us): {'44100': {'502358': 1004, '501364': 1}, '96000': {'502358': 1, '501364': 434}}
position seconds per wall second: [(8000, 22000, 1.0085), (23500, 35900, 0.9936), (38500, 47000, 1.0018), (48500, 124000, 1.0), (127500, 299900, 0.9995)]
length values seen: ['0.00000000000000000']
```

- **position:** a number of seconds that restarts at 0 on every serial change and then advances at one second per wall second (0.9936 to 1.0085 over the 200 ms samples). After the start from stopped and both same-rate changes it begins to advance within about 200 ms (one sample). After both rate changes it stays at 0 for about 1.0 s (1008 and 1009 ms), while frames resume 217 ms and 189 ms after the serial change (37313 against 37096, 126210 against 126021).
- **output_delay:** 502358 at 44100 and 501364 at 96000 (microseconds per `docs/spec/protocol.md` line 300, the repo's own reading). It is constant within a rate: one stray sample in each of the two rate stretches, and each is the first sample after a rate change, holding the previous rate's value for one 200 ms sample. The two rates differ by 994 us (0.994 ms). It does not move across any same-rate change or the start from stopped. The rush above is about 520 to 560 ms in playback ms and `output_delay` is about 502 ms at both rates; the capture shows both numbers and nothing links them.
- **length:** 0 throughout, so Status carried no track length for these tracks.

## Rush arrival rate against QUEUE_DEPTH

`QUEUE_DEPTH` is 8 in `hqptuner/engine/meterfeed.py` (line 83). Block D counts frame events arriving close together:

```python
Te = [e['t_ms'] for e in ev]
def peak(lo, hi, w):
    best = (0, 0)
    for i, t in enumerate(Te):
        if lo <= t <= hi:
            c = bisect.bisect_left(Te, t + w) - i
            if c > best[0]: best = (c, round(t))
    return best
for name, lo, hi in [('resume 37313 (96000)', 37300, 38500), ('resume 126210 (44100)', 126200, 127400), ('steady 96000, 40-120 s', 40000, 120000), ('steady 44100, 130-299 s', 130000, 299000)]:
    print(name, 'peak events (count, at ms) in 10/100/1000 ms:', [peak(lo, hi, w) for w in (10, 100, 1000)])
print('event n values:', sorted({e['data']['n'] for e in ev}), 'events:', len(ev), 'frames:', len(fr))
```

```text
resume 37313 (96000) peak events (count, at ms) in 10/100/1000 ms: [(5, 37313), (15, 37313), (70, 37313)]
resume 126210 (44100) peak events (count, at ms) in 10/100/1000 ms: [(5, 126290), (14, 126252), (63, 126252)]
steady 96000, 40-120 s peak events (count, at ms) in 10/100/1000 ms: [(5, 40052), (10, 40052), (55, 45856)]
steady 44100, 130-299 s peak events (count, at ms) in 10/100/1000 ms: [(5, 130025), (10, 130927), (54, 224227)]
event n values: [1024, 2048] events: 13216 frames: 17351
```

- Event `n` is 1024 at 44100 (one frame per event) and 2048 at 96000 (two frames per event), as `stride` sets.
- During the rush the peak is 15 events in 100 ms at 96000 and 14 at 44100, against a queue depth of 8, and 70 and 63 events in the first second. In steady state the peak is 10 events in 100 ms at both rates (the frames arrive in groups).
- Five events arrive within 10 ms in every stretch, rush or steady.
- The capture's own subscriber was drained at once and the run has 0 stamp breaks, so it shows arrival bursts above the queue depth and no overflow break. Whether a page's subscriber overflows depends on how fast it drains, which this capture does not measure.

## What HQPlayer's own docs say

The hqpdoc MCP tools were not available to this executor, so the same sources (`hqplayerd-readme.txt`, and the split manual under `docs/official/manual/`) were searched directly with `grep`, for `position`, `output delay`, `delay`, `latency`, `meter`, `metering` and `status`. The `docs/official/` tree is gitignored and lives in the main checkout.

- **Status `position` and `output_delay`:** undocumented. Neither the readme nor the manual names either attribute, and `delay` appears only as the matrix delay plugin (`hqplayerd-readme.txt` line 850 onward). The repo's `docs/spec/protocol.md` line 300 lists `output_delay` as microseconds; that is the repo's reading, not HQPlayer's.
- **Where hqplayerd taps metering, and whether it runs faster than real time:** undocumented. The manual describes the meters as a display (HQPlayer Client, "Metering", page 51) and gives one switch, "Pre-process before metering" (Settings, Advanced, §4.7, page 39), and the readme has the matching `pre_before_meter` attribute (`hqplayerd-readme.txt` lines 179 to 184). These say where pre-processing sits relative to the meter. They say nothing about the tap point against the output, the metering timing, or what metering does at a track or rate change.

## Reading against the two candidate causes

- **Opening rush: confirmed at a rate change, absent elsewhere in this capture.** After both rate changes the stamps ran ahead of wall time by about 560 ms within about 250 ms of the first frame, at 96000 and at 44100 alike, and kept that lead. The start from stopped and the two same-rate changes show no rush.
- **Reader connect timing (poll phase): not measured.** The owner cut the late-connect runs, so this capture has one reader that connected before any start. It cannot say what a reader connecting during the opening stretch receives. It is an open item.
- **Per-rate output_delay misreport:** the capture shows 502358 us and 501364 us for the two rates, 0.994 ms apart, constant inside each rate. It shows no per-rate difference near the size of the lag in question.
- **Queue-overflow breaks against the geometry break:** the capture has no stamp break at all, with an undelayed drain. Rate changes emitted the geometry event, and the arrival bursts (14 to 15 events in 100 ms) exceed the queue depth of 8, so the capture shows the geometry event and the bursts and does not show an overflow.
- **Does every track start re-anchor:** the capture shows geometry events only at the two rate changes. The start from stopped and the same-rate changes emitted none and broke no stamp.

Limits of the capture: one run, two rate changes and two same-rate changes, each rate change followed by the same kind of gap; the 200 ms Status sampling bounds when a start is timed; the app's own reader and page were not part of it.
