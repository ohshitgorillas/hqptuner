# Security Review · HQPTuner

**John Crenshaw · Independent Security Review**

AI-assisted review (Claude), reviewed and approved by John Crenshaw

| Document control | |
| :--- | :--- |
| Upstream repository | https://github.com/ohshitgorillas/hqptuner |
| Reviewed commit | [`a942cfcac127ea790adccc11a279a748da5ea426`](https://github.com/ohshitgorillas/hqptuner/tree/a942cfcac127ea790adccc11a279a748da5ea426) |
| Declared version | 1.20.1 ([`pyproject.toml:3`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L3)); tag `v1.20.1` points to the reviewed commit |
| Review date | 2026-11-06 |
| Prepared by | John Crenshaw |
| Method and assistance | Source review only; AI-assisted |
| AI assistant | Claude (`claude-opus-5-5` for the main session, as exposed by the session environment) |
| Requester authorization | [Authorization comment](https://github.com/crenshawdev-security/review-ohshitgorillas-hqptuner-a942cfcac127/issues/1#issuecomment-6695218480), 2026-11-06T20:52:16Z |
| Human review | Reviewed and approved by John Crenshaw |
| Scope | The 1267 tracked entries at the reviewed commit: 452 files in four review areas and 815 entries skipped with a recorded reason |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

## Contents

- [Executive summary](#executive-summary)
- [Project and exposure](#project-and-exposure)
- [Threat model](#threat-model)
- [Findings at a glance](#findings-at-a-glance)
- [Technical findings](#technical-findings)
- [Coverage and limitations](#coverage-and-limitations)
- [Amendments](#amendments)

## Executive summary

HQPTuner has no login, and every packaged build listens on all network interfaces. Most of this report follows from that. Anyone who can reach port 8090 can read the daemon's configuration, replace it, restart the daemon and change the volume, and HQPTuner uses its stored management credential to do it for them (F-001). A website can reach part of the same surface through a visitor's browser (F-002, F-003). A caller can also point HQPTuner at their own server, which then receives a Digest response computed from the stored password (F-004), or use it to read internal HTTP services (F-005). Values a client stages reach `hqplayerd.xml` unescaped, which gets past the field allowlist (F-006). The README tells Mac and Windows users the app is reachable from that machine only, and it isn't (F-009).

The release pipeline is the second area. Build jobs install unpinned code in the same job as the Apple signing material (F-034), the Apple secrets sit outside the `signing` environment (F-035), the check job holds a token that can push to GHCR (F-036), and no lockfile ties what ships to what was tested (F-037). These need an upstream compromise or a stolen token, and the consequence is hostile code signed as the project.

The most useful next step is a login or token on every `/api` route, with loopback as the default until that exists, because that closes or narrows most of the network findings at once. Until then, keep HQPTuner on a network you trust. Docker users can publish the port as `127.0.0.1:8090:8090`, because the container's bind leaves scoping to the port mapping, and other installs can set `HQPTUNER_LISTEN_HOST`, though a Finder launch on macOS takes its value from the app bundle. Setting `HQPTUNER_HQP_HOST` stops the connection host from being changed through the API.

What the daemon does with hostile input is the main thing I couldn't settle, because it's closed source. Several findings state their worst case as a possibility for that reason, and the open questions are under [coverage](#exclusions-and-unresolved-questions).

This is a security review only, not a review of the project's purpose or intended use.

This is a point-in-time source review. The project was not built, installed, or executed; tests, exploit payloads, live endpoints, and credentials were not exercised. Conclusions are limited to the evidence and scope recorded here.

## Project and exposure

HQPTuner is a browser UI for configuring and controlling hqplayerd, a closed-source audio daemon. It runs as a FastAPI service that talks to the daemon over port 8088 (HTTP with Digest) and port 4321 (the unauthenticated Control API), and it edits the daemon's config by rewriting its XML and pushing a settings archive to `/restore`. It ships as a container, deb and rpm packages under systemd, a macOS dmg and a Windows installer. The repository also carries Claude Code configuration, hooks and two stdio MCP servers.

| Component / entry point | Sensitive assets or operations | Trust boundary / existing controls |
| :--- | :--- | :--- |
| About 50 `/api` routes, listed in [`docs/openapi.json:1`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/openapi.json#L1) | Daemon config, restart, volume, presets, stored credential | LAN or any browser to HQPTuner. No authentication. Unknown live fields are refused when staged and unknown `http` fields at apply, and the password is never returned by `GET /api/connection` |
| Static mount at `/`, [`hqptuner/api/spa.py:36-51`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/spa.py#L36-L51) | The Preact SPA, with no build step | Same origin as the API. App code renders text only, with no HTML sink found |
| 8088 and 4321 clients, [`hqptuner/conf/httpconf.py:164-169`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L164-L169), [`hqptuner/engine/control.py:308-315`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L308-L315) | The management credential, inbound daemon data | HQPTuner to the daemon or an impostor. `defusedxml` on 4321 frames, plain HTTP on 8088 |
| UDP discovery, [`hqptuner/engine/discovery.py:74-86`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L74-L86) | Daemon address selection | Any LAN peer. No identity check |
| Disk stores, [`hqptuner/core/connection.py:106-117`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L106-L117), [`hqptuner/presets/store/export.py:47-57`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/export.py#L47-L57) | Plaintext password, presets, backups, logs | Local filesystem. The Linux package uses `DynamicUser` |
| GitHub Actions, [`.github/workflows/release.yml:3-14`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L3-L14) | Apple certificate and notary key, SimplySign TOTP seed, Docker Hub token, `GITHUB_TOKEN` | CI and third-party tools to signing secrets and registries |
| `.claude/` and `.mcp.json`, [`.claude/settings.json:4-15`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L4-L15) | The developer account and the production daemon on the dev host | Repository contents to a developer's agent and machine |

I assumed a home LAN, a single tenant and no reverse proxy, since the default deployment has none and there are no user accounts. Severity depends on who shares that LAN and on browsing from the same network.

## Threat model

| Asset / trust boundary | Actor and controllable input | Threat and prerequisites | Existing controls / review focus |
| :--- | :--- | :--- | :--- |
| Daemon config and availability; LAN to HQPTuner | Any device on the network; every `/api` request | Read, replace or restart with network reach alone | `HttpMgr` tests only that a client exists. Reviewed every route |
| The same; other websites to HQPTuner | A web page in a visitor's browser; cross-site requests and DNS rebinding | Blind writes, or same-origin reads after a rebind. Needs a visit and a browser that allows it | No Origin or Host check. Browser policy decides reach |
| Management credential; HQPTuner to an impostor | Whoever supplies the connection host, a discovery reply or an alias answer | Digest capture and hostile daemon data | Plain Digest; discovery has no identity check |
| Daemon host filesystem; archive members and config values | A client staging values or uploading archives | File or config tampering, limited by what the closed daemon does | Name allowlist and filter name checks. Reviewed the XML writer |
| Local credential at rest | A second local account | Read of `connection.json` | Export blanks it; no restrictive file mode |
| HQPTuner availability | A peer or a hostile daemon sending large or slow input | Memory or event-loop exhaustion | Some ceilings exist. Reviewed each read path |
| Signing material and registries; CI to third parties | An upstream release, a moved tag or a write-access holder | Stolen keys or hostile signed output | `signing` environment on Windows only. Reviewed all three workflows |
| Developer host; repository to agent | A hostile branch or injected text | Code execution as the developer | Project trust dialog; hooks. Reviewed settings and scripts |

Everything in this table was a hypothesis until it was traced. The supported ones are the findings below.

## Findings at a glance

Severity is the level of the CVSS 4.0 Base score, and a finding that isn't a vulnerability is a Defect. Confidence describes the strength of the evidence. Approval, maintainer acknowledgement, and remediation are separate states.

The 48 findings are 6 Critical, 13 High, 18 Medium, 7 Low and 4 Defects. A CVSS Base score doesn't count how likely a prerequisite is, so read the prerequisite column alongside it: F-034, F-038 and F-039 score Critical but need an upstream compromise first, and F-009 carries F-001's impact on the installs its README line misleads.

| ID | Finding | Severity | Confidence | Main prerequisite |
| :--- | :--- | :--- | :--- | :--- |
| F-001 | No authentication on any API route, and the routes use HQPTuner's stored daemon credential | Critical | High | Network reach to port 8090 |
| F-002 | Any website can POST a restore archive or stop the engine through a visitor's browser | Medium | High | A visitor's browser can reach HQPTuner and doesn't block the request |
| F-003 | No Host validation, so DNS rebinding gives a website same-origin read and write on the API | High | Medium | A browser that permits the rebind, and a victim who stays on the page |
| F-004 | POST /api/connection sends a Digest response for the stored password to any host a caller names | Critical | High | Network reach or rebinding, `HQPTUNER_HQP_HOST` unset, a real password in force |
| F-005 | An unvalidated connection host lets a caller read HTTP services HQPTuner can reach | Medium | Medium | Network reach or rebinding, `HQPTUNER_HQP_HOST` unset, a target answering 2xx |
| F-006 | Staged config values reach hqplayerd.xml unescaped, so a client can add elements the allowlist never named | High | High | Network reach, working 8088 credentials (the stock pair qualifies) |
| F-007 | POST /api/restore passes any archive to the daemon with no member filter and no safety copy | High | High | Network reach or a cross-site POST, and a client holding credentials |
| F-008 | /api/state-export and /api/backup hand out configs, backups and logs with no gate | Medium | High | Network reach or rebinding |
| F-009 | The README says the desktop apps are reachable from that machine only, but they bind all interfaces | Critical | High | A macOS or Windows install on a network with other devices |
| F-010 | Control API commands are built by string interpolation, and three client routes feed raw strings into them | Medium | Medium | Network reach or rebinding, control lane connected |
| F-011 | Log path and pipeline process strings let a client name any path on the daemon's host | Medium | Low | Network reach, working 8088 credentials |
| F-012 | Parked filter uploads silently replace daemon files and ride the next apply | Medium | Medium | Network reach, then any persistent apply, and a name matching an existing member |
| F-013 | A value the repository documents as fatal can be staged with no check, and the UI then blames the credentials | High | Medium | Network reach, working 8088 credentials |
| F-014 | An unknown matrix profile name puts the engine in a restart loop | Medium | Medium | Network reach, control lane connected, a track loaded, then the next engine reinit |
| F-015 | One POST with a malformed host stops HQPTuner at every later start | High | Medium | Network reach or rebinding, a password in force, `HQPTUNER_HQP_HOST` unset |
| F-016 | /api/restore reads the whole upload and decompresses members with no ceiling | High | High | Network reach or a cross-site POST |
| F-017 | 8088 responses have no size or total-time limit, and each connection save keeps an old client until shutdown | High | Medium | Network reach or rebinding, and for the body case a host the attacker controls |
| F-018 | Several routes do unbounded or event-loop-blocking work per request | Medium | Medium | Network reach |
| F-019 | Whitespace in staged values makes profile and pipeline regexes quadratic on the event loop | High | Medium | Network reach, working 8088 credentials |
| F-020 | Discovery trusts spoofed UDP replies and parses them with the stdlib XML parser on the event loop | Low | Medium | A LAN peer that learns the sweep's port; desktop, deb or host-network installs |
| F-021 | A LAN discovery impostor can fill the host field, then receive the stored password's Digest response and supply a phishing link | High | Medium | Same LAN segment, the impostor is the only responder, and a user presses Connect or Save |
| F-022 | Startup adopts whoever answers host.docker.internal on an unconfigured install | Low | Medium | No saved or pinned host, no host mapping for that name, and control of its resolution |
| F-023 | connection.json holds the password in plaintext with the default file mode | Medium | High | `remember` on, and a second local account on a Docker or from-clone host |
| F-024 | The management password crosses the LAN in cleartext between browser and HQPTuner | Medium | High | A browser on another host over plain HTTP, and an observer on that path |
| F-025 | Licensee name, license fingerprint, playback metadata and the daemon log are served to anyone | Medium | High | Network reach or rebinding |
| F-026 | Preset names on the Windows build can leave the store or hit NTFS streams and device names | Medium | Medium | Windows build and network reach; a second drive for the re-root |
| F-027 | No browser security headers, one-click engine actions in a frameable page, and API docs that load CDN scripts | Low | Medium | A browser that renders the cross-site frame, or a user opening /docs |
| F-028 | The single-instance probe trusts any local process that answers with app_version | Low | High | Code already running on the machine that holds port 8090 first |
| F-029 | Apply lanes aren't serialized, and the shared pending buffer is cleared blind | Defect | Medium | Two browsers or a deliberate client |
| F-030 | The pre-apply safety copy is a single slot that later passes overwrite, and nothing rolls back | Defect | High | A pushed config the daemon serves but doesn't converge on, or any later apply |
| F-031 | JSON and preset stores write in place, so a torn file can leave the app refusing a store | Medium | Medium | Concurrent writes, or a process kill during a write |
| F-032 | Descriptions merged from an uploaded archive skip the write route's limits | Medium | High | Network reach; the restore need not succeed |
| F-033 | A rogue daemon's strings can stall the SPA or, with some settings on, crash its render | Low | Low | HQPTuner connected to a rogue or impersonated daemon |
| F-034 | Unpinned build inputs run in the same job as the Apple signing key and notary key | Critical | Medium | Compromise of one upstream: a PyPI package, PyInstaller, or the astral.sh installer |
| F-035 | Apple secrets sit outside the signing environment, and both signing jobs run on ungated dev pushes | High | Medium | Write access to any branch or a token with workflow scope; ordinary dev pushes for the unchecked artifacts |
| F-036 | docker.yml passes packages:write to the check job that runs unpinned dev dependencies | Medium | Medium | A compromised dev dependency during a push to main, beta, a tag, or a dispatch run |
| F-037 | Published artifacts contain what PyPI and base images serve at build time | High | High | A compromised or vulnerable upstream release at build time |
| F-038 | The SimplySign installer runs unverified in the step holding the TOTP seed | Critical | Medium | Compromise of Certum's file host or the installer |
| F-039 | Secret-bearing jobs trust movable action tags | Critical | Medium | Compromise or a tag move on one action repository |
| F-040 | No publisher checksum or signature for deb, rpm or images, with auto-update encouraged | Medium | High | Registry or release write access, by theft or through F-036 |
| F-041 | Frozen bundles ship eqlab's src, tests and .claude tree and may serve them over the network | Medium | Low | Network reach to a frozen install; sensitivity depends on the submodule |
| F-042 | Dev-tool dependencies run on developer hosts and in CI without commit pins | High | Medium | A moved tag, a compromised release, or a name collision on the package index |
| F-043 | A hostile branch or prompt injection gets code execution through the repo's agent allowlist and hooks | High | Medium | A developer or agent on a hostile branch in an already-trusted checkout, or an agent acting on injected text |
| F-044 | The eq-assistant's stated confinement is absent from this tree, and eqstage's url field gives it network egress | Medium | Medium | An EQ session on the host and an agent that follows injected content |
| F-045 | CLAUDE.md allows management credentials unredacted even when they're chosen rather than stock | Defect | Medium | A non-stock password, and an agent that prints or commits it under this rule |
| F-046 | The repo's agent guards are easy to get around | Defect | High | An agent that ignores instructions or is under prompt injection |
| F-047 | hqp_section reads any path named in INDEX.md | Low | High | A hostile tracked INDEX.md and an agent calling the tool |
| F-048 | Write probes keep the daemon backup at a predictable temp path, and restore_pristine pushes it back | Low | Medium | A second local user, default `TMPDIR`, no `PROBE_OUT`, and an operator running the probes |

## Technical findings

### F-001 · No authentication on any API route, and the routes use HQPTuner's stored daemon credential

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | High |
| CWE | CWE-306: Missing Authentication for Critical Function |
| CVSS 4.0 | CVSS-B 9.3 (Critical), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:H/VA:H/SC:L/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Nothing checks who is calling. `create_app` adds no middleware and no route has an auth dependency. The one gate, `HttpMgr`, only tests that an HTTP client object exists, and one exists by default because the config falls back to the published stock pair. HQPTuner then uses the management credential it holds for any caller, so operations the daemon protects with Digest become open: `GET /api/backup` returns the settings archive and `POST /api/restore` pushes an archive back and restarts the daemon. Every other route, including `POST /api/connection`, `POST /api/volume` and preset deletion, is equally open.

The container, the deb and rpm service, the macOS app and the Windows app all bind `0.0.0.0`. Only a from-clone run defaults to loopback, and the deb and rpm enable and start the service at install.

#### Evidence

- No middleware or dependency on the app: [`hqptuner/api/factory.py:65-103`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65-L103)
- `HttpMgr` tests only for a client object: [`hqptuner/api/deps.py:71-91`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/deps.py#L71-L91)
- Stock fallback and loopback default for a from-clone run: [`hqptuner/config.py:125-127`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L125-L127)
- Routes that use the held credential: [`hqptuner/api/routes/config.py:242-264`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L242-L264), [`hqptuner/api/routes/config.py:315-351`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L315-L351)
- All-interface binds: [`Dockerfile:25`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Dockerfile#L25), [`compose.yaml:22`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L22), [`packaging/linux/hqptuner.service:13`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/hqptuner.service#L13), [`packaging/windows/hqptuner.iss:44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/hqptuner.iss#L44), [`hqptuner.spec:113-115`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner.spec#L113-L115)
- Service started at install: [`packaging/linux/deb/postinst:29`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/deb/postinst#L29), [`packaging/linux/rpm/post:4-7`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/rpm/post#L4-L7)

#### Prerequisites and impact

Prerequisite: Network reach to port 8090. Anyone who can reach port 8090 can read the daemon's configuration, replace it, restart the daemon, change the volume and persist changes. A management password the owner set on the daemon no longer protects those operations from that person. On a home network that's every device on it, which includes the phones, TVs and guests. After a restart with a `remember=false` record the password is empty and `HttpMgr` answers 503, but only until someone posts a new pair, because `/api/connection` is ungated.

#### Severity and confidence rationale

High confidence: a case-insensitive search of the Python package found no Authorization, API key or client-IP check, and the refuter found none either. The prerequisite is plain network reach, and the packaged defaults provide it. The service accepts any routable address, so AV is N; a home LAN or a firewall is an Environmental matter for whoever runs it. The vulnerable system is HQPTuner and the subsequent system is the daemon.

#### Recommended remediation

Add a login or token that every `/api` route requires, including `/api/connection`. Until then, bind to loopback by default and make listening on the network an explicit choice the user makes with a warning next to it. Binding every package to `0.0.0.0` is a product decision, and it needs that control in front of it.

#### Uncertainty and verification limits

Traced in source and not run. A host firewall can block the port, and source can't show that state. That the daemon honors Digest from HQPTuner comes from [`docs/protocol.md:48-52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L48-L52).

### F-002 · Any website can POST a restore archive or stop the engine through a visitor's browser

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-352: Cross-Site Request Forgery (CSRF) |
| CVSS 4.0 | CVSS-B 5.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:L/VA:L/SC:N/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

No route checks Origin, Referer, Sec-Fetch or a token, and the SPA sends no token. A page on any website can make a visitor's browser send a multipart or bodyless POST, which browsers treat as a simple request with no preflight. These routes accept that shape:

- `POST /api/restore` takes a multipart upload and forwards it to the daemon's `/restore` with HQPTuner's credential. It acts outright. Restore is additive, so it overwrites `hqplayerd.xml` and any member supplied, and members left out of the zip stay on disk.
- `POST /api/config/refresh` takes no body and triggers the device rescan, which stops the engine. It acts outright.
- `POST /api/matrix/filter` parks uploaded file bytes for the next apply (F-012).
- `POST /api/config/apply` accepts no body and flushes whatever is staged. It answers 400 if nothing is staged.
- `POST /api/livepresets/{name}/apply` takes no body but needs an existing preset name.

The response is opaque to the attacker's page, so this is write-only. Whether the JSON routes are reachable the same way is an open question under coverage.

#### Evidence

- No middleware: [`hqptuner/api/factory.py:65-103`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65-L103)
- Multipart restore to the daemon: [`hqptuner/api/routes/config.py:315-351`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L315-L351), [`hqptuner/lanes/settle.py:50-63`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/settle.py#L50-L63)
- Bodyless refresh, which stops the engine: [`hqptuner/api/routes/config.py:229-239`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L229-L239), [`hqptuner/core/engineread.py:92-108`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/engineread.py#L92-L108)
- Filter upload: [`hqptuner/api/routes/matrix/matrix.py:266-283`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L266-L283)
- Optional body on apply and its 400: [`hqptuner/api/routes/apply.py:100-124`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/apply.py#L100-L124)
- Live preset apply: [`hqptuner/api/routes/livepreset.py:203-229`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/livepreset.py#L203-L229)
- The SPA's wrappers send no token: [`hqptuner/static/lib/api.js:149-192`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/lib/api.js#L149-L192)
- Restore is additive: [`docs/protocol.md:90`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L90)
- The credential gate on those routes: [`hqptuner/api/deps.py:85-87`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/deps.py#L85-L87)

#### Prerequisites and impact

Prerequisite: A visitor's browser can reach HQPTuner and doesn't block the request. The victim has to visit the attacker's page, and the attacker has to know or guess the address. That's `127.0.0.1:8090` on a desktop install, and a guess on a LAN. A drive-by page can then overwrite the daemon's running configuration, restart it and interrupt playback. The restore and refresh routes need a client the daemon accepts, which the stock pair provides. This extends the reach of F-001 to people who aren't on the network.

#### Severity and confidence rationale

High confidence for the routes and the missing check, confirmed by both the review agents and the refuter. Reach in practice depends on the browser: [MDN's CORS guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) lists `POST` with `multipart/form-data` as a simple request, and [Chrome's Local Network Access](https://developer.chrome.com/blog/local-network-access) asks the user for permission before a public site reaches a local or loopback address, with the prompt launching in Chrome 142. AT is P because the browser's local-network policy is outside the attacker's control, and UI is P for the page visit. The attack is blind, so no confidentiality impact.

#### Recommended remediation

Reject state-changing requests whose `Origin` or `Sec-Fetch-Site` doesn't match the app, in one middleware. A required token (F-001) closes this as well.

#### Uncertainty and verification limits

Not run. I checked Chrome's policy only, so other browsers' handling is unverified. What the daemon does with a hostile archive is unknown (F-007). Mixed-content rules stop an HTTPS page reaching a plain-HTTP LAN address, though an attacker can serve the page over HTTP.

### F-003 · No Host validation, so DNS rebinding gives a website same-origin read and write on the API

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-346: Origin Validation Error |
| CVSS 4.0 | CVSS-B 7.3 (High), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:L/VI:H/VA:H/SC:L/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

HQPTuner doesn't validate the `Host` header. There's no `TrustedHostMiddleware` and neither uvicorn entry point restricts hosts. A page on an attacker's domain that rebinds to HQPTuner's address becomes same-origin, so it can read `/api/backup`, `/api/state-export`, `/api/connection` and `/api/log`, and it can POST JSON to every route. `/api/audit` is also readable when `HQPTUNER_DEBUG_LOG` is set. No route returns the password, but the same page can use `POST /api/connection` to capture a Digest response (F-004).

#### Evidence

- No Host check in the app: [`hqptuner/api/factory.py:65-103`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65-L103)
- Uvicorn entry points: [`hqptuner/__main__.py:38-45`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/__main__.py#L38-L45), [`hqptuner/desktop.py:205-213`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L205-L213)
- Readable routes: [`hqptuner/api/routes/config.py:242-277`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L242-L277), [`hqptuner/api/routes/status.py:181-194`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L181-L194), [`hqptuner/api/routes/connection.py:94-100`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L94-L100)
- `/api/audit` is conditional: [`hqptuner/api/factory.py:73-74`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L73-L74)

#### Prerequisites and impact

Prerequisite: A browser that permits the rebind, and a victim who stays on the page. Where it works, an internet site gets what a LAN peer gets in F-001, with responses readable. The fixed default port 8090 helps the attacker.

#### Severity and confidence rationale

The missing control is certain. [FastAPI's middleware docs](https://fastapi.tiangolo.com/advanced/middleware/) say `TrustedHostMiddleware` is what enforces the `Host` header and that omitting it allows any hostname. I rate confidence Medium because success depends on the browser's DNS pinning and local-network rules, which source can't settle. Same impact as F-001 from a website, with AT at P for the browser's rebinding protections and UI at P for the visit.

#### Recommended remediation

Add `TrustedHostMiddleware` with the addresses the user configures, plus loopback.

#### Uncertainty and verification limits

Not run. I couldn't read uvicorn's settings page because its documentation host didn't resolve when I checked, so "uvicorn doesn't validate Host" rests on the entry points setting no restriction. Chrome's [Local Network Access](https://developer.chrome.com/blog/local-network-access) may prompt for the rebound request, and other browsers are unverified.

### F-004 · POST /api/connection sends a Digest response for the stored password to any host a caller names

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | High |
| CWE | CWE-522: Insufficiently Protected Credentials |
| CVSS 4.0 | CVSS-B 9.1 (Critical), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:L/VA:L/SC:H/SI:H/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

A caller can change the host alone. The route falls back to the password already in memory, moves the host into the config unless `HQPTUNER_HQP_HOST` is pinned, builds a new `httpx.DigestAuth` client for that host and fetches `/config` inside the same request. A server at that address can answer 401 with a Digest challenge it chose, and it gets the username plus a response computed from the password. The host record persists, and a caller who adds `remember:true` also writes the in-memory password to disk in plaintext, including a password the user asked not to store or one supplied through `HQPTUNER_HQP_PASSWORD`.

#### Evidence

- No validation on `host`: [`hqptuner/api/routes/connection.py:36`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L36)
- Password fallback, save, client build and immediate fetch: [`hqptuner/api/routes/connection.py:113-139`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L113-L139)
- A pinned host stops the move: [`hqptuner/core/connection.py:142-143`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L142-L143)
- The Digest client: [`hqptuner/conf/httpconf.py:164-169`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L164-L169)
- The daemon's HA1 is unsalted: [`docs/protocol.md:50-52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L50-L52)
- Compose passes the pin only when set: [`compose.yaml:26-31`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L26-L31)
- The lanes move to the new host: [`hqptuner/core/manager.py:302-314`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/manager.py#L302-L314)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding, `HQPTUNER_HQP_HOST` unset, a real password in force. The attacker gets material for offline guessing with a nonce they picked, and a persisted redirect of both lanes onto their own daemon, whose data the SPA then renders. A cracked password also works on the real daemon and anywhere it's reused. With the stock pair there's nothing to learn. HQPTuner loses the owner's daemon until someone corrects the host, unless the attacker restores it with a second POST. The daemon itself keeps running.

#### Severity and confidence rationale

High confidence in the flow, which the refuter traced line by line. [RFC 7616](https://www.rfc-editor.org/rfc/rfc7616.html) sections 3.3 and 3.4 define the response as a hash over the password and the server's values, and sections 5.1, 5.7 and 5.9 to 5.11 describe the dictionary and chosen-nonce risks. How hard the crack is depends on the password's strength. AT is P because recovering the password depends on its strength. The final outcome is the management password working on the daemon.

#### Recommended remediation

Require the password whenever the host changes, and drop the fallback. Authentication on the route (F-001) is the larger fix.

#### Uncertainty and verification limits

Not run. [httpx's authentication page](https://www.python-httpx.org/advanced/authentication/) calls Digest a challenge-response that takes an extra round trip but doesn't list which challenge fields it uses, so that step rests on the RFC.

### F-005 · An unvalidated connection host lets a caller read HTTP services HQPTuner can reach

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-918: Server-Side Request Forgery (SSRF) |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:L/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The host string goes unchanged into `http://{host}:{port}`. A value that carries its own port and path, such as `target:9000/path?x=`, selects another host and port. `GET /api/log` needs no credential, fetches `/log` from that base and returns the body as lines, capped at the last 256 KiB and 500 lines. `GET /api/backup` returns the body as raw bytes while the descriptions store is empty; once it holds entries, a non-zip body raises `BadZipFile` and the caller gets a 500. Only GET works and only 2xx bodies come back. The refusal text also tells an HTTP answer apart from a timeout and a failed connection, which gives a partial port probe, though a closed port and a port that answers with something other than HTTP can read the same, and a silent open port reads as a timeout. A second POST puts the original host back.

#### Evidence

- The unvalidated field: [`hqptuner/api/routes/connection.py:36`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L36)
- The base URL: [`hqptuner/engine/logtail.py:49-59`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L49-L59), [`hqptuner/config.py:243-244`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L243-L244)
- The tail and its caps: [`hqptuner/engine/logtail.py:62-66`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L62-L66), [`hqptuner/core/engineread.py:87-89`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/engineread.py#L87-L89)
- `/api/log` needs only the manager: [`hqptuner/api/routes/status.py:181-194`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L181-L194)
- `/api/backup`: [`hqptuner/api/routes/config.py:250-264`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L250-L264), [`hqptuner/conf/httpconf.py:308-314`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L308-L314)
- The refusal text: [`hqptuner/conf/noanswer.py:29-35`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/noanswer.py#L29-L35), [`hqptuner/conf/httpconf.py:147-150`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L147-L150)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding, `HQPTUNER_HQP_HOST` unset, a target answering 2xx. A peer can read internal HTTP services only HQPTuner's host can reach, which means the machine's loopback services on deb, rpm and desktop installs, and the Docker network and host in the container. A cloud-hosted install would reach its metadata service. The daemon lanes drop while the host is wrong, which the owner can see.

#### Severity and confidence rationale

The missing validation and the read-back are certain. Medium confidence overall because the exact path shaping rests on how httpx merges a request path into a `base_url` that already has a query, and [its docs](https://www.python-httpx.org/advanced/clients/) don't describe that case. Redirects aren't followed, per [httpx's quickstart](https://www.python-httpx.org/quickstart/). SC is L because only 2xx GET bodies come back, capped on `/api/log`. VA is L for the visible lane drop.

#### Recommended remediation

Validate `host` as a hostname or IP address with no port, path or query, and refuse anything else at the route.

#### Uncertainty and verification limits

Not run. Choosing the host and port follows from ordinary URL syntax. Control of the full path is unverified against an installed httpx, and httpx is unpinned at [`pyproject.toml:9`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L9).

### F-006 · Staged config values reach hqplayerd.xml unescaped, so a client can add elements the allowlist never named

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | High |
| CWE | CWE-91: XML Injection (aka Blind XPath Injection) |
| CVSS 4.0 | CVSS-B 7.8 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`POST /api/config/stage` takes `http` as a free string map and checks only live keys. `POST /api/config/apply` sends a batch with no routable field to the restore lane, which runs `apply_edits`. The field router checks the field name against `FIELD_MAP`, and `set_attr` then builds `attr="value"` by raw interpolation. A double quote closes the attribute, so `x"/><foo bar="baz` on the title field writes a new element beside it, and the result goes to the daemon's `/restore`. `LOCAL_BACKEND_MAP`, `PLUGIN_MAP`, `net_device` and `fixed_volume` share the problem, and the disabled `fixed_volume` path writes into an XML comment that `-->` closes.

A second path reaches the same writer: `POST /api/config/live` skips validation for a field on the chain that isn't loaded, stores it, and carries it into the next apply, engine change or preset save.

Matrix process strings and profile names don't take this path. They go through `attr_escape`, and source, mixdown and gain are validated.

#### Evidence

- The free map: [`hqptuner/api/models.py:28-30`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/models.py#L28-L30), [`hqptuner/api/routes/pending.py:116-134`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L116-L134)
- Routing to the restore lane: [`hqptuner/lanes/live/routing.py:208-216`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/live/routing.py#L208-L216)
- Name check and the call to the writer: [`hqptuner/conf/presetconf.py:204-213`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L204-L213), [`hqptuner/conf/presetconf.py:283-294`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L283-L294)
- Raw interpolation: [`hqptuner/conf/xmledit.py:180-198`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/xmledit.py#L180-L198)
- The comment path: [`hqptuner/conf/fixedvol.py:109-124`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/fixedvol.py#L109-L124)
- Second path: [`hqptuner/lanes/live/routing.py:320-327`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/live/routing.py#L320-L327), [`hqptuner/lanes/presetfields.py:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/presetfields.py#L52)
- The restore: [`hqptuner/lanes/http/restore.py:305-329`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L305-L329)

#### Prerequisites and impact

Prerequisite: Network reach, working 8088 credentials (the stock pair qualifies). A client can write any element or attribute the daemon reads from its config, at root, engine or matrix scope, including ones HQPTuner deliberately doesn't expose. Malformed output can break the config the daemon then restarts onto, and every restore restarts the daemon.

#### Severity and confidence rationale

High confidence that the bytes reach the daemon. The refuter reproduced the expansion by reading the code and found no escaping on either branch of `set_attr`. The effect of an injected element depends on the closed-source daemon. SI and SA are H because a client writes any element the daemon reads and can break the config it restarts onto.

#### Recommended remediation

Escape every value in `set_attr` and `fixedvol` the way `attr_escape` already does for process strings, and check values against each field's type. Building the edit through an XML library would remove the class of bug.

#### Uncertainty and verification limits

Not run. I can't tell from source which injected elements have any effect, or whether the daemon tolerates a broken comment.

### F-007 · POST /api/restore passes any archive to the daemon with no member filter and no safety copy

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | High |
| CWE | CWE-20: Improper Input Validation |
| CVSS 4.0 | CVSS-B 7.8 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The route reads the upload, strips only `hqptuner/descriptions.json`, and posts everything else to the daemon's `/restore` with `scope=system`, which HQPTuner's own comment says writes every archive member to disk. Member names aren't examined. It takes no backup first, unlike the apply, engine and preset-load lanes. The preset-save mirror also restores with no copy.

#### Evidence

- The route: [`hqptuner/api/routes/config.py:315-351`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L315-L351)
- The forward: [`hqptuner/lanes/settle.py:50-63`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/settle.py#L50-L63), [`hqptuner/conf/httpconf.py:290-306`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L290-L306)
- Only one member is stripped: [`hqptuner/conf/presetzip.py:162-182`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetzip.py#L162-L182)
- Lanes that do take a copy: [`hqptuner/lanes/http/restore.py:305-306`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L305-L306), [`hqptuner/core/applyops.py:187-188`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/applyops.py#L187-L188), [`hqptuner/presets/presetlane.py:153-154`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetlane.py#L153-L154)
- The auth file: [`docs/protocol.md:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L52)

#### Prerequisites and impact

Prerequisite: Network reach or a cross-site POST, and a client holding credentials. An anonymous client can replace the daemon's configuration with no recovery copy. Crafted member names, or a root-level `hqplayerd-auth.xml`, might also land on disk, which would be a file write on the daemon's host or a takeover of its credential. Whether either works depends on the daemon.

#### Severity and confidence rationale

High confidence for the route's behavior. The worst-case impact is unconfirmed, so the finding states it as a possibility. SI and SA cover replacing the daemon's config and restarting it, with no recovery copy. File write on the daemon's host isn't scored, because it's unconfirmed.

#### Recommended remediation

Refuse members other than the ones the daemon's archive format documents, reject path separators and `..` in names, and persist a backup first as the other lanes do.

#### Uncertainty and verification limits

Not run. How hqplayerd handles member paths, and whether it accepts an auth file member, can't be settled from source.

### F-008 · /api/state-export and /api/backup hand out configs, backups and logs with no gate

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-200: Exposure of Sensitive Information to an Unauthorized Actor |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:L/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`GET /api/state-export` needs no credentials and ships every preset, the pre-apply daemon backup, all of HQPTuner's stores, the debug log and its rolled copy, and up to 2000 recent log lines. Only the connection record's password is blanked. `GET /api/backup` is gated only by `HttpMgr`. An operator who points `HQPTUNER_BACKUP_DIR` or `HQPTUNER_PRESET_DIR` at the directory holding `connection.json` would ship the password unblanked, because `_dir_members` doesn't blank anything.

#### Evidence

- The routes: [`hqptuner/api/routes/config.py:242-277`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L242-L277)
- What ships: [`hqptuner/presets/store/export.py:47-96`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/export.py#L47-L96)
- The blanking: [`hqptuner/presets/store/export.py:31-44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/export.py#L31-L44)
- The backup slot: [`hqptuner/presets/presetops.py:281-284`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetops.py#L281-L284)
- HA1 and archive contents: [`docs/protocol.md:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L52), [`docs/protocol.md:68`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L68)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding. Any peer gets the full configuration, device names, paths, descriptions and logs. If the daemon's archive includes `hqplayerd-auth.xml`, the backups also carry a password equivalent, since that file holds the Digest HA1.

#### Severity and confidence rationale

High confidence for the disclosure. Low confidence on the HA1 part: `docs/protocol.md:68` lists the archive as `hqplayerd.xml`, `data/cfgs` and `library` without naming the auth file, and only a real archive would settle it. VC and SC are L for configuration, logs and paths. The HA1 case isn't scored, because it's unconfirmed.

#### Recommended remediation

Gate both routes behind authentication (F-001), and strip credential-bearing members from anything exported. Refuse export from a directory that holds `connection.json`.

#### Uncertainty and verification limits

Not run. Listing the members of a real `/backup/settings.zip` would settle the HA1 question.

### F-009 · The README says the desktop apps are reachable from that machine only, but they bind all interfaces

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | High |
| CWE | CWE-1188: Initialization of a Resource with an Insecure Default |
| CVSS 4.0 | CVSS-B 9.2 (Critical), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:H/VA:H/SC:L/SI:H/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

README lines 192 and 204 tell Mac and Windows users the app is reachable from that machine only. The macOS bundle and the Windows installer both set `HQPTUNER_LISTEN_HOST=0.0.0.0`, the smoke tests assert it, the 1.20.1 changelog describes access from other devices as intended, and README line 238 contradicts lines 192 and 204. The tray opens `127.0.0.1`, which reinforces the wrong belief. The Windows installer writes the value to `HKCU\Environment` with no prompt, so every process that user starts inherits it, including a from-clone run that would otherwise default to loopback.

#### Evidence

- The claim: [`README.md:192`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L192), [`README.md:204`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L204)
- The contradiction: [`README.md:238`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L238)
- The settings: [`hqptuner.spec:113-115`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner.spec#L113-L115), [`packaging/windows/hqptuner.iss:43-44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/hqptuner.iss#L43-L44)
- The changelog: [`CHANGELOG.md:7-11`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/CHANGELOG.md#L7-L11)
- The tray's loopback URL: [`hqptuner/desktop.py:55`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L55), [`hqptuner/desktop.py:143-149`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L143-L149)
- The smoke tests: [`packaging/macos/smoke.sh:88-91`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/macos/smoke.sh#L88-L91), [`packaging/windows/smoke.sh:116-120`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/smoke.sh#L116-L120)

#### Prerequisites and impact

Prerequisite: A macOS or Windows install on a network with other devices. A laptop user on shared Wi-Fi, told the app is local, exposes every route in F-001. The bind looks deliberate and the two README lines look stale, so which one is wrong is your call.

#### Severity and confidence rationale

High confidence, since all of it is in tracked files. Actual reachability also depends on the OS firewall. A vulnerability because a default setting introduces surprising security behavior: the docs say local-only and the default isn't. AT is P for the OS firewall, and the impact is F-001's.

#### Recommended remediation

Correct README lines 192 and 204, and give desktop users an opt-in setting for network access. If the bind stays, say so at install.

#### Uncertainty and verification limits

Not run. Whether the Windows or macOS firewall blocks inbound connections on a given machine isn't something source can show. "Since 1.20.1" rests on the changelog entry, since the refuter had no git history.

### F-010 · Control API commands are built by string interpolation, and three client routes feed raw strings into them

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-91: XML Injection (aka Blind XPath Injection) |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:L/SC:N/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`ControlClient.send` writes each attribute as `f' {k}="{v}"'` with no escaping, then writes the result to the 4321 socket as one document. Three routes reach it with free text: `POST /api/matrix/profile` passes `name` straight through, `POST /api/volume` passes `level` straight through because the numeric guard lives only in `writer._malformed`, and staged live fields reach it on apply. Staged `volume` does get the numeric check, while staged `filter`, `shaper`, `mode`, `junk_filter` and `adaptive_volume` don't. `POST /api/config/live` is safe on the loaded chain because values resolve through enumerations. A value with a double quote can add attributes or close the element and append more XML.

#### Evidence

- The interpolation and the write: [`hqptuner/engine/control.py:308-315`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L308-L315), [`hqptuner/engine/control.py:183`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L183)
- Matrix profile: [`hqptuner/api/routes/matrix/matrix.py:168-193`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L168-L193), [`hqptuner/lanes/matrixlane.py:36-42`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/matrixlane.py#L36-L42)
- Volume: [`hqptuner/api/models.py:63-66`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/models.py#L63-L66), [`hqptuner/api/routes/volume.py:52-61`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/volume.py#L52-L61), [`hqptuner/core/applyops.py:115-123`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/applyops.py#L115-L123)
- Staged live fields: [`hqptuner/api/routes/pending.py:123-129`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L123-L129), [`hqptuner/lanes/writer.py:176-191`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/writer.py#L176-L191)
- Stale replies: [`hqptuner/engine/control.py:187-197`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L187-L197)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding, control lane connected. At minimum a client adds attributes to a command. If the daemon acts on a second element from one write, every Control API command becomes reachable through HQPTuner. Port 4321 is already unauthenticated, per [`docs/protocol.md:42`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L42), so this adds the most where a peer can reach HQPTuner but not 4321. An extra reply would also shift the request and reply pairing. A legitimate profile name containing a quote breaks the same way.

#### Severity and confidence rationale

High confidence that the bytes reach the socket. Medium overall because the effect depends on how the closed daemon parses them. Impacts are L because the socket write is certain, the daemon's handling is unknown, and 4321 is already open to anyone who can reach it.

#### Recommended remediation

Escape attribute values in `send`, and validate `level` and `name` at their routes.

#### Uncertainty and verification limits

Not run. Only a test against hqplayerd would show whether anything after the first closed element is executed.

### F-011 · Log path and pipeline process strings let a client name any path on the daemon's host

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Low |
| CWE | CWE-73: External Control of File Name or Path |
| CVSS 4.0 | CVSS-B 6.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:N/VA:N/SC:L/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`log_file` and `log_enabled` are allowlisted fields with no path rule, and an absent `<log>` element gets created. Pipeline process strings are checked only for control characters and then attribute-escaped. Nothing confines either to a directory. HQPTuner's docs record that the daemon resolves absolute process paths. A comment in the log tail mentions a custom log path, which is weak support that the daemon honors one.

#### Evidence

- The fields: [`hqptuner/conf/presetconf.py:141-143`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L141-L143)
- Creating the element: [`hqptuner/conf/xmledit.py:86-102`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/xmledit.py#L86-L102)
- The process check: [`hqptuner/conf/matrixpayload.py:167-170`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixpayload.py#L167-L170), [`hqptuner/conf/matrixconf.py:91-95`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixconf.py#L91-L95)
- The field list: [`docs/settings-classification.md:98`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/settings-classification.md#L98)
- Process paths: [`docs/matrix-spec.md:104`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L104), [`docs/matrix-spec.md:111`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L111)
- The log comment: [`hqptuner/engine/logtail.py:3-6`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L3-L6)

#### Prerequisites and impact

Prerequisite: Network reach, working 8088 credentials. This could overwrite or corrupt files the daemon can write. If `/log` serves whatever `<log file>` names, it could also read files the daemon can read. Process paths pointing at device nodes or FIFOs might hang engine init. All of that is conditional.

#### Severity and confidence rationale

Certain that any client can name any path in the config. Low confidence in the impact, because the effect sits entirely in the closed daemon, and [`hqptuner/engine/logtail.py:3-6`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L3-L6) suggests `/log` may be independent of that file. AT is P and impacts are L because the effect sits entirely in the closed daemon.

#### Recommended remediation

Restrict `log_file` to a fixed directory or stop exposing it, and refuse absolute or parent-relative process paths unless the UI's own filter directory holds them.

#### Uncertainty and verification limits

Not run. Whether the daemon creates, appends to or only reads each path, and what its service sandbox allows, needs the daemon and its deployed unit.

### F-012 · Parked filter uploads silently replace daemon files and ride the next apply

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-641: Improper Restriction of Names for Files and Other Resources |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The filter park checks name collisions only against its own directory. Parked files become `data/<name>` substitutions, and `rewrite_zip` replaces any member of that name, so an upload named after a daemon file, such as `impulse_0-0.wav`, overwrites it on the next restore. Nothing links the person who parked a file to the person who applies. Files are read and re-deflated synchronously inside the async pass, up to 256 MiB, for up to three passes. Only top-level `.wav` and `.txt` names are reachable, because the name check refuses separators and other extensions. An apply that stays on the live lane ships nothing.

#### Evidence

- Collision check and capacity: [`hqptuner/presets/store/filterpark.py:143-163`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L143-L163), [`hqptuner/presets/store/filterpark.py:32`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L32)
- Members to substitutions: [`hqptuner/presets/store/filterpark.py:172-181`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L172-L181), [`hqptuner/conf/engineconf.py:84-90`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/engineconf.py#L84-L90)
- Replacement in the archive: [`hqptuner/conf/presetzip.py:107-110`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetzip.py#L107-L110)
- Per-pass read: [`hqptuner/lanes/http/restore.py:218`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L218), [`hqptuner/lanes/http/restore.py:320`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L320)
- The daemon's impulse names: [`docs/matrix-spec.md:111`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L111)

#### Prerequisites and impact

Prerequisite: Network reach, then any persistent apply, and a name matching an existing member. A peer can swap a convolution filter in use, so audio with an unexpected response plays through the owner's equipment. Applies also bring memory pressure and event-loop stalls.

#### Severity and confidence rationale

High confidence for the replacement in the archive. Medium for what the daemon then does, which rests on [`docs/protocol.md:90`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L90). SI is L because only a top-level `.wav` or `.txt` member can be replaced, and VA is L for the stall during applies.

#### Recommended remediation

Refuse a parked name that matches an existing archive member, or give parked files a reserved prefix. Do the read and deflate off the event loop.

#### Uncertainty and verification limits

Not run. Assumes the daemon overwrites `data/` members on restore, as HQPTuner's protocol notes say.

### F-013 · A value the repository documents as fatal can be staged with no check, and the UI then blames the credentials

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-20: Improper Input Validation |
| CVSS 4.0 | CVSS-B 7.8 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:L/SA:H` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`matrix_enabled` maps straight to `<matrix enabled>` with no domain check on the staged path. `docs/matrix-spec.md` records that `enabled="on"` makes the daemon fail engine init on every startup, that a service restart doesn't recover it, and that `/backup/settings.zip` then answers 401. The first restore pass's verify absorbs that 401 and reports a diff. The second pass's `backup()` raises `AuthRefused`, and the caller gets the sentence saying the username and password are bad. The speakers lane guards this class of value, and the restore lane has no equivalent.

#### Evidence

- The field and the writer: [`hqptuner/conf/presetconf.py:137`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L137), [`hqptuner/conf/xmledit.py:186`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/xmledit.py#L186)
- The probe note: [`docs/matrix-spec.md:121`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L121)
- The misreport: [`hqptuner/lanes/http/restore.py:218-234`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L218-L234), [`hqptuner/conf/httpauth.py:23-26`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpauth.py#L23-L26), [`hqptuner/conf/httpauth.py:118-119`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpauth.py#L118-L119)
- The speakers guard: [`hqptuner/conf/httpconf.py:250-254`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L250-L254), [`hqptuner/conf/httpconf.py:258`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L258), [`hqptuner/conf/httpconf.py:265-266`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L265-L266)

#### Prerequisites and impact

Prerequisite: Network reach, working 8088 credentials. Two anonymous requests can take the daemon down persistently, with recovery needing a config edit on its host, while the UI points the owner at the wrong cause.

#### Severity and confidence rationale

The write is certain. Medium confidence because the wedge rests on the repository's own probe note, which used the `/matrix` form lane on 6.0.4 and attributes the failure to the file's contents. SA is H because the note describes the daemon staying down until its config is edited by hand.

#### Recommended remediation

Check staged values against each field's domain, which also addresses F-006. Report the failure as an engine fault when the daemon was reachable before the push.

#### Uncertainty and verification limits

Not run. I can't confirm that the same bytes arriving by restore behave as the form-lane note describes.

### F-014 · An unknown matrix profile name puts the engine in a restart loop

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-20: Improper Input Validation |
| CVSS 4.0 | CVSS-B 6.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`docs/matrix-spec.md` documents that `MatrixSetProfile` accepts any name and that the engine then fails and reruns repeatedly, and it says `switch_profile` forwards whatever the route is given. The code matches. The route checks only `action`, and the lane sends the name with no comparison against the profile list HQPTuner already holds. The route needs `Mgr` and no credential. The switch itself causes no reload, so the failure starts at the next engine reinit. The loop is the playback engine stopping and re-running, and a daemon restart clears it. The route's own comment records that the daemon refuses a live switch with nothing loaded, so this needs a track loaded.

#### Evidence

- The note: [`docs/matrix-spec.md:127`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L127), [`docs/matrix-spec.md:131`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/matrix-spec.md#L131)
- The route: [`hqptuner/api/routes/matrix/matrix.py:175-193`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L175-L193), with its comment at [`hqptuner/api/routes/matrix/matrix.py:133-141`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L133-L141)
- The lane: [`hqptuner/lanes/matrixlane.py:36-42`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/matrixlane.py#L36-L42)
- The list HQPTuner already holds: [`hqptuner/core/readings.py:67-69`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/readings.py#L67-L69)

#### Prerequisites and impact

Prerequisite: Network reach, control lane connected, a track loaded, then the next engine reinit. One request sets this up, and from the next engine reinit playback is interrupted until someone selects a real profile or restarts the daemon. No config file changes, per the note.

#### Severity and confidence rationale

High confidence in the missing check. Medium overall because the daemon's behavior rests on the author's probe notes on 6.0.4. AT is P because it needs a loaded track and the next engine reinit. SA is L because it clears with one request.

#### Recommended remediation

Compare the name against `MatrixListProfiles` before sending it.

#### Uncertainty and verification limits

Not run, and not verifiable from source.

### F-015 · One POST with a malformed host stops HQPTuner at every later start

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-248: Uncaught Exception |
| CVSS 4.0 | CVSS-B 8.7 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`POST /api/connection` saves the record before it builds the client. A host httpx rejects, such as `a:b`, makes the build raise `InvalidURL` after the record is on disk, and the route returns a 500. At the next start `create_app` builds the client from that record outside any handler, since only `StoreCorruptError` is caught, so the process exits. The restart policies then produce a crash loop, and the desktop app fails with no console, so the Connection panel that could fix it never loads. A host-only POST on an install that never remembered writes an empty password, gets no client at start and doesn't crash. So this needs `remember:true`, which the caller can send, or an already-remembered record, or a pinned password.

#### Evidence

- Save before build: [`hqptuner/api/routes/connection.py:119-125`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L119-L125)
- The build at start: [`hqptuner/api/factory.py:53-60`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L53-L60), [`hqptuner/core/connection.py:150-158`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L150-L158)
- No guard: [`hqptuner/__main__.py:38-39`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/__main__.py#L38-L39)
- Restart policies: [`compose.yaml:19`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L19), [`packaging/linux/hqptuner.service:14`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/hqptuner.service#L14)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding, a password in force, `HQPTUNER_HQP_HOST` unset. One unauthenticated request causes a denial of service that lasts until someone removes `connection.json` or sets `HQPTUNER_HQP_HOST`. The daemon itself isn't affected.

#### Severity and confidence rationale

Medium confidence. The ordering and the missing guard are certain. [httpx documents `InvalidURL`](https://www.python-httpx.org/exceptions/) as outside the `HTTPError` tree, which is why it escapes, but doesn't say it fires at client construction. VA is H because HQPTuner stays down until someone changes the host's files or environment. The caller can supply `remember:true`, so AT is N.

#### Recommended remediation

Validate the host before saving (F-005), and catch a bad saved record at startup so the app still opens and shows the Connection panel.

#### Uncertainty and verification limits

Not run. That the client constructor raises on this value is from the agents' knowledge of httpx and wasn't executed.

### F-016 · /api/restore reads the whole upload and decompresses members with no ceiling

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | High |
| CWE | CWE-409: Improper Handling of Highly Compressed Data (Data Amplification) |
| CVSS 4.0 | CVSS-B 8.7 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The route has no size check, unlike `/api/matrix/filter`, and reads the whole upload into memory. If the archive holds `hqptuner/descriptions.json`, `take_descriptions` decompresses that member and every other member with no cap, synchronously inside an `async def`, so it runs on the event loop. A zip without that member isn't decompressed here. `snapshot_members` does the same to a daemon's `data/cfgs` members at first connect. The handler catches only `BadZipFile` and `OSError`.

#### Evidence

- The route: [`hqptuner/api/routes/config.py:324-337`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L324-L337)
- The decompression: [`hqptuner/conf/presetzip.py:162-182`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetzip.py#L162-L182)
- First-connect path: [`hqptuner/conf/presetzip.py:185-196`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetzip.py#L185-L196), [`hqptuner/presets/presetlane.py:364-374`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetlane.py#L364-L374)
- The filter route's ceiling for comparison: [`hqptuner/api/routes/matrix/matrix.py:277-281`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L277-L281)

#### Prerequisites and impact

Prerequisite: Network reach or a cross-site POST. A small upload can exhaust memory or stall every route and the poll loop. `compose.yaml` sets no memory limit, so on a same-host deployment the kernel's OOM killer might also pick hqplayerd.

#### Severity and confidence rationale

High confidence in the code. Python's [`zipfile` docs](https://docs.python.org/3/library/zipfile.html) warn about decompression bombs and document no limit on `read`, and [FastAPI's upload docs](https://fastapi.tiangolo.com/tutorial/request-files/) state no maximum upload size. VA is H for an out-of-memory kill. SA is L for the chance the kernel picks hqplayerd on a shared host.

#### Recommended remediation

Cap the upload size, and check `ZipInfo.file_size` for each member before reading. Move the work off the event loop.

#### Uncertainty and verification limits

Not run, so actual memory exhaustion depends on host limits. I couldn't read Starlette's docs because its documentation host didn't resolve when I checked.

### F-017 · 8088 responses have no size or total-time limit, and each connection save keeps an old client until shutdown

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-770: Allocation of Resources Without Limits or Throttling |
| CVSS 4.0 | CVSS-B 8.7 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Two problems. Each `POST /api/connection` appends the replaced client to `_retired`, which only shutdown drains, so repeated posts grow memory and open sockets, and every retired client keeps its Digest username and password in memory. Separately, every 8088 read buffers the full body with no size check, and the poll refreshes three forms each tick and parses them with BeautifulSoup synchronously. The log's 256 KiB cap applies after `resp.text` already holds the whole body, so its comment overstates it. On the Control API the 4 MiB cap holds for size, but the wait is per read, and each chunk re-decodes and rescans the whole buffer, so a slow drip costs time and CPU. The poll-loop read also needs a control connection first, and the route reads don't.

#### Evidence

- Retired clients: [`hqptuner/core/manager.py:257-269`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/manager.py#L257-L269), [`hqptuner/core/manager.py:152-162`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/manager.py#L152-L162)
- Full-body reads: [`hqptuner/conf/httpconf.py:192-201`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L192-L201), [`hqptuner/conf/httpconf.py:220-243`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L220-L243), [`hqptuner/conf/httpconf.py:308-314`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L308-L314)
- The form parser: [`hqptuner/conf/formparse.py:238-239`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/formparse.py#L238-L239)
- The log comment and cap: [`hqptuner/engine/logtail.py:17`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L17), [`hqptuner/engine/logtail.py:54-66`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L54-L66)
- The Control API read loop: [`hqptuner/engine/control.py:199-216`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L199-L216)
- The poll-loop condition: [`hqptuner/core/loader.py:44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/loader.py#L44), [`hqptuner/core/loader.py:174`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/loader.py#L174)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding, and for the body case a host the attacker controls. Gradual or quick memory and descriptor exhaustion that takes a restart to clear, and a stalled event loop while a hostile daemon drips. Availability of HQPTuner only.

#### Severity and confidence rationale

High confidence for `_retired`. [httpx's timeout docs](https://www.python-httpx.org/advanced/timeouts/) define read as waiting for a chunk and describe no whole-response deadline, and [its quickstart](https://www.python-httpx.org/quickstart/) presents streaming as the way to avoid loading the entire body. Medium overall because the real socket count depends on the peer. VA is H because the exhaustion takes a restart to clear.

#### Recommended remediation

Close the old client when replacing it. Stream 8088 responses with a size ceiling and a total deadline.

#### Uncertainty and verification limits

Not run. How long httpx keeps idle sockets on a retired client wasn't confirmed.

### F-018 · Several routes do unbounded or event-loop-blocking work per request

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-400: Uncontrolled Resource Consumption |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Each of these is minor and repeatable by any peer. `/api/config/stage` has no limit on key count or value size, and the pending buffer grows until an apply or discard. `/api/state-export` reads all stores into memory per request. `/api/audit` parses the whole log per call, when `HQPTUNER_DEBUG_LOG` enables it. `/api/matrix/filter` runs the RIFF chunk walk synchronously inside `async def`, and `/api/backup` recompresses inside `async def` when descriptions exist. `/api/discover` keeps every reply in its window and doesn't yield while datagrams keep arriving (F-020). Favorites, descriptions and the filter park have ceilings, and `/api/meter/feed` is inert in this build.

#### Evidence

- Staging: [`hqptuner/api/routes/pending.py:47-53`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L47-L53), [`hqptuner/api/models.py:28-29`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/models.py#L28-L29)
- State export: [`hqptuner/presets/store/export.py:47-57`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/export.py#L47-L57)
- Audit: [`hqptuner/audit.py:162-190`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/audit.py#L162-L190)
- Filter walk: [`hqptuner/api/routes/matrix/matrix.py:278-281`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/matrix/matrix.py#L278-L281), [`hqptuner/presets/store/filterpark.py:92-114`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L92-L114)
- Discovery: [`hqptuner/engine/discovery.py:171-179`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L171-L179)
- `/api/backup` recompression: [`hqptuner/api/routes/config.py:256`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L256), [`hqptuner/conf/engineconf.py:78-91`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/engineconf.py#L78-L91)
- Inert meter feed: [`hqptuner/config.py:70`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L70)

#### Prerequisites and impact

Prerequisite: Network reach. Brief stalls of the poll loop and API, and temporary disk or memory use.

#### Severity and confidence rationale

Medium confidence: the refuter checked route by route and confirmed the list above, but real impact needs measurement. VA is L for brief stalls.

#### Recommended remediation

Cap staged size and audit `limit`, and run the blocking walks in a thread.

#### Uncertainty and verification limits

Not run or measured. [FastAPI's docs](https://fastapi.tiangolo.com/async/) say plain `def` routes run in a threadpool; that they don't state where `async def` runs is a gap the event-loop wording fills from general framework behavior.

### F-019 · Whitespace in staged values makes profile and pipeline regexes quadratic on the event loop

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-1333: Inefficient Regular Expression Complexity |
| CVSS 4.0 | CVSS-B 8.7 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Four patterns begin `\n?[ \t]*` with no literal prefix, so the engine tries every byte of a space run and each try scans to the run's end. `apply_edits` writes staged fields before the profile verbs, so a title of spaces plus a staged `matrix_profile_delete` puts the run into the XML that `_profile_re` searches. Nothing limits a staged title's length and spaces pass every check. `apply_edits` runs synchronously inside the async restore path. The pipeline, post-process and fixed-volume patterns run before the pass places its values, so they need the run in the snapshot from an earlier apply or preset.

#### Evidence

- The patterns: [`hqptuner/conf/matrixprofiles.py:49-60`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixprofiles.py#L49-L60), [`hqptuner/conf/matrixconf.py:140`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixconf.py#L140), [`hqptuner/conf/matrixconf.py:177`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixconf.py#L177), [`hqptuner/conf/fixedvol.py:27`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/fixedvol.py#L27)
- The search: [`hqptuner/conf/matrixprofiles.py:130-140`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixprofiles.py#L130-L140)
- Ordering: [`hqptuner/conf/presetconf.py:283-298`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L283-L298)

#### Prerequisites and impact

Prerequisite: Network reach, working 8088 credentials. HQPTuner stops answering until the search finishes or the process is killed. The hang comes before the restore POST, so the daemon isn't affected.

#### Severity and confidence rationale

Medium confidence: this is from reading the patterns. A 1 MiB run implies roughly 5e11 byte comparisons by the refuter's estimate, but nothing was timed. VA is H because HQPTuner stops answering until the search ends or it's killed. The daemon isn't affected.

#### Recommended remediation

Cap staged value length and anchor the patterns on a literal.

#### Uncertainty and verification limits

Not run or measured under the source-only rule. It assumes CPython's regex engine has no search optimization for this shape, which I couldn't confirm from documentation.

### F-020 · Discovery trusts spoofed UDP replies and parses them with the stdlib XML parser on the event loop

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | Medium |
| CWE | CWE-940: Improper Verification of Source of a Communication Channel |
| CVSS 4.0 | CVSS-B 2.3 (Low), `CVSS:4.0/AV:A/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:L/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The discovery socket is unconnected, so any sender that learns the ephemeral port can answer, and the multicast request shows that port to group members. A sender becomes a listed daemon with no check beyond the `discover` root tag, and HQPTuner dials each sender on 4321 to describe it. `_collect` stores replies with no count or size cap and awaits only when the socket is empty, so a steady stream holds the event loop until the deadline, about 3 s. Parsing then runs synchronously over everything stored with `ElementTree`, while 4321 frames use `defusedxml`. `GET /api/discover` is open, so any peer can trigger a sweep. A bridged container's multicast reaches nobody, per the code's own comment.

#### Evidence

- Parsing: [`hqptuner/engine/discovery.py:74-86`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L74-L86)
- Sequential dial: [`hqptuner/engine/discovery.py:116-123`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L116-L123)
- The collect loop: [`hqptuner/engine/discovery.py:171-179`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L171-L179)
- The sweep and the container note: [`hqptuner/engine/discovery.py:206-236`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L206-L236)
- `defusedxml` elsewhere: [`hqptuner/engine/frames.py:11-12`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/frames.py#L11-L12)
- The open route: [`hqptuner/api/routes/discovery.py:16-29`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/discovery.py#L16-L29)

#### Prerequisites and impact

Prerequisite: A LAN peer that learns the sweep's port; desktop, deb or host-network installs. Event-loop stalls that any peer can repeat, and outbound dials aimed by forged sender addresses. It also feeds F-021. Parser impact is bounded by the 64 KiB datagram size and by the installed Expat.

#### Severity and confidence rationale

Medium confidence. The socket and parser behavior is certain. [Python's XML docs](https://docs.python.org/3/library/xml.html) say Expat below 2.7.2 may be vulnerable to billion laughs and quadratic blowup and that the version depends on the build, so entity impact can't be settled. AV is A for the multicast segment, and AT is P because the attacker must learn the port and the install can't be a bridged container.

#### Recommended remediation

Use `defusedxml` here too, cap the reply count and yield while reading.

#### Uncertainty and verification limits

Not run. The installed Expat version is unknown. The agents recalled that an unknown XML encoding raises something other than `ParseError`, which would produce a 500; I didn't confirm that.

### F-021 · A LAN discovery impostor can fill the host field, then receive the stored password's Digest response and supply a phishing link

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-940: Improper Verification of Source of a Communication Channel |
| CVSS 4.0 | CVSS-B 7.0 (High), `CVSS:4.0/AV:A/AC:L/AT:P/PR:N/UI:A/VC:H/VI:L/VA:L/SC:H/SI:L/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The connection panel overwrites the host field when exactly one daemon answers discovery, with no notice beyond the changed value. The panel opens by itself when the daemon is unreachable or credentials are refused, which is the moment the real daemon isn't answering. A blank password field omits the key, so pressing Connect or Save keeps the stored password and dials the impostor (F-004). The panel's "port 8088" link is built from the same field, and its copy tells the user to set credentials there. Nothing is saved until the user submits, and the scheme is fixed to `http://`, so this isn't a script URL.

#### Evidence

- The fill: [`hqptuner/static/store/setup.js:108-111`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L108-L111), [`hqptuner/static/store/setup.js:208-215`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L208-L215)
- The auto-open: [`hqptuner/static/store/setup.js:141-161`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L141-L161)
- The omitted password: [`hqptuner/static/store/setup.js:270-275`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L270-L275)
- The link and its copy: [`hqptuner/static/components/Setup.js:118-124`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/Setup.js#L118-L124), [`hqptuner/static/components/Setup.js:189-192`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/Setup.js#L189-L192)
- The sender becomes the address: [`hqptuner/engine/discovery.py:77-86`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L77-L86)

#### Prerequisites and impact

Prerequisite: Same LAN segment, the impostor is the only responder, and a user presses Connect or Save. HQPTuner gets retargeted to a rogue daemon and hands over a Digest response that can be attacked offline. A password typed at the linked page goes straight to the attacker.

#### Severity and confidence rationale

Medium confidence. The trace is firm but it needs several things to line up, including a user who doesn't notice the new address. UI is A because the user presses Connect or Save. AT is P because the impostor must be the only responder. VC and SC are H for the management password.

#### Recommended remediation

Don't overwrite the field silently: list discovered daemons and make the user choose. Require the password again when the host changes (F-004).

#### Uncertainty and verification limits

Not run. `HQPTUNER_HQP_HOST` pins the dialed host, though the link still follows the field. A bridged container shouldn't see LAN impostors.

### F-022 · Startup adopts whoever answers host.docker.internal on an unconfigured install

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | Medium |
| CWE | CWE-923: Improper Restriction of Communication Channel to Intended Endpoints |
| CVSS 4.0 | CVSS-B 2.3 (Low), `CVSS:4.0/AV:A/AC:L/AT:P/PR:N/UI:N/VC:L/VI:L/VA:L/SC:L/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

With no saved record and no pinned host, `_adopt_alias` runs at every start with no container check. It probes the alias name, accepts any reply that parses as XML, sets the host and rebuilds the Digest client. Where no host mapping pins it, that name goes to the ordinary resolver, which covers installs outside Docker and a container started without compose's `extra_hosts`. The config comment says it resolves only inside a container, which the code doesn't enforce. A corrupt connection file also counts as no record. The shipped compose pins the alias, so that deployment isn't exposed.

#### Evidence

- The adoption: [`hqptuner/api/lifespan.py:27-50`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/lifespan.py#L27-L50), [`hqptuner/api/lifespan.py:80`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/lifespan.py#L80)
- The condition: [`hqptuner/core/connection.py:125-131`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L125-L131)
- The probe: [`hqptuner/engine/discovery.py:127-150`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L127-L150)
- The comment: [`hqptuner/config.py:141-145`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L141-L145)
- The compose pin: [`compose.yaml:23-24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L23-L24)

#### Prerequisites and impact

Prerequisite: No saved or pinned host, no host mapping for that name, and control of its resolution. A silent move onto a rogue daemon at each start until a host is saved. A pinned password gets exposed as a Digest response, and hostile data flows into the app and preset store.

#### Severity and confidence rationale

Medium confidence: the code path is certain, and whether an attacker can answer that name depends on the local network and resolver. AV is A and AT is P because the attacker must control that name's resolution on the local network.

#### Recommended remediation

Run the alias probe only when the app knows it's in a container, and ask the user before adopting a host.

#### Uncertainty and verification limits

Not run. Resolver behavior for that name outside a container varies by OS.

### F-023 · connection.json holds the password in plaintext with the default file mode

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-256: Plaintext Storage of a Password |
| CVSS 4.0 | CVSS-B 5.7 (Medium), `CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:N/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

With `remember` true, the password goes to disk as plain JSON through `write_text` to a fixed temp name and then `replace`. A search of the package and packaging found no `chmod`, `umask`, `0o600`, `O_NOFOLLOW` or `mkstemp`. The Docker layout bind-mounts `./state` from a plain `mkdir -p`, and removal keeps data by default. An unauthenticated POST with `remember:true` writes a password that was only in memory, including one from the environment (F-004).

#### Evidence

- The write: [`hqptuner/core/connection.py:106-117`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L106-L117)
- A fresh panel starts on no: [`hqptuner/api/routes/connection.py:84-91`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L84-L91), [`hqptuner/static/store/setup.js:235-240`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L235-L240)
- The Docker layout: [`compose.yaml:36-37`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L36-L37), [`README.md:131-135`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L131-L135)
- Data kept on removal: [`packaging/linux/deb/postrm:8-17`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/deb/postrm#L8-L17), [`README.md:184`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L184)
- The Linux package's state directory: [`packaging/linux/hqptuner.service:10-12`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/hqptuner.service#L10-L12)

#### Prerequisites and impact

Prerequisite: `remember` on, and a second local account on a Docker or from-clone host. Other local users on a Docker or from-clone host can read the daemon's management password if the path allows traversal. Remote read isn't available, because the export blanks it (F-008).

#### Severity and confidence rationale

High confidence for the missing restriction. Exposure varies by deployment. The deb and rpm are protected: [systemd's docs](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) say `DynamicUser` puts `StateDirectory` under `/var/lib/private`, which is inaccessible to unprivileged users. AT is P because it depends on umask, path traversal and `remember` being on.

#### Recommended remediation

Create the file with mode 0600 using `os.open`, and say in the UI that the password is stored unencrypted.

#### Uncertainty and verification limits

Not run. Actual readability depends on umask and on whether other users can traverse the host path. Windows and macOS profile directories are normally closed to other users, which I didn't confirm from documentation.

### F-024 · The management password crosses the LAN in cleartext between browser and HQPTuner

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-319: Cleartext Transmission of Sensitive Information |
| CVSS 4.0 | CVSS-B 5.9 (Medium), `CVSS:4.0/AV:A/AC:L/AT:P/PR:N/UI:P/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

A password typed into the connection panel goes in a plain JSON body over the page's own HTTP origin. Neither uvicorn entry point passes TLS options, the repo ships no TLS proxy, and a browser on another host is a supported case since the packaged builds bind all interfaces. Digest protects only the HQPTuner-to-daemon leg. The password crosses only when someone types one, because a blank field omits the key.

#### Evidence

- The panel and the body: [`hqptuner/static/store/setup.js:270-275`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L270-L275), [`hqptuner/static/lib/api.js:169-176`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/lib/api.js#L169-L176)
- The repo's own note about plain HTTP: [`hqptuner/static/components/system/LogTail.js:33-35`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/system/LogTail.js#L33-L35)
- No TLS options: [`hqptuner/__main__.py:38-45`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/__main__.py#L38-L45), [`hqptuner/desktop.py:207-209`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L207-L209)
- Other hosts are supported: [`README.md:238`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L238)
- The Digest client: [`hqptuner/conf/httpconf.py:164-167`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/httpconf.py#L164-L167)

#### Prerequisites and impact

Prerequisite: A browser on another host over plain HTTP, and an observer on that path. Anyone observing that LAN segment, such as on shared Wi-Fi, gets the daemon's management password at the moment it's set.

#### Severity and confidence rationale

High confidence in the path. Severity depends on the deployment, and an operator's own TLS proxy removes the exposure. AT is P for the observer's position on the path, and UI is P because someone has to type the password.

#### Recommended remediation

Offer TLS, or document a reverse proxy and warn in the panel when the page isn't a secure context.

#### Uncertainty and verification limits

Not run. Assumes no TLS-terminating proxy, which matches the default deployment.

### F-025 · Licensee name, license fingerprint, playback metadata and the daemon log are served to anyone

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-200: Exposure of Sensitive Information to an Unauthorized Actor |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`/api/health` passes `GetLicense` attributes through unfiltered, including name and fingerprint. `/api/status` passes all metadata attributes through, and the protocol notes list `uri` among them. `/api/log` returns the log lines plus the configured log path. All three take only `Mgr` or `Static`. The daemon leaves 4321 and `/log` unauthenticated itself, so HQPTuner widens who can reach this data and isn't bypassing a daemon gate.

#### Evidence

- The routes: [`hqptuner/api/routes/status.py:73-92`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L73-L92), [`hqptuner/api/routes/status.py:111-144`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L111-L144), [`hqptuner/api/routes/status.py:181-194`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L181-L194)
- The attributes: [`hqptuner/engine/control.py:228-230`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L228-L230), [`hqptuner/engine/control.py:270-278`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L270-L278)
- The daemon's own exposure: [`docs/protocol.md:42`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L42), [`docs/protocol.md:207`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/protocol.md#L207), [`hqptuner/engine/logtail.py:6`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/logtail.py#L6)

#### Prerequisites and impact

Prerequisite: Network reach or rebinding. A peer learns a personal name, a license identifier, listening activity and local paths.

#### Severity and confidence rationale

High confidence in the passthrough. It adds the most where a peer can reach HQPTuner but not the daemon's own ports. VC is L for a name, a license identifier, listening activity and local paths.

#### Recommended remediation

Drop `name` and `fingerprint` from `/api/health` unless the UI needs them, and gate the rest behind F-001's authentication.

#### Uncertainty and verification limits

Not run. Whether a `uri` can carry a streaming token depends on the daemon and source player, and how sensitive the fingerprint is isn't something I could establish.

### F-026 · Preset names on the Windows build can leave the store or hit NTFS streams and device names

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-22: Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal') |
| CVSS 4.0 | CVSS-B 6.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:L/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The preset name check refuses separators and `..` but not colons or reserved names, and there's no resolve-and-contain check. The filter upload rule does refuse colons. On Windows, joining the store path with `D:foo.xml` takes the new drive, so `POST /api/profile/save`, `GET /api/preset/{name}` and `DELETE /api/preset/{name}` act on an `.xml` in that drive's current directory. `foo:bar.xml` targets a stream that `names()` never lists, and `NUL` becomes `NUL.xml`. Migration carries the same reach through a daemon member named `data/cfgs/D:evil.xml`. The suffix is always `.xml`, separators stay refused, and a save writes the daemon's config XML. POSIX installs aren't affected. Live snapshots are JSON keys, so they aren't affected either.

#### Evidence

- The name rule: [`hqptuner/presets/names.py:80-88`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/names.py#L80-L88)
- The join: [`hqptuner/presets/store/presets.py:164-165`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/presets.py#L164-L165)
- Save, read and delete: [`hqptuner/presets/store/presets.py:224-258`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/presets.py#L224-L258)
- The filter rule's colon refusal: [`hqptuner/presets/store/filterpark.py:35`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L35)
- Windows binds all interfaces: [`packaging/windows/hqptuner.iss:44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/hqptuner.iss#L44)

#### Prerequisites and impact

Prerequisite: Windows build and network reach; a second drive for the re-root. Limited write, read and delete of `.xml` files in another drive's current directory, plus hidden store data. No directory climbing.

#### Severity and confidence rationale

Medium confidence: nothing was run on Windows. [Python's pathlib docs](https://docs.python.org/3/library/pathlib.html) show `PureWindowsPath('c:/Windows', 'd:bar')` becoming `d:bar`. [Microsoft's naming page](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file) says `C:tmp.txt` is relative to that drive's current directory, lists the colon as reserved, and says `NUL.txt` is equivalent to `NUL`. AT is P for Windows and a second drive. Impacts are L because only `.xml` files in that drive's current directory are reached.

#### Recommended remediation

Refuse colons and reserved names in the shared rule, and check that the resolved path stays inside the store.

#### Uncertainty and verification limits

Not run on Windows, and the repo says its Windows daemon details are unconfirmed at [`docs/settings-classification.md:36`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/settings-classification.md#L36). A reserved name with an extension may behave differently on recent Windows versions.

### F-027 · No browser security headers, one-click engine actions in a frameable page, and API docs that load CDN scripts

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | Medium |
| CWE | CWE-1021: Improper Restriction of Rendered UI Layers or Frames |
| CVSS 4.0 | CVSS-B 2.1 (Low), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:A/VC:N/VI:L/VA:L/SC:N/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

No CSP, `X-Frame-Options`, `frame-ancestors` or `nosniff` is set, and the page has no frame-busting code. The `index.html` comment saying "CSP-clean" describes local assets, and no policy is declared. A hostile site can frame the SPA and bait clicks: Rescan and hardware apply call their APIs directly with no confirmation, the hardware apply button stays clickable even when nothing changed, and LIVE controls write as soon as they change. Preset delete and overwrite do confirm. A click inside the frame runs the SPA's own same-origin fetch, so it also reaches JSON routes. FastAPI's default `/docs`, `/redoc` and `/openapi.json` are live with no auth.

#### Evidence

- No header code: [`hqptuner/api/spa.py:20-24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/spa.py#L20-L24), [`hqptuner/api/factory.py:65`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65)
- The comment: [`hqptuner/static/index.html:54`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/index.html#L54)
- Direct actions: [`hqptuner/static/components/widgets/Field.js:62-69`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/widgets/Field.js#L62-L69), [`hqptuner/static/components/system/SystemHardware.js:181-189`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/system/SystemHardware.js#L181-L189), [`hqptuner/static/store/live/write.js:70-74`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/live/write.js#L70-L74)

#### Prerequisites and impact

Prerequisite: A browser that renders the cross-site frame, or a user opening /docs. Playback interruption or a daemon restart using values already on the page, which is less than F-002 reaches directly. A visit to `/docs` runs third-party JavaScript with same-origin access to every route. I found no script-injection sink in the SPA, so the missing CSP is defense in depth.

#### Severity and confidence rationale

High confidence that the protections are absent. [FastAPI's docs](https://fastapi.tiangolo.com/how-to/custom-docs-ui-assets/) say the default docs pages load their files from a CDN. Medium overall because browser policy may restrict framing a private address, and the attacker can't choose form values without baiting more input. UI is A for the baited click, and AT is P for browser policy on framing a private address.

#### Recommended remediation

Send `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and a CSP, and disable `/docs` and `/redoc` in packaged builds.

#### Uncertainty and verification limits

Not run. Partitioned localStorage in a framed page can change the layout an overlay has to match.

### F-028 · The single-instance probe trusts any local process that answers with app_version

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | High |
| CWE | CWE-290: Authentication Bypass by Spoofing |
| CVSS 4.0 | CVSS-B 1.0 (Low), `CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

On macOS and Windows the launcher runs a regex over the `/api/health` response and treats a match on `app_version` as HQPTuner, ignoring status code and any other identity. It then opens the user's browser on that address and exits. A process holding the port controls what the browser shows at the address the user trusts.

#### Evidence

- The regex: [`hqptuner/desktop.py:49`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L49)
- The check: [`hqptuner/desktop.py:161-173`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L161-L173)
- The launch: [`hqptuner/desktop.py:304-314`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L304-L314)

#### Prerequisites and impact

Prerequisite: Code already running on the machine that holds port 8090 first. Local credential phishing, by an attacker who already has local code execution as some user.

#### Severity and confidence rationale

High confidence in the code. The impact is small because of the prerequisite. AV is L and PR is L because the attacker already runs code on the machine. AT is P for holding the port first.

#### Recommended remediation

Make the instance check prove identity, such as a lock file plus a per-install token in the health response.

#### Uncertainty and verification limits

Not run. Applies only to the macOS and Windows desktop shell.

### F-029 · Apply lanes aren't serialized, and the shared pending buffer is cleared blind

| Assessment | |
| :--- | :--- |
| Severity | Defect |
| Confidence | Medium |
| CWE | CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization ('Race Condition') |
| CVSS 4.0 | Not scored; this is a defect |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Only the 4321 socket has a lock. Applies, preset loads and restores hold many awaits across the daemon's restart, so they can interleave. `POST /api/config/apply` calls `store.clear()` afterward with no comparison against its snapshot, so edits staged during the apply are discarded with no audit record. The filter park has the same pattern. Two concurrent applies each build from their own backup, so the second overwrites the first. The buffer is one app-wide object, so one client's field applies under another's press.

#### Evidence

- The only lock: [`hqptuner/engine/control.py:113`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L113)
- The clear: [`hqptuner/api/routes/apply.py:115-123`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/apply.py#L115-L123)
- The shared buffer: [`hqptuner/api/routes/pending.py:73-76`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L73-L76)
- The lanes: [`hqptuner/lanes/http/restore.py:218-224`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L218-L224), [`hqptuner/presets/presetlane.py:152-161`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetlane.py#L152-L161)
- The park clear: [`hqptuner/presets/presetops.py:104-106`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetops.py#L104-L106)

#### Prerequisites and impact

Prerequisite: Two browsers or a deliberate client. Silently lost edits, an unconverged or misleading apply report, and extra restarts.

#### Severity and confidence rationale

High confidence in the code. Medium overall because which interleavings corrupt state depends on daemon timing that wasn't exercised. Defect, because this loses edits under ordinary concurrent use and gives an attacker nothing F-001 doesn't already.

#### Recommended remediation

Serialize the write lanes with one lock, and clear only the fields the apply took.

#### Uncertainty and verification limits

Not run.

### F-030 · The pre-apply safety copy is a single slot that later passes overwrite, and nothing rolls back

| Assessment | |
| :--- | :--- |
| Severity | Defect |
| Confidence | High |
| CWE | Not assigned |
| CVSS 4.0 | Not scored; this is a defect |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`_write_backup` always targets `pre-apply-settings.zip`, and each restore pass fetches a fresh backup and writes it there first, so pass 2 replaces the pre-apply copy with pass 1's result. Preset load and engine apply write the same slot. The bytes are persisted before they're validated as an archive, so a non-zip body or an empty backup also replaces a good copy. Unconverged outcomes only return a report, and no path pushes the saved copy back.

#### Evidence

- The slot: [`hqptuner/presets/presetops.py:272-288`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetops.py#L272-L288)
- Per-pass write: [`hqptuner/lanes/http/restore.py:218-224`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L218-L224), [`hqptuner/lanes/http/restore.py:305-306`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L305-L306)
- The outcome: [`hqptuner/lanes/http/restore.py:259-263`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/http/restore.py#L259-L263)

#### Prerequisites and impact

Prerequisite: A pushed config the daemon serves but doesn't converge on, or any later apply. The recovery file may hold the broken config when the owner needs it, which makes F-006 and F-013 worse.

#### Severity and confidence rationale

High confidence, since the file name is fixed and the order is direct. Defect, because this is a recovery gap that nobody exploits on its own, though it makes F-006 and F-013 worse.

#### Recommended remediation

Write the copy once per apply, keep a few dated copies, and validate before replacing one.

#### Uncertainty and verification limits

Not run.

### F-031 · JSON and preset stores write in place, so a torn file can leave the app refusing a store

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-362: Concurrent Execution using Shared Resource with Improper Synchronization ('Race Condition') |
| CVSS 4.0 | CVSS-B 6.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:L/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The JSON stores and preset files use `write_text` or `write_bytes` in place, with no lock and no temp-and-rename. Plain `def` routes run in the threadpool, so two writers can interleave and leave stray trailing bytes. `read_stamped` turns unparseable bytes into `StoreCorruptError`, and writes read first, so the API can't repair the store and it takes a disk edit. The connection store does use temp-and-rename. Preset XML files are read as bytes, so a torn one doesn't raise that error, though `store.json` and `active.json` do.

#### Evidence

- In-place writes: [`hqptuner/presets/store/presets.py:241`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/presets.py#L241), [`hqptuner/presets/store/presets.py:275`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/presets.py#L275), [`hqptuner/presets/store/favorites.py:171-173`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/favorites.py#L171-L173), [`hqptuner/presets/store/live.py:255-258`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/live.py#L255-L258)
- The refusal: [`hqptuner/presets/store/jsonfile.py:61-68`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/jsonfile.py#L61-L68)
- A threadpool route: [`hqptuner/api/routes/pending.py:160-167`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L160-L167)
- The one store that renames: [`hqptuner/core/connection.py:113-117`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L113-L117)

#### Prerequisites and impact

Prerequisite: Concurrent writes, or a process kill during a write. A store's routes refuse until someone fixes the file on disk, and a preset can be truncated by a crash. Read-modify-write races also lose updates.

#### Severity and confidence rationale

High confidence that writes aren't atomic. [Python's docs](https://docs.python.org/3/library/pathlib.html) say these methods overwrite an existing file, and [FastAPI's docs](https://fastapi.tiangolo.com/async/) say `def` routes run in a threadpool. Medium for corruption, because the race window is small. AT is P because it's a race. Impacts are L because the result is one store refusing until a disk edit.

#### Recommended remediation

Move the temp-and-rename from the connection store into one shared write helper, and add a lock around read-modify-write.

#### Uncertainty and verification limits

Not run. The docs don't name the open mode, so truncation at open comes from general Python behavior.

### F-032 · Descriptions merged from an uploaded archive skip the write route's limits

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-20: Improper Input Validation |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:L/VA:L/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`merge()` passes entries through `_clean_entry`, which checks types only, so the 2000-character text limit, the control-character refusal and the 128-character name limit are all skipped, and `GET /api/descriptions` then serves the result. The module's own docstring says control characters are refused because they corrupt the archive. The 256-profile ceiling does hold, so entry count is bounded and entry size isn't. The merge happens before the restore is posted, so it stands even if the restore fails.

#### Evidence

- The merge: [`hqptuner/presets/store/descriptions.py:293-309`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L293-L309)
- The type-only check: [`hqptuner/presets/store/descriptions.py:196-208`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L196-L208)
- The ceiling: [`hqptuner/presets/store/descriptions.py:264-271`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L264-L271)
- The route: [`hqptuner/api/routes/config.py:334-341`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L334-L341)
- The write route and its limits: [`hqptuner/api/routes/descriptions.py:48-55`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/descriptions.py#L48-L55), [`hqptuner/presets/store/descriptions.py:165-188`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L165-L188), [`hqptuner/presets/store/descriptions.py:284-285`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L284-L285)

#### Prerequisites and impact

Prerequisite: Network reach; the restore need not succeed. A persistent large payload on every page load and bloat in later backups. No script execution, because the SPA renders these as text.

#### Severity and confidence rationale

High confidence, by direct reading. Impacts are L: stored data bypasses limits and bloats pages, with no script execution.

#### Recommended remediation

Run merged entries through the same validator as the PUT route.

#### Uncertainty and verification limits

Not run.

### F-033 · A rogue daemon's strings can stall the SPA or, with some settings on, crash its render

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | Low |
| CWE | CWE-1333: Inefficient Regular Expression Complexity |
| CVSS 4.0 | CVSS-B 2.3 (Low), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Two availability issues from data a daemon supplies. A filter description reaches `FOCUS_RE`, which has three adjacent spans that can all match spaces, so a value like `1/5` plus a long space run with no arrow backtracks badly. That works on default settings, and the 4 MiB response cap leaves plenty of room. Separately, plain-object lookups keyed by daemon strings can return inherited members for names like `constructor`, and `simplified(e.leaf)` then calls `.replace` on undefined and throws in `Field`'s render path. The app has no error boundary. That throw needs the Simplified option style, which is off by default. The same kind of lookup throws in `narrowOptions` during field rendering when genre or focus narrowing is engaged, because `f.genre.includes` runs on an inherited member. A form label such as `constructor` that's absent from the enumeration triggers it, and any client can engage that narrowing through `PUT /api/narrowing`. I found no throw on default settings.

#### Evidence

- The regex and its input: [`hqptuner/static/store/narrow/facets.js:80`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/narrow/facets.js#L80), [`hqptuner/static/store/narrow/facets.js:306`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/narrow/facets.js#L306)
- The lookup: [`hqptuner/static/store/plainnames.js:115-129`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/plainnames.js#L115-L129), [`hqptuner/static/store/plainnames.js:41`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/plainnames.js#L41)
- The default: [`hqptuner/static/store/ui/prefs.js:105`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/ui/prefs.js#L105)
- The narrowing path: [`hqptuner/static/components/widgets/Field.js:161`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/components/widgets/Field.js#L161), [`hqptuner/static/store/narrow/match.js:125-135`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/narrow/match.js#L125-L135), [`hqptuner/static/store/narrow/match.js:219-220`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/narrow/match.js#L219-L220), [`hqptuner/presets/store/narrowing.py:158-161`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/narrowing.py#L158-L161)
- The response cap: [`hqptuner/engine/control.py:215-216`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L215-L216)

#### Prerequisites and impact

Prerequisite: HQPTuner connected to a rogue or impersonated daemon. The SPA stops rendering or the tab hangs until the rogue input goes away. No persistence beyond a stored process string, no disclosure and no code execution.

#### Severity and confidence rationale

Low confidence, because this is read and not run: nothing measured the stall time, and it assumes V8's backtracking behavior. AT is P because HQPTuner has to be talking to a rogue daemon, and UI is P because the effect is in the user's tab.

#### Recommended remediation

Use `Object.hasOwn` or a `Map` for these lookups, rewrite `FOCUS_RE` without adjacent whitespace spans, and add an error boundary.

#### Uncertainty and verification limits

Not run. The stage-type variant the review agent raised ends in the unreviewed `eqlab` submodule, so it's under open questions.

### F-034 · Unpinned build inputs run in the same job as the Apple signing key and notary key

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | Medium |
| CWE | CWE-829: Inclusion of Functionality from Untrusted Control Sphere |
| CVSS 4.0 | CVSS-B 9.4 (Critical), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:H/SI:H/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`build-macos` pipes the astral.sh installer into `sh` with no checksum, then runs `uv pip install . pyinstaller` with no lockfile or hashes, in the same job as the Developer ID certificate and the App Store Connect key. Installing before the import step gives no isolation, for two reasons. Code at install can append to `$GITHUB_PATH` and shadow `security` or `openssl` in the import step, which holds the p12, its password and the notary key. And after the import, `package-macos.sh` runs `.venv/bin/python` and PyInstaller while `notary.p8` and `certificate.p12` sit in `RUNNER_TEMP` and the keychain is unlocked, until cleanup at the end. A `.pth` file in the venv runs each time that Python starts. The certificate password is scoped to the import step, which narrows the second path without closing it.

#### Evidence

- Installer and install: [`.github/workflows/release.yml:191-196`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L191-L196)
- Secret import: [`.github/workflows/release.yml:200-222`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L200-L222)
- Packaging and cleanup: [`.github/workflows/release.yml:224-233`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L224-L233)
- Python runs under the secrets: [`scripts/package-macos.sh:25`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/package-macos.sh#L25), [`scripts/package-macos.sh:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/package-macos.sh#L52), [`scripts/package-macos.sh:86`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/package-macos.sh#L86)
- Unpinned dependencies and backend: [`pyproject.toml:6-16`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L6-L16), [`pyproject.toml:307-309`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L307-L309)

#### Prerequisites and impact

Prerequisite: Compromise of one upstream: a PyPI package, PyInstaller, or the astral.sh installer. If an upstream is compromised, the App Store Connect key and the Developer ID private key can be stolen, or the job can sign and notarize arbitrary binaries as the owner.

#### Severity and confidence rationale

High confidence in the exposure. Medium overall because it needs an upstream compromise. [GitHub's docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) say `GITHUB_PATH` applies to later steps in the job, and [Python's `site` docs](https://docs.python.org/3/library/site.html) say `import` lines in `.pth` files run at startup. AT is P for the upstream compromise. The vulnerable system is the build job, and the subsequent systems are Apple's notary account and whoever runs a binary signed as the owner.

#### Recommended remediation

Build in a job with no secrets using a hash-locked install, and sign in a separate job that downloads the artifact and runs no build code, as `package-windows` already mostly does.

#### Uncertainty and verification limits

Not run. `BASH_ENV` and the macOS keychain behavior the review agent described (`-A` and the partition list) weren't confirmed, so I don't rely on them here and they're under open questions.

### F-035 · Apple secrets sit outside the signing environment, and both signing jobs run on ungated dev pushes

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-284: Improper Access Control |
| CVSS 4.0 | CVSS-B 8.5 (High), `CVSS:4.0/AV:N/AC:L/AT:N/PR:H/UI:N/VC:H/VI:H/VA:N/SC:N/SI:L/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`build-macos` reads the Apple secrets and names no `environment`, unlike `package-windows`, which names `signing`. It fails hard when the certificate is empty, so a working pipeline implies those secrets are repository or organization level. A push to `dev` touching packaging paths starts the workflow, and `check` runs only on tags, so neither signing job waits for `make check`. Signed output from an unchecked commit is uploaded as artifacts.

#### Evidence

- Triggers: [`.github/workflows/release.yml:3-14`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L3-L14)
- `check` is tag-only: [`.github/workflows/release.yml:20-24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L20-L24)
- `build-macos` and its secrets: [`.github/workflows/release.yml:175-186`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L175-L186), [`.github/workflows/release.yml:202-204`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L202-L204)
- `package-windows` and its environment: [`.github/workflows/release.yml:314-318`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L314-L318)
- The uploads: [`.github/workflows/release.yml:235-239`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L235-L239), [`.github/workflows/release.yml:345-349`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L345-L349)

#### Prerequisites and impact

Prerequisite: Write access to any branch or a token with workflow scope; ordinary dev pushes for the unchecked artifacts. A workflow edit pushed to any branch by someone with write access can read the Apple material, with no environment rule in the way. Binaries signed as the owner exist for commits that never passed the gate.

#### Severity and confidence rationale

High confidence in the workflow logic. Secret placement is inferred, so Medium overall. [GitHub's docs](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) say environment secrets are available only to jobs that use the environment, and required reviewers gate them. PR is H because it takes write access to the repository.

#### Recommended remediation

Move the Apple secrets into the `signing` environment with a branch rule, and add `needs: check` to both signing jobs.

#### Uncertainty and verification limits

Not checked. GitHub settings aren't in source: `signing`'s protection rules could pause `package-windows` on dev. I didn't confirm from documentation who can download artifacts on a public repository.

### F-036 · docker.yml passes packages:write to the check job that runs unpinned dev dependencies

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-250: Execution with Unnecessary Privileges |
| CVSS 4.0 | CVSS-B 6.9 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:N/VI:L/VA:N/SC:N/SI:H/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`docker.yml` grants `packages: write` at workflow level and calls `check.yml` with no job-level override, and `check.yml` declares no `permissions` of its own. Its jobs check out with default credential persistence, then run `pip install -e ".[dev]"` from unpinned names and `make check`. Code in any of those could use the token to push to `ghcr.io/ohshitgorillas/hqptuner` under a tag this run doesn't rewrite. The check job doesn't receive `DOCKERHUB_TOKEN`, since there's no `secrets: inherit`, and fork pull requests don't get this token.

#### Evidence

- The grant and the call: [`.github/workflows/docker.yml:9-11`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L9-L11), [`.github/workflows/docker.yml:17-18`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L17-L18)
- The check job: [`.github/workflows/check.yml:12-21`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/check.yml#L12-L21), [`.github/workflows/check.yml:36-41`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/check.yml#L36-L41), [`.github/workflows/check.yml:47-48`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/check.yml#L47-L48)
- Unpinned dev extras: [`pyproject.toml:19-54`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L19-L54)
- GHCR as a mirror, and Watchtower: [`README.md:162`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L162), [`README.md:166`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L166)

#### Prerequisites and impact

Prerequisite: A compromised dev dependency during a push to main, beta, a tag, or a dispatch run. A poisoned image could be published to GHCR without the Docker Hub token, which reaches auto-updating users.

#### Severity and confidence rationale

Medium confidence. [`actions/checkout`](https://github.com/actions/checkout) documents `persist-credentials` defaulting to true, and [GitHub's reusable workflow docs](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) say permissions can only be maintained or reduced through the chain. They don't spell out the no-`permissions` case, and that this token has write access to the package is inferred from the push in the same workflow. AT is P for the compromised dev dependency, and SI is H for a poisoned image reaching GHCR users.

#### Recommended remediation

Set `permissions: contents: read` on the `check` call, or at the top of `check.yml`. Grant `packages: write` only to the job that builds and pushes.

#### Uncertainty and verification limits

Not run. The second path the review agent raised, poisoning the shared `type=gha` build cache to reach Docker Hub, isn't part of this finding and is under open questions.

### F-037 · Published artifacts contain what PyPI and base images serve at build time

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | High |
| CWE | CWE-1357: Reliance on Insufficiently Trustworthy Component |
| CVSS 4.0 | CVSS-B 7.7 (High), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The tree has no Python lockfile, requirements or constraints file, and runtime dependencies have no version bounds. The image builds from a mutable `python:3.12-slim` with its own `pip install .`, while CI tests on 3.14 from its own resolution. Each release job resolves separately and then signs, and on Windows `build-windows` also runs `irm | iex` with no checksum. Smoke and lifecycle jobs do install and run the exact built packages, though those are health-level checks and the image gets no post-build test.

#### Evidence

- Unbounded dependencies: [`pyproject.toml:6-16`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L6-L16)
- The image: [`Dockerfile:1`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Dockerfile#L1), [`Dockerfile:10`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Dockerfile#L10)
- CI's Python: [`.github/workflows/check.yml:25-27`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/check.yml#L25-L27)
- Release resolutions: [`.github/workflows/release.yml:49-50`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L49-L50), [`.github/workflows/release.yml:195-196`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L195-L196), [`.github/workflows/release.yml:297-303`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L297-L303)
- Smoke jobs: [`.github/workflows/release.yml:75-134`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L75-L134)

#### Prerequisites and impact

Prerequisite: A compromised or vulnerable upstream release at build time. A hostile upstream release ships in the image, deb, rpm, dmg and signed Windows installer. A vulnerable version can ship silently, and a release can't be reproduced.

#### Severity and confidence rationale

High confidence, since the absence is checkable in the tree. AT is P for the compromised upstream, and UI is P because a user has to install the release.

#### Recommended remediation

Commit a hash-pinned lockfile, install from it in CI and every build job, and pin base images by digest.

#### Uncertainty and verification limits

I didn't examine which versions any published artifact actually contains.

### F-038 · The SimplySign installer runs unverified in the step holding the TOTP seed

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | Medium |
| CWE | CWE-494: Download of Code Without Integrity Check |
| CVSS 4.0 | CVSS-B 9.0 (Critical), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:N/VA:N/SC:H/SI:H/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The MSI comes from a version-pinned HTTPS URL and goes straight to `msiexec` with no hash or signature check. `SIMPLYSIGN_OTPAUTH_URI` is in the step's environment and never cleared, both `Start-Process` calls run without `-UseNewEnvironment`, and the app started at line 113 keeps running until the logout step. The script skips the download only if the runner already carries the app.

#### Evidence

- The URL: [`packaging/windows/simplysign-login.ps1:11-12`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/simplysign-login.ps1#L11-L12)
- Download and install: [`packaging/windows/simplysign-login.ps1:98-104`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/simplysign-login.ps1#L98-L104)
- The app start: [`packaging/windows/simplysign-login.ps1:113`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/simplysign-login.ps1#L113)
- The step's environment: [`.github/workflows/release.yml:331-336`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L331-L336)

#### Prerequisites and impact

Prerequisite: Compromise of Certum's file host or the installer. A long-lived TOTP seed is exposed, which with the email address allows Certum cloud logins for code signing outside this job.

#### Severity and confidence rationale

Medium confidence. [Microsoft's `Start-Process` docs](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process) say a started process inherits the parent's environment by default. AT is P for compromise of the vendor's host. SC and SI are H for code-signing logins outside this job.

#### Recommended remediation

Compare the MSI against a pinned hash, and remove the seed from the environment before starting anything, passing it only where the code is generated.

#### Uncertainty and verification limits

Not run. Server-side custom actions run under the Windows Installer service and may not see the variable. Whether Certum signs the MSI isn't visible here.

### F-039 · Secret-bearing jobs trust movable action tags

| Assessment | |
| :--- | :--- |
| Severity | Critical |
| Confidence | Medium |
| CWE | CWE-829: Inclusion of Functionality from Untrusted Control Sphere |
| CVSS 4.0 | CVSS-B 9.1 (Critical), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:N/SC:N/SI:L/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Every `uses:` line in the three workflows names a major tag, apart from the local reusable-workflow references. `docker/login-action@v4` receives `DOCKERHUB_TOKEN` directly as `password`. In `package-windows`, `actions/checkout` and `download-artifact` run before the SimplySign login, and `upload-artifact@v7` runs on the signed output after logout.

#### Evidence

- The Docker job: [`.github/workflows/docker.yml:25`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L25), [`.github/workflows/docker.yml:38-44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L38-L44), [`.github/workflows/docker.yml:62`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L62)
- The Windows job: [`.github/workflows/release.yml:323-325`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L323-L325), [`.github/workflows/release.yml:340-345`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L340-L345)

#### Prerequisites and impact

Prerequisite: Compromise or a tag move on one action repository. If a tag moves to hostile code, Docker Hub push credentials get exposed or signed output gets altered.

#### Severity and confidence rationale

Medium confidence: the movable refs are certain, and the risk needs an upstream compromise. I didn't check whether any tag has moved. AT is P for a compromised or moved tag. VC and VI are H for the push credential and the output.

#### Recommended remediation

Pin actions by full commit SHA, and let a tool like Dependabot update them.

#### Uncertainty and verification limits

Not run.

### F-040 · No publisher checksum or signature for deb, rpm or images, with auto-update encouraged

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | High |
| CWE | CWE-353: Missing Support for Integrity Check |
| CVSS 4.0 | CVSS-B 6.8 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:H/UI:P/VC:N/VI:H/VA:N/SC:N/SI:H/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`gh release create` attaches the files with no checksum file. `nfpm.yaml` has no signature block, and a search found no `cosign`, `attest`, `sbom`, `gpg` or `id-token` in workflows, packaging or the README. The documented setup fetches `compose.yaml` from `main`, follows `:latest` and recommends Watchtower. The deb and rpm run maintainer scripts as root. The dmg and exe do carry platform signatures.

#### Evidence

- The release: [`.github/workflows/release.yml:429-432`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L429-L432)
- The package config: [`packaging/linux/nfpm.yaml:11-34`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/nfpm.yaml#L11-L34)
- The image: [`.github/workflows/docker.yml:62-70`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L62-L70)
- The setup: [`compose.yaml:17`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L17), [`README.md:140`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L140), [`README.md:166`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L166), [`README.md:170-178`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L170-L178)

#### Prerequisites and impact

Prerequisite: Registry or release write access, by theft or through F-036. A swap on the Linux or container channels goes undetected, and root installs or auto-pulled containers then run it.

#### Severity and confidence rationale

High confidence in the absence. Two things exist outside the repo that don't change it: [Docker's docs](https://docs.docker.com/build/ci/github-actions/attestations/) say public repositories get provenance attestations automatically, and GitHub's API lists a digest for each release asset. Neither is a publisher signature, and neither stops someone who can replace the artifact. PR is H because it takes registry or release write access, AT is P for getting that access, and UI is P for the install or pull.

#### Recommended remediation

Sign deb and rpm packages and publish a signed checksum file, and sign images with cosign. Publish a signing key users can pin.

#### Uncertainty and verification limits

I confirmed the release-asset digests through GitHub's API for v1.20.1. I didn't inspect the published images.

### F-041 · Frozen bundles ship eqlab's src, tests and .claude tree and may serve them over the network

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Low |
| CWE | CWE-538: Insertion of Sensitive Information into Externally-Accessible File or Directory |
| CVSS 4.0 | CVSS-B 6.3 (Medium), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The wheel and the image exclude these `eqlab` paths, but `hqptuner.spec` copies all of `hqptuner/static`, and every freezing job checks out submodules. `spa.py` mounts that directory at `/` with no filter, so paths under `/vendor/eqlab/` other than `core/` would be served in every frozen build: the dmg, the Windows installer, and the deb and rpm, which freeze from the same spec. A search of packaging and the spec found no filter or test for those paths.

#### Evidence

- The exclusions: [`pyproject.toml:334-336`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L334-L336), [`.dockerignore:5-7`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.dockerignore#L5-L7)
- The spec copy and who uses it: [`hqptuner.spec:1-4`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner.spec#L1-L4), [`hqptuner.spec:36-37`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner.spec#L36-L37)
- The mount: [`hqptuner/api/spa.py:49-51`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/spa.py#L49-L51)
- Submodule checkouts: [`.github/workflows/release.yml:44-46`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L44-L46), [`.github/workflows/release.yml:187-189`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L187-L189), [`.github/workflows/release.yml:290-292`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L290-L292)

#### Prerequisites and impact

Prerequisite: Network reach to a frozen install; sensitivity depends on the submodule. Unneeded developer files and a build path are exposed, and agent config ships inside signed bundles.

#### Severity and confidence rationale

Low confidence. The submodule isn't checked out, so its contents are unknown: `scripts/eqtools_mcp.py` shows `src/` exists, and `tests/` and `.claude/` are inferred from the exclusion rules. VC is L and AT is P because the files' contents and sensitivity are unknown.

#### Recommended remediation

Apply the same exclusions in `hqptuner.spec`.

#### Uncertainty and verification limits

Not run. That PyInstaller copies dot-directories and `StaticFiles` serves them comes from the agents' knowledge of those tools. I couldn't read Starlette's docs because its documentation host didn't resolve when I checked, and I didn't check PyInstaller's.

### F-042 · Dev-tool dependencies run on developer hosts and in CI without commit pins

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-829: Inclusion of Functionality from Untrusted Control Sphere |
| CVSS 4.0 | CVSS-B 7.6 (High), `CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:L/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`filepawl` follows the git tag `v0.11.0` with no commit SHA, and `triviajudge` has no version bound. Both install through `.[dev]` in CI, including under `docker.yml`'s `packages:write` token (F-036), and their console scripts run in `make check`. Pre-commit runs hooks labelled as LLM judges, with a model set in `pyproject.toml`, so repository text leaves the host.

#### Evidence

- The pins: [`pyproject.toml:34`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L34), [`pyproject.toml:37`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L37)
- The judge config: [`pyproject.toml:146-150`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L146-L150)
- Where they run: [`Makefile:16`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Makefile#L16), [`Makefile:24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Makefile#L24), [`.pre-commit-config.yaml:234-239`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.pre-commit-config.yaml#L234-L239)
- CI's install: [`.github/workflows/check.yml:40`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/check.yml#L40)

#### Prerequisites and impact

Prerequisite: A moved tag, a compromised release, or a name collision on the package index. Code execution on developer hosts and in the check job. Disclosure of repository text to the model provider is low-risk for a public repo.

#### Severity and confidence rationale

Medium confidence: the pins are certain, and neither package is in this tree. AT is P for a moved tag or compromised release, and UI is P for a developer installing or running the gate.

#### Recommended remediation

Pin `filepawl` by commit and `triviajudge` by version and hash.

#### Uncertainty and verification limits

Not checked: whether `triviajudge` on the index belongs to the owner, what either package contains, and what the judges send, which here comes from hook labels and config.

### F-043 · A hostile branch or prompt injection gets code execution through the repo's agent allowlist and hooks

| Assessment | |
| :--- | :--- |
| Severity | High |
| Confidence | Medium |
| CWE | CWE-94: Improper Control of Generation of Code ('Code Injection') |
| CVSS 4.0 | CVSS-B 7.1 (High), `CVSS:4.0/AV:L/AC:L/AT:P/PR:N/UI:A/VC:H/VI:H/VA:H/SC:L/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`.claude/settings.json` allowlists commands that run repo-controlled or arbitrary code: `make check *` and `make test *`, `scripts/gate.sh .venv/bin/pytest *`, `.venv/bin/pip install *`, `npx prettier *` and `git commit *`, which fires branch-controlled pre-commit entries. It wires repo scripts as `PreToolUse` and `PostToolUse` hooks and self-enables the `hqpdoc` MCP server that `.mcp.json` defines from a tree script. There are no `deny` rules. `CLAUDE.md` places production hqplayerd on the same host and tells agents to run the gate before every commit.

#### Evidence

- Allow rules: [`.claude/settings.json:4-15`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L4-L15), [`.claude/settings.json:22-24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L22-L24), [`.claude/settings.json:27`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L27)
- Hooks and the MCP enable: [`.claude/settings.json:30-76`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L30-L76)
- The MCP definition: [`.mcp.json:3-7`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.mcp.json#L3-L7)
- The exec: [`scripts/gate.sh:55`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/gate.sh#L55)
- The host: [`CLAUDE.md:43-44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/CLAUDE.md#L43-L44), [`CLAUDE.md:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/CLAUDE.md#L52), [`.claude/skills/live-daemon/SKILL.md:34`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/skills/live-daemon/SKILL.md#L34)

#### Prerequisites and impact

Prerequisite: A developer or agent on a hostile branch in an already-trusted checkout, or an agent acting on injected text. Arbitrary code runs as the developer, with access to local credentials and the production daemon.

#### Severity and confidence rationale

Medium confidence. [Claude Code's settings docs](https://code.claude.com/docs/en/settings) say project `permissions.allow` rules apply only after the user trusts the folder, and that settings files reload when they change. So "no prompt" here means after trust, and my reading is that a branch switch doesn't ask again. [Its hooks docs](https://code.claude.com/docs/en/hooks) describe no sandboxing for hook commands. AV is L and UI is A because a developer has to work on the hostile branch, and AT is P because the checkout must already be trusted.

#### Recommended remediation

Narrow the allowlist to exact commands, drop `pip install *` and `npx *`, and add `deny` rules. Keep hook scripts outside the tree on the host that runs production.

#### Uncertainty and verification limits

Not run. Host-level settings, sandboxing or hooks are out of tree, and `CLAUDE.md:59` shows at least one host hook exists. That a branch switch skips re-trust is my inference from those docs, not a stated rule.

### F-044 · The eq-assistant's stated confinement is absent from this tree, and eqstage's url field gives it network egress

| Assessment | |
| :--- | :--- |
| Severity | Medium |
| Confidence | Medium |
| CWE | CWE-918: Server-Side Request Forgery (SSRF) |
| CVSS 4.0 | CVSS-B 5.8 (Medium), `CVSS:4.0/AV:L/AC:L/AT:P/PR:N/UI:P/VC:H/VI:L/VA:N/SC:N/SI:L/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The agent text says the session enforces stage-only writes, but its frontmatter grants `Read`, `Write` and `Edit` with no path limit, no repo hook restricts write paths, and `eqtools` isn't in `.mcp.json`. The planned lane hook appears only in `gauntlet/` specs. A job's `url` passes through `eqtools_mcp` and `eqstage` unvalidated, so a base with a query string sends data in the first GET with no server cooperation. If that server returns a valid baseline, `job.live` and `job.http` are POSTed to it. `fetch` sets no `redirect` option, so a 307 can carry the POST on to `/api/config/apply`, which ignores unknown body fields and applies whatever is staged, or answers 400 if nothing is. The `job_path` check itself is sound, and aiming `url` directly at the apply route fails at the baseline read.

#### Evidence

- The agent text: [`docs/eq-assistant/agent/eq-assistant.md:4`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/eq-assistant/agent/eq-assistant.md#L4), [`docs/eq-assistant/agent/eq-assistant.md:15`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/docs/eq-assistant/agent/eq-assistant.md#L15)
- The wiring: [`.mcp.json:3-7`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.mcp.json#L3-L7), [`.claude/settings.json:30-76`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L30-L76)
- The unvalidated job: [`scripts/eqtools_mcp.py:80-81`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqtools_mcp.py#L80-L81), [`scripts/eqtools_mcp.py:134`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqtools_mcp.py#L134), [`scripts/eqstage/eqstage.js:113-114`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqstage/eqstage.js#L113-L114)
- The requests: [`scripts/eqstage/rows.js:110-122`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqstage/rows.js#L110-L122), [`scripts/eqstage/post.js:36-41`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqstage/post.js#L36-L41)
- The apply route: [`hqptuner/api/routes/apply.py:100-112`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/apply.py#L100-L112), [`hqptuner/api/models.py:39-48`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/models.py#L39-L48)

#### Prerequisites and impact

Prerequisite: An EQ session on the host and an agent that follows injected content. Files the agent can read can leave the host, tree edits are possible unless host-side controls exist, and an engine restart can be forced despite the stated rule that it never applies. The last one needs an attacker-run server.

#### Severity and confidence rationale

High confidence for the unvalidated `url` and the absence from this tree. Medium for the redirect. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit) says `fetch` defaults to `follow` and [says a 307 keeps the method and body](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307), and [Pydantic's docs](https://pydantic.dev/docs/validation/latest/api/pydantic/config/) say `extra` defaults to `ignore`. AT is P because it needs an EQ session and an agent that follows injected content. VC is H for files the agent can read.

#### Recommended remediation

Validate `job.url` against loopback, set `redirect: 'error'`, and enforce the stated write limits in a tracked hook.

#### Uncertainty and verification limits

Not run. The session launcher and `eqtools` registration live outside this repo and may add controls. The frontmatter omits `Bash`, so "no shell" holds only if that file starts the session. MDN documents the browser fetch standard, and I'm assuming Node follows it. The `eqlab` submodule wasn't reviewed.

### F-045 · CLAUDE.md allows management credentials unredacted even when they're chosen rather than stock

| Assessment | |
| :--- | :--- |
| Severity | Defect |
| Confidence | Medium |
| CWE | CWE-532: Insertion of Sensitive Information into Log File |
| CVSS 4.0 | Not scored; this is a defect |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`CLAUDE.md` exempts hqplayerd management credentials from the placeholder rule because a stock pair is published, with no carve-out for chosen ones, and the `live-daemon` skill says they print freely. The product models a chosen password, and a committed brief records a non-stock username with a password set on the dev host. The sentence lists commands, logs and reports. Commits come in only because it's framed as an exception to "placeholders only in commits", and `.gitignore` separately says never to commit `hqpcreds`.

#### Evidence

- The rule: [`CLAUDE.md:46`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/CLAUDE.md#L46), [`.claude/skills/live-daemon/SKILL.md:34`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/skills/live-daemon/SKILL.md#L34)
- The chosen password: [`hqptuner/config.py:246-255`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L246-L255)
- The brief: [`.claude/briefs/compose-pins.md:19`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/briefs/compose-pins.md#L19)
- The ignore rule: [`.gitignore:72-77`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.gitignore#L72-L77)

#### Prerequisites and impact

Prerequisite: A non-stock password, and an agent that prints or commits it under this rule. A real management password can end up in transcripts and logs, and possibly in this public repository through commit text.

#### Severity and confidence rationale

Medium confidence. The rule's wording is certain, and "may reach commits" is the likely reading, not explicit text. A targeted grep for password assignments found only fixtures, placeholders and the stock default, with no real credential. That grep isn't a full secret scan, though gitleaks also reported nothing. Defect, because this is a written rule for agents with no attacker in the path, and I found no real credential disclosed.

#### Recommended remediation

Limit the exemption to the stock pair by value, and tell agents to treat any other password as a secret.

#### Uncertainty and verification limits

I can't tell from source whether this has ever happened.

### F-046 · The repo's agent guards are easy to get around

| Assessment | |
| :--- | :--- |
| Severity | Defect |
| Confidence | High |
| CWE | CWE-693: Protection Mechanism Failure |
| CVSS 4.0 | Not scored; this is a defect |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

The version-bump hook says it catches `bump.sh` however it's spelled or reached, but the Bash rule is one regex for that literal name, so a glob or a name built from a variable passes, and `sed -i` on `pyproject.toml` isn't caught. Malformed input fails open. `Bash(git commit *)` matches `git commit --no-verify`, which `CLAUDE.md` forbids, and no hook checks for it. The hook is a real deny when it matches. A push would still need the owner, since nothing allowlists it.

#### Evidence

- The regex and docstring: [`.claude/hooks/no-version-bumps.py:15`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/hooks/no-version-bumps.py#L15), [`.claude/hooks/no-version-bumps.py:36-37`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/hooks/no-version-bumps.py#L36-L37), [`.claude/hooks/no-version-bumps.py:58-59`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/hooks/no-version-bumps.py#L58-L59)
- Fail open: [`.claude/hooks/no-version-bumps.py:82-85`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/hooks/no-version-bumps.py#L82-L85)
- The commit rule: [`.claude/settings.json:27`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L27), [`CLAUDE.md:43`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/CLAUDE.md#L43)

#### Prerequisites and impact

Prerequisite: An agent that ignores instructions or is under prompt injection. Release and gate policy can be bypassed locally. CI still runs `make check`, so I traced no direct product impact.

#### Severity and confidence rationale

High confidence by reading. The impact is small. Defect, because getting around these local guards traced to no product impact and CI still runs the gate.

#### Recommended remediation

Correct the docstring so it doesn't promise more than a name match, and treat these hooks as guidance. Keep the enforcement in CI.

#### Uncertainty and verification limits

Not run. Host-level hooks outside the tree could add coverage. That the wildcard rule admits extra flags is assumed from the rule's form.

### F-047 · hqp_section reads any path named in INDEX.md

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | High |
| CWE | CWE-22: Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal') |
| CVSS 4.0 | CVSS-B 1.8 (Low), `CVSS:4.0/AV:L/AC:L/AT:P/PR:N/UI:A/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

`INDEX_ROW` accepts any non-backtick text as the filename, and `tool_hqp_section` joins it to the manual directory, checks only `is_file` and returns the contents. A `../` or absolute path escapes the directory. `INDEX.md` is generated with slugged names and `docs/official/` is gitignored, so an attacker has to tamper with the local file or force-track one on a branch.

#### Evidence

- The join: [`scripts/hqpdoc_tools.py:245-257`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/hqpdoc_tools.py#L245-L257)
- The row pattern: [`scripts/authority.py:151`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/authority.py#L151)
- The ignore: [`.gitignore:32`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.gitignore#L32)

#### Prerequisites and impact

Prerequisite: A hostile tracked INDEX.md and an agent calling the tool. A file read that sidesteps a `Read` deny rule the user configured. A caller that also holds `Read` gains little, and a hostile branch already has stronger routes (F-043).

#### Severity and confidence rationale

High confidence by reading, with low practical value. VC is L because a caller that also holds `Read` gains little.

#### Recommended remediation

Check that the resolved path stays inside the manual directory.

#### Uncertainty and verification limits

Not run.

### F-048 · Write probes keep the daemon backup at a predictable temp path, and restore_pristine pushes it back

| Assessment | |
| :--- | :--- |
| Severity | Low |
| Confidence | Medium |
| CWE | CWE-377: Insecure Temporary File |
| CVSS 4.0 | CVSS-B 2.0 (Low), `CVSS:4.0/AV:L/AC:L/AT:P/PR:L/UI:A/VC:L/VI:L/VA:N/SC:N/SI:H/SA:L` |
| Verification | Source review only; not reproduced |
| Disposition | Open |
| Approval status | Approved |
| Approved by | John Crenshaw |
| Approved at | 2026-11-06 17:24:19 -05:00 (America/Indianapolis) |
| Approved content revision | `c261ae1d1af2d44284ecfb63c040d531986d2740` |

#### What the code shows

Three probes write to `<PROBE_OUT or tempdir>/hqptuner-probe/pristine-settings.zip` using `mkdir(exist_ok=True)` and `write_bytes`, with no mode or ownership check. `restore_pristine.py` checks only `is_file` and that the engine is idle, then POSTs the bytes unchanged with `scope=system`. Another user can pre-create the directory in a sticky `/tmp` and read or supply the archive.

#### Evidence

- The restore: [`scripts/probes/restore_pristine.py:26`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/restore_pristine.py#L26), [`scripts/probes/restore_pristine.py:52-55`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/restore_pristine.py#L52-L55), [`scripts/probes/restore_pristine.py:62-69`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/restore_pristine.py#L62-L69)
- The writers: [`scripts/probes/probe_post_reassert.py:44`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/probe_post_reassert.py#L44), [`scripts/probes/probe_post_reassert.py:169-170`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/probe_post_reassert.py#L169-L170), [`scripts/probes/probe_profile_post_process.py:184-185`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/probe_profile_post_process.py#L184-L185), [`scripts/probes/absent_plugin/probe_absent_plugin.py:260-264`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/absent_plugin/probe_absent_plugin.py#L260-L264)

#### Prerequisites and impact

Prerequisite: A second local user, default `TMPDIR`, no `PROBE_OUT`, and an operator running the probes. On a multi-user host, the daemon config is disclosed, or attacker-chosen config and archive members reach the production daemon. In the single-user case the risk is low.

#### Severity and confidence rationale

Medium confidence, since whether the host has other users is out of tree and the tool needs an operator. PR is L for the second local user, UI is A for the operator running the probe, and SI is H for attacker-chosen config reaching the daemon.

#### Recommended remediation

Use a private directory made by `tempfile.mkdtemp`, or refuse a directory the user doesn't own.

#### Uncertainty and verification limits

Not run. `PROBE_OUT` or `TMPDIR` changes the path, and umask decides read access once the directory already belongs to the operator.

## Coverage and limitations

### Reviewed scope

| Area | Coverage | Evidence / limitation |
| :--- | :--- | :--- |
| REST API, app shell and network exposure (46 files) | Reviewed | All 46 read in full, per that area's agent |
| Engine lanes, config editing, archives and stores (78 files) | Reviewed | All 78 read in full, per that area's agent |
| Browser SPA and rendered data (181 files) | Partly reviewed | Ten `hqptuner/data/*.json` files were searched for markup and links and not read line by line. Five minified vendored modules got a skim with no upstream comparison |
| Supply chain, CI, packaging and agent tooling (147 files) | Partly reviewed | `package-lock.json` was read for lines 1-120 and checked structurally by grep |
| Test code (480 files) and fixtures (17) | Not reviewed as targets | Not shipped. Tests may have been read as evidence of intended behavior |
| Dev record text (117), offline analysis tools (45), stylesheets (36), prose and EQ data (31), type declarations (2), an enum snapshot (1) | Not read in full | Skipped with a recorded reason. The analysis tools and stylesheets got targeted greps only |
| Archives and binaries (84 entries) and the submodule | Not reviewed | Listed below |

The areas account for 452 files and the skips for 815 entries, which covers all 1267 tracked entries with none unaccounted for. "Reviewed" isn't a claim that no vulnerability exists.

### Checks performed

| Check | Scope and method | Result / limitation |
| :--- | :--- | :--- |
| Pin and retrieval | Cloned with hooks, submodules and LFS disabled, and confirmed `HEAD` equals the reviewed commit | Matched. No tracked symlinks and no LFS attributes |
| Requester check | Metadata, tags, the path listing and `CONTRIBUTING.md` before authorization | The requester owns this user-owned repository, and nothing refuses AI-assisted reports |
| Secret scan | gitleaks 8.30.1 with `--redact --no-banner --ignore-gitleaks-allow` and default rules, over the pinned tree and the history reachable from the commit. The repository has no `.gitleaks.toml` or `.gitleaksignore` | No results. gitleaks reports 1922 commits scanned and 2349 are reachable. A clean run doesn't rule out a secret its rules don't match |
| Release assets | The seven assets on tag `v1.20.1` were downloaded and not run or extracted | SHA-256 digests match GitHub's. No tracked file matches any of them by name or blob hash, so they aren't reviewed |
| Script-injection sinks in the SPA | Search of app code for HTML, script and `eval`-style sinks, and a trace of daemon strings to render | None found in the code present. `eqlab` isn't included |
| Prototype pollution | Search for two-level writes and recursive merges | None found in the code present. The worst case is one local lookup object |
| Password exposure through responses, logs and export | Traced the read route, the audit record, the export and the SPA | No disclosure on those paths. `form.password` stays in memory until the panel reopens |
| Favicon and accent-color injection | Traced both | Neither carries attacker text |
| Rendered data and vendored modules | Searched `hqptuner/data` and skimmed the five vendored modules | No markup or links. The skim found no added network calls. This wasn't an upstream comparison |
| Refutation | One new agent per area, given claims without the reasoning | See below |
| CVSS 4.0 scoring | Each finding labeled and scored from the draft's own text, with FIRST's calculator code | Scores and vectors are in each finding. Threat and Environmental metrics are left to whoever runs the software |
| Independent check | One fresh read-only agent that hadn't seen the reasoning judged all 48 findings and the dropped candidates from the source, then checked the drafts' wording and citations | It confirmed all 48, kept the dropped checks dropped and left three narrower variants unresolved. It raised 22 corrections, which I checked against the source and applied. Nobody independently re-checked those corrections. It checked the load-bearing citations and many others, not every line range, and its SPA results rest on targeted greps and reads |

I didn't check dependency advisories, published images, deployed systems or commit history beyond gitleaks. During retrieval I also ran `file` on the release assets and `git status`, `git tag --points-at` and `git rev-list --count` on the checkout. All four are read-only, and they aren't on the review's list of allowed tools. One agent's read used a mistyped path outside the checkout; the file didn't exist and nothing was read.

### Outside-tool behavior checked

Where a finding rests on how an outside tool behaves, I checked public documentation. Requests carried no source or case details.

| Tool | What the documentation says | Findings |
| :--- | :--- | :--- |
| [httpx timeouts](https://www.python-httpx.org/advanced/timeouts/), [quickstart](https://www.python-httpx.org/quickstart/) | Read timeout is per chunk, with no whole-response deadline. Redirects aren't followed by default. Streaming is how to avoid loading the whole body | F-005, F-017 |
| [httpx exceptions](https://www.python-httpx.org/exceptions/) | `InvalidURL` sits outside `HTTPError`. When it fires isn't stated | F-015 |
| [httpx clients](https://www.python-httpx.org/advanced/clients/), [authentication](https://www.python-httpx.org/advanced/authentication/) | One `base_url` example, with no merge rules. Digest is a challenge-response, with no field-level detail. These two claims stay partly unconfirmed | F-004, F-005 |
| [RFC 7616](https://www.rfc-editor.org/rfc/rfc7616.html) | The response is a hash over the password and the server's values; dictionary and chosen-nonce risks | F-004 |
| [FastAPI middleware](https://fastapi.tiangolo.com/advanced/middleware/), [uploads](https://fastapi.tiangolo.com/tutorial/request-files/), [docs assets](https://fastapi.tiangolo.com/how-to/custom-docs-ui-assets/), [async](https://fastapi.tiangolo.com/async/), [strict content type](https://fastapi.tiangolo.com/advanced/strict-content-type/) | `TrustedHostMiddleware` is opt-in. No stated upload maximum. Docs pages use a CDN by default. `def` routes use a threadpool. Strict JSON content type is the default from 0.132.0 | F-003, F-016, F-018, F-027, F-031, open questions |
| [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access) | Multipart POST is a simple request. Chrome asks permission for public-to-local requests, with the prompt launching in Chrome 142 | F-002, F-003 |
| [MDN `RequestInit`](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit), [MDN 307](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/307), [Pydantic config](https://pydantic.dev/docs/validation/latest/api/pydantic/config/) | `fetch` follows redirects by default, 307 keeps method and body, and `extra` defaults to ignore | F-044 |
| [Python `zipfile`](https://docs.python.org/3/library/zipfile.html), [`xml`](https://docs.python.org/3/library/xml.html), [`pathlib`](https://docs.python.org/3/library/pathlib.html), [`site`](https://docs.python.org/3/library/site.html) | Decompression bombs and no documented `read` limit. Expat below 2.7.2 may be vulnerable. The drive-changing join. `.pth` import lines run at startup | F-016, F-020, F-026, F-031, F-034 |
| [Microsoft file naming](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file), [`Start-Process`](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process) | Drive-relative paths and reserved names. A started process inherits the environment | F-026, F-038 |
| [GitHub workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands), [reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments), [`actions/checkout`](https://github.com/actions/checkout) | `GITHUB_PATH` reaches later steps. Permissions can't be raised through a chain. Environment secrets reach only jobs using the environment. `persist-credentials` defaults to true | F-034, F-035, F-036 |
| [Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/), [systemd.exec](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) | Public repositories get provenance attestations automatically. `DynamicUser` state sits under an inaccessible `/var/lib/private` | F-023, F-040 |
| [Claude Code settings](https://code.claude.com/docs/en/settings), [hooks](https://code.claude.com/docs/en/hooks) | Project allow rules wait for folder trust, and settings reload on change. No sandboxing described for hooks | F-043 |

Starlette's and uvicorn's documentation hosts didn't resolve when I checked, so I didn't confirm claims about them from their own docs. Unconfirmed from any documentation: CPython's and V8's regex behavior (F-019, F-033), macOS `security` behavior (left out of F-034), PyInstaller's and `StaticFiles`' handling of dot-directories (F-041), Node following the browser fetch standard (F-044), and Windows and macOS profile directory permissions (F-023).

### Refutation pass

| Item | Record |
| :--- | :--- |
| Method | Refuter agents per area, one new read-only agent each, then one fresh read-only agent on the draft, which judged every finding and dropped candidate from the source before reading the drafts |
| Assistant | Claude |
| Scope | 70 candidates from the four review agents at the reviewed commit |
| Evidence standard | Commit-pinned source lines |
| Result | The refuters returned 66 confirmed and 4 unresolved. None was refuted outright, though one candidate's live-snapshot half was. Five of the confirmed entries were records of checks with no finding, listed above. The other 61 merged into the 48 findings here. The independent check then confirmed all 48 and left three narrower variants unresolved, which are under open questions |
| Limitation | Refuters could only read. Nothing was run, and the daemon's behavior couldn't be tested |

| Released finding ID | Counterargument examined | Commit-pinned evidence and adjudication |
| :--- | :--- | :--- |
| F-001 | Any auth gate or client-IP check, and the `remember=false` state | a search found no gate at [`hqptuner/api/factory.py:65`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65), and the 503 lasts only until an ungated POST at [`hqptuner/core/connection.py:156`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L156). |
| F-002 | Any Origin or token check, and whether each route acts without preconditions | no check at [`hqptuner/api/factory.py:65`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65); apply answers 400 with nothing staged at [`hqptuner/api/routes/apply.py:111`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/apply.py#L111). |
| F-003 | Any allowed-hosts setting or Host comparison | none in [`hqptuner/api/factory.py:65`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/factory.py#L65) or [`hqptuner/__main__.py:38`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/__main__.py#L38). Whether a browser permits the rebind stays unresolved. |
| F-004 | A pinned host, and whether the password persists | a pin blocks the move at [`hqptuner/core/connection.py:142`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L142), and the caller can set `remember` itself at [`hqptuner/api/routes/connection.py:119`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L119). |
| F-005 | Any host validation, and whether both routes return bodies | none at [`hqptuner/api/routes/connection.py:36`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/connection.py#L36); `/api/backup` returns a 500 for non-zip bytes when descriptions exist, per [`hqptuner/api/routes/config.py:256`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L256). |
| F-006 | Any escaping or domain check between input and writer | only a field-name lookup at [`hqptuner/conf/presetconf.py:209-213`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L209-L213), and `attr_escape` applies only to process strings and profile names. |
| F-007 | Any member check or backup on this route | none at [`hqptuner/api/routes/config.py:324-344`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L324-L344). The preset-save lane also takes no copy, per [`hqptuner/presets/presetlane.py:320-335`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetlane.py#L320-L335), which narrows the original claim. |
| F-008 | Whether the password reaches these outputs | a search for `hqp_password` found no log or export use, and [`hqptuner/presets/store/export.py:43`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/export.py#L43) blanks it. The disclosure of everything else stands. |
| F-009 | Whether the docs and the bind actually conflict | they do, per [`README.md:238`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L238) against [`README.md:192`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/README.md#L192). The firewall state stays unresolved. |
| F-010 | Whether every route is affected | `/api/config/live` isn't on the loaded chain, per [`hqptuner/lanes/live/routing.py:116-127`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/live/routing.py#L116-L127), and staged volume is guarded at [`hqptuner/lanes/writer.py:189`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/writer.py#L189). |
| F-011 | Any path restriction | none at [`hqptuner/conf/presetconf.py:142-143`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L142-L143) or [`hqptuner/conf/matrixpayload.py:167-170`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixpayload.py#L167-L170). The effect stays unresolved. |
| F-012 | The name check and the reach | names with separators or other extensions are refused at [`hqptuner/presets/store/filterpark.py:83-89`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L83-L89), which narrows the claim to top-level `.wav` and `.txt`. |
| F-013 | Any domain check on the staged path | none at [`hqptuner/conf/presetconf.py:137`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetconf.py#L137) or [`hqptuner/api/routes/pending.py:129`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/pending.py#L129). |
| F-014 | Whether the route compares the name to known profiles | it doesn't, per [`hqptuner/lanes/matrixlane.py:36-39`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/lanes/matrixlane.py#L36-L39). The nothing-loaded refusal narrows when it fires. |
| F-015 | A host-only POST with no remembered password, and a pinned host | the first gets no client at [`hqptuner/core/connection.py:156`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L156) and the second isn't layered at [`hqptuner/core/connection.py:142`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L142). Both narrow the claim. |
| F-016 | Whether a size check exists anywhere and whether all zips decompress | no check at [`hqptuner/api/routes/config.py:324`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/config.py#L324); only an archive with the descriptions member is decompressed, per [`hqptuner/conf/presetzip.py:171-173`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/presetzip.py#L171-L173). |
| F-017 | Any cap on `_retired` or the bodies | none at [`hqptuner/core/manager.py:268`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/manager.py#L268) or [`hqptuner/conf/noanswer.py:29-35`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/noanswer.py#L29-L35). The 4 MiB Control API cap does hold, per [`hqptuner/engine/control.py:203-216`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L203-L216). |
| F-018 | Which stores are bounded | favorites at [`hqptuner/presets/store/favorites.py:45`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/favorites.py#L45), descriptions at [`hqptuner/presets/store/descriptions.py:42`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L42) and the park at [`hqptuner/presets/store/filterpark.py:32`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/filterpark.py#L32) all have ceilings. |
| F-019 | Which patterns are reachable in one apply | only `_profile_re`, per [`hqptuner/conf/matrixprofiles.py:139`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixprofiles.py#L139); the others need an earlier apply, per [`hqptuner/conf/matrixconf.py:177`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/conf/matrixconf.py#L177). |
| F-020 | Whether the cap is real and whether a peer is adopted | the only bound is the deadline at [`hqptuner/engine/discovery.py:171`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L171); the route only lists daemons, so nothing is adopted without a user. |
| F-021 | A healthy daemon answering too, and a pinned host | two answers block the fill at [`hqptuner/static/store/setup.js:213-215`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L213-L215), and a pin stops the dial at [`hqptuner/core/connection.py:142`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L142). |
| F-022 | Any container or identity check | none at [`hqptuner/api/lifespan.py:27-50`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/lifespan.py#L27-L50) or [`hqptuner/engine/discovery.py:127-150`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/discovery.py#L127-L150); compose is protected at [`compose.yaml:24`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/compose.yaml#L24). |
| F-023 | Which deployments are protected | deb and rpm per [`packaging/linux/hqptuner.service:10-12`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/linux/hqptuner.service#L10-L12), and the app's own atomic rename at [`hqptuner/core/connection.py:113-117`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L113-L117) covers tearing only, with no mode set. |
| F-024 | A TLS option or a blank-field exemption | no TLS option at [`hqptuner/__main__.py:38`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/__main__.py#L38); a blank field omits the key at [`hqptuner/static/store/setup.js:274`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/setup.js#L274), which narrows when it happens. |
| F-025 | Any filtering in the routes | none at [`hqptuner/api/routes/status.py:89`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L89) or [`hqptuner/api/routes/status.py:137`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/api/routes/status.py#L137). |
| F-026 | Live snapshots | refuted and dropped, since they stay JSON keys at [`hqptuner/presets/store/live.py:215-218`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/live.py#L215-L218). The preset path survives, per [`hqptuner/presets/store/presets.py:241`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/presets.py#L241). |
| F-027 | Any header or frame-busting | none in Python or at [`hqptuner/static/index.html:3-8`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/index.html#L3-L8). Preset delete and overwrite do confirm, which narrows the bait. |
| F-028 | Any identity beyond the regex | none at [`hqptuner/desktop.py:170-173`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/desktop.py#L170-L173). |
| F-029 | Any serialization on the write lanes | a search found `asyncio.Lock` only on the control client, at [`hqptuner/engine/control.py:113`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/engine/control.py#L113). |
| F-030 | Whether a failed write or a rollback protects it | a failed write does stop the restore, per [`hqptuner/presets/presetops.py:272-288`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/presetops.py#L272-L288); a search found no rollback logic. |
| F-031 | The exceptions | the connection store renames at [`hqptuner/core/connection.py:113-117`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/core/connection.py#L113-L117), and a mid-write read clears when the write finishes. The persistent case needs interleaved writers. |
| F-032 | The count ceiling | `_save` enforces 256 at [`hqptuner/presets/store/descriptions.py:266`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/presets/store/descriptions.py#L266), which narrows "every limit" to the per-entry ones. |
| F-033 | Whether the crash needs non-default settings | it does, per [`hqptuner/static/store/ui/prefs.js:105`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/ui/prefs.js#L105) for the option and [`hqptuner/static/store/narrow/match.js:125-135`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/store/narrow/match.js#L125-L135) for narrowing. The stall needs neither. |
| F-034 | Order of install and import, and the scoped password | neither closes it, per [`.github/workflows/release.yml:200-222`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L200-L222) and [`scripts/package-macos.sh:52`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/package-macos.sh#L52). |
| F-035 | Environment rules | none could gate `build-macos`, since it names no environment at [`.github/workflows/release.yml:175-186`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L175-L186). Rules on `signing` stay unknown. |
| F-036 | Whether the secret reaches the job | `DOCKERHUB_TOKEN` doesn't, per [`.github/workflows/docker.yml:17-18`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/docker.yml#L17-L18). The `packages: write` token does, with no override. |
| F-037 | Whether artifacts are wholly untested | they aren't, since smoke and lifecycle jobs run them at [`.github/workflows/release.yml:75-134`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.github/workflows/release.yml#L75-L134). That narrows the claim for packages but not for the image. |
| F-038 | Any hash or environment scrub | a search found no `Get-FileHash`, and no `-UseNewEnvironment` at [`packaging/windows/simplysign-login.ps1:101`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/simplysign-login.ps1#L101) or [`packaging/windows/simplysign-login.ps1:113`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/packaging/windows/simplysign-login.ps1#L113). |
| F-039 | Any SHA pin | a search of the `uses:` lines found none. |
| F-040 | Default provenance and GitHub digests | they exist, but neither is verifiable against a publisher key. The dmg and exe are out of scope for this finding. |
| F-041 | Whether the spec filters them | no filter at [`hqptuner.spec:36-37`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner.spec#L36-L37). The content stays unknown. |
| F-042 | Whether install runs code | `filepawl` builds from source; `triviajudge` depends on wheel or sdist. Their scripts run in `make check` either way, per [`Makefile:16`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/Makefile#L16). |
| F-043 | The trust dialog | it comes first, so a fresh clone is protected. The trusted-checkout case stands, per [`.claude/settings.json:4-15`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/settings.json#L4-L15). |
| F-044 | The direct same-origin trick | it dies at [`scripts/eqstage/rows.js:120-122`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqstage/rows.js#L120-L122). The `job_path` containment at [`scripts/eqtools_mcp.py:86-91`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/eqtools_mcp.py#L86-L91) holds. The target must serve a valid baseline first. |
| F-045 | Whether a real credential is committed | none found by the grep or by gitleaks over the pinned tree and history. |
| F-046 | Whether the hook blocks anything | it does deny the literal case at [`.claude/hooks/no-version-bumps.py:58-59`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/hooks/no-version-bumps.py#L58-L59), so "advisory" was too loose. |
| F-047 | Whether generation protects it | generated names are slugged at [`scripts/build_manual.py:256`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/build_manual.py#L256), but nothing checks a tampered file at [`scripts/hqpdoc_tools.py:245-257`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/hqpdoc_tools.py#L245-L257). |
| F-048 | Any ownership or content check | none at [`scripts/probes/restore_pristine.py:52-55`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/restore_pristine.py#L52-L55); the idle check at [`scripts/probes/restore_pristine.py:62`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/probes/restore_pristine.py#L62) isn't one. |

### Exclusions and unresolved questions

Not reviewed:

- The submodule `hqptuner/static/vendor/eqlab` at `4e24b8d9167e08d225f91c719c102b9e0d3a98c2`, which isn't checked out. The SPA imports it for EQ parsing and it ships same-origin, so any sink inside it is unknown, and that limits the script-injection result above.
- 68 `.gz` archives, which weren't extracted: `hqptuner/static/vendor/autoeq.json.gz` and `tests/support/fixtures/junkcal/*.jsonl.gz`.
- 10 PNG images and 6 WOFF2 fonts.
- The seven release assets on `v1.20.1`, and any published image.
- Dependency implementations, `docs/official` (untracked), and the outside plugins `filepawl` and `triviajudge`.

Open questions. These were neither confirmed nor refuted, so they aren't findings:

- **Can the JSON routes be driven cross-site?** Nothing on the server requires a JSON content type, and the only thing forcing a preflight is the header the SPA sets, per [`hqptuner/static/lib/api.js:169-179`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/static/lib/api.js#L169-L179). [FastAPI's docs](https://fastapi.tiangolo.com/advanced/strict-content-type/) say strict checking has been the default since 0.132.0 and refuses a body with no `Content-Type`. `fastapi` is unpinned at [`pyproject.toml:7`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/pyproject.toml#L7), so a build older than that would accept it. The version inside each published build would settle this.
- **Does `task-check` lead to root on the dev host?** `.claude/task-check.sh` is allowlisted, runs the branch's `make check` and writes a trigger, per [`.claude/task-check.sh:32-38`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/task-check.sh#L32-L38), and [`.claude/commands/task-check.md:11`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/.claude/commands/task-check.md#L11) describes a root-owned unit that rebuilds from the working tree. That unit isn't in the repository. Its command and the compose file it reads would settle this.
- **Are the review agents' lists of threats they traced and didn't raise right?** Two agents recorded lists like this, covering matrix and speaker escaping, the Actions triggers, the test harness and more. The entries the refuters received named no specific threat, so they came back unresolved. Treat the lists as unverified.
- **Does a `constructor` stage type crash the matrix editor?** This is a variant of F-033 that ends in `eqlab/core/matrixspec.js`, which isn't in the checkout.
- **Can a dependency in the check job poison the shared `type=gha` build cache?** That would reach Docker Hub without its token, as a variant of F-036. It needs proof that a `run` step can get a cache-write token and that BuildKit would reuse the entry.
- **Do `BASH_ENV` and the keychain's `-A` flag and partition list give a shorter path to the Apple key?** This is a variant of F-034. It needs Actions' `BASH_ENV` handling and macOS `security` export behavior, neither of which I confirmed.

Also unsettled, from source alone:

- Whether `/backup/settings.zip` includes `hqplayerd-auth.xml`, how hqplayerd treats archive member paths, what it does with injected config, whether it processes a second element in one 4321 write, and what `<log file>` does.
- Browser protections other than Chrome's Local Network Access, and OS firewall state for the `0.0.0.0` binds.
- Resolved dependency versions in any published artifact.
- GitHub settings: `signing` protection rules, branch and tag protection, the default `GITHUB_TOKEN` permission, fork approval settings and where secrets are stored.
- Whether `docker/metadata-action` can move `:latest` on a tag from a non-main commit.
- The AutoEq blob's provenance: [`scripts/build_autoeq_db.py:74`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/build_autoeq_db.py#L74) defaults to `--ref master` despite the docstring's "pinned ref" at [`scripts/build_autoeq_db.py:3-4`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/scripts/build_autoeq_db.py#L3-L4), and nothing verifies a hash at runtime. The blob and its parser weren't reviewed, so no finding was raised.
- `eqlab`'s `resolveChain` sources, which may read files.
- The 4322 metering path is inert at this commit, per [`hqptuner/config.py:70`](https://github.com/ohshitgorillas/hqptuner/blob/a942cfcac127ea790adccc11a279a748da5ea426/hqptuner/config.py#L70), and the review agent noted latent issues there if `ADVISOR_ENABLED` is ever turned on.

Further review is by agreement. A fix in source is not evidence that a corrected release is available or deployed.

## Amendments

| Date and timezone | Revision / affected finding IDs | Change and evidence | Approval reference |
| :--- | :--- | :--- | :--- |
| — | — | No amendments recorded | — |
