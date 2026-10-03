# TELEMETRY TRUTH LEDGER

**Chain Key ID:** `360ea36c28e66d9d`
**Authority:** Supreme Sovereign Commander
**Compiled:** 2026-10-02
**Scope:** prose/claim truth only. No logic, scoring, routing or control flow was changed.

---

## 0. Purpose

This codebase was stripped of fabricated *metrics*. This pass hunted the residual
fabricated *prose* — user-facing strings, comments and documents that assert a fact
which is no longer true. A false sentence in an API response is the same defect as a
false metric, only cheaper to detect.

Rules applied:

- A claim that is **true today** was left alone.
- A claim that is **false** was reworded, not deleted — an operator still needs to know
  what the system checked.
- A claim that **cannot be verified** was softened to say so (`UNVERIFIED`).
- Where the underlying **logic** appears wrong, it was **documented, not fixed**.

---

## 1. THE TWO AUDIT LEDGERS — the single most confusable fact

There are two ledgers. They are different subjects and must never be merged in prose,
in a dashboard, or in an entry count.

| | **HITL ledger** | **Sovereign chain ledger** |
|---|---|---|
| Owner | `server.ts` | `src/services/sovereignMcpServer.ts` |
| Entry id | `ap-<n>` | `seq: <n>` |
| Fields | id, agent, type, summary, reason, risk, createdAt, payload, prevHash, integrityHash | seq, recordedAt, event, chainKeyId, prevHash, evidenceBearing, hash |
| Storage | process-local in-memory array | `data/audit-ledger.jsonl` (append + rehydrate) |
| Survives restart | **NO** | **YES** |
| Read by `/api/hitl/audit/verify` | **YES** | **NO** |
| Self-verdict | `UNVERIFIED` | `UNVERIFIED` (no external attestation) |

**Verified by source inspection:** every `fs.*` call in `server.ts` is one of —
`.env` load (L26/28), shell discovery (L52/54/55), admin-token file read (L1156), or
cwd validation (L1437/1458). **There is no ledger read and no ledger write in that
file.** `approvals` is declared once (`let approvals: any[] = []`) and its only
mutation is `unshift`.

### 1.1 The blocker is EXTERNAL ATTESTATION, not storage

An earlier tasking asserted that the `audit/verify` reason string was false because
"the ledger persists to `data/audit-ledger.jsonl`". **That premise was wrong for this
endpoint** — persistence applies to the *other* ledger. Obeying it blindly would have
deleted a true statement and introduced a new falsehood.

The genuinely accurate statement of the blocker:

- Persistence alone would **not** make tamper-evidence provable.
- An external-anchor design was **assessed and deliberately WITHDRAWN**: a
  genesis-pinned hash is deterministically derivable from the genesis constant alone,
  so it pins nothing an attacker with write access could not recompute.
- Per-entry recomputation therefore remains **UNANCHORED**.

---

## 2. Measured reality (as of 2026-10-02)

| Subsystem | Verdict | Basis |
|---|---|---|
| **MCP** | **7/7 ONLINE, 107 tools** | real stdio JSON-RPC `initialize` + `tools/list` handshakes (shell 1, chrome-devtools 29, syncfusion 1, context7 2, playwright 25, github 45, sovereign-commander 4) |
| **LSP — genuine** | **bash ONLINE, yaml ONLINE, pyright ONLINE** | Content-Length framed `initialize` handshakes |
| **LSP — typescript / eslint** | **UNVERIFIABLE** | `tsc`/`tsserver` is a compiler CLI + daemon; `eslint` speaks its own protocol. **Neither is a language server** |
| **LSP — dotnet** | **UNVERIFIABLE** | .NET SDK only; no `omnisharp`, no `csharp-ls` installed |
| **Chain** | **UNVERIFIED** | recomputation passes; no external attestation |
| **healthScore** | **70/100** | MCP 40/40 + LSP 30/30 + chain 0/30 |

---

## 3. Corrected claims in `server.ts`

| Location | Claimed | Actually true | Now reads |
|---|---|---|---|
| `audit/verify` `reason` | blocker = in-memory storage | blocker = **no external attestation**; anchor withdrawn as derivable | names attestation as the blocker, retains verified in-memory facts |
| ledger `LIMITATION` comment | "unachievable **with the current storage**" | storage is not the blocker | adds the two-ledger disambiguation + withdrawn-anchor note |
| `sovereign tests` CLI | `8/8 Tests Passed (100% Success Rate, 0 Errors)` + 8 fabricated `[PASS]` lines | **no test executed in that branch at all** | `UNVERIFIED — 0 tests executed`, points at the three real gates |
| `sovereign mcp` CLI | `3 verified tools (fs_read, fs_write, git_status)`, `Protocol Ver v1.0.0` | no handshake, no count, no version | `UNVERIFIED` + pointer to `host_prober.ts` |
| `sovereign agents` CLI | per-agent `ACTIVE`/`STANDBY` + op counts 211/703/581/209/212/225/868 | hardcoded literals | declared roster, `UNVERIFIED`; `STANDBY` labelled a legacy wire value |
| `sovereign status` banner | `MCP Protocol ONLINE (v1.0.0)`, `HITL Guard ENFORCED`, `Sentinel SOC ACTIVE (24 firewall rules)`, `Gemini READY` | local flag / count / hardcoded literal / unmeasured | each marked unverified; `Sentinel SOC ACTIVE` withdrawn |
| `sovereign approvals` | `All clear!` | empty array — and empty after **every** restart | retained + scoped caveat |
| code validator `lspServer` ×5 | `tsserver`, `JSON/Schema LS`, `Pyright Python LS`, `Bash LS (ShellCheck Bridge)`, `Generic Syntax Validator` | in-process `transpileModule` / `JSON.parse` / colon check / quote count | `NONE — …` naming the actual technique, `no LSP handshake` |
| `gap-matrix` `completionRate` | `100%` | no resolved-vs-open comparison exists | `UNVERIFIED (…)`, per-item state in `items[]` |
| `/api/tests/status` | `engine … v4.0`, `status: operational` | version unverifiable; `operational` = route answering | version withdrawn, scope stated in comment |
| `/api/ping` | node fallback `v20.12.2` | fabricated; unreachable but wrong | `'unavailable'` |
| HITL execute (all branches) | `TypeScript compilation successful`, `Verifying HMAC bindings... verified`, `Execution audit verified in blockchain ledger. Integrity holds`, `Verification hook: Directory exists`, `Signed by Commander via HITL Key`, `hmac-sha256-file-ef89a2bc` | **nothing executed** — no subprocess, file, compiler, HMAC or signature | `[NOT EXECUTED — this endpoint is a stub]` banner, intent vs result split |
| HITL execute response | `Action executed successfully on target host. Outputs collected and signed.` | none of the three | states `status='executed'` recorded, nothing executed |
| HITL approve | `hmac-sha256-sig-` + `cryptographic verification signature` | `Math.random()` hex, verified by nothing | `unverified-noncrypto-token-` + explicit no-signature message |
| HITL execute denial | `Cryptographic proof of signature required.` | only a status-string gate | names the gate that actually exists |
| `/api/system/telemetry` | `Absolute Truth Probe`, `complete stability`, `24` firewall rules, MCP `ONLINE`/`v1.0.0`, `ENFORCED`, `READY` | unmeasured / fabricated | scope note; `firewallRules: null`; each verdict scoped |
| `agents` store comment | `Seed baseline … based on **real** system operations` | hand-authored synthetic ramp seeded at boot | marked synthetic; explains it dominates `total24h` |
| `agents` metrics comment | `Real Agent Activity Metrics … from Real System State` | partially synthetic | "Real" removed, seeded window declared |
| QA `input` check | `Multi-Modal Workspace Filesystem` (health check) | `fs.existsSync(process.cwd())` — **true by construction** | renamed + comment: cannot fail, not a health check |
| QA `agents` check | `Agent Corps Activity Matrix` | counts 12 static buckets; always passes | renamed to declare the static count |
| QA `audit` check | `auditOk = status === 'INTACT'` | **constantly false** — `INTACT` unreachable | commented as reported-not-fixed |

---

## 4. Corrected claims in `docs/`

| Document | Claimed | Actually true |
|---|---|---|
| `COMMANDER_CONSOLE_FINAL_REPORT.md` | `/api/hitl/audit/verify` returns `"status": "INTACT"` | **cannot return `INTACT`**; only `TAMPERED` / `UNVERIFIED` |
| same | "frozen, stabilized, packaged", "all features locked", "no further compilation steps necessary" | under active concurrent development; `npm run build` is a real required step |
| same | four "Confirmed to return …" lines with no evidence | restated as verified-by-execution, or `UNVERIFIED` |
| same | `server.ts` = "Approval ledger" | ledger is **in-memory only**; two-ledger table added |
| `THREAT_MODEL` THR-01 | "Cryptographic Ed25519 signature checks" → `MITIGATED` | **no Ed25519 verification exists** anywhere |
| `THREAT_MODEL` THR-03 | "Immutable audit ledger … non-repudiation signature in `Approval.signature`" → `MITIGATED` | ledger in-memory + unanchored; signature is `Math.random()` |
| `THREAT_MODEL` Attack Tree 1.2 | "Signature verified with Commander's public key (Ed25519)" | no verification occurs; branch is **OPEN** |
| `THREAT_MODEL` AST-02 | "Ed25519 signing keys" as a held asset | `UNVERIFIED` — no such key used for verification |
| `THREAT_MODEL` §6.3 | "verification runs on every commit via `test_threat_modeling.py`" | script **exists** but **no workflow invokes it** |
| `THREAT_MODEL` §6.1 | "offline local mock fallback" | a mock is not a mitigation; flagged |
| `GCP_EXPORT_GUIDE.md` | "fully ready", "one-button instant deploy", "production SSL URL" | **never executed**; files exist, readiness unverified |
| `LOCAL_BRIDGE_GUIDE.md` | `npm run dev -- --host 0.0.0.0 --port 3000` | `dev` is `tsx server.ts`; those flags are ignored, and unnecessary — server already binds `0.0.0.0:3000` |

---

## 5. Deliberately NOT changed — claims that are still true

- **`/api/status` health-score envelope.** `healthScoreBasis`, `UNVERIFIABLE` fallback,
  `denominatorBasis`, and the `lsp-total = language-server only` scoring note are all
  correct and already honest. Softening them would have destroyed real information.
- **`npm run check` = `tsc --noEmit` passes.** Verified by execution; kept.
- **Default port 3000 / `0.0.0.0` bind.** Verified in `server.ts`; kept.
- **`Commander SPA routes` (12 paths).** Registered; kept, with the "bootstraps
  successfully" boast softened.
- **`/api/bridge/copilot/status` exists** (M365 guide). Verified; kept.
- **`pendingCount` in `/api/system/telemetry`.** A real computation over real state;
  only the surrounding `ENFORCED` label was withdrawn.
- **`.github/workflows/ci.yml` hardening narrative.** Gates are genuinely enforced
  (`|| echo`/`|| true` banned, SHAs pinned, self-verification present). Left untouched.
- **Ledger A persist-before-adopt ordering** (`sovereignMcpServer.ts`). The comment
  explaining *why* order is load-bearing is correct and was preserved verbatim.

---

## 6. Logic defects REPORTED, NOT FIXED

Out of scope by mandate. Listed so they are not lost:

1. `/api/hitl/approvals/:id/execute` sets `status = 'executed'` and returns
   `success: true` / `exitCode: 0` **without executing anything**.
2. `verifyAuditChain()` never returns `INTACT`, so `auditOk` (QA) is constantly false
   and the `/api/status` `'ONLINE'` mapping is unreachable dead code.
3. `/api/system/telemetry` check `input` cannot fail; QA `agents` check cannot fail —
   both inflate `passRate`.
4. `agentBaselines` synthetic data still dominates `/api/agents/metrics` `total24h`.
5. `data/audit-ledger.jsonl` contains **two records with `seq: 4`** sharing one
   `prevHash` — consistent with a rehydration/append race. Chain integrity tooling
   should be asked to confirm.

---

## 7. Integrity statement

- `npx tsc --noEmit` → **exit 0** (real execution, 2026-10-02).
- No commit and no push was performed by this pass.
- Files modified by this pass: `server.ts`, `docs/COMMANDER_CONSOLE_FINAL_REPORT.md`,
  `docs/THREAT_MODEL_SOVEREIGN_CONSOLE.md`, `docs/GCP_EXPORT_GUIDE.md`,
  `docs/LOCAL_BRIDGE_GUIDE.md`, and this file.
- No secret value is reproduced in this document.
