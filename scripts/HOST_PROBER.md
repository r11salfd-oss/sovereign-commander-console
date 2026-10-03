# SOVEREIGN HOST PROBER — OPERATOR MANUAL

**Chain Key ID:** `360ea36c28e66d9d`
**Component:** host-side MCP measurement service
**Files:** `scripts/host_prober.ts` (service) · `scripts/host_prober_client.ts` (shared contract + console-side client)

---

## 0. TL;DR

`E:\Servers-Center` does not exist inside the Alpine container. The container has
no PowerShell and cannot execute the Windows-native MCP binaries. It is therefore
**physically incapable of measuring** the infrastructure the console reports on —
which is why the console previously had to fabricate status.

This prober runs on the **Windows host**, spawns the **real** MCP servers,
performs a **real** MCP stdio JSON-RPC handshake with each one, and publishes the
**measured** result over a loopback HTTP API that the container reads.

Measured on this host: **7/7 ONLINE, 107 tools**, full sweep in ~1.1 s.

---

## 1. THE THREE-STATE CONTRACT

The prober emits exactly one of three verdicts per server. The distinction
between OFFLINE and UNVERIFIABLE is the entire point: collapsing them would let a
*measurement* error be reported as a *service* outage.

| State | Meaning | Emitted only when |
|---|---|---|
| `ONLINE` | **Measured alive** | `initialize` returned a result → `notifications/initialized` was delivered → `tools/list` returned **≥1** tool. `measured: true`. |
| `OFFLINE` | **Measured dead** | A transport attempt actually ran and the target conclusively declined to serve: `initialize`/`tools/list` returned a JSON-RPC error, non-zero exit before the handshake, a clean exit with **zero MCP frames**, a zero-length tool list, a non-executable binary image, or a stdout flood. `measured: true`. |
| `UNVERIFIABLE` | **Could not conclude** | Never attempted (entrypoint absent, no launcher runtime, platform mismatch, inventory unresolved) **or** attempted but inconclusive (handshake timeout, sweep deadline, execution permission denied), **or** the prober itself could not be reached/authorized by the console. `measured: false`. |

**Two rules that must never be broken:**

1. `UNVERIFIABLE` is **never** promoted to `ONLINE`.
2. `UNVERIFIABLE` is **never** demoted to `OFFLINE`.

Rationale for rule 2: `OFFLINE` asserts *"I probed it and it is not serving."* If
the measuring instrument is absent, that assertion is **false**. Reporting
`OFFLINE` on a prober outage converts one bridge failure into seven phantom
server outages.

Every result also carries:

| Field | Meaning |
|---|---|
| `lastProbedAt` | ISO-8601 instant the probe **completed** (not when it was cached) |
| `probeMethod` | e.g. `mcp-stdio-jsonrpc` — the transport that produced the verdict |
| `toolCount` | Tool count from `tools/list`; `null` when not `ONLINE` |
| `reason` | Machine-readable reason code |
| `reasonText` | Human-readable explanation. Never contains a secret or env value |
| `measured` | `true` only when a transport actually ran |
| `entrySource` | `MANIFEST` / `ALLOWLIST` / `MANIFEST_ENTRY_ABSENT_FALLBACK_ALLOWLIST` / `UNRESOLVED` |
| `cached` / `cacheAgeMs` | Whether the row came from the TTL cache, and how old it is |
| `stderrProduced` | Whether the child wrote to stderr. **The content is never captured or returned.** |

A report additionally carries `provenance`:

- `MEASURED_BY_PROBER` — the prober ran transports and concluded.
- `DEGRADED_UNVERIFIABLE` — the console could not reach/authorize the prober, so
  **nothing was measured**. Every entry is `UNVERIFIABLE`.

---

## 2. RUNNING IT

### 2.1 One-shot (CI / verification) — no token required

```powershell
cd C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console
npx tsx scripts/host_prober.ts --once
```

Prints the full JSON report to stdout and exits `0`. No socket is opened, so
`HOST_PROBER_TOKEN` is **not** required — a CI run should not need a secret.

Exit code is non-zero only when the **prober itself** fails (bad config, refused
bind). A measured `OFFLINE` is a successful measurement and does not fail the run.

```powershell
# fail a pipeline if fewer than 7 servers are ONLINE
npx tsx scripts/host_prober.ts --once |
  ConvertFrom-Json |
  ForEach-Object { if ($_.summary.online -lt 7) { throw "only $($_.summary.online)/7 online" } }
```

### 2.2 Long-running service

> **PREFER THE INSTALLED SERVICE.** The prober is now a Windows service that
> starts at boot and restarts itself (§10). **Do not start it manually** — a
> second instance cannot bind port 39711 and the manual one is the fragile
> arrangement the service exists to replace. The command below is retained for
> one-shot debugging and for `uninstall.ps1` recovery; stop it with `Ctrl+C`
> (never Task Manager — §12).

```powershell
$env:HOST_PROBER_TOKEN = '<see §3>'
$env:HOST_PROBER_ALLOWED_HOSTS = 'host.docker.internal'
npx tsx scripts/host_prober.ts
```

Startup banner prints bind address, root, limits, allowlisted ids and the Host
allowlist. It prints **no token and no environment values**.

`--help` prints the full usage and every environment variable.

---

## 3. THE TOKEN

The prober **refuses to start** without `HOST_PROBER_TOKEN` of at least 32
characters. Fail closed — it is never downgraded to an unauthenticated service.

Generate one (32 random bytes, base64url → 43 characters):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

The same value must be present in the **console's** environment (inside the
container) so the two can authenticate to each other.

**Storage (Windows, recommended — a service account's user environment):**

1. Generate the token; keep it out of shell history and out of any repo file.
2. Store it as a **machine-level** environment variable:
   `setx /M HOST_PROBER_TOKEN "<token>"` (open a new shell afterwards).
   Or set it explicitly on the service account when registering with NSSM/Task
   Scheduler (see §7) — preferred, because it scopes the secret to one service.
3. Give the container the same value via its runtime environment (compose
   `environment:` / Dockerfile `ENV` / orchestrator secret). **Do not commit it.**
4. Rotate by updating both sides and restarting both.

**Never** put the token in `opencode.json`, in `config/`, in `scripts/`, or in
any file tracked by git. The prober never logs it, never returns it, and never
writes it anywhere.

---

## 4. HTTP CONTRACT

Base URL from the container: `http://host.docker.internal:39711`
(matching the verified default in `HOST_PROBER_DEFAULT_BASE_URL`).

> **Verified on this host:** a listener bound to `127.0.0.1` **is** reachable from
> the running container through `host.docker.internal` (Docker Desktop proxies that
> name to host loopback). The bridge gateway `172.17.0.1` is **REFUSED**. So loopback
> binding is both sufficient and the safest choice.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/probe/health` | none | Liveness of the prober itself. Deliberately exposes **no** host metadata. |
| GET | `/probe/mcp/status` | Bearer | Full measured report — the payload the console consumes. |
| GET | `/probe/lsp/status` | Bearer | **Every entry `UNVERIFIABLE`.** See §6. |
| GET | `/probe/tools/:id` | Bearer | Tool **names** only for one allowlisted id. |
| GET | `/probe/servers` | Bearer | Allowlist inventory: ids, kinds, operator notes. |
| GET | `/probe/discrepancies` | Bearer | Manifest-vs-host disagreements, including the `github.entry` defect. |

### 4.1 The critical security rule

> **No endpoint ever accepts a filesystem path, a command, or an entrypoint from
> the request.** A request may only *select* an id from a hardcoded allowlist.

`/probe/tools/:id` enforces this with **two independent gates**: a strict charset
(`/^[a-z0-9][a-z0-9._-]{0,63}$/i`) **and** allowlist membership. The id is never
joined to a filesystem location, so path traversal is structurally impossible.
This is what keeps the prober from being an RCE gadget reachable from any
container on the Docker host.

`/probe/mcp/status?fresh=1` is the only query parameter. It is a boolean mode
selector (bypass the TTL cache), not a path/command/entrypoint, so it cannot
widen the execution surface.

### 4.2 Consuming it from the console

`scripts/host_prober_client.ts` is container-safe and is the only sanctioned path:

```ts
import { HostProberClient } from './scripts/host_prober_client';

const prober = new HostProberClient();          // reads HOST_PROBER_BASE_URL + HOST_PROBER_TOKEN
const report = await prober.fetchMcpStatus(['shell', 'github'] /* expected ids */);

if (report.provenance === 'MEASURED_BY_PROBER') {
  // real measurement — trust the per-server states
} else {
  // prober unreachable/unauthorized: every entry is already UNVERIFIABLE.
  // DO NOT substitute a number, and DO NOT report OFFLINE.
}
```

**The client never throws for a transport-layer problem.** It always resolves to a
report, degrading to all-`UNVERIFIABLE`. A caller finds out "did the prober
answer?" by reading `provenance`, never by catching an exception — which removes
the temptation to substitute a default verdict in a `catch` block.

It also **sanitizes** the payload: a prober claiming `ONLINE` without a tool count,
with `measured: false`, or with a reason other than `HANDSHAKE_COMPLETED` is
**downgraded to `UNVERIFIABLE`** at the boundary. A prober bug cannot inject a
green status into the console.

---

## 5. MANIFEST RECONCILIATION

Precedence, deterministic and reported:

```
repo config/servers_center_manifest.json  →  host <root>/manifest.json  →  allowlist
```

- A manifest entry that **exists** on disk is used as-is (`entrySource: MANIFEST`).
- A manifest entry that **does not** exist is **rejected and reported**, then the
  next source is tried (`entrySource: MANIFEST_ENTRY_ABSENT_FALLBACK_ALLOWLIST`).
- It is **never** silently accepted, and the prober **never writes a manifest**.

**Every** readable manifest is reconciled, not merely the one that won. This is
deliberate: once the repo manifest is corrected, a first-match strategy would stop
examining the host manifest and the host manifest's bad `mcp.github.entry` would
**silently stop being reported**. A defect that stops being reported is a defect
that never gets repaired.

Two safety guards on manifest data (manifests are *data*, and data can be wrong
or hostile):

- **Containment** — a declared entry resolving outside the Servers Center root
  (`../../../Windows/System32/cmd.exe`) is refused as a containment violation.
- **PowerShell rejection** — a `.ps1` entry is refused, because a PowerShell
  wrapper does not forward stdin to a native child. See §8.

Force the allowlist with `HOST_PROBER_MANIFEST=0`.

---

## 6. LSP: WHY EVERYTHING IS `UNVERIFIABLE`

`GET /probe/lsp/status` returns `UNVERIFIABLE` for **every** entry,
unconditionally, and says so *structurally* rather than in a comment:

```json
"transportImplemented": false,
"framing": "CONTENT_LENGTH_HEADERS"
```

**Why.** MCP's stdio transport frames messages as **newline-delimited JSON**.
LSP frames messages with **`Content-Length` headers**. The MCP client in this
process therefore *cannot speak to a language server at all*. Inferring readiness
from the existence of a directory is **precisely the fabrication this system was
built to remove** — a directory existing is not a healthy language server.

**Drop-in seam.** `buildInventory()` already enumerates the manifest's `lsp`
keys. A real client only needs to:
1. implement `Content-Length` framing,
2. issue `initialize` and read `serverInfo`,
3. flip `transportImplemented` to `true`.

The consumer-side sanitizer **already refuses to believe any LSP state** while
`transportImplemented` is `false`, so nothing can start reporting a fabricated
`READY` before the transport exists.

---

## 7. CONFIGURATION

| Variable | Default | Meaning |
|---|---|---|
| `HOST_PROBER_TOKEN` | *(none)* | **Required** for server mode, ≥32 chars. Fail closed. |
| `HOST_PROBER_PORT` | `39711` | Listen port. |
| `HOST_PROBER_BIND` | `127.0.0.1` | Loopback only. Any other value is **refused at startup**. |
| `HOST_PROBER_ROOT` | `E:\Servers-Center` | Servers Center root. |
| `HOST_PROBER_MANIFEST` | enabled | `0` forces the built-in allowlist. |
| `HOST_PROBER_NODE` | discovered | Explicit Node runtime override. |
| `HOST_PROBER_REPO_ROOT` | cwd-walk | Repo root used to locate `config/servers_center_manifest.json`. |
| `HOST_PROBER_ALLOWED_HOSTS` | loopback only | Extra `Host` names. To let the container reach the prober you **must** include `host.docker.internal`. |
| `HOST_PROBER_ALLOWED_ORIGINS` | *(none)* | Extra `Origin` values for browser clients. |
| `HOST_PROBER_TIMEOUT_MS` | `20000` | Per-child lifetime cap. |
| `HOST_PROBER_PHASE_TIMEOUT_MS` | `10000` | Per-handshake-phase cap. |
| `HOST_PROBER_MAX_CONCURRENCY` | `3` | Parallel probes. |
| `HOST_PROBER_RUN_DEADLINE_MS` | `90000` | Whole-sweep deadline. |
| `HOST_PROBER_CAPTURE_CAP_BYTES` | `4194304` | Per-stream capture ceiling. |
| `HOST_PROBER_CACHE_TTL_MS` | `15000` | Result cache TTL. `0` disables. |

The Node runtime is **discovered**, not hardcoded: `HOST_PROBER_NODE` → host
manifest `runtime.node` → a `runtime\*\node.exe` under the root → `node` on PATH.
A hardcoded `node-v24.19.0-win-x64` would keep probing a binary that may no longer
be the one in use.

### 7.1 Minimal working environment

```powershell
$env:HOST_PROBER_TOKEN           = '<43-char token>'
$env:HOST_PROBER_ALLOWED_HOSTS   = 'host.docker.internal'
$env:HOST_PROBER_ROOT            = 'E:\Servers-Center'
npx tsx scripts/host_prober.ts
```

---

## 8. MEASURED BEHAVIOUR: THE POWERSHELL TRAP

`opencode.json` launches the GitHub server as
`powershell -NoProfile -ExecutionPolicy Bypass -File run-github-mcp.ps1`.

**Measured on this host:** PowerShell does not forward its stdin pipe to a native
child, so the wrapper's server sees EOF and quits without ever emitting a frame.
Through this prober the wrapper classifies as:

```
state=OFFLINE reason=EXIT_NONZERO_BEFORE_HANDSHAKE exitCode=1 frames=0
```
(with a scrubbed child environment the wrapper throws early on the missing
`GITHUB_PERSONAL_ACCESS_TOKEN`; with the token present it is `EXIT_ZERO_NO_MCP_FRAMES`,
`exitCode=0`. Both are conclusive and both are `OFFLINE` — the prober covers both
paths, verified.)

Invoking the real executable directly:

```
state=ONLINE reason=HANDSHAKE_COMPLETED toolCount=45 frames=2
```

**A clean exit with zero MCP frames is never reported as `ONLINE`.** The prober
invokes the `.exe` directly. This is a **probe-side** decision only; the
Commander's own launch configuration is untouched.

---

## 9. SECURITY CONTROLS

| # | Control | Implementation |
|---|---|---|
| 1 | **Loopback-only bind** | Default and **enforced** — a non-loopback `HOST_PROBER_BIND` is refused at startup, not merely discouraged. |
| 2 | **Bearer token ≥32 chars** | Service **refuses to start** without one. Fail closed. |
| 3 | **Constant-time compare** | `crypto.timingSafeEqual` with a length-mismatch guard. |
| 4 | **Host header validation** | Only allowlisted names accepted → defeats DNS rebinding. `host.docker.internal` is **not** accepted by default; adding it is an explicit decision. |
| 5 | **Origin validation** | Absent `Origin` (machine client) allowed; present `Origin` must be allowlisted → defeats CSRF. |
| 6 | **Rate limit** | 30 requests / 60 s per peer. Each status request spawns subprocesses. |
| 7 | **Liveness never throttled** | `/probe/health` is exempt — a busy prober must never be reported as a dead one. |
| 8 | **No caller-controlled execution** | Allowlist only. No endpoint accepts a path, command or entrypoint. Two independent gates on `:id`. |
| 9 | **Manifest containment** | Declared entries resolving outside the root are refused. |
| 10 | **Scrubbed child env** | Built from scratch — there is **no** `...process.env` spread. Only `PATH`, `SystemRoot`, `TEMP`, `PATHEXT` and an explicit allowlist. Host secrets are not inherited. |
| 11 | **Bounded concurrency** | ≤3 parallel probes (configurable, capped at 8). |
| 12 | **Per-child + per-phase timeout** | 20 s / 10 s. A hung server can never stall a sweep. |
| 13 | **Hard sweep deadline** | 90 s. Enforced by *clamping* each child budget, so a partial sweep still returns complete, individually honest rows. |
| 14 | **Capture cap** | 4 MB per stream; a flooding child cannot exhaust prober memory. |
| 15 | **Guaranteed cleanup** | Timers cleared, stdin/stdout/stderr destroyed, child killed on **every** settle path, including timeout. A live-child set is killed on shutdown. |
| 15a | **Process-*tree* termination** | On Windows, `taskkill /T /F` walks the tree, because `child.kill()` reaches only the **direct** child. Measured: browser-backed servers spawn Chromium as a **grandchild**. Verified 0 survivors after settle. Built-in utility — **no npm dependency**. See §12 for the hard-kill caveat. |
| 16 | **stderr counted, never stored** | Only a boolean and a byte count. A misconfigured server routinely prints its own environment. |
| 17 | **No secret in any response** | No token, no env values, no absolute paths, no argument schemas, no tool output. |
| 18 | **Tool names only** | `/probe/tools/:id` returns names. Never `inputSchema` (which can embed defaults) and never output values. |
| 19 | **Read-only filesystem** | The prober performs no writes at all. |
| 20 | **Strict arg parsing** | Unknown CLI flags are **rejected**, so a typo cannot silently change what is being measured. |

---

## 10. THE SERVICE (installed, measured, self-healing)

> **Status: INSTALLED AND RUNNING.** This section used to say "documentation only
> — nothing was installed". That was true when written and is now **false**. The
> prober is no longer a process somebody has to remember to start. It is a
> Windows service. Every number below is a real measurement from this host,
> quoted from real stdout. Scripts: [`prober-service/`](prober-service/README.md).

```powershell
cd C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\scripts\prober-service

.\install.ps1 -AdoptExistingProber   # idempotent, self-elevates, fail-closed
.\verify.ps1                        # read-only gate; exit 1 on any failure
.\verify.ps1 -SelfHealTest          # kills the prober, measures recovery
.\uninstall.ps1                     # fully reversible
```

### 10.1 Identity, as installed

| Property | Value |
|---|---|
| Service name | `SovereignHostProber` |
| Display name | `Sovereign Host Prober (MCP measurement instrument)` |
| Status | `Running` |
| Start type | `AutomaticDelayedStart` (`SERVICE_DELAYED_AUTO_START`) |
| Account | `LocalSystem` — **not** the interactive user; see §10.6 |
| Application | `C:\Program Files\nodejs\node.exe` |
| Arguments | `"…\node_modules\tsx\dist\cli.mjs" "…\scripts\host_prober.ts"` |
| Working dir | the repo root |
| Logs | `%APPDATA%\sovereign-commander-console\host-prober.service[.err].log`, rotated at 10 MB |
| Token | read from the token file at install; **length 43**, value never printed |
| NSSM | `%LOCALAPPDATA%\sovereign-commander-console\tools\nssm\2.24-101\…\win64\nssm.exe` |

### 10.2 How `tsx` was resolved for a non-interactive service

**It was not resolved through `PATH` at all.** The service command line is
three *absolute* paths: an absolute `node.exe`, an absolute
`node_modules\tsx\dist\cli.mjs`, and an absolute `host_prober.ts`. Session 0 has
no interactive shell and no user environment, so any `PATH` lookup would be a
latent boot-time failure — precisely the failure this service exists to prevent.

In addition the service's own `PATH` is **pinned** via NSSM
`AppEnvironmentExtra`, rebuilt at install time from the **HKLM + HKCU registry
values** (31 entries) rather than from whatever environment the installing shell
happened to have. `NODE_OPTIONS` is pinned empty so a stray value elsewhere
cannot break the boot start. `HOST_PROBER_REPO_ROOT` is pinned so the manifest
is found by absolute path instead of by walking up from `cwd`.

### 10.3 Restart policy — three independent layers

| Layer | Setting | Trigger |
|---|---|---|
| 1 — NSSM | `AppExit Default=Restart`, plus explicit `0→Restart`, `1→Restart`, `2→Reboot`; `AppThrottle=3000`; `AppRestartDelay=3000` | the prober process exits |
| 2 — SCM | `restart/5000`, `restart/10000`, `restart/30000`; counter reset `86400` | `nssm.exe` itself dies |
| 3 — SCM | `SERVICE_DELAYED_AUTO_START` | host boot, nobody signed in |

`AppStopMethodConsole=0` so `nssm stop` delivers a console control event and the
prober's `SIGINT` handler runs `handle.close()` and reaps its live children.

**Measured crash recovery:** `taskkill /F /T` against the prober's node process
→ reachable again in **3466 ms**, `7/7 ONLINE`, console back to `70/100`.

### 10.4 Measured outage and recovery, quoted

```
t0: taskkill /PID <prober> /F /T  (simulating a crash)
recovery: recovered=True after 3466ms (budget 120s)
post-recovery measurement: provenance=MEASURED_BY_PROBER online=7/7

  --- OUTAGE WINDOW (prober killed) ---
  prober reachable      : False  (t+2176ms after kill)
  console healthScore   : UNVERIFIABLE
  console mcpSource     : CONTAINER_FILESYSTEM_PROBE
  console lspSource     : CONTAINER_FILESYSTEM_PROBE
  console mcp total     : 0 online=0 source=CONTAINER_FILESYSTEM_PROBE
  console lsp total     : 0 ready=0 source=CONTAINER_FILESYSTEM_PROBE
  hostProber.reachable  : False
  hostProber.mcp        : provenance=DEGRADED_UNVERIFIABLE unavailableReason=The host prober did not answer. No MCP verdict was established, so none is reported.
  rationale             : No transport produced a measured verdict, so no score is published. A number here would assert a conclusion that no observation supports.
  --- RECOVERED ---
  console healthScore   : 70/100
  console mcpSource     : HOST_PROBER_MEASURED
  console mcp total     : 7 online=7
  hostProber.reachable  : True
```

### 10.5 What NSSM was downloaded, and what was verified about it

| Item | Value |
|---|---|
| URL | `https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip` |
| Bytes | 415 458 |
| SHA-1 | `ca2f6782a05af85facf9b620e047b01271edd11d` — **matches** the value published on `nssm.cc/download` |
| SHA-256 | `99f5045fffbffb745d67fe3a065a953c4a3d9c253b868892d9b685b0ee7d07b8` — recorded, **not** verifiable against any publisher |
| `win64/nssm.exe` SHA-256 | `eee9c44c29c2be011f1f1e43bb8c3fca888cb81053022ec5a0060035de16d848` |
| Authenticode | **`Status=NotSigned`** on both `win32` and `win64` binaries |

**Honest limits of that verification.** nssm.cc publishes **SHA-1 only**, and
the binaries carry **no code signature**. So the integrity check proves *the
bytes match what the vendor's page advertises*; it does **not** prove the vendor
account was uncompromised, and SHA-1 is not collision-resistant. The
**pre-release** `2.24-101` was chosen deliberately: nssm.cc states that Windows
10 Creators Update and newer "should use prelease build 2.24-101 … to avoid an
issue with services failing to start", and this host is Windows 11 build 26200.
The stable `2.24` build is knowingly the wrong choice here.

The binary is installed to `%LOCALAPPDATA%`, **outside the repository**, so it
cannot be committed by accident.

### 10.6 The account is `LocalSystem`, and that is not cosmetic

A service running as an interactive user needs that user's **password** in the
LSA secret store so the SCM can log it on at boot with nobody signed in. No
password is available to the installer, and none may be typed into a script or
a command line. The installer therefore *attempts* the account and **verifies**
the result rather than assuming it:

```
--- attempting account: DESKTOP-7FSRQ0H\AA5II ---
ObjectName set to 'DESKTOP-7FSRQ0H\AA5II' (SCM reports StartName='LocalSystem')
[WARN] the SCM did not accept 'DESKTOP-7FSRQ0H\AA5II' as the service account; it reports StartName='LocalSystem'. Attempt rejected.
--- attempting account: LocalSystem ---
[OK]   account 'LocalSystem' WORKS: service Running, /probe/health ok=true
```

> **A false positive, found and fixed.** An earlier revision passed the literal
> string `'CurrentUser'` to `nssm set ObjectName`. NSSM returned **exit 0**, the
> SCM silently kept `LocalSystem`, the service started and looked perfect, and
> the installer printed *"account 'CurrentUser' WORKS"*. It now compares
> `Win32_Service.StartName` against the requested account and rejects the
> attempt on mismatch. **A configuration command that returns success is not
> evidence that the configuration took effect.**

#### Running as `LocalSystem` silently changes *what is measured*

`LocalSystem` has a different profile, so the prober measures a different
machine than the operator sees. Measured:

| Service environment | `pyright` verdict | Console score |
|---|---|---|
| `LocalSystem` default (`APPDATA` = `…\systemprofile\AppData\Roaming`) | `OFFLINE / EXIT_NONZERO_BEFORE_HANDSHAKE` | **60/100** |
| `APPDATA`/`USERPROFILE` pinned to the operator profile | `ONLINE / HANDSHAKE_COMPLETED` | **70/100** |

The cause is declared in `config/servers_center_manifest.json` itself: the
`pyright` package lives in the **per-user** site-packages, CPython derives that
path from `%APPDATA%`, and the manifest declares
`command.env.passThrough: ["APPDATA"]` for exactly this reason. Under
`LocalSystem` there is no pyright to import, so the interpreter exits nonzero.

Note the shape of that failure: `hostProber.reachable` stayed `true` and
`mcpSource` stayed `HOST_PROBER_MEASURED`. **It looked exactly like a pyright
outage.** The installer now pins `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`HOMEDRIVE`, `HOMEPATH`, `TEMP`, `TMP` to the profile the instrument is meant to
measure (paths, not secrets), restoring `70/100`. `-NoProfileMapping` opts out
and measures the SYSTEM profile honestly.

### 10.7 Stopping it: `taskkill` cannot do this cleanly on this host

Installing over the old manual prober requires taking port 39711 back. Three
measured facts, all of which shaped `install.ps1`:

1. `taskkill /PID n` **without** `/F` only posts `WM_CLOSE` to top-level
   windows. A prober started by `Start-Process npx.cmd` has no window:
   `ERROR: The process with PID 10700 could not be terminated`.
2. `CTRL_C_EVENT` (`send-ctrl-c.ps1`) is generated successfully — the sender
   prints `ctrl-c-sent` — but a **background console process group does not
   receive it**, so Node's `SIGINT` handler never ran and the port stayed bound.
   `nssm stop` works precisely *because* NSSM owns a foreground console for the
   service.
3. Therefore `install.ps1` escalates: control event → `taskkill /T` (no `/F`) →
   `taskkill /F /T`, and the last step **requires explicit
   `-AllowForcedKill`**. `/T` matters: it takes the descendants with it, which
   is strictly better for Chromium orphans than a forced kill of the parent
   alone.

The orphan check walks `ParentProcessId` from the stopped PID and reports only
*that* process's surviving descendants.

> **Near-miss worth recording.** An earlier orphan detector matched command
> lines such as `chrome-devtools-mcp` and `playwright\mcp`. It matched **22 live
> processes belonging to `opencode-cli.exe` — the operator's own MCP servers**,
> not prober leftovers. A cleanup step built on that filter would have killed
> the operator's tooling. Command-line matching is not process ownership.

### 10.8 Alternatives considered and not used

Task Scheduler and PM2 both inherit the **user** environment and need a
`setx /M` machine-wide token, which is worse isolation than scoping the secret
to one service. NSSM scopes the secret to `HKLM\…\Services\SovereignHostProber`
and deletes it with the service. See `prober-service/README.md` §4.

---

## 11. VERIFYING AN INSTALLATION

```powershell
# 0. The whole gate, read-only, non-zero exit on any failure. Start here.
cd C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\scripts\prober-service
.\verify.ps1

# 1. Service state and boot-time start type
Get-Service SovereignHostProber | Format-List Name,Status,StartType
Get-CimInstance Win32_Service -Filter "Name='SovereignHostProber'" |
  Select-Object StartName,StartMode,ProcessId

# 2. Liveness (unauthenticated)
curl.exe -s http://127.0.0.1:39711/probe/health

# 3. The security control: this MUST be 401
curl.exe -s -o - -w "\nHTTP=%{http_code}\n" http://127.0.0.1:39711/probe/mcp/status

# 4. Measured status (authenticated)
curl.exe -s -H "Authorization: Bearer $env:HOST_PROBER_TOKEN" `
  http://127.0.0.1:39711/probe/mcp/status

# 5. Bound to loopback only — never 0.0.0.0
netstat -ano | Select-String ":39711"

# 6. From inside the running console container (read-only; does not disturb it)
docker exec sovereign-commander-console node -e "
  fetch('http://host.docker.internal:39711/probe/mcp/status',{headers:{authorization:'Bearer '+process.env.HOST_PROBER_TOKEN}})
    .then(r=>r.json()).then(j=>console.log(j.summary)).catch(e=>console.log('UNVERIFIABLE:',e.message))"
```

---

## 12. KNOWN LIMITATIONS (stated, not hidden)

- **LSP is not implemented.** Every entry is `UNVERIFIABLE`. See §6.
- **Token over plain HTTP on loopback.** Loopback traffic does not leave the host,
  but it transits a hypervisor-adjacent virtual link inside Docker Desktop.
  Residual risk is **low but nonzero** and mitigated by the token, the loopback
  bind, and a payload that carries no secrets by design. TLS is deliberately not
  added: it would require provisioning a CA into both host and image for metadata
  that is secret-free.
- **`GITHUB_PERSONAL_ACCESS_TOKEN` is not forwarded** by default. The probe still
  completes the handshake and enumerates 45 tools (the capability inventory does
  not require the token), but authenticated tool *calls* would fail. Add the
  variable name to the entry's `passEnv` **only** if a future probe needs to make
  authenticated calls; the value is never logged or returned either way.
- **Browser-backed probes** (`chrome-devtools`, `playwright`) launch headless and
  isolated, but repeated sweeps do consume CPU and disk in the Chromium profile.
  The 15 s TTL cache bounds this; `?fresh=1` bypasses it deliberately.
- **Sustained/soak behaviour under continuous polling is UNVERIFIED** — not
  measured beyond the verification runs recorded in the build report.
- **Hard-killing the prober (`taskkill /F`, Task Manager "End task") can leave
  Chromium grandchildren alive.** MEASURED: killing the prober mid-sweep left 3
  live `chrome.exe` processes. The cause is structural — an abrupt
  `TerminateProcess` gives the prober no opportunity to run *any* cleanup, so
  `taskkill /T` in the settle path never gets a chance. Graceful shutdown
  (`SIGINT`/`SIGTERM`, which routes through `killAllChildren()`) is clean.
  **Operational rule: always stop the prober gracefully.** The service makes
  this easy and safe: `nssm stop SovereignHostProber`, **not** Task Manager.
  (`AppStopMethodConsole=0` is what makes this true — NSSM delivers a console
  control event, so the `SIGINT` handler actually runs.) If you must use
  `taskkill`, use `/T` so the tree goes with it; `install.ps1` does exactly that
  and then reports which descendants survived. The proper fix is a Windows
  **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, which requires
  native code and therefore a dependency the Commander has not approved — not
  implemented.
- **The service runs as `LocalSystem`, not the operator's account.** A service
  cannot run as an interactive user without a stored password. §10.6 pins the
  measured profile so the instrument's identity is explicit and produces the
  same `70/100` as the manual process did, but the process identity itself is
  SYSTEM. Anything on this host that depends on being the logged-in user (a
  user-mode credential store, a per-user license, a mapped network drive) will
  not be visible to the service. `E:` was verified to be a **local** disk
  (`Win32_LogicalDisk DriveType=3`, ReFS, "DevDrive"), so the Servers Center
  tree is reachable from SYSTEM; a network or per-user-mounted root would not be.
- **An actual reboot was not performed** — see §14.3.
- **Concurrency of Chromium.** Probes of `chrome-devtools` and `playwright` are
  bounded to 3 in parallel, but a sweep can transiently run two browsers at once.
  Verified non-disruptive to a concurrent interactive Chrome session (probes use
  `--headless --isolated`), though sustained repeated sweeping is unproven.

---

## 13. TROUBLESHOOTING

| Symptom | Likely cause | Action |
|---|---|---|
| Console shows `UNVERIFIABLE` / `CONTAINER_FILESYSTEM_PROBE` | **The instrument is not running.** `Get-Service SovereignHostProber` | §10. `\prober-service\verify.ps1` tells you which check failed |
| Console shows `UNVERIFIABLE` but took ~90 s to appear | Prober accepts TCP and never answers | Same as above; §14.1 explains why the payload cannot tell you which it was |
| `healthScore` fell to 60/100 with `pyright OFFLINE` | Service running under a profile where pyright is not installed | §10.6 — the measurement identity is wrong; reinstall with `-MeasuredProfile` |
| `Get-Service` shows `Stopped` right after an install | The service account could not be logged on | §10.6; `nssm get SovereignHostProber AppParameters`, then the Application event log |
| `HOST_PROBER_TOKEN must be set…` | Token missing/short | §3 |
| `HOST_PROBER_BIND="…" is refused` | Non-loopback bind attempted | Remove the variable |
| Console gets `UNVERIFIABLE / PROBER_UNREACHABLE` | Prober down, or Host header refused | Start the service; ensure `HOST_PROBER_ALLOWED_HOSTS` contains `host.docker.internal` |
| Console gets `UNVERIFIABLE / PROBER_UNAUTHORIZED` | Token mismatch | Compare both sides; `GET /probe/health` still answers 200, which distinguishes "down" from "wrong token" |
| `429 rate limited` | >30 requests/min from one peer | Wait 60 s, or cache client-side |
| Server reports `UNVERIFIABLE / ENTRYPOINT_ABSENT` | Server not on this host, or `HOST_PROBER_ROOT` wrong | Check the root; the probe never guessed |
| Server reports `UNVERIFIABLE / SPAWN_PERMISSION_DENIED` | Prober lacks execute rights | `LocalSystem` on a local disk is fine; a network or per-user-mounted root is not |
| GitHub server `OFFLINE` | PowerShell wrapper, or missing PE binary | The prober already invokes the `.exe`; check the entry in the manifest |

---

## 14. WHAT THE OPERATOR ACTUALLY SEES

### 14.1 The state table

Three states, all measured on this host against the running console at
`http://127.0.0.1:3000/api/agents/framework`. **"Cause visible?" is the column
that matters** — it asks whether the payload tells an operator *why* the number
changed.

| State | `healthScore` | `mcpSource` | `lspSource` | `mcp` / `lsp` totals | `hostProber.reachable` | Latency | Is the cause visible? |
|---|---|---|---|---|---|---|---|
| **UP** | `70/100` | `HOST_PROBER_MEASURED` | `HOST_PROBER_MEASURED` | `7/7` · `6/3` | `true` | <2 s | n/a — measurement is real |
| **DOWN** (nothing listening) | `UNVERIFIABLE` | `CONTAINER_FILESYSTEM_PROBE` | `CONTAINER_FILESYSTEM_PROBE` | `0/0` · `0/0` | `false` | <1 s | **Yes, unambiguously** |
| **SLOW** (accepts TCP, never answers) | `UNVERIFIABLE` | `CONTAINER_FILESYSTEM_PROBE` | `CONTAINER_FILESYSTEM_PROBE` | `0/0` · `0/0` | `false` | **90 s** | **No — indistinguishable from DOWN** |

**The DOWN payload, quoted:**

```
healthScore    = UNVERIFIABLE
anyMeasured    = False
mcpSource      = CONTAINER_FILESYSTEM_PROBE
lspSource      = CONTAINER_FILESYSTEM_PROBE
rationale      = No transport produced a measured verdict, so no score is published. A number here would assert a conclusion that no observation supports.
mcp total/online = 0/0 source=CONTAINER_FILESYSTEM_PROBE
lsp total/ready  = 0/0 source=CONTAINER_FILESYSTEM_PROBE
hostProber.reachable = False
hostProber.mcp  = provenance=DEGRADED_UNVERIFIABLE unavailableReason=The host prober did not answer. No MCP verdict was established, so none is reported.
hostProber.lsp  = provenance=DEGRADED_UNVERIFIABLE unavailableReason=The host prober did not answer. No LSP verdict was established, so none is reported.
```

### 14.2 Does the system still lie by omission? No — and one gap remains

**It does NOT lie by omission.** Three properties were each verified by
observation, not by reading code:

1. **No number is published when nothing was measured.** `healthScore` is the
   string `UNVERIFIABLE`, not a degraded score. The `rationale` says so in
   plain words.
2. **The instrument's absence is structurally visible, not just textual.**
   `hostProber.reachable=false`, `hostProber.mcp.provenance=DEGRADED_UNVERIFIABLE`
   with an explicit `unavailableReason`, and `mcpSource`/`lspSource` both flip to
   `CONTAINER_FILESYSTEM_PROBE`. A consumer reading only `mcpSource` cannot
   mistake a lost instrument for a measured result.
3. **No per-server `OFFLINE` is invented.** Totals are `0/0`, consistent with §1
   rule 2: `UNVERIFIABLE` is never demoted to `OFFLINE`. A prober outage did not
   become seven phantom server outages.

> **Correction to an earlier claim in this document's own brief:** the failure
> mode was previously described as *"healthScore collapses from 70/100 to
> 40/100"*. **That is no longer what the system does, and it is no longer the
> right thing to build towards.** Publishing `40/100` would be a lie of the same
> species this system exists to remove: a number asserting a conclusion no
> observation supports. The current behaviour — publish nothing — is correct and
> should be preserved.

**The one real remaining gap, stated plainly:**

> **In the SLOW state the console cannot distinguish "the prober is absent" from
> "the prober is wedged".** Both produce a byte-identical payload with
> `hostProber.reachable=false` and `unavailableReason="The host prober did not
> answer."` — the word *answer* covers both *there was nothing there* and *it
> never answered*. The only distinguishing signal a consumer has is **latency**:
> DOWN answers in under a second, SLOW blocks for 90 s. Latency is not in the
> payload.
>
> **Recommended follow-up (NOT implemented — `server.ts` is out of this task's
> file ownership):** give the client result a *reason* distinct from
> `PROBER_UNREACHABLE`, e.g. `PROBER_TIMEOUT`, and surface it on
> `healthScoreBasis`. The client already has `PROBER_TIMEOUT` in its reason
> vocabulary (`scripts/host_prober_client.ts`), and the console already
> distinguishes *how* it is unreachability-free of effort — so the information
> may already be reaching the API and only needs to be published.

**A second, smaller gap:** the console's own client timeout is **15 000 ms**
(`timeoutMs = options.timeoutMs ?? 15_000`), yet `/api/agents/framework` took
**90 s** to return in the SLOW state. The endpoint's latency therefore comes
from somewhere other than the single client timeout — most plausibly more than
one fetch being awaited, or a retry. An operator's dashboard will appear frozen
for 90 s before saying anything. Worth a look in `server.ts`.

### 14.3 What is UNVERIFIED

Stated rather than implied:

- **An actual reboot was not performed.** Not permitted by this task. Boot
  behaviour is **UNVERIFIED by execution**. What *is* proven: the start type is
  `SERVICE_DELAYED_AUTO_START`, the account is `LocalSystem` (which requires no
  logon and no stored password), every absolute path the service needs exists
  and was resolved from the registry, and crash recovery is proven at 3466 ms.
  What is *not* proven: that Windows actually starts it after a power cycle, and
  that nothing in a cold-boot environment (no user profile, no mapped drives,
  Docker not yet running) breaks it.
- **A power-loss / BSOD recovery** (the `AppExit 2 → Reboot` path) is untested.
- **Sustained soak** under continuous polling is unproven. Only the runs quoted
  here.
- **`nssm.exe` itself being killed** (SCM Recovery layer 2) was configured and
  read back via `sc qfailure`, but was not exercised.
- **Token rotation** across the service boundary is untested.

### 14.4 Residual risk

| # | Risk | Severity | Mitigation / status |
|---|---|---|---|
| 1 | `LocalSystem` is a high-privilege process that spawns untrusted-ish child MCP servers and headless Chromium | **HIGH** | Inherent to the platform's boot-start-without-a-password constraint. It is also *lower* privilege than the interactive-user option that requires storing a password. Child env is scrubbed (control 10); the bound is loopback-only; the token gate is re-verified after every install. |
| 2 | The bearer token is stored in plaintext in `HKLM\…\Services\SovereignHostProber\Parameters` | MEDIUM | Readable by Administrators/SYSTEM only. Removed with the service. Not committed, not printed. |
| 3 | NSSM is **unsigned**, verified only against a publisher-published **SHA-1** | MEDIUM | Cannot detect a compromised vendor page. Prefer a signed package manager (`winget`/`chocolatey`) if one becomes available. |
| 4 | Boot start is configured but unproven (§14.3) | MEDIUM | `verify.ps1` is the gate; run it after the next real reboot. |
| 5 | A forced kill can strand Chromium processes | LOW | Service is always stopped with `nssm stop`; installer reports surviving descendants; `/T` is always used. |
| 6 | Two prober instances could contend for the port if someone re-runs the old manual start command | LOW | The service holds the port first; a second bind fails loudly. Worth an operator note: **do not run §2.2 any more.** |
| 7 | The console cannot distinguish SLOW from DOWN (§14.2) | LOW-MEDIUM | Recommended follow-up in `server.ts`; latency is the only current signal. |

---

**Chain Key ID:** `360ea36c28e66d9d`