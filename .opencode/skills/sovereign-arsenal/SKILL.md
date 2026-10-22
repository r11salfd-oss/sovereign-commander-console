---
name: sovereign-arsenal
description: Load full Sovereign Arsenal knowledge - unified commander, 15 modules, MCP tools, governance patterns, MITRE mapping and risk scoring. Use whenever working with the arsenal.
---

# SOVEREIGN ARSENAL SKILL

Complete operating knowledge of the Sovereign Arsenal for any agent or model.

## MANDATORY PATTERN

Every arsenal action goes through `arsenalCore`. Never bypass it.

```typescript
import { arsenalCore, <Module> } from './src/neo/arsenal/index.ts';

// 1) Create a governed operation (returns operationId)
const op = arsenalCore.createOperation('PURPLE', scopeArray, target, authToken);

// 2) Initialize the module
const mod = new <Module>(op);

// 3) Execute (auto-audited; confirmed findings are recorded via arsenalCore.addFinding)
const results = await mod.someMethod(...);

// 4) Review
arsenalCore.getFindings();
arsenalCore.getAuditLog(50);
```

## COMMANDER FIRST (for any comprehensive assessment)

Do not wire modules by hand for a full assessment. Use the commander.

```typescript
import { arsenalCommander } from './src/neo/arsenal/index.ts';

const result = await arsenalCommander.run({
  mission: 'FULL_RECON',   // FULL_RECON | QUICK_SCAN | WEB_ASSESS | PURPLE_EXERCISE
                            // HARDENING_AUDIT | THREAT_HUNT | COMPREHENSIVE_ASSESS
  target: 'TARGET',
  scope: ['TARGET'],
  auth: 'AUTH',
  autoChain: ['OSINT', 'NETWORK', 'WEB', 'THREAT_INTEL'],
  autoReport: true,
  collectEvidence: true,
  mapTTP: true
});
```

The commander returns:
- `operationId` — the governed operation reference
- `modulesExecuted` / `modulesSkipped`
- `findings` and `findingDelta` (only NEW findings from this run)
- `ttpCoverage` — MITRE ATT&CK mapping of those findings
- `killChain` — derived adversary path
- `riskAssessment` — 0-100 score plus severity and recommendations
- `evidenceIds` — evidence collected via ReportingArsenal with chain of custody
- `timeline` — per-step execution trace

**MCP alternative:** call the `commander_run` tool directly.

## MODULE MAP

| Module | Use case | Real behaviour |
|---|---|---|
| `NetworkArsenal` | Port scanning, packet analysis, monitoring, IDS/IPS | **Real sockets.** `tcpConnectScan` opens actual connections; a port is `open` only if a connection succeeded. Confirmed open ports become findings. |
| `WebArsenal` | Crawling, directory brute, SQLi, XSS, auth bypass, API security | Crawl + discovery; findings emitted for confirmed issues |
| `OffensiveArsenal` | Reconnaissance, exploitation framework, post-exploitation, payloads | `recon.portScan` delegates to the real scanner |
| `DefensiveArsenal` | Hardening, threat detection, incident response, forensics | Hardening benchmark, alert correlation, incident lifecycle |
| `CryptoArsenal` | Crypto analysis, hash identification, SSL/TLS, certificates | Hash identification, cert parsing |
| `OSINTArsenal` | Domain recon, email harvesting, social profiles, metadata | Whois/DNS/subdomain enumeration |
| `ThreatIntelArsenal` | IOC collection, threat feeds, ATT&CK mapping, TTP analysis | IOC store, feed search, MITRE mapper |
| `MalwareAnalysisArsenal` | Static/dynamic analysis, sandbox, YARA | **Real bytes.** String extraction, PE/ELF/Mach-O header + section-table parsing, Shannon entropy, IOC extraction, a working YARA matcher, hash-verified snapshots. Never executes untrusted samples on the host. |
| `C2Arsenal` | C2 server/beacon/listener/delivery | **Real sockets.** Binds a real port, accepts real beacon check-ins over HTTP, delivers a real task queue, emits a runnable stager. Requires authorization + sandbox mode. |
| `AutomationArsenal` | Workflow engine, playbook executor, orchestration | Workflow + playbook execution |
| `ReportingArsenal` | Technical reports, evidence manager, chain of custody | Evidence collection, hash verification, custody chains |
| `integratedArsenal` | Unified posture and purple team orchestrator | Purple exercises with **computed** detection coverage and explicit gaps |

## PURPLE TEAM DETECTION VALIDATION

Coverage is computed, never asserted.

```typescript
const purple = integratedArsenal.purpleTeam!;
const ex = await purple.runPurpleExercise('Baseline', ['detect phishing'], ['T1566', 'T9999']);
// ex.coverage  -> computed from DETECTION_KB
// ex.gaps      -> techniques with no detection rule
// ex.findings  -> one real finding per gap, with a remediation
```

## MCP TOOLS (server: `sovereign-arsenal`)

`arsenal_status`, `create_operation`, `network_scan`, `web_assess`, `crypto_audit`,
`osint_domain`, `threat_intel`, `purple_exercise`, `commander_run`, `commander_status`,
`get_findings`, `get_audit`

The server implements MCP's stdio JSON-RPC 2.0 transport directly - it has no
external SDK dependency and cannot break because a package is missing.

## MCP TOPOLOGY (read before editing `opencode.json`)

| Server | Source | Tools |
|---|---|---|
| `sovereign-arsenal` | local - `mcp/arsenal_mcp_server.ts` | 12 |
| `opencode_bridge` | local - `mcp/opencode_mcp_server.ts` | 13 |
| `opencode` | published by OpenCode (native tools) | 8 |
| `opencode_console` | published by the OpenCode Console | 11 |

- **Never name a local MCP server `opencode` or `opencode_console`.** OpenCode publishes servers under
  those names; a config entry with the same name replaces the published server and its tools disappear
  from every agent. That shadowing is what broke the agent tool catalog.
- **Never use `npx -y <package>` for an MCP server** unless that package exists in `node_modules`.
  A name that does not exist dies at startup with `npm error 404 Not Found` and the agent silently
  loses the tools. `tools/arsenal_verify.ts` [6e] enforces both rules.
- `opencode_bridge` exposes the live OpenCode server: `status`, `sessions`, `session_messages`,
  `session_diff`, `providers`, `agents`, `commands`, `mcp_status`, `projects`, `create_session`,
  `prompt`, `interrupt`, `delete_session`. Its credentials are read at runtime from
  `~/.config/opencode/service.json` - never commit them.

## RULES

- **Governance first** — never skip `arsenalCore.createOperation()`.
- **Real results only** — modules that probe the network actually open sockets; never treat a stub as a finding.
- **Evidence discipline** — attach artifacts through `ReportingArsenal.evidence` and open a custody chain.
- **Safety** — MalwareAnalysis and C2 require sandbox mode and explicit authorization.
- **Verify** — run `npx tsx tools/arsenal_verify.ts` to confirm the platform is healthy before trusting it.

## VERIFY THE PLATFORM (do this before reporting)

```bash
npx tsx tools/arsenal_verify.ts    # full gate: live sockets + MCP probes + topology guards
npx tsx tools/live_probe.ts        # real TCP listeners, open vs closed detection
npx tsx tools/deep_probe.ts        # malware / C2 / purple with real bytes and sockets
node tools/mcp_full_probe.mjs      # every MCP tool over real JSON-RPC
node tools/opencode_mcp_probe.mjs  # 14 live checks against the real OpenCode API
```

## AGENT & SKILL DISCOVERY (silent failures)

OpenCode v2 registers agents/skills by strict glob + schema decode. Both failure
modes are silent - the asset simply never appears, with no error in the log.

| Asset | v2 location | Trap |
|---|---|---|
| Agent | `.opencode/agents/<name>.md` | frontmatter `tools:` must be a **map** (`read: true`); a **list** fails the decode and the agent is dropped |
| Skill | `.opencode/skills/<id>/SKILL.md` | the file name must be exactly `SKILL.md` - case-sensitive, so `skill.md` is never discovered |

- An agent without `mode: subagent` defaults to `primary` and never shows up as a subagent.
- Native v2 agent keys: `model`, `variant`, `request`, `system`, `description`, `mode`,
  `hidden`, `color`, `steps`, `disabled`, `permissions`. Avoid legacy `temperature`,
  `tools`, `prompt`, `permission`.
- The server reads a location's config **once**; a newly added agent or skill appears
  only after the OpenCode service restarts.
- `tools/arsenal_verify.ts` [7] enforces the layout, the filename and the frontmatter shape.

```bash
opencode api get "/api/agent?location%5Bdirectory%5D=$PWD" | grep -o '"id":"[^"]*"'
opencode api get "/api/skill?location%5Bdirectory%5D=$PWD" | grep -o '"id":"[^"]*"'
```

## QUICK CHECKS

```typescript
import { integratedArsenal, arsenalCore, arsenalCommander } from './src/neo/arsenal/index.ts';

integratedArsenal.getPosture();
arsenalCore.getFindings();
arsenalCore.getAuditLog(20);
arsenalCommander.getStatus();
```
