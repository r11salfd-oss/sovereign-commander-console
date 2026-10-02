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
TIMEOUT_SECONDS: Final[float] = 6.0
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
        status, data = await self._async_http_call("/api/hitl/audit/verify")
        chain_status = data.get("status")
        entry_count: int = data.get("entryCount", -1)
        broken_at = data.get("brokenAt")
        match (status, chain_status):
            case (200, "INTACT"):
                verified = data.get("verifiedEntries", 0)
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="VERIFIED_INTACT",
                    details=f"SHA-256 ledger tamper-proof | {verified} entries verified",
                    healthy=True,
                )
            case (200, "UNVERIFIED") if entry_count == 0 and broken_at is None:
                # Empty ledger = genesis state — no entries, no tampering detected
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="EMPTY_LEDGER_HEALTHY",
                    details="Ledger in genesis state (0 entries, brokenAt=null) — no tampering detected",
                    healthy=True,
                )
            case _:
                return SubsystemReport(
                    name="Sovereign Audit Chain",
                    status="TAMPERED_OR_CORRUPT",
                    details=f"Chain status: {chain_status} | brokenAt: {broken_at} | entries: {entry_count}",
                    healthy=False,
                )

    async def probe_mcp_protocol(self) -> SubsystemReport:
        status, data = await self._async_http_call("/api/mcp/status")
        mcp_status = data.get("status")
        match (status, mcp_status):
            case (200, "active"):
                servers = data.get("servers", [])
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status="ACTIVE",
                    details=f"Active Servers: {servers}",
                    healthy=True,
                )
            case _:
                return SubsystemReport(
                    name="Model Context Protocol (MCP)",
                    status=str(mcp_status).upper(),
                    details=f"MCP Subsystem status: {mcp_status}",
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
        print("\n✨ All sovereign systems, audit chains, and bridges are 100% OPERATIONAL.")
        return 0
    else:
        print(f"\n⚠️ Verification failed with {result.failed_checks} errors.")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
