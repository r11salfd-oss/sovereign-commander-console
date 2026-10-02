# LSP Prober — Measured Language Server Protocol Reachability

Chain Key ID: `360ea36c28e66d9d`
Owner: `scripts/lsp_prober.ts` (exclusive), `scripts/LSP_PROBER.md` (exclusive)

---

## 1. Purpose

The console previously reported LSP servers as `STANDBY`/`healthy` because a
**directory existed on disk**. That check has no operational meaning. This
module replaces it with a **real, measured LSP handshake**: it spawns each
declared language server, speaks the LSP base protocol over stdio, and reports
only what it observed.

Three rules are absolute:

1. **Existence is never evidence.** A directory, a `package.json`, or a
   `manifest.json` entry proves nothing about reachability.
2. **Silence is not failure.** A timeout is `UNVERIFIABLE`, not `OFFLINE`.
3. **The denominator is never padded.** If 3 of 6 declared servers are
   genuinely measurable, the report says `measurable: 3` and `total: 6`.

---

## 2. Why MCP's transport cannot be reused

The MCP prober in `scripts/host_prober.ts` speaks **newline-delimited JSON-RPC**:

```
{"jsonrpc":"2.0","id":1,"method":"initialize"}\n
```

**LSP does not.** LSP §Base Protocol is HTTP-shaped:

```
Content-Length: 123\r\n
Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

Consequences of getting this wrong:

| Wrong reader | Symptom |
| --- | --- |
| Newline-delimited reader → LSP server | Blocks forever. The first "line" is the literal string `Content-Length: 123`, which never parses as JSON. Appears as a hang, not an error. |
| LSP reader → newline-delimited server | Never finds `\r\n\r\n`. The buffer grows until the frame limit trips. |

The two transports are not variations of one another; they are different
grammars. `LspFramer` therefore exists as its own component and the MCP prober
cannot supply it.

---

## 3. Spec conformance (fetched 2026-10-02, LSP 3.17 / Base Protocol 0.9)

| Requirement | Source | Implementation |
| --- | --- | --- |
| `Content-Length` is **mandatory** | §Header Part: "The length of the content part in bytes. This header is required." | Missing header → `LspFramingError['missing-content-length']` |
| `Content-Length` is in **bytes** | same | Slicing on `Buffer` before any decode; `encodeLspFrame` uses `Buffer.byteLength` |
| Header part encoded in **ASCII** | §Header Part: "The header part is encoded using the 'ascii' encoding. This includes the '\r\n'" | Headers parsed via `toString('latin1')` (byte-preserving) |
| Two `\r\n` precede the content | §Header Part | Primary separator is `\r\n\r\n`; bare `\n\n` tolerated as tolerance |
| `Content-Type` defaults to `application/vscode-jsonrpc; charset=utf-8`; utf-8 is the only supported charset; treat legacy `utf8` as `utf-8` | §Content Part | UTF-8 decode is the only path; a non-UTF-8 body is a violation |
| `InitializeParams` requires `processId`, `rootUri`, `capabilities`; optional `clientInfo`, `trace`, `workspaceFolders` | §initialize | All sent; `rootUri` points at the scratch workspace |
| `InitializeResult.capabilities` is **REQUIRED**; `serverInfo` optional since 3.15 | §initialize | Absent/empty `capabilities` → `OFFLINE`, never `ONLINE` |
| `initialized` sent once, before any other message | §initialized | Sent immediately after the `initialize` result |
| `shutdown` must be answered before `exit`; it is the only permitted message after shutdown | §shutdown | `await shutdown result`, then `exit` |
| Exit code **0** if shutdown was received, else **1** | §exit | Recorded as `shutdown.clean`; non-zero is surfaced, not hidden |

### InitializeParams actually sent

```jsonc
{
  "processId": <prober pid>,          // parent pid, per spec
  "clientInfo": { "name": "sovereign-commander-console-lsp-prober", "version": "1.0.0" },
  "locale": "en",
  "rootUri": "file:///<scratch>",      // NEVER the repo, NEVER the E: tree
  "capabilities": { /* minimal real client caps: hover, definition, symbols,
                       completion, sync, workspace folders, positionEncodings */ },
  "trace": "off",
  "workspaceFolders": [{ "uri": "file:///<scratch>", "name": "lsp-prober-scratch" }]
}
```

---

## 4. `LspFramer`

```ts
class LspFramer {
  push(chunk: Buffer | string): LspFramedMessage[]
  get bufferedBytes(): number
  reset(): void
}
```

Guarantees, each covered by a unit test:

1. **Partial reads** — internal state is a `Buffer`, never a string. A frame split
   at *any* byte boundary (tested byte-at-a-time) yields exactly one message.
2. **Multiple frames per chunk** — `push` returns an array and drains greedily.
3. **Byte semantics** — proven with a payload containing Arabic (2 bytes/char) and
   an astral-plane rune (4 bytes). A `.length`-based client truncates it; see §8.
4. **Bounded memory** — `Content-Length` is validated *before* any allocation.
   A claim of 9,000,000,000 bytes against an 8 MiB limit is rejected
   immediately, so a hostile or broken server cannot induce a huge buffer.
5. **Tolerant, not credulous** — unknown headers are retained and ignored;
   header names are matched case-insensitively; a bare `\n\n` terminator is
   accepted.
6. **Truncation is visible** — `bufferedBytes > 0` after the stream ends means a
   frame was cut short. The prober treats that as `OFFLINE`
   (`framing-violation`) rather than a successful probe.

`LspFramingError` codes: `header-section-too-large`, `missing-content-length`,
`invalid-content-length`, `content-length-too-large`, `body-not-utf8`,
`body-not-json`.

---

## 5. Handshake state machine

```
                 ┌──────────────────────────────────────────┐
resolve launcher ─┤ no launcher ─────────────────► UNVERIFIABLE│
  │              └──────────────┬───────────────────────────┘
  │ found                       │ spawn
  │              ┌──────────────▼───────────────────────────┐
  │              │ ENOENT / spawn error ─────► UNVERIFIABLE │
  │              │                             (dependency-  │
  │              │                             missing)     │
  │              ├──────────────────────────────────────────┤
  │              │ exit before answering ────► OFFLINE     │
  │              │ framing violation ─────────► OFFLINE     │
  │              │ JSON-RPC error response ───► OFFLINE     │
  │              │ missing capabilities ──────► OFFLINE     │
  │              │ no response (timeout) ─────► UNVERIFIABLE │
  │              ├──────────────────────────────────────────┤
  │              │ initialize OK + capabilities ► ONLINE    │
  │              └──────────────────────────────────────────┘
  │
  ▼
initialize ─► initialized ─► didOpen(scratch) ─► ONE declared-capability
request ─► didClose ─► shutdown ─► await result ─► exit ─► await process exit
```

Every exit path runs `finally { session.dispose() }`, which kills the process
**tree** (`taskkill /T /F` on Windows, signals elsewhere).

### Failure classification

| State | Meaning | Reasons |
| --- | --- | --- |
| `ONLINE` | `initialize` returned a valid result **and** capabilities were observed | `none` |
| `OFFLINE` | Conclusive: executable exists but is broken | `child-exited-early`, `child-exited-nonzero`, `framing-violation`, `protocol-violation`, `initialize-error-response` |
| `UNVERIFIABLE` | Could not be attempted or concluded | `launcher-not-found`, `launcher-not-a-language-server`, `entry-directory-missing`, `spawn-failed`, `dependency-missing`, `platform-mismatch`, `initialize-timeout-silent`, `total-deadline-exceeded`, `not-declared-in-manifest`, `io-error` |

**Answers vs silence.** A server that replies with a JSON-RPC *error* is talking
and is therefore `OFFLINE` — that is a real, conclusive malfunction. A server
that says nothing is `UNVERIFIABLE` — silence proves neither reachability nor
failure.

### Timeouts

- `--step-timeout-ms` (default 15 s): bound on `initialize` and `shutdown`.
- `--probe-timeout-ms` (default 8 s): separate, shorter bound on the optional
  capability probe. A server may legitimately be slow on its first real request
  while having completed `initialize`. **A probe timeout does not downgrade
  `ONLINE`** — but it is stated verbatim in `detail` and in
  `capabilityProbe.outcome`, because it means interactivity beyond `initialize`
  is not proven.
- `--timeout-ms`: sets both step and total.
- Watchdog: if the whole chain stalls, the process writes an explicit report and
  exits **3**. A prober that exits 0 having printed nothing is the exact failure
  this module exists to eliminate.

---

## 6. Launcher resolution (evidence, never inference)

Resolution is driven by the manifest's own
`command.launcherCandidates` / `command.args`, falling back to a built-in table.
Two evidence paths, tried in order:

1. `<entry>/node_modules/<binName>/package.json` → its `bin` field → spawn with
   `process.execPath` (node). This avoids `.cmd` shims entirely, which cannot be
   spawned without a shell on modern Node.
2. `<binName>` on `PATH` → spawn the resolved executable directly.

**The allow-list is the load-bearing anti-fabrication control.** A `.bin`
directory holding `tsc` / `tsserver` / `eslint` does *not* make a language
server: those are a compiler CLI, a compiler daemon (proprietary protocol) and a
linter CLI (its own protocol). Accepting them would recreate the original defect.

---

## 7. Output shape

Drop-in for the MCP prober's `/probe/status`. See
`scripts/LSP_PROBER.md` §Measured results for the real payload.

```jsonc
{
  "summary":     { "total": 6, "online": 3, "offline": 0, "unverifiable": 3, "measurable": 3 },
  "denominator": { "declaredInManifest": 6, "declaredEntryDirectoryExists": 4,
                   "languageServerLauncherResolved": 3, "handshakeCompleted": 3 },
  "servers": [ {
    "id": "bash",
    "state": "ONLINE",
    "probeMethod": "lsp-stdio-content-length",
    "lastProbedAt": "2026-10-02T16:42:11.318Z",
    "durationMs": 525,
    "reason": "none",
    "detail": "shutdown acknowledged; exit code 0 as required by spec",
    "declared": { "entry": "servers/lsp/bash", "version": "5.8.1", "entryKind": "directory",
                  "entryExists": true, "handshakeFeasibility": "ELIGIBLE_NOT_EXECUTED",
                  "handshakeBlockers": [] },
    "launcher": { "command": "...node.exe", "args": ["...cli.js", "start"],
                  "kind": "node-script", "evidence": "node_modules/.../package.json bin -> ..." },
    "serverInfo": null,
    "capabilityCounts": { "total": 11, "providers": 10, "booleanFlags": 7,
                          "providerKeys": ["hoverProvider", "..."], "namespaces": { "core": 11 } },
    "capabilityProbe": { "method": "textDocument/hover", "outcome": "answered", "note": "..." },
    "initialize": { "answered": true, "msToFirstResponse": 352 },
    "shutdown":  { "clean": true, "exitCode": 0, "signal": null }
  } ],
  "generatedAt": "...",
  "probeMethod": "lsp-stdio-content-length",
  "host": { "platform": "win32-x64", "nodeVersion": "v24.19.0", "side": "host", "workspaceRoot": "..." },
  "notes": [ "..." ]
}
```

`capabilityCounts` is a **count**, never a capability dump: consumers need to
know a server is feature-bearing, not to receive a multi-kilobyte tree that
differs per server.

`declared.handshakeFeasibility` echoes the manifest's own claim so the console
can show agreement between *declared* and *measured*. It is never used as
evidence.

---

## 8. Measured results (2026-10-02, host `win32-x64`, node v24.19.0)

**Real output. Not a projection.**

```json
{"summary":{"total":6,"online":3,"offline":0,"unverifiable":3,"measurable":3},
 "denominator":{"declaredInManifest":6,"declaredEntryDirectoryExists":4,
 "languageServerLauncherResolved":3,"handshakeCompleted":3}}
```

| declared id | probed? | state | reason | evidence |
| --- | --- | --- | --- | --- |
| `typescript` | no | `UNVERIFIABLE` | `launcher-not-a-language-server` | `.bin` holds only `tsc`, `tsserver` — a compiler CLI and a compiler daemon. `typescript-language-server` absent from disk and PATH. |
| `eslint` | no | `UNVERIFIABLE` | `launcher-not-a-language-server` | `.bin` holds only `acorn`, `eslint`, `node-which`. `eslint-language-server` absent from disk and PATH. |
| `bash` | **yes** | **`ONLINE`** | `none` | initialize 352 ms, 11 capabilities / 10 providers, hover probe answered, exit 0 |
| `yaml` | **yes** | **`ONLINE`** | `none` | initialize 467 ms, 16 capabilities / 14 providers, hover probe answered, exit 0 |
| `pyright` | **yes** | **`ONLINE`** | `none` | initialize 437 ms, 16 capabilities / 14 providers, **hover probe timed out at 8 s** (disclosed in `detail`), exit 0 |
| `dotnet` | no | `UNVERIFIABLE` | `entry-directory-missing` | No Servers Center asset; neither `omnisharp` nor `csharp-ls` on PATH. The .NET SDK is a toolchain, not an LSP endpoint. |

### The honest denominator

- **6** declared in the manifest.
- **4** have a `servers/lsp/<id>` directory on `E:\`.
- **3** resolve to a runnable language-server launcher: `bash`, `yaml`, `pyright`.
- **3** completed a real handshake.

**Only 3 of 6 are genuinely measurable on this machine.** The other 3 are not
"down" — they were never installable as declared. Reporting `total: 4` by
dropping the unprobeable rows, or `online: 6`, would both be fabrications. The
report keeps all six rows and states `measurable: 3`.

`pyright` is reachable despite having no `E:` asset, because
`pyright-langserver.exe` is installed on the host `PATH`. Its hover probe did
not answer within 8 s; that is recorded, not smoothed over.

---

## 9. Required integrations (files owned by other agents)

The shared LSP contract lives in `scripts/host_prober_client.ts`
(`LspProbeResult`, `LspProbeReport`, `PROBE_METHOD_LSP_CONTENT_LENGTH =
'lsp-jsonrpc-content-length'`, `buildUnverifiableLspReport`). This module
already matches that `probeMethod` literal exactly and exports a ready adapter,
so no change to `host_prober_client.ts` is required.

### 9.1 `scripts/host_prober.ts` — delegate `lspStatus()` (line 1586)

**Old** (lines 1566–1628, the whole doc comment + function): returns
`UNVERIFIABLE` for every row with `transportImplemented: false` and
`reason: 'LSP_TRANSPORT_NOT_IMPLEMENTED'`.

**New** — replace the body of `lspStatus` with:

```ts
import { runLspProbes, toProberLspReport } from './lsp_prober';

export async function lspStatus(config: ProberConfig): Promise<LspProbeReport> {
  const report = await runLspProbes({
    manifestPath: join(config.manifestPath),
    serversCenterRoot: config.serversCenterRoot,
    workspaceRoot: config.lspScratchRoot, // scratch dir, never the repo or E:\
    stepTimeoutMs: DEFAULT_PHASE_TIMEOUT_MS,
    totalDeadlineMs: DEFAULT_RUN_DEADLINE_MS,
    probeTimeoutMs: 8_000,
    onlyIds: null,
    nodeEnv: sanitisedChildEnv(),
  });
  return toProberLspReport(report, {
    chainKeyId: HOST_PROBER_CHAIN_KEY_ID,
    proberVersion: PROBER_VERSION,
  }) as unknown as LspProbeReport;
}
```

Line **1799–1800** (the route) must then await it:
`sendJson(res, 200, await lspStatus(config));`

Flipping `transportImplemented` to `true` is what makes
`parseLspReport` (`host_prober_client.ts:585–608`) stop clamping every state to
`UNVERIFIABLE`. Until that happens the sanitizer correctly refuses to believe a
measured LSP state, so **the delegation and the sanitizer change must land
together**.

### 9.2 Reason-code mapping

This module's taxonomy is finer-grained than `ProbeReasonCode`.
`toProberReasonCode()` projects it onto the shared vocabulary so
`asReasonCode()` accepts the value instead of downgrading it to
`LSP_TRANSPORT_NOT_IMPLEMENTED` (which would become false once the transport is
live). The precise reason is always preserved verbatim in `reasonText` as
`<fine-reason>: <detail>`.

| this module | projected `ProbeReasonCode` |
| --- | --- |
| `none` | `HANDSHAKE_COMPLETED` |
| `launcher-not-found`, `launcher-not-a-language-server`, `entry-directory-missing`, `dependency-missing` | `ENTRYPOINT_ABSENT` |
| `spawn-failed` | `SPAWN_FAILED` |
| `platform-mismatch` | `PLATFORM_MISMATCH` |
| `child-exited-early`, `child-exited-nonzero` | `EXIT_NONZERO_BEFORE_HANDSHAKE` |
| `framing-violation`, `protocol-violation`, `io-error` | `PROBER_RESPONSE_INVALID` |
| `initialize-error-response` | `HANDSHAKE_INITIALIZE_ERROR` |
| `initialize-timeout-silent` | `HANDSHAKE_TIMEOUT` |
| `total-deadline-exceeded` | `RUN_DEADLINE_EXCEEDED` |
| `not-declared-in-manifest` | `INVENTORY_UNRESOLVED` |

### 9.3 `src/services/serversCenterRegistry.ts`

`EXPECTED_LSP_KEYS` (line 218) is already labelled *"EXPECTED INVENTORY ONLY,
never a reported total"* — correct, leave it. But `healthCheck:
'DIRECTORY_EXISTENCE_ONLY'` (the value `ServersCenterPanel.tsx:199` maps to the
"directory existence only" label) must be replaced by the prober's measured
state. Add to `LspServerInfo` a field carrying
`ProberLspRow.capabilityCounts` / `.initialize.answered` / `.shutdown.clean`,
and have `ServersCenterPanel` render `UNVERIFIABLE` whenever
`transportImplemented !== true`.

### 9.4 `src/pages/DeveloperPage.tsx` line 301

`desc: 'Inspect all 6 Language Server Protocol (LSP) engines'` hard-codes 6.
Replace with a count read from `/probe/lsp/status` → `summary.total`, and show
`summary.measurable` next to it so the console cannot silently present 6 as a
denominator when only 3 are measurable.

---

## 10. CLI

```
lsp_prober --once [--pretty] [--trace] [--id <id[,id]>]
           [--step-timeout-ms <n>] [--probe-timeout-ms <n>] [--timeout-ms <n>]
           [--servers-center-root <dir>] [--workspace-root <dir>] [--manifest <path>]
lsp_prober --watch <intervalMs> [...]
lsp_prober --framer-selftest
```

- JSON goes to **stdout**; logs and `--trace` go to **stderr**. The payload is
  therefore safe to pipe straight into `jq` or an HTTP handler.
- Exit codes: `0` report produced · `2` bad arguments · `3` watchdog or fatal fault.
- `--workspace-root` defaults to a scratch directory under
  `%LOCALAPPDATA%\Temp\opencode\lsp-prober\workspace`. **Never point it at the
  repository or at `E:\`** — probing must stay side-effect-free.
- `--manifest` is required when running a compiled copy from outside the repo
  layout, because `import.meta.url` then no longer points at `scripts/`.

---

## 11. Security

- **Zero npm dependencies.** `vscode-languageserver-protocol` and `vscode-jsonrpc`
  are absent from this repository and deliberately not added; the wire protocol
  is hand-rolled against the published spec.
- **No secret is ever read or printed.** Server stderr is captured (8 KiB cap)
  and passed through `redact()`, which masks any assignment to a key shaped like
  `api_key` / `token` / `secret` / `password` / `credential`. Paths and binary
  names only.
- **Host-side by necessity.** The container is `node:20-alpine`, root,
  `Mounts: []`, with no PowerShell, no .NET runtime and no Python. No LSP server
  on this machine can be reached from inside it.
- The probe opens documents **in memory only** via `textDocument/didOpen`; no
  file is created, written or read on disk.

---

## 12. Residual risk / unverified

- `pyright`'s capability probe timing out at 8 s is **measured, not explained**.
  Whether it is indexing latency or a genuine unresponsiveness is UNVERIFIED.
  Raise `--probe-timeout-ms` to investigate.
- `OFFLINE` was never observed in a live run on this machine, because no declared
  server has a broken launcher to point at. The `OFFLINE` code paths are
  unit-reachable through the framing tests but are **not** proven end-to-end
  against a real misbehaving server. Treat `OFFLINE` as UNVERIFIED in practice.
- Windows `exit`-before-drain is handled with a bounded 150 ms settle, which is
  heuristic. A server that flushes more slowly could in principle be misjudged;
  the residual `bufferedBytes` check is the guard.
- `--watch` mode was implemented but not exercised over a long interval.