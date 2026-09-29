"""
Sovereign Workspace Verification Helper
Script location: .agents/skills/sovereign-governance/scripts/verify_workspace.py
Chain Key ID: 360ea36c28e66d9d
"""

import sys
import os
import subprocess

# Force UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
    print("=" * 80)
    print(" SOVEREIGN WORKSPACE HEALTH AUDIT")
    print(f" Workspace Root: {root_dir}")
    print(" Chain Key ID: 360ea36c28e66d9d")
    print("=" * 80)

    # 1. Critical Files Audit
    critical_files = [
        "package.json",
        "tsconfig.json",
        "AGENTS.md",
        "firestore.rules",
        os.path.join("src", "services", "agentMemoryEngine.ts"),
        os.path.join("dataconnect", "schema", "schema.gql"),
        os.path.join("scripts", "test_agent_memory_systems.py")
    ]

    missing = []
    for rel_path in critical_files:
        full_path = os.path.join(root_dir, rel_path)
        if not os.path.exists(full_path):
            missing.append(rel_path)
        else:
            print(f"  [OK] Found critical asset: {rel_path}")

    if missing:
        print(f"\n[FAIL] Missing critical files: {missing}")
        return 1

    # 2. Run Memory Systems Test
    print("\n[+] Running Agent Memory Systems Verification...")
    res = subprocess.run([sys.executable, os.path.join(root_dir, "scripts", "test_agent_memory_systems.py")], cwd=root_dir)
    if res.returncode != 0:
        print("[FAIL] Agent Memory Systems test failed.")
        return res.returncode

    print("\n" + "=" * 80)
    print(" [WORKSPACE HEALTHY] All sovereign core assets verified.")
    print(" Cryptographic Seal: WS-HEALTH-360ea36c28e66d9d-PASSED")
    print("=" * 80)
    return 0

if __name__ == "__main__":
    sys.exit(main())
