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

## 10. INSTALLING AS A SERVICE (documentation only — nothing was installed)

Pick **one**. All three require `tsx` and this repo on the host.

### 10.1 NSSM (recommended — native Windows service)

```powershell
# 1. Download nssm from https://nssm.cc/download , extract to C:\tools\nssm
# 2. Register (run elevated):
C:\tools\nssm\nssm.exe install SovereignHostProber `
  "C:\Program Files\nodejs\node.exe" `
  "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\node_modules\tsx\dist\cli.mjs" `
  "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\scripts\host_prober.ts"

# 3. Set the service environment (scopes the secret to THIS service):
C:\tools\nssm\nssm.exe set SovereignHostProber AppEnvironmentExtra `
  HOST_PROBER_TOKEN=<token> `
  HOST_PROBER_ALLOWED_HOSTS=host.docker.internal `
  HOST_PROBER_ROOT=E:\Servers-Center

# 4. Working directory (so the repo manifest is found):
C:\tools\nssm\nssm.exe set SovereignHostProber AppDirectory `
  "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console"

# 5. Start and confirm:
C:\tools\nssm\nssm.exe start SovereignHostProber
netstat -ano | Select-String ":39711"   # expect 127.0.0.1:39711 LISTENING
```

### 10.2 Task Scheduler

```powershell
$action = New-ScheduledTaskAction `
  -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\node_modules\tsx\dist\cli.mjs C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\scripts\host_prober.ts" `
  -WorkingDirectory "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console"

# Secrets must not be typed on the command line. Preferred: a SYSTEM-scoped
# environment variable set once with setx /M, which the task inherits on logon.
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "SovereignHostProber" `
  -Action $action -Trigger $trigger -Settings $settings `
  -User "NT AUTHORITY\SYSTEM" -RunLevel Highest
```

### 10.3 PM2

```powershell
npm i -g pm2
pm2 start "C:\Program Files\nodejs\node.exe" `
  --name sovereign-host-prober `
  --cwd "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console" `
  -- "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\node_modules\tsx\dist\cli.mjs" `
       "C:\Users\AA5II\sovereign-commander-console\sovereign-commander-console\scripts\host_prober.ts"
pm2 save
pm2 startup     # then run the printed command elevated
```

> **Caveat:** PM2 and Task Scheduler both inherit the **user** environment, which
> is why the token should be set machine-wide (`setx /M`) or, preferably, scoped to
> the service as shown for NSSM.

---

## 11. VERIFYING AN INSTALLATION

```powershell
# 1. Liveness (unauthenticated)
curl.exe -s http://127.0.0.1:39711/probe/health

# 2. Measured status (authenticated)
curl.exe -s -H "Authorization: Bearer $env:HOST_PROBER_TOKEN" `
  http://127.0.0.1:39711/probe/mcp/status

# 3. Bound to loopback only — never 0.0.0.0
netstat -ano | Select-String ":39711"

# 4. From inside the running console container (read-only; does not disturb it)
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
  **Operational rule: always stop the prober gracefully.** With NSSM, use
  `nssm stop SovereignHostProber` rather than Task Manager; with PM2 use
  `pm2 stop`. The proper fix is a Windows **Job Object** with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, which requires native code and therefore
  a dependency the Commander has not approved — not implemented.
- **Concurrency of Chromium.** Probes of `chrome-devtools` and `playwright` are
  bounded to 3 in parallel, but a sweep can transiently run two browsers at once.
  Verified non-disruptive to a concurrent interactive Chrome session (probes use
  `--headless --isolated`), though sustained repeated sweeping is unproven.

---

## 13. TROUBLESHOOTING

| Symptom | Likely cause | Action |
|---|---|---|
| `HOST_PROBER_TOKEN must be set…` | Token missing/short | §3 |
| `HOST_PROBER_BIND="…" is refused` | Non-loopback bind attempted | Remove the variable |
| Console gets `UNVERIFIABLE / PROBER_UNREACHABLE` | Prober down, or Host header refused | Start the service; ensure `HOST_PROBER_ALLOWED_HOSTS` contains `host.docker.internal` |
| Console gets `UNVERIFIABLE / PROBER_UNAUTHORIZED` | Token mismatch | Compare both sides; `GET /probe/health` still answers 200, which distinguishes "down" from "wrong token" |
| `429 rate limited` | >30 requests/min from one peer | Wait 60 s, or cache client-side |
| Server reports `UNVERIFIABLE / ENTRYPOINT_ABSENT` | Server not on this host, or `HOST_PROBER_ROOT` wrong | Check the root; the probe never guessed |
| Server reports `UNVERIFIABLE / SPAWN_PERMISSION_DENIED` | Prober lacks execute rights | Run as the account that owns the Servers Center tree |
| GitHub server `OFFLINE` | PowerShell wrapper, or missing PE binary | The prober already invokes the `.exe`; check the entry in the manifest |

---

**Chain Key ID:** `360ea36c28e66d9d`