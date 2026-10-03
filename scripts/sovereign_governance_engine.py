#!/usr/bin/env python3
"""
Sovereign Governance Engine & System Verifier
Developed under modern Python 3.12+ / 3.14 standards (python-pro).

Features:
- Pure asynchronous I/O utilizing asyncio and standard library urllib
- Strongly typed domain models with Python dataclasses
- Structural Pattern Matching (PEP 634 match/case) for subsystem status validation
- Real-time audit verification against Sovereign Zero-Trust boundaries
- Strict exit code semantics for CI/CD and Sovereign governance automation
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Final, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Constant Configuration
DEFAULT_BASE_URL: Final[str] = "http://localhost:3000"
# TIMEOUT RAISED (Chain Key 360ea36c28e66d9d): the old value was 6.0s, measured
# against endpoints that had not yet learned to do real work. `/api/agents/framework`
# now drives a REAL stdio JSON-RPC handshake against every MCP server and a real
# Content-Length-framed LSP handshake against every language server, and it answers
# in ~20s on this host. A 6s budget did not merely report "slow", it killed the whole
# process: see the unhandled-`TimeoutError` note in `_async_http_call` below.
#
# This is a fix to the HARNESS, not a relaxation of a measurement. No assertion was
# weakened; a genuinely-slow-but-honest probe must be allowed to finish and be judged
# on what it actually says. A probe that cannot finish is still reported as
# UNREACHABLE and still fails the run.
TIMEOUT_SECONDS: Final[float] = 45.0
CHAIN_KEY_ID: Final[str] = "360ea36c28e66d9d"


class HealthState(str, Enum):
    OPTIMAL = "OPTIMAL"
    OPERATIONAL = "OPERATIONAL"
    DEGRADED = "DEGRADED"
    CRITICAL = "CRITICAL"
    UNKNOWN = "UNKNOWN"


@dataclass(slots=True, frozen=True)
class SubsystemReport:
    name: str
    status: str
    details: str
    healthy: bool


@dataclass(slots=True)
class VerificationResult:
    total_checks: int = 0
    passed_checks: int = 0
    failed_checks: int = 0
    subsystems: list[SubsystemReport] = field(default_factory=list)
    execution_time_ms: float = 0.0

    @property
    def is_success(self) -> bool:
        return self.failed_checks == 0 and self.passed_checks > 0


class SovereignClient:
    """High-performance asynchronous client for the Sovereign Commander Console."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")

    async def _async_http_call(
        self, endpoint: str, method: str = "GET", payload: Optional[dict[str, Any]] = None
    ) -> tuple[int, dict[str, Any]]:
        """Executes an asynchronous non-blocking HTTP request via thread worker."""
        url = f"{self.base_url}{endpoint}"
        body_bytes = json.dumps(payload).encode("utf-8") if payload else None

        def _blocking_call() -> tuple[int, dict[str, Any]]:
            headers = {"Content-Type": "application/json"}
            req = Request(url=url, data=body_bytes, headers=headers, method=method)
            try:
                with urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                    status_code: int = resp.status
                    raw_data = resp.read().decode("utf-8")
                    try:
                        parsed = json.loads(raw_data)
                    except json.JSONDecodeError:
                        parsed = {"raw": raw_data}
                    return status_code, parsed
            except HTTPError as e:
                raw_data = e.read().decode("utf-8")
                try:
                    parsed = json.loads(raw_data)
                except Exception:
                    parsed = {"error": str(e), "body": raw_data}
                return e.code, parsed
            except URLError as e:
                return 503, {"error": f"Connection Refused or Unreachable: {e.reason}"}
            except (TimeoutError, OSError) as e:
                # INCORRECT-FAILURE FIX (Chain Key 360ea36c28e66d9d).
                # FORENSIC FINDING: `TimeoutError` is a subclass of `OSError`, NOT of
                # `URLError`. `urllib` raises the bare socket timeout while reading the
                # status line, so it escaped both handlers above and propagated out of
                # `asyncio.gather` — terminating the whole engine with a traceback
                # before a single verdict was printed. Measured effect: the governance
                # verifier crashed with exit 1 while every subsystem was in fact
                # reachable, purely because one legitimate endpoint became slower when it
                # started doing honest work instead of returning a fabricated count.
                #
                # A transport failure is a MEASUREMENT (this subsystem is UNREACHABLE),
                # not a fatal error of the instrument. It is now attributed to the
                # subsystem that hit it, and `main()` still exits 1 because
                # `is_success` requires zero unhealthy subsystems.
                return 504, {
                    "error": f"Transport timeout or OS-level failure after {TIMEOUT_SECONDS}s: {type(e).__name__}: {e}",
                    "reason": "NO_VERDICT_ESTABLISHED",
                }

        return await asyncio.to_thread(_blocking_call)

    async def probe_health(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/health")
        match (status, data.get("ok"), data.get("status")):
            case (200, True, "operational"):
                engine = data.get("engine", "Sovereign OS")
                services = data.get("services", {})
                return SubsystemReport(
                    name="Core Health Probe",
                    status=HealthState.OPTIMAL.value,
                    details=f"Engine: {engine} | Services: {list(services.keys())}",
                    healthy=True,
                )
            case _:
                return SubsystemReport(
                    name="Core Health Probe",
                    status=HealthState.CRITICAL.value,
                    details=f"Status: {status} | Error: {data.get('error', 'Unknown')}",
                    healthy=False,
                )

    async def probe_system_telemetry(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/system/telemetry")
        if status == 200 and data.get("ok"):
            subsystems = data.get("subsystems", {})
            core_server = subsystems.get("coreServer", {}).get("status")
            hitl_guard = subsystems.get("hitlGuard", {}).get("status")
            return SubsystemReport(
                name="System Telemetry",
                status=HealthState.OPERATIONAL.value,
                details=f"Core: {core_server} | HITL: {hitl_guard} | Uptime: {data.get('uptimeSeconds')}s",
                healthy=True,
            )
        return SubsystemReport(
            name="System Telemetry",
            status=HealthState.DEGRADED.value,
            details=f"HTTP {status} returned from /api/system/telemetry",
            healthy=False,
        )

    async def probe_audit_chain(self) -> SubsystemReport:
        """Probe the audit ledger, distinguishing 'cannot prove' from 'proven broken'.

        HONESTY FIX (Chain Key 360ea36c28e66d9d). This probe previously had exactly
        two ways to fail: `INTACT` -> healthy, everything else -> `TAMPERED_OR_CORRUPT`.
        That conflated two states that mean opposite things to an operator:

          * the ledger is internally consistent but no anchor outside the container's
            write reach has attested to it, so integrity is UNPROVABLE; and
          * a digest/linkage actually failed and the chain is demonstrably BROKEN.

        Calling the first case "TAMPERED_OR_CORRUPT" is a false accusation: it asserts
        tampering that the payload does not report, and it trains the reader to
        discount the alarm. It also invents an unbroken verdict ("corrupt") that no
        observation supports — the precise failure mode this programme exists to remove.

        The endpoint now publishes `status` plus an explanatory `reason`, and sets
        `brokenAt` to a sequence number only when a link or digest actually failed. So
        the honest discriminator is `brokenAt`, not the absence of a positive verdict.
        """
        status, data = await self._async_http_call("/api/hitl/audit/verify")
        chain_status = data.get("status")
        entry_count: int = data.get("entryCount", -1)
        broken_at = data.get("brokenAt")
        verified_entries: int = data.get("verifiedEntries", 0)
        reason: str = str(data.get("reason") or "").strip()

        match (status, chain_status, broken_at):
            case (200, "INTACT", None):
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="VERIFIED_INTACT",
                    details=f"SHA-256 ledger tamper-proof | {verified_entries} entries verified",
                    healthy=True,
                )
            case (200, _, _) if broken_at is not None:
                # A real integrity failure. This is the only branch that may claim
                # tampering, and it may claim it only because `brokenAt` was set.
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="TAMPERED_BROKEN_LINK",
                    details=(
                        f"Recomputation FAILED at entry {broken_at} | "
                        f"{verified_entries}/{entry_count} entries recomputed"
                    ),
                    healthy=False,
                )
            case (200, "UNVERIFIED", None) if entry_count == 0:
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="EMPTY_LEDGER_UNVERIFIABLE",
                    details=(
                        "Ledger in genesis state (0 entries, brokenAt=null) — nothing to "
                        "verify; awaiting first sealed entry"
                    ),
                    healthy=False,
                )
            case (200, _, None):
                # Arithmetically consistent, but UNPROVABLE: no external attestation.
                # Unhealthy (absence of evidence is not health) yet NOT tampered.
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="UNVERIFIED_NO_ANCHOR",
                    details=(
                        f"{verified_entries}/{entry_count} entries recomputed, brokenAt=null, "
                        f"but no anchor outside this container attests to the chain — "
                        f"integrity UNPROVEN (not tampered). {reason}"
                    ),
                    healthy=False,
                )
            case _:
                # Reached only when the endpoint itself failed. Report the transport
                # truth and withhold any claim about the ledger's contents.
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="UNREACHABLE_NO_VERDICT",
                    details=(
                        f"HTTP {status} from /api/hitl/audit/verify — "
                        f"no verdict established, chain state unknown. "
                        f"{data.get('error', '')}"
                    ),
                    healthy=False,
                )

    async def probe_mcp_protocol(self) -> SubsystemReport:
        # Read from /api/agents/framework — HOST_PROBER_MEASURED data (7/7 real)
        # /api/mcp/status returns servers:[] (static registry, not live probe)
        status, data = await self._async_http_call("/api/agents/framework")
        if status != 200 or not data.get("ok"):
            return SubsystemReport(
                name="Model Context Protocol (MCP)",
                status="UNREACHABLE",
                details=f"HTTP {status} from /api/agents/framework",
                healthy=False,
            )
        mcp = data.get("mcp", {})
        online: int = mcp.get("online", 0)
        total: int = mcp.get("total", 0)
        unverified: int = mcp.get("unverifiedCount", 0)
        source: str = mcp.get("measurementSource", "UNKNOWN")
        reachability_verified: bool = bool(mcp.get("reachabilityVerified", False))
        servers_list = mcp.get("servers", [])
        server_ids = [s.get("id", "?") for s in servers_list if isinstance(s, dict)]

        # HONESTY FIX (Chain Key 360ea36c28e66d9d).
        # FORENSIC FINDING: the previous `case (0, _)` branch printed
        #     status="OFFLINE", details="0/N ONLINE"
        # for ANY zero count. Two very different states collapse into it:
        #   (a) total == 0 because the inventory could not be enumerated (discovery
        #       failed, assets absent) — we did not look, so we know nothing; and
        #   (b) total > 0 and every discovered server was probed and found offline —
        #       a measured failure of known servers.
        # (a) is reported as OFFLINE, which asserts a fact about the servers that no
        # observation supports, and simultaneously hides the real problem (discovery
        # failed) behind a server-health verdict. The endpoint publishes exactly the
        # fields needed to tell them apart, so the split is now made on evidence.
        match (online, total, unverified, reachability_verified):
            case (0, 0, _, _):
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="UNVERIFIABLE_NO_INVENTORY",
                    details=(
                        "0/0 ONLINE — no inventory could be enumerated, so no MCP "
                        f"server was probed and none can be called offline. source: {source}"
                    ),
                    healthy=False,
                )
            case (n, t, 0, True) if n > 0 and n == t:
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="ACTIVE",
                    details=(
                        f"{online}/{total} ONLINE over a verified real transport | "
                        f"source: {source} | ids: {server_ids}"
                    ),
                    healthy=True,
                )
            case (0, t, _, _) if t > 0:
                # Measured: every inventoried server was probed and none answered.
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="MEASURED_OFFLINE",
                    details=f"0/{total} ONLINE | source: {source} | every probed server failed",
                    healthy=False,
                )
            case (n, t, u, _) if u > 0:
                # A real measured OFFLINE must stay separable from an UNVERIFIABLE that
                # only means "we could not look". Both are present.
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="PARTIAL_WITH_UNVERIFIED",
                    details=(
                        f"{online}/{total} ONLINE | {u} UNVERIFIABLE (absence of evidence, "
                        f"not evidence of absence) | source: {source}"
                    ),
                    healthy=False,
                )
            case _:
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="DEGRADED",
                    details=f"{online}/{total} ONLINE | source: {source}",
                    healthy=False,
                )

    async def probe_agent_metrics(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/agents/metrics")
        if status == 200 and "architect" in data.get("agents", {}):
            agent_count = len(data.get("agents", {}))
            return SubsystemReport(
                name="Agent Activity Metrics (24H)",
                status="STREAMING",
                details=f"Telemetry tracked for {agent_count} sovereign autonomous agents",
                healthy=True,
            )
        return SubsystemReport(
            name="Agent Activity Metrics (24H)",
            status="UNAVAILABLE",
            details="Could not retrieve agent activity timeline",
            healthy=False,
        )

    async def probe_copilot_bridge(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/bridge/copilot/status")
        if status == 200 and data.get("ok"):
            bridge_name = data.get("bridge", "Semantic Kernel")
            return SubsystemReport(
                name="M365 Copilot & Semantic Kernel Bridge",
                status="ONLINE",
                details=f"Bridge ID: {bridge_name}",
                healthy=True,
            )
        return SubsystemReport(
            name="M365 Copilot & Semantic Kernel Bridge",
            status="OFFLINE",
            details="Bridge status check failed",
            healthy=False,
        )

    async def probe_multicli_bridge(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/cli/multibridge/status")
        if status == 200 and data.get("ok"):
            engines = data.get("engines", [])
            engine_names = [e.get("name") for e in engines]
            return SubsystemReport(
                name="Unified Multi-CLI Dispatcher",
                status="READY",
                details=f"Engines: {', '.join(engine_names)}",
                healthy=True,
            )
        return SubsystemReport(
            name="Unified Multi-CLI Dispatcher",
            status="DEGRADED",
            details="Multi-CLI status check returned non-200",
            healthy=False,
        )


async def main() -> int:
    start_time = time.perf_counter()
    print("=" * 68)
    print("👑 SOVEREIGN GOVERNANCE & ARCHITECTURE VERIFIER (PYTHON 3.12+)")
    print(f"🔐 Chain Key ID: {CHAIN_KEY_ID}")
    print("=" * 68)

    client = SovereignClient()
    checks = [
        client.probe_health(),
        client.probe_system_telemetry(),
        client.probe_audit_chain(),
        client.probe_mcp_protocol(),
        client.probe_agent_metrics(),
        client.probe_copilot_bridge(),
        client.probe_multicli_bridge(),
    ]

    print("\n⏳ Running parallel asynchronous subsystem probes...")
    reports: list[SubsystemReport] = await asyncio.gather(*checks)

    result = VerificationResult()
    result.total_checks = len(reports)
    result.subsystems = reports

    for r in reports:
        if r.healthy:
            result.passed_checks += 1
            icon = "✅"
        else:
            result.failed_checks += 1
            icon = "❌"
        print(f"  {icon} [{r.name}]: {r.status} -> {r.details}")

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    result.execution_time_ms = elapsed_ms

    print("\n" + "=" * 68)
    print(
        f"📊 VERIFICATION SUMMARY: {result.passed_checks}/{result.total_checks} PASSED "
        f"({elapsed_ms:.1f}ms latency)"
    )
    print("=" * 68)

    if result.is_success:
        print("\n✅ All probed subsystems PASSED. Score reflects measured state — not declared.")
        return 0
    else:
        failed_names = [r.name for r in result.subsystems if not r.healthy]
        print(f"\n⚠️  {result.failed_checks} subsystem(s) did not pass: {failed_names}")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
