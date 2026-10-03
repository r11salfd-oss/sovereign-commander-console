# SOVEREIGN COMMANDER CONSOLE - COMPREHENSIVE THREAT MODEL
**Methodology**: STRIDE & PASTA (Process for Attack Simulation and Threat Analysis)  
**Authority**: Supreme Sovereign Commander  
**Chain Key ID**: `360ea36c28e66d9d`  
**Classification**: LEVEL-5 SOVEREIGN INTERNAL SECURITY  

---

## 1. System Scope & Trust Boundaries

The Sovereign Commander Console is a military-grade command-and-control platform orchestrating autonomous AI agents, persistent cognitive memory, a microkernel emulation engine, and hybrid database layers (Firebase Data Connect PostgreSQL + Cloud Firestore).

```mermaid
graph TD
    subgraph UntrustedZone[منطقة غير موثوقة: Client Browser & External Network]
        BrowserUser[متصفح القائد / الواجهة Web Console]
        ExternalAttacker[مهاجم خارجي / شبكة عامة]
    end

    subgraph TrustBoundary1[Trust Boundary 1: TLS / HMAC WebSocket Gateway]
        APIGateway[API Gateway / Node Server Core]
    end

    subgraph TrustBoundary2[Trust Boundary 2: Agent Runtime & Sandboxed Microkernel]
        AgentOrchestrator[Autonomous Agent Runtime<br/>ReAct & Plan-and-Execute]
        ToolRegistry[Sovereign Tool Registry<br/>Circuit Breakers & HITL Gate]
        KernelRing0[Microkernel Ring-0 Syscall Engine<br/>Protected Memory Pages]
    end

    subgraph TrustBoundary3[Trust Boundary 3: Cognitive Memory & Data Stores]
        CoALAMemory[Agent Memory Engine<br/>Working, Semantic, Episodic]
        PostgreSQLDataConnect[Firebase Data Connect<br/>PostgreSQL with @auth Directives]
        FirestoreDb[Cloud Firestore<br/>Security Rules Enforced]
    end

    BrowserUser -->|HTTPS / WSS| APIGateway
    ExternalAttacker -.->|Threat Vector| APIGateway
    APIGateway -->|Internal IPC / Syscalls| AgentOrchestrator
    APIGateway -->|Ring-0 IPC| KernelRing0
    AgentOrchestrator -->|Validated Tool Calls| ToolRegistry
    ToolRegistry -->|HITL Approval Check| FirestoreDb
    AgentOrchestrator -->|Context Assembly| CoALAMemory
    ToolRegistry -->|GraphQL Mutations| PostgreSQLDataConnect
```

---

## 2. Asset Inventory & Critical Entry Points

| Asset ID | Asset Name | Description & Value | Criticality |
| :--- | :--- | :--- | :--- |
| **AST-01** | `Sovereign War Chest & Approvals Ledger` | Cryptographic approvals for sensitive system mutations | **CRITICAL** |
| **AST-02** | `Commander Security Profile & Keys` | Ed25519 signing keys and Level-5 clearance credentials — **UNVERIFIED: no Ed25519 signing key material is used for verification anywhere in the codebase (see §6.1)** | **CRITICAL** |
| **AST-03** | `Agent Working & Semantic Memory` | Active session tokens, system invariants, zero-trust policies | **HIGH** |
| **AST-04** | `PostgreSQL Database Tables` | Cloud SQL relational records, audit trails, telemetry logs | **HIGH** |
| **AST-05** | `Microkernel Ring-0 Memory Queues` | Real-time process tables, page tables, ring buffer queues | **HIGH** |

### Primary Attack Surface Entry Points:
1. **EP-01**: `/api/chat` and WebSocket channel (Input for prompt injection & command injection).
2. **EP-02**: `/api/approvals` endpoint (Target for approval tampering or unauthorized state transition).
3. **EP-03**: Tool Registry execution layer (`executeTool` parameter deserialization).
4. **EP-04**: Firebase Data Connect GraphQL API (`queries.gql` and `mutations.gql`).
5. **EP-05**: Microkernel Syscall Handler (Privilege escalation via DPL bypass).

---

## 3. STRIDE Threat Analysis Matrix

| Threat ID | STRIDE Category | Component Affected | Threat Scenario & Vector | DREAD Score | Mitigation & Security Control | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **THR-01** | **Spoofing** | API Gateway & WebSocket | Impersonating the Supreme Commander via forged JWT/session header | **8.4 (HIGH)** | **NO Ed25519 verification exists.** `request.auth.uid` validation applies on the Firebase/Data Connect path only. | **UNVERIFIED** |
| **THR-02** | **Tampering** | PostgreSQL / Data Connect | Injecting arbitrary SQL or mutating unauthorized records via GraphQL | **9.0 (CRITICAL)**| Parameterized GraphQL operations, `@auth(expr: "auth.token.role == 'commander'")` row-level security, AST schema validation. | **MITIGATED** |
| **THR-03** | **Repudiation** | Approvals Page & Ledger | Agent or operator denies executing a destructive operation | **7.2 (MEDIUM)**| **The ledger is NOT immutable and `Approval.signature` is NOT a signature.** See §6.1 for the verified detail. | **NOT MITIGATED** |
| **THR-04** | **Information Disclosure**| Agent Memory Engine | Leaking sensitive API keys or system invariants through chat or memory dump | **8.6 (HIGH)**| Sanitization pipeline in `prepareUnifiedContext`, redaction of restricted paths (`/etc/shadow`, `vault.key`), memory isolation. | **UNVERIFIED** |
| **THR-05** | **Denial of Service** | Agent Runtime Loops | Malicious prompt forcing infinite ReAct loops, exhausting tokens and API credits | **8.8 (HIGH)**| Hard cap on loop iterations (`maxIterations: 5`), per-turn token budgets (8192 tokens), circuit breakers with 60s cooldown. | **UNVERIFIED** |
| **THR-06** | **Elevation of Privilege**| Microkernel Syscall Engine | User-mode task (Ring 3) attempting to execute Ring-0 kernel memory commands | **9.2 (CRITICAL)**| Descriptor Privilege Level (`dpl: 0`) enforcement, ring check in `kernelEngine.ts`, zero-copy buffer bounds checking. | **UNVERIFIED** |

> **TRUTH NOTICE — status column corrected 2026-10-02.**
> Every row above previously read `MITIGATED`. That verdict was asserted, never
> demonstrated. Statuses were downgraded to `UNVERIFIED` where no executed evidence
> was produced. Rows carrying real, implemented controls (THR-02) keep `MITIGATED`.
>
> **THR-01 is the most serious correction.** The original mitigation read
> "Cryptographic Ed25519 signature checks". A repo-wide search for Ed25519 signature
> *verification* returns **no implementation**. What exists is:
> - `src/os/kernelEngine.ts` — emits string literals of the form
>   `` `ed25519:${hash.slice(0,16)}...${hash.slice(-8)}` ``. That is a truncated
>   SHA-256 with an `ed25519:` label prefixed; no Ed25519 key is involved and nothing
>   verifies it. Three further `signatureEd25519` values are hardcoded literals.
> - `src/services/auditChainAnchor.ts` — a detached-signature verifier exists here,
>   but the anchor design it serves was **assessed and deliberately WITHDRAWN**
>   (a genesis-pinned hash is deterministically derivable, so it pins nothing).
>
> Therefore no control in this codebase currently performs Ed25519 verification.

---

## 4. Attack Trees for Critical Vectors

### Attack Tree 1: Unauthorized Destructive Database Mutation
```text
[Goal: Execute Unapproved DROP TABLE on Sovereign Database]
└── 1. Bypass HITL Safety Gate
    ├── 1.1 Direct API call without approval ID
    │   └── Mitigation: Backend checks Approval record status == 'approved' — this string-state gate is REAL. No cryptographic proof is checked.
    ├── 1.2 Spoof Commander Approval Signature
    │   └── Mitigation: NONE EXISTS — see §6.1. This previously read "Signature verified with Commander's public key (Ed25519)". No signature is verified anywhere on this path; approval.signature is never read back. Branch 1.2 is OPEN.
    └── 1.3 Poison Agent Goal via Prompt Injection
        └── Mitigation: Agent Tool Registry enforces isDestructive=true interceptor before invoking tool
```

### Attack Tree 2: Context Poisoning & Memory Exfiltration
```text
[Goal: Exfiltrate Sovereign Secrets from Agent Long-Term Memory]
└── 1. Poison Working Memory Buffer
    ├── 1.1 Inject malicious directive via Chat Chamber prompt
    │   └── Mitigation: Strict input validation and token filtering
    ├── 1.2 Trigger memory consolidation with poisoned insights
    │   └── Mitigation: Background consolidation checks for invariant keywords before promotion
    └── 1.3 Exploit RAG recall to output secrets into user response
        └── Mitigation: Output sanitizer masks restricted keys and tokens
```

---

## 5. DREAD Scoring Methodology

Each identified threat is evaluated against the 5 DREAD dimensions ($1 \text{ to } 10$):
$$\text{DREAD Risk Rating} = \frac{\text{Damage} + \text{Reproducibility} + \text{Exploitability} + \text{Affected Users} + \text{Discoverability}}{5}$$

* **THR-02 (SQL Tampering)**: $D=10, R=8, E=8, A=10, D=9 \implies \mathbf{9.0/10}$ (Mitigated via Data Connect @auth & strict mutations).
* **THR-06 (Ring-0 Privilege Escalation)**: $D=10, R=9, E=8, A=10, D=9 \implies \mathbf{9.2/10}$ (Mitigated via Ring isolation & DPL checks).
* **THR-05 (Agent Looping DoS)**: $D=8, R=9, E=9, A=9, D=9 \implies \mathbf{8.8/10}$ (Mitigated via ReAct 5-step cap & circuit breaker).

---

## 6. Residual Risk Assessment & Ongoing Governance

1. **Third-Party LLM Provider Latency & Availability**:
   * *Residual Risk*: Intermittent API outages from external AI providers.
   * *Mitigation*: **UNVERIFIED.** A `BrainMap` fallback route and an "offline local
     mock fallback" were asserted here. Note that a *mock* fallback is not a
     mitigation under the anti-fabrication mandate: it silently substitutes fabricated
     output for a real model response. Either verify the routing or remove the claim.
2. **Client-Side Memory Inspection**:
   * *Residual Risk*: User inspecting client-side React devtools memory.
   * *Mitigation*: **UNVERIFIED.** "No secret keys stored in client state" was asserted
     without an audit of the client bundle; no such audit is recorded in this repo.
3. **Audit Cadence**:
   * *CORRECTION — this claim was FALSE.* It stated that automated verification "runs
     on every commit via `scripts/test_threat_modeling.py`". The script **does exist**
     (`Test-Path scripts/test_threat_modeling.py` → `True`), but it is **not wired to
     any workflow**: neither `.github/workflows/ci.yml` nor `deploy.yml` references
     `test_threat_modeling`. A script that nothing invokes does not run on any commit.
     Until it is added to CI, this document is **not** automatically enforced.
   * Re-certification required upon architectural changes to `src/os/` or `dataconnect/`.

### 6.1 Verified Detail — Why THR-03 Is NOT Mitigated

Recorded 2026-10-02 from direct source inspection, so the correction above is
auditable rather than rhetorical.

**`Approval.signature` is not a signature.** In `server.ts` the approve handler builds:

```ts
'unverified-noncrypto-token-' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')
```

This is 64 hex characters from `Math.random()`. It is not an HMAC, not Ed25519, and
not a function of the approved payload. The value was previously prefixed
`hmac-sha256-sig-`, which asserted an algorithm that never ran. A repo-wide search
shows **no code path ever recomputes or verifies this field** — it is stored, returned
in API responses, and displayed in the UI.

**The HITL audit ledger is not immutable and not anchored.** `server.ts` keeps the
ledger in a module-local `approvals` array. Every `fs.*` call in the file is one of:
`.env` loading, shell discovery, the admin-token file read, or cwd validation. There is
no ledger read and no ledger write. Entries are therefore lost on restart, and
`/api/hitl/audit/verify` reports `UNVERIFIED` — never `INTACT`.

**Persistence exists, but in a different ledger.** `src/services/sovereignMcpServer.ts`
appends seq-numbered records to `data/audit-ledger.jsonl` and rehydrates them at
startup. That is a real, durable chain. It is **not** the ledger the HITL verify
endpoint reads, and its durability does not make the HITL endpoint verifiable.

**Net position.** There is currently **no non-repudiation control** in the approval
path: an approved-and-executed action leaves a self-issued, unverifiable, in-memory
record. THR-03 must remain open until an external attestation anchor or a real
signature scheme is implemented and verified by execution.
