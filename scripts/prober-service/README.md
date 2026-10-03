# HOST PROBER — WINDOWS SERVICE

**Chain Key ID:** `360ea36c28e66d9d`

Permanent, self-healing Windows service for `scripts/host_prober.ts`, using
NSSM. Replaces the transient `Start-Process npx.cmd tsx scripts/host_prober.ts`
process, whose absence silently dropped the console from a measured `70/100`
to its fallback.

Full operator manual: [`../HOST_PROBER.md`](../HOST_PROBER.md) §10 and §14.

---

## 1. FILES

| File | Purpose |
|---|---|
| `install.ps1` | Idempotent installer. Self-elevates. Validates the account empirically. Fail-closed. Registers the recovery task and writes the install-time expectations. |
| `uninstall.ps1` | Full reversal. Removes the recovery task FIRST, then the service. Leaves the token file and the NSSM tooling alone unless told otherwise. |
| `verify.ps1` | Read-only gate. Exits non-zero on any failed check. `-SelfHealTest` also proves crash recovery. Checks 9-11 assert the cold-boot chain. |
| `boot-verdict.ps1` | **The one command to run after a reboot.** Prints `BOOT OK` or `BOOT FAILED` with the specific failed check. Needs no elevation. `-Json` for machine consumption. |
| `boot-guard.mjs` | The service wrapper. Runs the startup readiness self-test on every start, writes the record, then runs the prober unchanged. Node built-ins only — no new dependency. |
| `recover-prober.ps1` | The independent recovery action. Idempotent by construction. Writes its own result into the readiness file. |
| `install-recovery-task.ps1` | Registers `\Sovereign\HostProberRecovery`. Re-runnable; asserts the wiring it created. |
| `remove-recovery-task.ps1` | Exact reversal of the above. Does not touch the service. `-WhatIfOnly` prints exactly what it would change. |
| `common.ps1` | Shared constants and helpers. Importing it has no side effects. |
| `send-ctrl-c.ps1` | Sends `CTRL_C_EVENT` to another process's console group (graceful stop). |

## 2. QUICK USE

```powershell
# install (elevates itself; stops a manual prober only if you allow it)
.\install.ps1 -AdoptExistingProber

# prove everything, non-destructively
.\verify.ps1

# prove crash recovery (kills the prober, measures the interval, waits for recovery)
.\verify.ps1 -SelfHealTest

# AFTER ANY REBOOT - the boot verdict
.\boot-verdict.ps1
.\boot-verdict.ps1 -Json

# remove everything
.\uninstall.ps1
.\uninstall.ps1 -PurgeNssm -PurgeLogs      # also delete the tooling and logs
```

## 2b. FILES THE INSTRUMENT WRITES

| Path | Owner | Purpose |
|---|---|---|
| `C:\ProgramData\sovereign-commander-console\readiness.json` | wrapper + recovery script | The record. The wrapper owns `service`/`boot`/`verdict`; `recover-prober.ps1` owns `recovery`. Both merge under one exclusive lock and write atomically. |
| `C:\ProgramData\sovereign-commander-console\expectations.json` | installer | What was PINNED, so the wrapper can prove at boot that what it sees is what was pinned. No secret: the token appears by NAME only. |
| `%APPDATA%\sovereign-commander-console\host-prober.service.log` | NSSM | Rotated per start. The wrapper's single JSON line and the prober's banner are both here. |

The record lives in `ProgramData`, **not** `%APPDATA%`, on purpose: whether
`APPDATA` is pinned correctly is one of the things being tested, so the place the
verdict is stored must not depend on the thing being verified.

## 3. WHAT THE INSTALLER ACTUALLY DOES

| # | Step | Why |
|---|---|---|
| 1 | Resolve **absolute** `node.exe`, absolute `node_modules/tsx/dist/cli.mjs`, absolute `host_prober.ts`, and the absolute `boot-guard.mjs` | Session 0 has no interactive shell and no user environment. Nothing in the command line is resolved through `PATH`, so it cannot depend on one. |
| 2 | Resolve NSSM; download `2.24-101` and **verify SHA-1** against the value published on nssm.cc; place it under `%LOCALAPPDATA%` | The stable 2.24 build is explicitly unsupported on Windows 10/11 per the vendor. The binary is placed **outside the repository** so it cannot be committed. |
| 3 | Read the token from `%APPDATA%\sovereign-commander-console\secrets\host-prober-token.txt`; require ≥32 chars; report **length only** | The token is never echoed, never typed on a command line, never committed. |
| 4 | Pin the service environment: `PATH` rebuilt from HKLM+HKCU registry values, all `HOST_PROBER_*`, and the **measurement identity** (see §5) | A service that inherits a shell's `PATH` fails at boot, which is the defect being removed. |
| 4b | Write `expectations.json`: every non-secret pinned variable + every absolute path | Without it, "the environment is pinned" stays a belief about the installer instead of a measurement taken by the process that has to live with it. |
| 5 | Remove any previous registration, then **wait until the name is genuinely released** | `nssm remove` returns exit 0 and prints "removed successfully" while the service is only marked for deletion. Re-installing immediately then fails with `exit 5 Error creating service!`. Measured, then asserted. |
| 6 | Register, then set `AppParameters` (**guard path first, asserted on read-back**), `AppDirectory`, `Start=SERVICE_DELAYED_AUTO_START`, `AppExit`, `AppThrottle`, `AppRestartDelay`, `AppStopMethodConsole=0`, `AppStdout/AppStderr` with rotation, `AppEnvironmentExtra`, and SCM Recovery actions | Four restart layers — see §4. |
| 7 | Select the service account **empirically** | See §6. |
| 8 | Free the port if needed, start, then gate on: `/probe/health` ok, **unauthenticated `/probe/mcp/status` == 401**, and a real measurement | A service that starts but fails the auth check is a failure, not a success. |
| 9 | Read the readiness record back and refuse to be satisfied with `FAIL`; register the recovery task and **prove it idempotent** by running it twice | See §7 and §8. |

## 4. RESTART POLICY — FOUR LAYERS, ONE OF THEM NEW

| Layer | Mechanism | Trigger |
|---|---|---|
| 1 | NSSM `AppExit` | The prober process exits. `Default=Restart`, plus explicit `0→Restart`, `1→Restart`, `2→Reboot` for the host-prober's documented exit codes. `AppThrottle`/`AppRestartDelay` = 3000 ms. |
| 2 | SCM Recovery actions | `nssm.exe` itself dies. `restart/5000`, `restart/10000`, `restart/30000`, counter reset every 86400 s. |
| 3 | `SERVICE_DELAYED_AUTO_START` | Host boot, with no user signed in. Delayed so a slow start-up cannot make the SCM declare the service failed. |
| 4 | **`\Sovereign\HostProberRecovery`, triggered at logon** — see §8 | The service **never started**. Layers 1-3 all require a start to have happened at least once. |

`AppStopMethodConsole=0` makes `nssm stop` deliver a console control event, so
the prober's `SIGINT` handler runs `handle.close()` and reaps its live MCP and
Chromium children. **Always stop this service with `nssm stop`, never Task
Manager** (see `../HOST_PROBER.md` §12).

> **MEASURED, load-bearing:** the wrapper does **not** forward the stop signal to
> the prober. On Windows libuv maps a signal *name* to `TerminateProcess`, so
> `child.kill('SIGINT')` never delivers SIGINT — it abruptly kills the child. The
> first stop through the wrapper logged
> `the prober exited (code=null signal=SIGINT)`, which is the signature of
> `TerminateProcess`, not of Node's SIGINT handler running `process.exit(0)`
> (that reports `code=0 signal=null`). Forwarding was therefore converting a
> graceful stop into exactly the abrupt kill that strands Chromium grandchildren.
> The console control event already reaches every process on the console; the
> wrapper only escalates to termination after a 60 s deadline, and logs it.
>
> **After the fix, measured over repeated stops:** the prober's own `SIGINT`
> handler runs, `handle.close()` completes, and `0` listeners remain on the port.
> The exit code the wrapper hands to NSSM is the exit code of the layer it spawns
> — tsx's CLI, which installs no SIGINT handler — and that was observed as **both**
> `code=0` (the prober closed first) and `code=3221225786`
> (`0xC000013A`, `STATUS_CONTROL_C_EXIT`, the event reached the CLI first). Both
> leave the instrument stopped with the port released, and both are covered by
> `AppExit Default=Restart`, so the restart policy is unaffected. The distinction
> is logged, not normalised away.

**Measured crash recovery: `taskkill /F /T` on the prober's node process →
reachable again in 3466 ms, 7/7 ONLINE, console back to `70/100`.**

## 5. MEASUREMENT IDENTITY (read this before changing the account)

A service running as `LocalSystem` does **not** measure the same machine the
operator sees. Measured on this host:

| Service env | `pyright` verdict | Console score |
|---|---|---|
| `LocalSystem` default (`APPDATA` = `…\systemprofile\AppData\Roaming`) | `OFFLINE / EXIT_NONZERO_BEFORE_HANDSHAKE` | **60/100** |
| `APPDATA`/`USERPROFILE` pinned to the operator profile | `ONLINE / HANDSHAKE_COMPLETED` | **70/100** |

Cause is declared in `config/servers_center_manifest.json` itself: the `pyright`
package lives in the per-user site-packages, CPython derives that path from
`%APPDATA%`, and the manifest declares `command.env.passThrough: ["APPDATA"]`.

The installer therefore pins `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`HOMEDRIVE`, `HOMEPATH`, `TEMP`, `TMP` to `-MeasuredProfile` (default: the
installing user's profile). These are paths, not secrets. Pass
`-NoProfileMapping` to opt out and measure the SYSTEM profile instead — the
score will then legitimately read 60/100.

### 5b. THE PLATFORM SUBSTITUTES `USERPROFILE` — AND THE WRAPPER FIXES IT

**Measured on the first real start through the wrapper:**

```
asDeliveredByPlatform.mismatched:
   USERPROFILE: platform='C:\WINDOWS\system32\config\systemprofile'
                pinned='C:\Users\AA5II'
```

Every other pinned variable — `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`,
`HOMEPATH`, `TEMP`, `TMP`, `PATH`, all five `HOST_PROBER_*` — arrived exactly
as pinned. Only `USERPROFILE` was replaced, with the service account's own
profile. This nssm build contains **no `USERPROFILE` string at all** (measured,
UTF-16LE scan of `nssm.exe`), so nssm is not the author either; the substitution
happens while the service environment block is assembled. Pinning it in
`AppEnvironmentExtra` therefore cannot work, and re-pinning at install time will
not change that.

The fix has to be applied at the last point where nothing can override it: the
wrapper sets `process.env.USERPROFILE` immediately before spawning the prober,
which is exactly the environment block the child receives. The record states
**both** what the platform delivered and what the wrapper did, so the correction
is visible rather than hidden:

```
enforcedByWrapper:
   USERPROFILE -> 'C:\Users\AA5II'   (platform delivered 'C:\WINDOWS\system32\config\systemprofile')
```

Enforcement is deliberately limited to the identity variables
(`USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOMEDRIVE`, `HOMEPATH`, `TEMP`,
`TMP`). `PATH` is not enforced (everything is referenced absolutely anyway) and
`HOST_PROBER_*` is not enforced: if one of those drifts, the instrument is
measuring something other than what was installed, and that must **fail loudly**
instead of being quietly corrected.

### 5c. THE PIN IS PROVEN BY ITS CONSEQUENCE, NOT BY ITS PRESENCE

The wrapper does not stop at "the pin is present". It locates the directory the
pin points at and checks that the `pyright` package is actually in it:

```json
"pyrightUserSite": {
  "pythonRoot": "C:\\Users\\AA5II\\AppData\\Roaming\\Python",
  "versions": ["Python314"],
  "sitePackagesContainingPyright": ["C:\\Users\\AA5II\\AppData\\Roaming\\Python\\Python314\\site-packages"],
  "found": true
}
```

If `found` were `false`, `pinnedEnvironment` FAILS with the reason, because that
is the state in which the console score is silently 10 points wrong. The check
likewise counts the manifest's declared inventory (`mcp` = 7 servers, `lsp` = 6)
so an inventory that has shrunk is detectable.

## 6. THE ACCOUNT, AND WHY IT IS `LocalSystem`

Running as an interactive user requires that user's **password** in the LSA
secret store so the SCM can log the service on at boot with nobody signed in.
No password is available to this installer and none may ever be typed into a
script or a command line.

`install.ps1` therefore *tries* the account and **verifies** the result rather
than assuming it:

```
--- attempting account: DESKTOP-7FSRQ0H\AA5II ---
ObjectName set to 'DESKTOP-7FSRQ0H\AA5II' (SCM reports StartName='LocalSystem')
[WARN] the SCM did not accept 'DESKTOP-7FSRQ0H\AA5II' ... Attempt rejected.
--- attempting account: LocalSystem ---
[OK]   account 'LocalSystem' WORKS: service Running, /probe/health ok=true
```

**Guard against a false positive, measured:** `nssm set ObjectName` with a
non-existent or unauthorised account returns **exit 0** while the SCM silently
keeps `LocalSystem`, and the service starts and looks perfect. The installer
compares `Win32_Service.StartName` against the requested account and rejects the
attempt on mismatch.

A `LocalSystem` service logon presents the **machine account**
(`DESKTOP-7FSRQ0H$`), never the literal string `SYSTEM` — measured. The wrapper
therefore derives the service-account profile from the account declared in
`expectations.json`, not from `USERNAME`, and records the declared account and
the profile side by side.

## 7. THE STARTUP READINESS SELF-TEST (Part A)

The SCM starts this service with nobody signed in. Every cold-boot assumption
was previously *structural* only. On every start the wrapper now **measures** the
conditions the prober depends on, emits one machine-readable JSON line
(`SOVEREIGN_BOOT_READINESS {…}`) to the service log, and writes the full record
to `readiness.json`.

| Check | Severity | Hazard it covers | How it is decided |
|---|---|---|---|
| `account` | REQUIRED | No user profile loaded | `USERNAME` present; integrity level from the `S-1-16-<rid>` SID in `whoami /groups`; the declared account and its profile recorded |
| `serverRoot` | REQUIRED | `E:\Servers-Center` not mounted | `HOST_PROBER_ROOT` is absolute, exists, is a directory, `readdir` succeeds, entry count recorded, and it equals what was pinned |
| `pinnedEnvironment` | REQUIRED | `APPDATA` re-derived at runtime | Every non-secret pinned variable compared byte-for-byte against `expectations.json`; identity variables re-asserted in-process; `HOST_PROBER_TOKEN` asserted **present and ≥32 chars, never read**; the pyright user-site consequence checked |
| `runtimeEntries` | BLOCKER | Defender / filter driver holding a file | `node.exe`, the tsx entry and the prober script `stat`ed, and the two that execute were actually read by this process |
| `workingDirectoryAndPath` | REQUIRED | Working directory / PATH not established | `cwd` absolute and equal to `AppDirectory`, PATH non-empty and containing node's own directory, `SystemRoot` present |
| `repoAndManifest` | REQUIRED | Manifest missing → inventory shrinks silently | `HOST_PROBER_REPO_ROOT` and `config/servers_center_manifest.json` present; declared `mcp`/`lsp` counts reported |
| `host.docker.internal` | ADVISORY | Docker engine not started | `getaddrinfo` (honours the hosts file) **and** `dns.resolve4` (bypasses it), so a stale static hosts entry is distinguishable from the Docker DNS answering |

**Severity is separated from "can it start", on purpose.** Conflating them
produces either a crash loop or a silent lie:

- `BLOCKER` failed → the prober cannot run. The wrapper **refuses to spawn it**,
  prints an unambiguous banner to stdout *and* stderr, and stays alive
  re-announcing every 60 s. It never exits, so NSSM cannot turn a fatal
  precondition into a 3-second restart storm, and the service still reports its
  state truthfully to the SCM.
- `REQUIRED` failed → the prober serves, but the measurement is wrong. Verdict `FAIL`.
- `ADVISORY` failed → a boot hazard is present right now. Verdict `DEGRADED`.

Verdict: `READY` (everything present) / `DEGRADED` (hazard present) / `FAIL`
(measurement untrustworthy).

**Defender is deliberately NOT queried on the start path.** `Get-MpComputerStatus`
measured **1897 ms** on this host and can block for seconds while Defender is
itself still starting — precisely the moment it must not be on a service start
path. The symptom (a file that cannot be opened) is measured at start; the cause
is asked by `boot-verdict.ps1`, off that path.

## 8. THE INDEPENDENT RECOVERY PATH (Part B)

`\Sovereign\HostProberRecovery` — **trigger: at logon of the profile the
instrument measures. Principal: `NT AUTHORITY\SYSTEM`, highest run level,
ServiceAccount logon type.** Action: `recover-prober.ps1`.

| Requirement | How it is met |
|---|---|
| Idempotent | The first thing the script does is read the service state. A healthy Running service produces `NOOP_SERVICE_RUNNING`, exit 0, and **zero** side effects. `verify.ps1` asserts this by running it twice and requiring the service PID to be unchanged. |
| Does not fight the service | It **never** kills or restarts a Running service. Running-but-unhealthy is reported as `NOOP_SERVICE_RUNNING_UNHEALTHY` and exits non-zero rather than "fixing" it. The only action it ever takes on a non-Running service is `Start-Service` — exactly what the SCM would have done at boot. |
| Writes its own result to the readiness file | Merged under the `recovery` key, under the same exclusive lock the wrapper uses, with an atomic rename. **Measured bug fixed:** the wrapper's first version overwrote the whole file, so every restart erased the recovery record — including the one written moments earlier at logon. |
| Fully reversible | `remove-recovery-task.ps1` unregisters the task, removes the folder only if empty, **asserts the task is gone by reading the scheduler back**, and does not touch the service. `uninstall.ps1` calls it first. |

**Why a logon-triggered task and not the alternatives:**

- **SCM Recovery actions** — rejected: not independent. They fire only for a
  service that was started and then failed. A service that never starts at boot
  gets no recovery action at all.
- **A watchdog service** — rejected: another process that can fail at exactly the
  same moment (slow boot), and it would be *watching* the service.
- **A WMI permanent event subscription** — rejected: heavier to install and much
  harder to reverse cleanly than `Unregister-ScheduledTask`.
- **`ONBOOT` instead of `ONLOGON`** — rejected: at `ONBOOT` the machine is in
  exactly the state these hazards describe (Docker down, volume possibly
  unmounted), so recovering there re-runs the same failure with less information.
  At logon the machine has settled. The acknowledged cost is that a machine
  nobody signs into gets no second chance — and on this host the whole
  measurement chain is per-user anyway, because Docker Desktop runs in the user
  session.

## 9. THE BOOT VERDICT (Part C)

```powershell
.\boot-verdict.ps1
```

Needs no elevation. Prints `BOOT OK` or `BOOT FAILED` on its own line and exits
0 or 1. It does **not** re-run the interactive checks — by the time a human runs
a command, Docker is up and the volume is mounted, so every check would pass even
if the service had never started. It answers "did the SCM start it during **this**
boot, and did everything it needs exist **at that moment**", from four
independent kinds of evidence:

1. **A** — did it start at boot: `boot.uptimeSecAtStart` vs current uptime;
   `recordedAtUtc` vs `LastBootUpTime`; `BootId` vs current `BootId` (increments
   once per power-on, so a clock change cannot fake it); and the service
   process's `CreationDate` vs `LastBootUpTime` — a source the wrapper did not
   write. A record from an earlier boot is reported as stale.
2. **B** — did the preconditions hold then: the record's per-check verdicts.
3. **C** — is it up now: service state, loopback listener, `/probe/health`.
4. **D** — does the console actually reach it now: host-side name resolution is
   **not sufficient** (Docker Desktop leaves a static hosts-file entry that
   survives with the engine stopped), so the end-to-end path is asked of the
   console, which lives in the container and is the only vantage point that can
   answer it truthfully.
5. **E** — Defender, off the start path.

`-Json` emits the same verdict as one object. `-AllowHazards` lets `DEGRADED`
exit 0; the default fails loudly.

## 10. SECURITY

Unchanged and re-verified after every install:

| Control | Post-install evidence |
|---|---|
| Bearer token still required | `GET /probe/mcp/status` with no `Authorization` header → **HTTP 401**. Re-asserted in `verify.ps1` *after* all resilience work, so a future change to the auth gate cannot hide behind a passing readiness verdict. |
| Token never printed | Only `length=43` is reported, and the wrapper asserts the token **by length only** — the value never enters the record. `nssm get … AppEnvironmentExtra` is never called, because it prints the value. All `nssm` output is passed through a redactor before display. |
| Token removed on uninstall | It lives only in the service registry key; `uninstall.ps1` asserts the key is gone. The token **file** is deliberately preserved. |
| Loopback-only bind | `Get-NetTCPConnection` must show `127.0.0.1`, never `0.0.0.0`. The installer refuses a non-loopback `-Bind`. |

## 11. WHAT IS PROVEN BY EXECUTION, AND WHAT IS STILL INFERRED

**This is the honest ledger. `UNVERIFIED` is load-bearing in this project.**

| Link in the chain | Status |
|---|---|
| Service installs, starts, binds loopback only | **PROVEN BY EXECUTION** |
| Unauthenticated `/probe/mcp/status` → 401 | **PROVEN BY EXECUTION** |
| Authenticated `/probe/mcp/status` → 7/7 ONLINE, `MEASURED_BY_PROBER` | **PROVEN BY EXECUTION** |
| Console reads it: `mcpSource=HOST_PROBER_MEASURED`, `70/100` | **PROVEN BY EXECUTION** |
| Crash recovery (`taskkill /F /T` → back up) | **PROVEN BY EXECUTION** — 3466 ms |
| The wrapper is on the service command line and writes a verdict | **PROVEN BY EXECUTION** — `Start-Service` → `verdict=READY`, 7/7 checks |
| Readiness FAIL/DEGRADED are reported loudly, not silently | **PROVEN BY EXECUTION** — `verdict=DEGRADED`, `ADVISORY:host.docker.internal… does NOT resolve: ENOTFOUND` |
| `USERPROFILE` substitution by the platform | **PROVEN BY EXECUTION** — `platform='…\systemprofile'` vs `pinned='C:\Users\AA5II'`, corrected in-process |
| pyright user-site consequence of the `APPDATA` pin | **PROVEN BY EXECUTION** — `found=true` at `…\Python314\site-packages` |
| Recovery task registered, wired as SYSTEM at logon | **PROVEN BY EXECUTION** — read back from the scheduler, 5 assertions |
| Recovery path idempotent | **PROVEN BY EXECUTION** — two runs, both `NOOP_SERVICE_RUNNING`, service PID unchanged |
| `tsc --noEmit` clean | **PROVEN BY EXECUTION** |
| **The service actually starts from a cold boot** | **UNVERIFIED** — no power cycle has been performed on this configuration. `SERVICE_DELAYED_AUTO_START` is configured and the readiness record's mechanism to prove it exists and works, but the power-on event itself has not happened. `boot-verdict.ps1` closes this link the first time it runs after a reboot. |
| **A logon-triggered task actually fires at logon and rescues a failed service** | **UNVERIFIED** — the task is registered, asserted, and its action is proven idempotent and correct when invoked. No logon has occurred since registration, and no service failure has been induced for it to rescue. |
| **Docker being down at boot** | **SIMULATED, declared** — the real check was run against a name that provably cannot resolve, returning a real `ENOTFOUND`. Docker was never touched, because touching it is out of scope. Host-side resolution is also **not sufficient** evidence by design; the end-to-end path is asserted by `boot-verdict.ps1` through the console. |
| **Defender holding a file at cold boot** | **PARTIALLY PROVEN** — the *symptom* is measured at every start (the runtime files were opened). The *cause* has not been induced. `boot-verdict.ps1` reports Defender's real-time state and exclusions. |

## 12. KNOWN LIMITATIONS

- **The account is `LocalSystem`, not the interactive user.** A service cannot
  run as a user without a stored password. §5 pins the profile so the
  measurement identity is explicit and correct, but the process identity is not
  the operator's.
- **An actual reboot was not performed.** Boot start is configured
  (`AutomaticDelayedStart`), the readiness record exists and is asserted, and the
  independent recovery path is installed — but the power-on path itself is
  **UNVERIFIED** until someone runs `boot-verdict.ps1` after a real reboot.
- **The wrapper adds one process to the chain** (nssm → node guard → node tsx →
  node prober). It is a transparent proxy: same child, same stdio, same console,
  and the wrapper's exit code is always the prober's own exit code, so the NSSM
  `AppExit` policy applies unchanged. The extra process is the price of being
  able to prove anything at boot at all without editing `host_prober.ts`.
- **`CTRL_C_EVENT` cannot stop the previous manual prober on this host.** The
  event is generated successfully but a background console group does not
  receive it, so `install.ps1 -AdoptExistingProber` escalates to
  `taskkill /T`, and only with explicit `-AllowForcedKill` to `taskkill /F /T`.
  An abrupt kill can strand Chromium; `verify.ps1` measures and reports the
  surviving descendants of exactly the process it stopped.
- **The orphan detector is scoped to the stopped process's own tree.** An
  earlier version matched command lines such as `chrome-devtools-mcp` and
  matched 22 processes belonging to `opencode-cli.exe` — the operator's own MCP
  tooling. It now walks `ParentProcessId` from the target PID and can only ever
  consider that process's descendants.
- **Sustained/soak behaviour is unproven.** Only the runs recorded here.
- **One unexplained anomaly.** A single elevated `Stop-Service` invocation hung
  for 400 s and never sent a stop control; the service was verifiably `RUNNING`
  with `WAIT_HINT 0` the whole time. It could not be reproduced — the same stop
  via `nssm stop` completes in under a second and via `Start-Service`/`Stop-Service`
  inside a bounded job completes normally. `verify.ps1` and every proof script in
  this directory therefore issue service-control calls inside jobs with hard
  timeouts, so a hang can never block a verdict again. The root cause is
  **UNVERIFIED**.