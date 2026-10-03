#!/usr/bin/env python3
"""
Sovereign Master Test Suite Runner
Orchestrates and executes all sovereign quality verification test suites
under strict Sovereign Governance Active controls.

Authority: Supreme Sovereign Commander
Chain Key ID: 360ea36c28e66d9d

Subprocess audit note (Chain Key 360ea36c28e66d9d): this runner invokes each
suite as an ARGUMENT LIST, `[sys.executable, script_path]`, with no `shell=True`
and no string command. It was therefore already free of the
`shell=True`-with-a-list defect found in the MCP and Servers Center harnesses,
and no quoting or injection change was required here. The hardening applied to
this file is the per-suite TIMEOUT below, which converts an indefinitely hanging
suite into an attributed, explicit failure.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from dataclasses import dataclass

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

CHAIN_KEY_ID = "360ea36c28e66d9d"

# ── PER-SUITE TIMEOUT (Chain Key 360ea36c28e66d9d) ────────────────────────────
# FORENSIC FINDING: `subprocess.run` here was called with NO `timeout`. A suite
# that hangs - waiting on an unreachable network endpoint, a stalled child
# process, or an interactive prompt - would therefore hang the master runner
# indefinitely. In CI that burns the whole runner budget and, because the job
# never reaches a failure, the run is eventually killed by the platform timeout
# with no per-suite attribution. A hung suite is a FAILED suite, and must be
# reported as one with its name attached.
#
# This is NOT the same as the subprocess-injection class of defect: this file
# already invoked suites correctly as an ARGUMENT LIST (`[sys.executable,
# script_path]`) with no `shell=True`, so there was nothing to remove here.
# Verified by inspection - see the audit note in this module's docstring.
SUITE_TIMEOUT_SECONDS = 300

@dataclass
class SuiteTarget:
    name: str
    script_rel_path: str
    description: str

TEST_SUITES: list[SuiteTarget] = [
    SuiteTarget(
        name="SQL Architecture & Query Engine",
        script_rel_path="scripts/sql_architecture_verifier.py",
        description="Validates relational schema, constraints, and SHA-256 recursive audit chain.",
    ),
    SuiteTarget(
        name="Threat Modeling & Security Architecture",
        script_rel_path="scripts/test_threat_modeling.py",
        description="Validates STRIDE completeness, DREAD risk scoring, and zero-trust controls.",
    ),
    SuiteTarget(
        name="Firestore Security Rules & AST Parser",
        script_rel_path="scripts/test_firestore_rules.py",
        description="Audits firestore.rules structural balance, RBAC policies, and auth invariants.",
    ),
    SuiteTarget(
        name="Firebase SQL Connect (Data Connect)",
        script_rel_path="scripts/test_firebase_data_connect.py",
        description="Verifies GraphQL schema, @table directives, and Row-Level Security (@auth).",
    ),
    SuiteTarget(
        name="Autonomous AI Agents Architect",
        script_rel_path="scripts/test_ai_agents_architect.py",
        description="Verifies ReAct loops, tool registries, HITL approval gate, and circuit breakers.",
    ),
    SuiteTarget(
        name="Agent Memory Systems (CoALA Engine)",
        script_rel_path="scripts/test_agent_memory_systems.py",
        description="Verifies semantic/episodic/procedural memory retrieval and recency decay.",
    ),
    SuiteTarget(
        name="Antigravity Customizations & Governance",
        script_rel_path="scripts/test_agy_customizations.py",
        description="Verifies .agents hooks, plugins, rules, and sovereign skill definitions.",
    ),
    SuiteTarget(
        name="Model Context Protocol (MCP) Dispatcher",
        script_rel_path="scripts/test_mcp_tool_developer.py",
        description="Verifies JSON-RPC 2.0 protocol endpoints, tool discovery, and error envelopes.",
    ),
    SuiteTarget(
        name="Servers Center Registry Inventory (7 MCP + 6 LSP entries)",
        script_rel_path="scripts/test_servers_center_integration.py",
        description=(
            "Verifies the committed registry inventory and that the LSP scoring "
            "denominator equals the language-server category count. Does NOT verify "
            "readiness."
        ),
    ),
    SuiteTarget(
        name="Gemini API SDK & Modern Model Matrix",
        script_rel_path="scripts/test_gemini_api_dev.py",
        description="Verifies @google/genai SDK integration and auto-upgrade guards for Gemini models.",
    ),
]

def main() -> int:
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("=" * 80)
    print("👑 SOVEREIGN MASTER TEST MATRIX & QUALITY GATES HARNESS")
    print("🎖️  Authority: Supreme Sovereign Commander")
    print(f"🔐 Chain Key ID: {CHAIN_KEY_ID}")
    print("=" * 80)
    print(f"📁 Workspace Root: {root_dir}")
    print(f"📋 Total Test Suites: {len(TEST_SUITES)}")
    print("-" * 80)

    start_total = time.perf_counter()
    passed_count = 0
    failed_count = 0
    results: list[tuple[str, bool, float, str]] = []

    for idx, suite in enumerate(TEST_SUITES, 1):
        script_path = os.path.join(root_dir, suite.script_rel_path)
        print(f"\n[{idx}/{len(TEST_SUITES)}] ⏳ Running: {suite.name}...")
        print(f"    Target: {suite.script_rel_path}")
        print(f"    Intent: {suite.description}")

        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                [sys.executable, script_path],
                cwd=root_dir,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=SUITE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            duration_ms = (time.perf_counter() - t0) * 1000.0
            failed_count += 1
            msg = (
                f"HUNG: suite exceeded the {SUITE_TIMEOUT_SECONDS}s per-suite "
                f"timeout and was terminated. A hung suite is a failed suite."
            )
            results.append((suite.name, False, duration_ms, msg))
            print(f"    ❌ FAILED (TIMEOUT after {SUITE_TIMEOUT_SECONDS}s, {duration_ms:.1f}ms)")
            print(f"    Error Output:\n{msg}")
            continue
        duration_ms = (time.perf_counter() - t0) * 1000.0

        if proc.returncode == 0:
            passed_count += 1
            results.append((suite.name, True, duration_ms, ""))
            print(f"    ✅ PASSED ({duration_ms:.1f}ms)")
        else:
            failed_count += 1
            error_preview = proc.stderr.strip() or proc.stdout.strip()
            results.append((suite.name, False, duration_ms, error_preview[:200]))
            print(f"    ❌ FAILED (Exit Code: {proc.returncode}, {duration_ms:.1f}ms)")
            print(f"    Error Output:\n{error_preview}")

    total_time_ms = (time.perf_counter() - start_total) * 1000.0

    print("\n" + "=" * 80)
    print("📊 SOVEREIGN QUALITY GATE SUMMARY")
    print("=" * 80)
    print(f"{'Status':<8} | {'Suite Name':<45} | {'Duration':<12}")
    print("-" * 80)
    for name, ok, dur, _ in results:
        status_str = "✅ PASS" if ok else "❌ FAIL"
        print(f"{status_str:<8} | {name:<45} | {dur:8.1f}ms")
    print("-" * 80)
    print(f"Results: {passed_count}/{len(TEST_SUITES)} Suites Passed ({passed_count/len(TEST_SUITES)*100:.1f}%)")
    print(f"Total Verification Latency: {total_time_ms:.1f}ms")
    print(f"Cryptographic Chain Key ID: {CHAIN_KEY_ID}")

    if failed_count == 0:
        # The old banner printed "ALL QUALITY GATES VERIFIED" followed by
        # `Cryptographic Seal: SEC-CI-QUALITY-GATE-...-VERIFIED`. Both overstated
        # what this runner can establish. It runs test suites; it does not verify
        # a cryptographic seal, and a green run says only that the assertions
        # currently written hold — not that the SYSTEM is free of defects the
        # assertions do not cover. A seal here is an attestation of integrity that
        # nothing in this file computes, so it is removed. Exit code 0 is the
        # real signal and it is unchanged.
        print("\n✨ ALL SUITES PASSED UNDER SOVEREIGN SPECIFICATION.")
        print("   Scope: the suites listed above executed and their assertions held.")
        print("   NOT certified: system integrity, chain-of-custody, or any property")
        print("   no listed suite asserts. No cryptographic seal is minted by this")
        print("   runner, because none is computed here.")
        print("=" * 80)
        return 0
    else:
        print(f"\n⚠️  VERIFICATION GATE BLOCKED: {failed_count} suite(s) failed.")
        print("=" * 80)
        return 1

if __name__ == "__main__":
    sys.exit(main())
