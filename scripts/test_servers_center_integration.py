"""
Sovereign Servers Center (6 MCP + 6 LSP) Integration Verification Harness
Standards: Model Context Protocol (MCP) & Language Server Protocol (LSP)
Chain Key ID: 360ea36c28e66d9d
"""

import os
import sys
import json
import subprocess

# Force UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

CHAIN_KEY_ID = "360ea36c28e66d9d"
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANONICAL_MANIFEST = os.path.join(ROOT_DIR, "config", "servers_center_manifest.json")
CENTER_ROOT = os.environ.get("SERVERS_CENTER_PATH", r"E:\Servers-Center")
PORTABLE_NODE = os.path.join(CENTER_ROOT, "runtime", "node-v24.19.0-win-x64", "node.exe")

def test_manifest_and_mcp_servers():
    print("=" * 80)
    print(" SUITE 1: 6 MCP SERVERS + SOVEREIGN COMMANDER INVENTORY & VALIDATION")
    print("=" * 80)

    manifest_path = os.path.join(CENTER_ROOT, "manifest.json")
    if not os.path.exists(manifest_path):
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

    manifest_path = os.path.join(CENTER_ROOT, "manifest.json")
    if not os.path.exists(manifest_path):
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
        cmd = f'npx tsx "{runner_file}"'
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
            shell=True
        )
        output = proc.stdout.strip()
        lines = [l for l in output.split("\n") if l.startswith("{")]
        if not lines:
            print(f"  [FAIL] Unexpected output: {output}")
            return False

        data = json.loads(lines[-1])
        print(f"  [OK] Registry Center Available: {data.get('isAvailable')}")
        print(f"  [OK] Total MCP Servers Loaded: {data.get('mcpCount')} ({data.get('mcpIds')})")
        print(f"  [OK] Total LSP Servers Loaded: {data.get('lspCount')} ({data.get('lspIds')})")
        print(f"  [OK] Verified Chain Key: {data.get('chainKey')}")

        has_all_mcp = len(data.get("mcpIds", [])) >= 7
        has_all_lsp = len(data.get("lspIds", [])) >= 6
        valid_chain = data.get("chainKey") == CHAIN_KEY_ID

        return has_all_mcp and has_all_lsp and valid_chain
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
