# Connection lifecycle: binding for all contributors, human or agent

Violations are rejected in review even when every test passes. Tests of lifecycle code are also bound by `docs/spec/testing.md`, rule 7 above all. Every wire fact this document relies on is measured and recorded in `docs/spec/protocol.md`; that file is the authority and this one cites it.

What a restart does to the settings HQPTuner wrote is `docs/spec/settings-truth.md`'s. This document hands that one a transition and nothing else.

## Words

Each word below means one thing in this document, in code and in review.

| Word | Meaning |
|---|---|
| **Daemon** | hqplayerd, one process at the configured host. |
| **Lane** | One of the daemon's ports and its protocol: control on `:4321`, configuration on `:8088`, metering on `:4322`. |
| **Connection** | One accepted control socket whose `GetInfo` handshake has answered. A TCP accept alone is not one. |
| **Phase** | Where the daemon stands as HQPTuner knows it: one value from the table below, held in one place. |
| **Generation** | A count of proven departures. The one token events are ordered by. |
| **Transition** | A move from one phase to another, named for the wire fact that proves it. |
| **Own restart** | A restart or reload the daemon performs because HQPTuner asked. |
| **Foreign restart** | Any other: a `systemctl restart`, a crash, another client's write. |
| **Settled in place** | An own restart after which no departure was proven: the connection stood, or came back before a dial was refused. What the daemon did with the request is the write's own readback's to say. |
| **Departure** | The daemon ending or refusing the control connection. HQPTuner closing it is not one. An idle close is one. |
| **Window** | The longest a restart may take before it is an outage: `alarm_threshold`, 15 s by default. |
| **Readings** | The snapshots the manager holds for the page: state, enumerations, forms. Each belongs to the connection it was read on. |

## The one phase

The daemon's standing is one value and no second one. Four phases:

| Phase | What is true |
|---|---|
| **Down** | No connection. The manager dials on its retry cadence. |
| **Reachable** | A connection stands; the configuration lane has not answered on it. |
| **Ready** | A connection stands and the configuration lane has answered on it. |
| **Alarm** | Down for longer than the window. |

Beside the phase, the same module holds two more values and nothing else: the generation, and the request stamp, which is the generation and clock reading at which HQPTuner's last restart request was accepted, or none.

Down is entered in one of two ways. A proven Down is a departure, and advances the generation. A taken Down is HQPTuner closing the connection itself ahead of a restart it asked for, and advances nothing; it becomes proven at the first dial the daemon refuses or fails to answer.

Three outcomes fall out of this tuple, and every consumer reads them from it rather than working them out:

- **Own restart landed**: Ready at a generation later than the request stamp's.
- **Own restart settled in place**: the request stamp is pending, the generation has not moved, and either the write's own readback confirmed on the standing connection or the window has run. The readback is the proof; the window is the deadline, and a settle by deadline is reported as one.
- **Foreign departure**: the generation moved with no request stamp pending. Whether the daemon restarted or only closed an idle connection is not this module's to say; the settings side decides from its readings.

A dial that succeeds from a taken Down proves nothing on its own: it may have reached the instance the restart is about to kill, or the new one. Only a refused dial, a departure on the new connection, or the readback settles which.

Alarm is the control lane's. A daemon whose configuration lane never answers sits Reachable, and that is reported by health's `ready` false and `credentials_ok`, not by Alarm: an install with no management credentials is Reachable by design.

## Transitions

Each transition is proven by one wire fact. The daemon's accept and its first answer are simultaneous (`docs/spec/protocol.md` "Transport and framing"), so an accept is never a fact on its own.

| From | To | Wire fact |
|---|---|---|
| Down, Alarm | Reachable | `GetInfo` answered on a new control socket. |
| Reachable | Ready | The configuration lane answered its form read on this connection. |
| Ready | Reachable | The configuration lane stopped answering on a poll while the control socket stands. |
| Reachable, Ready | Down, proven | EOF, reset or timeout on the control socket. |
| Reachable, Ready | Down, taken | HQPTuner closed the socket after the daemon accepted a restart request. |
| Reachable, Ready | Down, taken | HQPTuner closed the control socket. |
| Down, taken | Down, proven | A dial refused or unanswered. |
| Down | Alarm | The window has run on the manager's clock since Down was entered. |
| any | request stamped | A request that restarts or reloads the daemon was accepted: `POST /restore`, `POST /matrix`, `POST /speakers`. |
| request stamped | stamp cleared | Ready at a later generation; the write's readback confirmed with the generation unmoved; or the window run with the generation unmoved. |

A refusal of the management credentials is not a transition. The configuration lane answered; it said no. That verdict rides the readings as `credentials_ok`, and the phase does not move.

## Rules

1. **One phase, one home.** The daemon's standing is one value in one module. No flag, counter or event anywhere else says where the daemon is. A consumer reads the phase; nothing re-derives it from parts.
2. **A transition names its wire fact.** Every transition in the table is proven by the fact beside it. A transition with no fact, or a phase set because a caller expects the daemon to be somewhere, is a defect.
3. **One ordering token.** The generation advances once per proven departure and at no other time. Nothing else counts connects, drops or dials. A question of before or after is answered by comparing generations and by nothing else: two counts compared separately cannot say which came first.
4. **Own is stamped where the request goes out.** Every request that restarts or reloads the daemon goes out through one function, which writes the request stamp as the daemon accepts it. A request that raises leaves no stamp. Nothing infers own from foreign by what dropped or when, and nothing calls a departure a restart: a departure with no stamp pending is handed on as a departure and nothing more.
5. **A wait subscribes to a transition.** A wait names the transition it wants and returns on the edge that satisfies it. No wait sleeps on an edge and re-reads the parts. Every wait runs on `mgr.clock`, carries a deadline, and defaults that deadline to the window. A deadline passed is a result the caller reports, never one it papers over.
6. **A connection owns its readings.** Readings taken on one connection are invalid at the next Down and refilled on the next Ready. A consumer that needs them waits for Ready; none reads a snapshot from a connection that is gone as if it were current.
7. **The two front lanes return separately.** Ready is the control connection standing and the configuration lane having answered on that same connection. A handshake alone is Reachable. A wait for a restart to land is a wait for Ready, because 4321 and 8088 do not come back together.
8. **The API reports the phase and decides nothing.** Health carries the phase, the generation and the connection's age. The page shows what it is told. The page holds exactly two things of its own: whether a write it sent is still in flight, and the grace it gives a cold install before believing Down.
9. **Decisions are pure; the loop executes.** A transition is a pure function of the phase and a wire fact (testing rule 17). The connect body and the heartbeat feed facts to it and apply its answer. Neither sets a phase directly.
10. **The settings side takes a transition, not the lifecycle's internals.** `docs/spec/settings-truth.md` is handed three named outcomes: own restart landed, own restart settled in place, foreign departure. It reads no counter and no flag. It supplies one fact back: whether a write's readback confirmed on a standing connection, which is what settles a request in place.
11. **Lifecycle tests assert invariants.** Every lifecycle test runs on a virtual clock against a fake daemon driven from a table of wire events (testing rules 7, 11 and 13). It asserts a property the design promises: a wait never releases on the instance a restart is about to kill, Ready never precedes the configuration lane's answer, a foreign departure is never read as own. Tables in a test span the measured range below, and include a daemon that answers on 4321 for a moment after accepting a restart.
12. **A request that fails after its bytes went out drops the connection.** The daemon answers every command it accepts, unknown ones included, so a reply given up on is a reply still to come, and left on an open socket it becomes the answer the *next* command reads. So the control client closes its own connection on a read timeout, a socket error or a frame that will not parse, and the poll loop reconnects.

    A `result="Error"` reply keeps the connection: that reply is complete and correctly paired. At the batch level, fields behind a stalled setter in one live apply report `daemon_unavailable` instead of being written over a suspect connection, while fields behind a *refused* one still apply.

## The lifecycle pipeline

Each hop owns one decision. A diff that makes a decision outside its owner is rejected.

| Hop | Owns | Module |
|---|---|---|
| Daemon control port, `:4321` | Accepting, the handshake, the idle close | hqplayerd |
| Control client | One socket, one request at a time; closing its own socket when a request fails on the wire | `engine/control.py` |
| Phase | The one value, the generation, the request stamp, every transition | `core/lifecycle.py` |
| Connect body and heartbeat | Dialing, the handshake, filling the readings, the poll; reporting each wire fact to the phase | `core/loader.py` |
| Manager | Holding the clock, the client and the phase; the retry cadence | `core/manager.py` |
| Restart requests | The one way out for a request that restarts or reloads; writing the stamp | `lanes/settle.py` |
| Waits | Subscribing to a transition with a deadline | `lanes/settle.py` |
| Push feed | Publishing on every transition | `api/push.py` |
| Health | Reporting the phase | `api/routes/status.py` |
| Page signals | Picking the phase off health | `store/signals.js` |
| Brand knob | Drawing the phase and the page's own in-flight write | `store/faceplate/conn.js` |
| Connection panel | The cold-page grace and the verdict on a saved address | `store/connpanel.js` |

## Measured facts

These are measurements, not assumptions. Code reads the wire rather than relying on them; tests use their range.

| Fact | Value | Measured in |
|---|---|---|
| Accept and first answer | Simultaneous; refused until then, no accept-then-hang | `docs/spec/protocol.md` "Transport and framing" |
| `systemctl restart` | 4321 answers `GetInfo` 9.3 s later | `docs/spec/protocol.md` "Transport and framing" |
| `POST /config` | Pre-restart form served for a moment, 4321 drops at ~0.3 s, back at ~3 s | `docs/spec/protocol.md` "HTTP configuration routes" |
| `POST /config/profile/load` | 200 at once, 4321 refuses ~0.3 s later, answers ~3.4 s later | `docs/spec/protocol.md` "HTTP configuration routes" |
| `POST /restore` `scope=system` | Self-restart ~5.6 s, lands on `[default]`, success only by `/backup` readback | `docs/spec/protocol.md` "Configuration model" |
| A restore reloads in place | No process restart, no startup banner | `docs/spec/protocol.md` "Configuration model" |
| `POST /matrix` | 4321 drops at ~2.9 s, back at ~6.5 s | `docs/spec/protocol.md` "Matrix form lane" |
| `POST /speakers` | Engine reload, ~3 s; whether 4321 drops is unmeasured | `docs/spec/protocol.md` "HTTP configuration routes" |
| Matrix profiles after a restart | Register at process start, seconds after HTTP is back | `docs/spec/protocol.md` "Saved matrix profiles do not persist" |
| Idle close | ~156 s with no traffic, clean EOF; keep-alive is one space | `docs/spec/protocol.md` "Transport and framing" |
| Error replies | The connection is never dropped on one | `docs/spec/protocol.md` "Response conventions" |
| Control API writes across a restart | Live in memory only; a full restart lands on `[default]` | `docs/spec/protocol.md` "Transport and framing" |

## Checklists

**Adding a write that restarts or reloads the daemon.**

- It goes out through the one restart function and nowhere else.
- Its caption says what it costs; the write proceeds (the product rule).
- Its wait names the transition it needs: Ready at a later generation, or its own readback confirmed with the generation unmoved.
- Its test drives the fake daemon through the departure and the return, with 4321 answering for a moment after the request is accepted.

**Adding a wait.**

- Name the transition it returns on.
- Take `mgr.clock`, carry a deadline, default it to the window.
- Return the deadline as a result; the caller reports it.
- Its test counts passes on a virtual clock, never seconds.

**Adding a consumer of the phase.**

- Read the phase, never its parts, and hold no copy of it.
- Wake on the transition, not on a poll of the value.
- If it is a page, draw what health says and decide nothing about reachability.

**Adding a field to health.**

- It is the phase, the generation, the connection's age or a reading. A second verdict on where the daemon stands is a defect.

## Examples

Two counters compared, and one generation:

```python
# Rejected: two counts compared separately cannot say which came first.
return connects > mark.connects and drops_at_connect > mark.drops

# Holds: one token, one comparison.
return phase.is_ready and phase.generation > mark
```

A drop that lies about itself, and a request stamped where it goes out:

```python
# Rejected: the drop is told not to count so a later wait reads the counters right.
await self._drop("restore restarts the daemon", counts=False)

# Holds: the stamp is written as the daemon accepts; the drop says only that HQPTuner took the socket down.
mark = phase.request_accepted(mgr.clock.monotonic())
await self.close_control("restore restarts the daemon")
```

Three verdicts on one question, and one phase:

```python
# Rejected: each is true at a different moment, and a client must pick.
HealthReport(reachable=mgr.reachable, ready=mgr.ready, connected=mgr.connected.is_set())

# Holds: the phase, and the token a client orders events by.
HealthReport(phase=mgr.phase.name, generation=mgr.phase.generation)
```

A wait that re-reads the parts after every edge, and one that names its transition:

```python
# Rejected: the wait restates the whole derivation each time it wakes.
while not (restart_landed(mark, mgr.connects, mgr.drops_at_connect) and mgr.ready):
    await mgr.clock.wait(mgr.changed, remaining)

# Holds: the transition is named once and the wait returns on it.
landed = await phase.until_ready(after=mark, deadline=mgr.alarm_threshold)
```

A lifecycle test that restates the counters, and one that asserts the invariant. Shape only, not values to copy:

```python
# Rejected: the expected values are the implementation's own counters.
assert mgr.connects == 2 and mgr.drops_at_connect == 1

# Holds: the wait never released on the instance the restart killed.
assert landed and daemon.answering is daemon.after_restart
```

## Enforcement

- A gate refuses the names `reachable`, `connected`, `ready`, `http_ok`, `connects`, `drops`, `drops_at_connect` and `restart_landed` as attributes, parameters or comparands outside `core/lifecycle.py`, and any new `asyncio.Event` on `ConnectionManager`.
- Review checks every lifecycle diff against the pipeline table: one owner per decision.
- Exemptions are owner-approved, site by site, as for every gate.
