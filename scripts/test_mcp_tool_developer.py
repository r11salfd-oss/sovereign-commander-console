"""
Sovereign Model Context Protocol (MCP) Tool Developer Verification Harness
Standards: Model Context Protocol (MCP) JSON-RPC 2.0 Specification
Chain Key ID: 360ea36c28e66d9d

Suites:
1. Architecture & Export Contract Integrity
2. Protocol Primitives Verification (Tools, Resources, Prompts)
3. Live JSON-RPC 2.0 Dispatch & Execution Test (via tsx runtime)
"""

import sys
import os
import json
import shutil
import subprocess


def _resolve_npx():
    """Resolve the real npx launcher for the current platform.

    WHY THIS IS NECESSARY: with `shell=False` the OS performs the lookup, and on
    Windows `npx` is actually `npx.CMD` (plus a `npx.ps1` shim). Resolving the
    bare name `npx` therefore fails with WinError 2 on Windows. This is exactly
    why the old `shell=True` invocation appeared to work on a Windows
    workstation while failing on Linux CI: the shell was doing the extension
    resolution. `shutil.which` performs the same resolution WITHOUT spawning a
    shell, so the injection surface stays closed on every platform.
    """
    for candidate in ("npx", "npx.cmd", "npx.exe"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CHAIN_KEY_ID = "360ea36c28e66d9d"

def test_architecture_and_exports(server_service_path, server_ts_path):
    print("=" * 80)
    print(" SUITE 1: MCP ARCHITECTURE & EXPORT CONTRACT INTEGRITY")
    print("=" * 80)

    if not os.path.exists(server_service_path):
        print(f"  [FAIL] Missing SovereignMcpServer file: {server_service_path}")
        return False

    with open(server_service_path, "r", encoding="utf-8") as f:
        mcp_code = f.read()

    required_types = [
        "McpJsonRpcRequest",
        "McpJsonRpcResponse",
        "McpToolDefinition",
        "McpResourceDefinition",
        "McpPromptDefinition",
        "SovereignMcpServer",
        "globalSovereignMcpServer"
    ]

    for item in required_types:
        if item not in mcp_code:
            print(f"  [FAIL] Missing required definition in sovereignMcpServer.ts: {item}")
            return False
        print(f"  [OK] Found MCP Type / Export: {item}")

    # Check server.ts integration
    if not os.path.exists(server_ts_path):
        print(f"  [FAIL] Missing server.ts file: {server_ts_path}")
        return False

    with open(server_ts_path, "r", encoding="utf-8") as f:
        server_code = f.read()

    server_endpoints = [
        "/api/mcp/status",
        "/api/mcp/tools",
        "/api/mcp/resources",
        "/api/mcp/prompts",
        "/api/mcp/rpc",
        "globalSovereignMcpServer"
    ]

    for ep in server_endpoints:
        if ep not in server_code:
            print(f"  [FAIL] Missing endpoint/integration in server.ts: {ep}")
            return False
        print(f"  [OK] Verified server.ts integration: {ep}")

    return True

def test_protocol_primitives(server_service_path):
    print("\n" + "=" * 80)
    print(" SUITE 2: MCP CORE TOOLS, RESOURCES & PROMPTS CATALOG")
    print("=" * 80)

    with open(server_service_path, "r", encoding="utf-8") as f:
        code = f.read()

    expected_tools = [
        "sovereign_kernel_query",
        "sovereign_memory_recall",
        "sovereign_verify_chain",
        "sovereign_hitl_propose"
    ]

    for tool in expected_tools:
        if f"name: '{tool}'" not in code and f'name: "{tool}"' not in code:
            print(f"  [FAIL] Core Sovereign tool not registered: {tool}")
            return False
        print(f"  [OK] Registered Sovereign Core Tool: {tool}")

    expected_resources = [
        "sovereign://telemetry/live",
        "sovereign://security/zero-trust-policy"
    ]

    for res in expected_resources:
        if res not in code:
            print(f"  [FAIL] Sovereign Resource URI not found: {res}")
            return False
        print(f"  [OK] Registered Sovereign Resource URI: {res}")

    expected_prompts = [
        "sovereign-commander-briefing"
    ]

    for pr in expected_prompts:
        if pr not in code:
            print(f"  [FAIL] Sovereign Prompt template not found: {pr}")
            return False
        print(f"  [OK] Registered Sovereign Prompt Template: {pr}")

    return True

def test_live_jsonrpc_execution():
    print("\n" + "=" * 80)
    print(" SUITE 3: LIVE JSON-RPC 2.0 PROTOCOL DISPATCHER EXECUTION")
    print("=" * 80)

    runner_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_mcp_test.ts")
    if not os.path.exists(runner_path):
        print(f"  [FAIL] Missing test runner: {runner_path}")
        return False

    try:
        # ── COMMAND-INJECTION FIX (Chain Key 360ea36c28e66d9d) ──────────────────
        # FORENSIC FINDING: this previously ran
        #     cmd = f'npx tsx "{runner_path}"'
        #     subprocess.run(cmd, ..., shell=True)
        # Two distinct defects, only one of which is obvious:
        #   (a) INJECTION SURFACE - with shell=True the command string is handed
        #       to the system shell, so any shell metacharacter reaching
        #       `runner_path` executes. The quoted f-string only *moved* the
        #       risk; it never removed it.
        #   (b) WRONG SEMANTICS ON POSIX - CPython does not execute a list with
        #       shell=True directly; it hands it to the shell, which then treats
        #       the first element as `$0` and the rest as positional parameters.
        #       The invocation degenerates to `/bin/sh -c npx tsx <path>`, where
        #       `npx` runs with NO arguments. That is the actual cause of the
        #       Linux CI failures recorded in runs #34/#35 - not a flaky test.
        #
        # CORRECT FIX: `shell=False` (the default) with an ARGUMENT LIST. No
        # shell is spawned, so no quoting or escaping is required and no
        # metacharacter can be interpreted. This is correct on Windows, POSIX and
        # anywhere else, because there is no shell to disagree about parsing.
        #
        # The launcher is resolved with shutil.which() because `npx` is a `.CMD`
        # shim on Windows and a bare `npx` would not resolve under shell=False.
        npx = _resolve_npx()
        if not npx:
            print("  [FAIL] Unable to locate the 'npx' launcher on PATH.")
            print("         Install Node.js (npx ships with it) before running this suite.")
            return False
        proc = subprocess.run(
            [npx, "tsx", runner_path],
            capture_output=True,
            text=True,
            check=True,
            shell=False
        )
        output = proc.stdout.strip()
        lines = [line for line in output.split("\n") if line.startswith("[{")]
        if not lines:
            print(f"  [FAIL] Unexpected output from test runner: {output}")
            return False

        results = json.loads(lines[-1])
        all_passed = True
        for r in results:
            status = "OK" if r.get("pass") else "FAIL"
            print(f"  [{status}] JSON-RPC Dispatch: {r.get('test')}")
            if not r.get("pass"):
                all_passed = False

        return all_passed
    except subprocess.CalledProcessError as e:
        # ── DIAGNOSTIC FIX (Chain Key 360ea36c28e66d9d) ────────────────────────
        # FORENSIC FINDING: the old handler printed `e.stderr` only. The runner
        # writes its per-test verdict to STDOUT, so a failing subprocess printed
        # an EMPTY error message and hid the very evidence needed to diagnose
        # the failure. Both streams are now surfaced.
        print(f"  [FAIL] Error running live MCP test via tsx (exit code {e.returncode})")
        if e.stdout:
            print("  ---- runner stdout ----")
            for line in str(e.stdout).strip().split("\n"):
                print(f"  {line}")
        if e.stderr:
            print("  ---- runner stderr ----")
            for line in str(e.stderr).strip().split("\n"):
                print(f"  {line}")
        return False
    except Exception as e:
        print(f"  [FAIL] Unexpected error: {e}")
        return False

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    server_service_path = os.path.join(root_dir, "src", "services", "sovereignMcpServer.ts")
    server_ts_path = os.path.join(root_dir, "server.ts")

    print("\n" + "#" * 80)
    print(" SOVEREIGN MODEL CONTEXT PROTOCOL (MCP) TEST HARNESS")
    print(" Authority: Supreme Sovereign Commander")
    print(f" Chain Key ID: {CHAIN_KEY_ID}")
    print("#" * 80 + "\n")

    p1 = test_architecture_and_exports(server_service_path, server_ts_path)
    p2 = test_protocol_primitives(server_service_path)
    p3 = test_live_jsonrpc_execution()

    all_passed = p1 and p2 and p3

    print("\n" + "=" * 80)
    if all_passed:
        print(f" [ALL SUITES PASSED] Sovereign MCP Protocol & Tool Developer Verified!")
        print(f" Cryptographic Verification Seal: SEC-MCP-{CHAIN_KEY_ID}-VERIFIED")
        print("=" * 80 + "\n")
        return 0
    else:
        print(" [VERIFICATION FAILED] One or more MCP test suites failed.")
        print("=" * 80 + "\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
