# compose-pins

`symptom`

- A user running the published image cannot point HQPTuner at an hqplayerd on another machine from the Connection panel.
- The panel opens, detects, accepts a host and credentials and reports a saved record; the app goes on dialling the address and credentials it was started with.
- Nothing surfaces the override: health reads connected and the pill goes green against the old target.

`rule`

- A user running the published image sets host, username and password in the Connection panel and the app dials what they typed, with no file edited.
- The same-machine default still connects out of the box; `host.docker.internal` must still resolve for the case the panel's own copy recommends.
- `README.md`'s Docker instructions agree with whatever compose ships, in the same change.
- `layer_onto_config`'s precedence is not reopened: a non-empty variable outranking the record is deliberate and deployments (including Opal's) depend on it.
- The change touches `compose.yaml` and `README.md`, so it takes stage 1 of the plan gate before anything is written.

`authority`

- `POST /api/connection` carrying a different host does not move the host while the variable is set: the route answers `{"host":"host.docker.internal","username":"atom","remember":true,"has_password":true,"lane":"ok"}`, and `GET /api/connection` still reads `host.docker.internal`. The record is accepted and the variable wins.
- The override is silent. `/api/health` reads `reachable`, `ready` and `connected` all true against the pinned target, engine `Opal`, so no error path is taken and nothing tells the user their save did nothing.
- hqplayerd answers discovery from the host on `239.192.0.199:4321`, `127.0.0.1:4321`, `10.0.0.238:4321` and `255.255.255.255`, while `GET /api/discover` from inside the container answers `[]`. That is Docker's bridge not carrying multicast, not a code defect, and it is out of scope here.

`verified`

- `hqptuner/core/connection.py:111-114` — `_pinned`, an empty variable counting as absent.
- `hqptuner/core/connection.py:116-129` — `layer_onto_config` leaves each pinned field alone and fills the rest from the record.
- `hqptuner/core/connection.py:132-141` — `build_http_client` returns None when either credential is empty, which is the "no credentials, no 8088 lane" rule.
- `compose.yaml:25-26` — `extra_hosts: host.docker.internal:host-gateway`, what the same-machine case rests on.
- `README.md:186` — env table row for `HQPTUNER_HQP_HOST`, the second place the variable is documented.
- With none of the three variables set and no saved record, the panel path works end to end: a typed host and credentials save, the control lane retargets with no restart, the pill goes green, the panel closes itself, and `connected: true` with `credentials_ok: true` survives a container recreate.
- On an install holding no chosen password the panel's password placeholder reads "Leave empty to keep the default", auto-detect fills the host when discovery reaches the daemon, and an unconfigured page prints six console 503s, which is the one unconditional startup round and nothing after it.

`defects`

- `compose.yaml:29` — `HQPTUNER_HQP_HOST: host.docker.internal` is a non-empty pin, so the panel's Host field cannot take effect on the published image.
- `compose.yaml:30-31` — the username and password lines carry `:-hqplayer` and `:-password` shell defaults, so they substitute non-empty even with no `.env` file present, and Username and Password are pinned for a user who has no env file at all.
- `README.md:143` — "set `HQPTUNER_HQP_HOST` to the IP address of the hqplayerd host", the instruction that keeps the panel inert; it moves with whatever compose does.

`scope`

- Branch from `493f9938` on `dev`; it is clean, `make check` is green, and `hqptuner:dev` serves at http://10.0.0.238:8090.
- `dev` carries `config.STOCK_CREDENTIAL` with `Config.hqp_password_chosen`, a blank password field that omits the key rather than clearing it, and `reachable` / `ready` gates on the two poll timers in `store/sync.js`. Those are the surface this work sits on, not part of it.

`transcript`

- `/home/atom/.claude/projects/-home-atom-dev-hqptuner/63f66e56-3db8-4671-a5ad-3a0a97e3aa1b.jsonl`
