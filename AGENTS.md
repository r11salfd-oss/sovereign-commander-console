# SOVEREIGN COMMANDER CONSOLE - WORKSPACE AGENT GUIDELINES
Authority: Supreme Sovereign Commander
Chain Key ID: 360ea36c28e66d9d

## Core Operating Principles
1. **Sovereign Governance Active**:
   - Never claim execution, test pass, or deployment success without real, executed CLI commands, recorded stdout/stderr, and exit code 0.
   - Include Chain Key ID `360ea36c28e66d9d` on all commits and authoritative governance reports.
2. **TypeScript & Architecture Integrity**:
   - Maintain zero TypeScript compilation errors (`tsc --noEmit`).
   - Preserve all existing code comments, docstrings, and architectural separation of concerns.
   - Always provide GitHub-style clickable `file:///` markdown links for modified files and types.
3. **Human-In-The-Loop (HITL) Safety Gate**:
   - Strictly prohibit unapproved destructive database commands (DROP, TRUNCATE, unchecked DELETE).
   - Sensitive infrastructure actions require explicit Commander sign-off.
4. **Communication Style**:
   - Deliver reports in Arabic with concise, authoritative, military-grade precision suitable for the Supreme Sovereign Commander.
5. **Anti-Simulation & Anti-Fabrication Mandate**:
   - ERADICATE all canned responses, placeholders, mocks, or deception.
   - FORBID any simulation unless explicitly declared and approved.
   - Any past work performed under unacknowledged simulation is NULL and VOID.
   - Immediate termination for claiming mock results as physical truth.

---

# 6. CONCURRENT-EXECUTION DISCIPLINE

**These rules exist because they were violated in this very repository. Each
one cost real time or produced a real near-miss. They are not theoretical.**

## 6.1 Ownership boundaries are absolute

Every agent receives an explicit, exclusive file list. Files outside that list
are not "adjacent work" — they belong to someone else and may be **mid-write**.

**NEVER run `git add -A` or `git commit -a` while other agents are active.**
A blanket add is not tidiness; it is a signature on another agent's
half-written file. This happened here: an agent was writing
`scripts/prober-service/` while `git add -A` swept its in-progress output into
a commit. It was caught only because that agent reported the anomaly.

**Rule:** stage only named paths. `git add <path> <path>`, never `git add -A`.

## 6.2 A tree under active work is not clean

`git status --porcelain` returning entries does not mean the tree is dirty with
your mistakes — it may mean an agent is mid-flight. Before concluding anything
about who changed what, compare **file modification times** against your own
commit times and against session start times. Attributing a change to the
wrong author is as damaging as making the change wrongly.

## 6.3 Do not work in another agent's checkout

Concurrent agents must work in separate worktrees. If you find yourself reading
or copying from a path that is not yours, you are touching live work.

## 6.4 Never merge without reproducing the other's proof

When adopting another agent's (or another tool's) change, reproduce its central
claim yourself before merging. A guard that "passes" may only pass in the
author's tree because of state you do not have.

**Specifically:** before merging, run every verification the author claimed —
on the merged result — and check for false positives introduced by their fix.

---

# 7. TRUTHFUL VERIFICATION

## 7.1 A closed list of known patterns is not a check

A scanner that searches only prefixes it already knows will report `PASS` on a
repository that is not clean. This repository shipped a real credential in a
client bundle for 69 commits while `verify_secret_hygiene.ts` reported success —
the credential used a **custom `sov_` prefix** the scanner had never heard of.

> **A tool that does not know what it is not looking for must answer `UNKNOWN`,
> not `PASS`.**

Scan for the **class** — high-entropy literals bound to credential-shaped names,
especially in anything shipped to a browser — not for a list of prefixes.

## 7.2 A tool must be proven able to fail

A verifier that has never failed is not a verifier. For every check you add:

1. Show it passing on a correct state.
2. **Plant a violation yourself** and show it failing with a non-zero exit.
3. Do not accept the author's own failure fixture as sufficient — reproduce it.

## 7.3 Never satisfy a tool with a trick

If a check flags your code, **fix the check if the finding is a false positive;
fix the code if the finding is real.** Never obfuscate to pass.

Concrete prohibition, learned here: rewriting
`'sov_active_chat_session_id'` to `['sov','active_chat_session_id'].join('_')`
does not remove a string from a bundle — it leaves the identical bytes in the
build output while making the source harder to read. **A build artifact is the
thing that ships; satisfy the artifact, or fix the detector.**

Corollary: renaming identifiers that are not secrets, to satisfy a length-based
heuristic, is a false fix that damages the codebase for no security benefit.

## 7.4 Classification belongs in the detector

If a detector cannot distinguish a secret from a non-secret, that is a defect in
the detector. Do not rename innocent identifiers to teach it the difference.

## 7.5 Deferral must be recorded, never assumed

When a risk is consciously accepted, write it down with its date, its
measurement, its blast radius, and what remains unproven — in the repository,
not in a chat message. A deferral nobody can find is indistinguishable from an
oversight. See `docs/SECRET_ROTATION_RUNBOOK.md` for the pattern: dated,
measured, with the remaining risk stated plainly and the reason recorded.

**Authorisation to proceed is not authorisation to forget.**

## 7.6 Do not hand a tool destructive commands under a heading like "verification"

An instruction that says "run these to verify" must contain only read-only
operations. `docker rm -f` destroys a running system; if a verification list
contains it, the list is wrong regardless of intent.

## 7.7 Verify the direction of a claim, not just its presence

"I removed the secret" is a claim about absence — check the built artifact, not
the source. A literal removed from source can survive in `dist/`, in a source
map, or in a lockfile.

## 7.8 Do not ship scaffolding in place of a fix

Hardcoding a plausible-looking value to satisfy a type or a check is the same
defect class as a fabricated status, wearing a different hat. If a value is not
real, say `UNVERIFIED` or leave it absent.

---

# 8. SOVEREIGN ARSENAL (ALL AGENTS / ALL MODELS)

The arsenal is a governed capability available to **every agent and every model** through
three surfaces: the `sovereign-arsenal` MCP server, the `sovereign-arsenal` skill, and the
`arsenal-operator` subagent. The rules below are binding.

## 8.0 ARSENAL GOVERNANCE CHAIN

- **ZERO BYPASS**: Every arsenal action MUST preserve the sovereign chain:
  `Goal → Plan → Intent → Policy → Approval → Token → Start → ExecutionManager → Audit → Snapshot → SQLite → Replay → Narrative`
- **READ-ONLY FIRST**: All server operations start as read-only. A state-changing action
  (Restart, Kill, Install) requires explicit plan-based approval **and** a rollback snapshot.
- **EVIDENCE PRESERVATION**: No evidence folder or audit log may be deleted.
- **REDACTION**: All sensitive strings (KEY, TOKEN, SECRET, ...) are `[REDACTED]` in logs and UI.
- **NEVER FAKE UI STATE**: The interface must reflect the exact state of the backend
  persistence. If the data is not in SQLite/Replay, it does not exist.

## 8.1 SOVEREIGN ARSENAL (ALL AGENTS / ALL MODELS)

**Platform:** `src/neo/arsenal/` — 15 modules, 67 exports, unified by `arsenalCommander`.

| Piece | Location | Purpose |
|---|---|---|
| Core governance | `src/neo/arsenal/core/arsenal_core.ts` | `arsenalCore` — operations, findings, audit trail |
| Orchestrator | `src/neo/arsenal/commander/arsenal_commander.ts` | `arsenalCommander.run(...)` — auto-chain + TTP + risk + report + evidence |
| TTP & risk | `src/neo/arsenal/core/ttp_engine.ts` | `TTPEngine` (MITRE ATT&CK), `RiskScoring` (0-100) |
| MCP server | `mcp/arsenal_mcp_server.ts` | server name `sovereign-arsenal` (registered in `opencode.json`) |
| Agent | `.opencode/agents/arsenal-operator.md` | purpose-built operator agent |
| Skill | `.opencode/skills/sovereign-arsenal/SKILL.md` | loadable knowledge for any agent |
| System prompt | `prompts/ARSENAL_SYSTEM_PROMPT.md` | for local model injection |
| API reference | `docs/ARSENAL_API_REFERENCE.json` | machine-readable export surface |
| Health check | `tools/arsenal_verify.ts` | **run this before trusting the platform** |

**Mandatory rules**
- Every arsenal action runs inside `arsenalCore.createOperation(mode, scope, target, auth)`. Never bypass it.
- For any comprehensive assessment use `arsenalCommander.run(...)` (or the `commander_run` MCP tool) — do not hand-wire modules.
- **Never report unverified results as findings.** Probes that actually execute (e.g. TCP connect) may produce findings; stubbed output may not.
- Malware analysis and C2 require sandbox mode plus explicit authorization. Never weaken those gates.
- Attach material artifacts through `ReportingArsenal.evidence.collect()` and open a custody chain.
- **Lab hygiene: fixtures must carry inert indicators.** A PE-shaped file containing a *live* c2 address is quarantined within milliseconds by the host's on-access scanner on a Windows-mounted drive (`/mnt/d`): the write appears to succeed, then `open()` fails with `EINVAL` and the file is gone. Use the RFC 5737 documentation range (`198.51.100.7`) and the reserved `.example` TLD — every IOC regex still matches, the analysis stays real.

**Quick start**

```bash
npx tsx tools/arsenal_verify.ts      # platform health
```

```typescript
import { arsenalCommander } from './src/neo/arsenal/index.ts';
const res = await arsenalCommander.run({
  mission: 'FULL_RECON', target: 'TARGET', scope: ['TARGET'], auth: 'AUTH'
});
// res.operationId, res.findings, res.ttpCoverage, res.riskAssessment, res.evidenceIds
```

## 8.2 MCP TOPOLOGY (ALL AGENTS / ALL MODELS)

**Registered in `opencode.json`:**

| Server | Source | Tools | Purpose |
|---|---|---|---|
| `sovereign-arsenal` | local — `mcp/arsenal_mcp_server.ts` | 12 | the arsenal |
| `opencode_bridge` | local — `mcp/opencode_mcp_server.ts` | 13 | live read/drive access to the running OpenCode server |
| `opencode` | published by OpenCode | 8 | native tools: sessions, worktrees, models, MCP resources |
| `opencode_console` | published by the OpenCode Console | 11 | workspace: members, providers, models, usage, budgets |

**Mandatory rules (learned from a real outage — do not break them)**
- **Never name a local MCP server `opencode` or `opencode_console`.** OpenCode publishes servers under those
  exact names; a config entry with the same name *replaces* the published server and its tools vanish from
  every agent. The local bridge is `opencode_bridge` for this reason.
- **Never start an MCP server with `npx -y <package>` unless that package is installed in `node_modules`.**
  `npx` resolves the package from the registry at startup; a name that does not exist dies with
  `npm error 404 Not Found - GET https://registry.npmjs.org/<package>` and the agent silently loses the
  tools. `tools/arsenal_verify.ts` [6e] enforces both rules.
- Both local servers are **dependency-free** (Node built-ins only, stdio JSON-RPC 2.0). A missing npm
  package must never be able to disable them.
- The bridge reads its credentials at runtime from `~/.config/opencode/service.json` (or
  `OPENCODE_SERVER_PASSWORD`). **Never commit the password.**

**Verify the topology**

```bash
opencode mcp list                    # every server must read "connected"
npx tsx tools/arsenal_verify.ts     # [6e] guards the topology
node tools/opencode_mcp_probe.mjs   # 14 live checks against the real OpenCode API
```

## 8.3 AGENT & SKILL DISCOVERY (silent failures — verify, don't assume)

OpenCode v2 discovers agents and skills by strict glob and decodes their frontmatter against a
fixed schema. **Both failure modes are silent**: the file is simply never registered, and the
agent/skill never appears for any model. There is no warning in the log.

| Asset | v2 location | Trap that makes it vanish |
|---|---|---|
| Agent | `.opencode/agents/<name>.md` (or `.opencode/agent/`) | frontmatter `tools:` as a **list** — the legacy schema wants a **map** (`read: true`); the agent is dropped |
| Skill | `.opencode/skills/<id>/SKILL.md` | the file name must be exactly `SKILL.md` (case-sensitive) — `skill.md` is never discovered |

**Rules**
- An agent without `mode: subagent` defaults to `primary` and never appears in the subagent catalogue.
- Do not use legacy top-level agent fields (`temperature`, `tools`, `prompt`, `permission`) — native v2
  keys are `model`, `variant`, `request`, `system`, `description`, `mode`, `hidden`, `color`, `steps`,
  `disabled`, `permissions`.
- The server reads a location's config **once**, when the location opens. A new agent or skill is only
  picked up after the OpenCode service is restarted.
- `tools/arsenal_verify.ts` [7] enforces the layout, the filename and the frontmatter shape.

**Prove it, don't assume**

```bash
opencode api get "/api/agent?location%5Bdirectory%5D=$PWD" | grep -o '"id":"[^"]*"'   # agent registered?
opencode api get "/api/skill?location%5Bdirectory%5D=$PWD" | grep -o '"id":"[^"]*"'   # skill registered?
python3 tools/service_snapshot.py evidence/arsenal/service_restart_snapshot_after.json
```

**After a service restart, re-run the snapshot and diff it against the baseline.** The snapshot tool
records the live agent/skill ids, the MCP registration, the service URL, the process tree and the git
head — so a restart can be proven complete and reversible:

```bash
python3 tools/service_snapshot.py evidence/arsenal/service_restart_snapshot_before.json   # baseline
# ... restart the service ...
python3 tools/service_snapshot.py evidence/arsenal/service_restart_snapshot_after.json    # proof
```
