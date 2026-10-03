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
| `install.ps1` | Idempotent installer. Self-elevates. Validates the account empirically. Fail-closed. |
| `uninstall.ps1` | Full reversal. Leaves the token file and the NSSM tooling alone unless told otherwise. |
| `verify.ps1` | Read-only gate. Exits non-zero on any failed check. `-SelfHealTest` also proves crash recovery. |
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

# remove everything
.\uninstall.ps1
.\uninstall.ps1 -PurgeNssm -PurgeLogs      # also delete the tooling and logs
```

## 3. WHAT THE INSTALLER ACTUALLY DOES

| # | Step | Why |
|---|---|---|
| 1 | Resolve **absolute** `node.exe`, absolute `node_modules/tsx/dist/cli.mjs`, absolute `host_prober.ts` | Session 0 has no interactive shell and no user environment. Nothing in the command line is resolved through `PATH`, so it cannot depend on one. |
| 2 | Resolve NSSM; download `2.24-101` and **verify SHA-1** against the value published on nssm.cc; place it under `%LOCALAPPDATA%` | The stable 2.24 build is explicitly unsupported on Windows 10/11 per the vendor. The binary is placed **outside the repository** so it cannot be committed. |
| 3 | Read the token from `%APPDATA%\sovereign-commander-console\secrets\host-prober-token.txt`; require ≥32 chars; report **length only** | The token is never echoed, never typed on a command line, never committed. |
| 4 | Pin the service environment: `PATH` rebuilt from HKLM+HKCU registry values, all `HOST_PROBER_*`, and the **measurement identity** (see §5) | A service that inherits a shell's `PATH` fails at boot, which is the defect being removed. |
| 5 | Remove any previous registration | Re-running the installer is safe. |
| 6 | Register, then set `AppDirectory`, `Start=SERVICE_DELAYED_AUTO_START`, `AppExit`, `AppThrottle`, `AppRestartDelay`, `AppStopMethodConsole=0`, `AppStdout/AppStderr` with rotation, `AppEnvironmentExtra`, and SCM Recovery actions | Three independent restart layers — see §4. |
| 7 | Select the service account **empirically** | See §6. |
| 8 | Free the port if needed, start, then gate on: `/probe/health` ok, **unauthenticated `/probe/mcp/status` == 401**, and a real measurement | A service that starts but fails the auth check is a failure, not a success. |

## 4. RESTART POLICY — THREE LAYERS

| Layer | Mechanism | Trigger |
|---|---|---|
| 1 | NSSM `AppExit` | The prober process exits. `Default=Restart`, plus explicit `0→Restart`, `1→Restart`, `2→Reboot` for the host-prober's documented exit codes. `AppThrottle`/`AppRestartDelay` = 3000 ms. |
| 2 | SCM Recovery actions | `nssm.exe` itself dies. `restart/5000`, `restart/10000`, `restart/30000`, counter reset every 86400 s. |
| 3 | `SERVICE_DELAYED_AUTO_START` | Host boot, with no user signed in. Delayed so a slow start-up cannot make the SCM declare the service failed. |

`AppStopMethodConsole=0` makes `nssm stop` deliver a console control event, so
the prober's `SIGINT` handler runs `handle.close()` and reaps its live MCP and
Chromium children. **Always stop this service with `nssm stop`, never Task
Manager** (see `../HOST_PROBER.md` §12).

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

## 7. SECURITY

Unchanged and re-verified after every install:

| Control | Post-install evidence |
|---|---|
| Bearer token still required | `GET /probe/mcp/status` with no `Authorization` header → **HTTP 401** `{"ok":false,"error":"unauthorized"}` |
| Token never printed | Only `length=43` is reported. `nssm get … AppEnvironmentExtra` is never called, because it prints the value. All `nssm` output is passed through a redactor before display. |
| Token removed on uninstall | It lives only in the service registry key; `uninstall.ps1` asserts the key is gone. The token **file** is deliberately preserved. |
| Loopback-only bind | `Get-NetTCPConnection` must show `127.0.0.1`, never `0.0.0.0`. The installer refuses a non-loopback `-Bind`. |

## 8. KNOWN LIMITATIONS

- **The account is `LocalSystem`, not the interactive user.** A service cannot
  run as a user without a stored password. §5 pins the profile so the
  measurement identity is explicit and correct, but the process identity is not
  the operator's.
- **An actual reboot was not performed.** Boot start is configured
  (`AutomaticDelayedStart`) and every other link is proven, but the power-on
  path itself is **UNVERIFIED**.
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