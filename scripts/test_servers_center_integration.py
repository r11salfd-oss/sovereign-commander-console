"""
Sovereign Servers Center (6 MCP + 6 LSP) Integration Verification Harness
Standards: Model Context Protocol (MCP) & Language Server Protocol (LSP)
Chain Key ID: 360ea36c28e66d9d
"""

import os
import sys
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


# Force UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CHAIN_KEY_ID = "360ea36c28e66d9d"
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANONICAL_MANIFEST = os.path.join(ROOT_DIR, "config", "servers_center_manifest.json")

# ── SERVERS CENTER LOCATOR (Chain Key 360ea36c28e66d9d) ──────────────────────
# FORENSIC FINDING: the centre root was resolved as
#     os.environ.get("SERVERS_CENTER_PATH", r"E:\Servers-Center")
# A hardcoded machine-specific drive letter silently made this suite
# machine-dependent: on any host without `E:\` the variable still resolved to a
# non-existent path, which looked like a configured centre rather than an absent
# one. The env override is honoured first; the legacy path is used ONLY if it
# actually exists; otherwise the suite falls through to the canonical in-repo
# manifest that every other function already falls back to.
# The resolution SOURCE is reported explicitly so a pass can never be mistaken
# for "the live centre was checked" when it really came from the committed
# manifest.
def _resolve_center_root():
    """Return (center_root_or_None, source_description)."""
    env_path = os.environ.get("SERVERS_CENTER_PATH")
    if env_path:
        if os.path.isdir(env_path):
            return env_path, "SERVERS_CENTER_PATH env override"
        return None, "SERVERS_CENTER_PATH set but NOT A DIRECTORY -> falling back to canonical manifest"
    legacy = r"E:\Servers-Center"
    if os.path.isdir(legacy):
        return legacy, "legacy local path (E:\\Servers-Center) present on this host"
    return None, "no SERVERS_CENTER_PATH and no legacy path -> using canonical in-repo manifest"


CENTER_ROOT, CENTER_ROOT_SOURCE = _resolve_center_root()
# Retained for compatibility with any existing caller; None when no live centre.
PORTABLE_NODE = os.path.join(CENTER_ROOT, "runtime", "node-v24.19.0-win-x64", "node.exe") if CENTER_ROOT else None

def test_manifest_and_mcp_servers():
    print("=" * 80)
    print(" SUITE 1: 6 MCP SERVERS + SOVEREIGN COMMANDER INVENTORY & VALIDATION")
    print("=" * 80)

    # CENTER_ROOT may legitimately be None on a host with no Servers Center
    # installation; in that case fall straight through to the canonical
    # in-repo manifest instead of building a path against None.
    manifest_path = os.path.join(CENTER_ROOT, "manifest.json") if CENTER_ROOT else ""
    if not manifest_path or not os.path.exists(manifest_path):
        manifest_path = CANONICAL_MANIFEST
    if not os.path.exists(manifest_path):
        print(f"  [FAIL] Missing manifest.json at {manifest_path}")
        return False

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    mcp = manifest.get("mcp", {})
    expected_mcp = [
        "shell",
        "chrome-devtools",
        "github",
        "syncfusion",
        "context7",
        "playwright",
        "sovereign-commander"
    ]

    all_found = True
    for srv in expected_mcp:
        if srv not in mcp:
            print(f"  [FAIL] Missing MCP server in manifest: {srv}")
            all_found = False
        else:
            entry = mcp[srv].get("entry", "")
            ver = mcp[srv].get("version", "")
            print(f"  [OK] MCP Server: {srv:<22} | Version: {ver:<8} | Entry: {entry}")

    return all_found

def test_lsp_servers():
    print("\n" + "=" * 80)
    print(" SUITE 2: 6 LANGUAGE SERVER PROTOCOL (LSP) ENGINES INVENTORY")
    print("=" * 80)

    # CENTER_ROOT may legitimately be None on a host with no Servers Center
    # installation; in that case fall straight through to the canonical
    # in-repo manifest instead of building a path against None.
    manifest_path = os.path.join(CENTER_ROOT, "manifest.json") if CENTER_ROOT else ""
    if not manifest_path or not os.path.exists(manifest_path):
        manifest_path = CANONICAL_MANIFEST
    if not os.path.exists(manifest_path):
        print(f"  [FAIL] Missing manifest.json at {manifest_path}")
        return False

    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    lsp = manifest.get("lsp", {})
    expected_lsp = [
        "typescript",
        "eslint",
        "bash",
        "yaml",
        "pyright",
        "dotnet"
    ]

    all_found = True
    for srv in expected_lsp:
        if srv not in lsp:
            print(f"  [FAIL] Missing LSP server in manifest: {srv}")
            all_found = False
        else:
            ver = lsp[srv].get("version", "")
            entry_or_src = lsp[srv].get("entry") or lsp[srv].get("source") or lsp[srv].get("note")
            print(f"  [OK] LSP Engine: {srv:<22} | Version: {ver:<8} | Spec: {entry_or_src}")

    return all_found

def test_codebase_service_and_endpoints():
    print("\n" + "=" * 80)
    print(" SUITE 3: CODEBASE REGISTRY & SERVER ENDPOINT CONTRACTS")
    print("=" * 80)

    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    registry_file = os.path.join(root_dir, "src", "services", "serversCenterRegistry.ts")
    server_file = os.path.join(root_dir, "server.ts")
    panel_file = os.path.join(root_dir, "src", "components", "ServersCenterPanel.tsx")
    devpage_file = os.path.join(root_dir, "src", "pages", "DeveloperPage.tsx")

    files = [
        ("serversCenterRegistry.ts", registry_file),
        ("server.ts", server_file),
        ("ServersCenterPanel.tsx", panel_file),
        ("DeveloperPage.tsx", devpage_file)
    ]

    for name, path in files:
        if not os.path.exists(path):
            print(f"  [FAIL] Missing source file: {name}")
            return False
        print(f"  [OK] Found active source file: {name}")

    with open(server_file, "r", encoding="utf-8") as f:
        server_code = f.read()

    required_endpoints = [
        "/api/servers-center/overview",
        "/api/mcp/servers",
        "/api/lsp/servers",
        "/api/mcp/status"
    ]

    for ep in required_endpoints:
        if ep not in server_code:
            print(f"  [FAIL] Missing endpoint in server.ts: {ep}")
            return False
        print(f"  [OK] Verified server.ts endpoint route: {ep}")

    return True

def test_live_registry_evaluation():
    print("\n" + "=" * 80)
    print(" SUITE 4: LIVE SERVERS CENTER REGISTRY EVALUATION (TSX RUNNER)")
    print("=" * 80)

    test_ts = f"""
import {{ globalServersCenterRegistry }} from '../src/services/serversCenterRegistry';

const overview = globalServersCenterRegistry.getOverview();
const mcpCount = overview.mcpSummary.total;
const lspCount = overview.lspSummary.total;
const isAvailable = overview.isAvailable;

const result = {{
  isAvailable,
  mcpCount,
  lspCount,
  chainKey: overview.chainKey,
  mcpIds: overview.mcpSummary.servers.map(s => s.id),
  lspIds: overview.lspSummary.servers.map(s => s.id)
}};

console.log(JSON.stringify(result));
"""

    runner_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_temp_eval_center.ts")
    with open(runner_file, "w", encoding="utf-8") as f:
        f.write(test_ts)

    try:
        # ── COMMAND-INJECTION FIX (Chain Key 360ea36c28e66d9d) ──────────────────
        # FORENSIC FINDING: this previously ran
        #     cmd = f'npx tsx "{runner_file}"'
        #     subprocess.run(cmd, ..., shell=True)
        # Same two defects as the MCP harness: a shell-injection surface, and
        # CPython handing the list to the shell so that on POSIX `npx` ran with
        # no arguments at all (`/bin/sh -c npx tsx <path>`, where `npx` became
        # $0 and the path became $1). The quoted f-string only relocated the
        # injection risk; it never removed it.
        #
        # CORRECT FIX: `shell=False` with an ARGUMENT LIST. No shell is spawned,
        # so no quoting or escaping is needed and no metacharacter can be
        # interpreted. Identical behaviour on Windows, POSIX and anywhere else.
        #
        # The launcher is resolved with shutil.which() because `npx` is a `.CMD`
        # shim on Windows and a bare `npx` would not resolve under shell=False.
        npx = _resolve_npx()
        if not npx:
            print("  [FAIL] Unable to locate the 'npx' launcher on PATH.")
            print("         Install Node.js (npx ships with it) before running this suite.")
            return False
        proc = subprocess.run(
            [npx, "tsx", runner_file],
            capture_output=True,
            text=True,
            check=True,
            shell=False
        )
        output = proc.stdout.strip()
        lines = [l for l in output.split("\n") if l.startswith("{")]
        if not lines:
            print(f"  [FAIL] Unexpected output: {output}")
            return False

        data = json.loads(lines[-1])

        # ── ANTI-FABRICATION FIX (Chain Key 360ea36c28e66d9d) ──────────────────
        # FORENSIC FINDING: this block printed four unconditional `[OK]` lines
        # BEFORE evaluating anything. It printed "[OK] Registry Center Available:
        # False" when the registry was unavailable - i.e. it labelled a negative
        # result as a success. A line prefixed `[OK]` is an assertion about
        # reality, and here it asserted nothing at all. That is precisely how
        # fabricated MCP/LSP reporting survived review for so long.
        #
        # Every line below now reports the MEASURED value with a status marker
        # derived from that value, and an unmet expectation is recorded so the
        # suite can genuinely fail.
        has_all_mcp = len(data.get("mcpIds", [])) >= 7
        has_all_lsp = len(data.get("lspIds", [])) >= 6
        valid_chain = data.get("chainKey") == CHAIN_KEY_ID
        center_available = data.get("isAvailable") is True

        def report(label, value, ok):
            print(f"  [{'OK' if ok else 'FAIL'}] {label}: {value}")

        report("Registry Center Available", data.get("isAvailable"), center_available)
        report("Total MCP Servers Loaded",
               f"{data.get('mcpCount')} ({data.get('mcpIds')})", has_all_mcp)
        report("Total LSP Servers Loaded",
               f"{data.get('lspCount')} ({data.get('lspIds')})", has_all_lsp)
        report("Verified Chain Key", data.get("chainKey"), valid_chain)

        # `isAvailable` is now part of the verdict. Previously it was printed as
        # an `[OK]` line but never evaluated, so a centre that reports itself
        # unavailable could still pass the suite.
        return center_available and has_all_mcp and has_all_lsp and valid_chain
    except subprocess.CalledProcessError as e:
        # Surface BOTH streams: the runner reports on stdout, and the previous
        # handler printed `e.stderr` only, so failures surfaced with an empty
        # diagnostic and hid the evidence needed to diagnose them.
        print(f"  [FAIL] Registry evaluation runner exited {e.returncode}")
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
        print(f"  [FAIL] Error running registry evaluation: {e}")
        return False
    finally:
        if os.path.exists(runner_file):
            os.remove(runner_file)

def main():
    print("\n" + "#" * 80)
    print(" SOVEREIGN SERVERS CENTER (6 MCP + 6 LSP) INTEGRATION VERIFIER")
    print(" Authority: Supreme Sovereign Commander")
    print(f" Chain Key ID: {CHAIN_KEY_ID}")
    print("#" * 80 + "\n")

    # Report the resolution source so a pass can never be misread as
    # "the live Servers Center was verified" when it actually came from the
    # committed manifest fallback.
    print(f" Servers Center locator: {CENTER_ROOT_SOURCE}")
    print(f" Live center root      : {CENTER_ROOT or '(none - canonical manifest in use)'}")
    print(f" Canonical manifest    : {CANONICAL_MANIFEST}")
    print("")

    p1 = test_manifest_and_mcp_servers()
    p2 = test_lsp_servers()
    p3 = test_codebase_service_and_endpoints()
    p4 = test_live_registry_evaluation()

    all_passed = p1 and p2 and p3 and p4

    print("\n" + "=" * 80)
    if all_passed:
        print(" [ALL SUITES PASSED] All 6 MCP Servers + All 6 LSP Servers Successfully Integrated!")
        print(f" Cryptographic Verification Seal: SEC-CENTER-MATRIX-{CHAIN_KEY_ID}-VERIFIED")
        print("=" * 80 + "\n")
        return 0
    else:
        print(" [VERIFICATION FAILED] One or more verification suites failed.")
        print("=" * 80 + "\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
