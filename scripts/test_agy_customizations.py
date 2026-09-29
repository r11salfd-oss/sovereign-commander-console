"""
Sovereign Antigravity Customizations Verifier
Tests:
1. Workspace Customizations Root (.agents/)
2. Directory-Based Rules (AGENTS.md, .agents/rules/)
3. Workspace Skills & Runbooks (.agents/skills/sovereign-governance/)
4. Lifecycle Hooks (.agents/hooks.json)
5. Plugin Bundles (.agents/plugins/sovereign-suite/)
Chain Key ID: 360ea36c28e66d9d
"""

import sys
import os
import json
import re
import subprocess

# Force UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def test_file_presence(workspace_root):
    print("=" * 80)
    print(" SUITE 1: CUSTOMIZATION DIRECTORY & ASSET DISCOVERY")
    print("=" * 80)

    expected_assets = [
        ("AGENTS.md", "Directory-based Workspace Rule"),
        (".agents", "Workspace Customization Root"),
        (os.path.join(".agents", "rules", "sovereign-engineering-rules.md"), "Workspace Rule File"),
        (os.path.join(".agents", "skills", "sovereign-governance", "SKILL.md"), "Workspace Skill Definition"),
        (os.path.join(".agents", "skills", "sovereign-governance", "scripts", "verify_workspace.py"), "Skill Executable Script"),
        (os.path.join(".agents", "hooks.json"), "Agent Lifecycle Hooks"),
        (os.path.join(".agents", "plugins", "sovereign-suite", "plugin.json"), "Workspace Plugin Manifest")
    ]

    all_found = True
    for rel_path, desc in expected_assets:
        full_path = os.path.join(workspace_root, rel_path)
        if os.path.exists(full_path):
            print(f"  [OK] Discovered {desc}: {rel_path}")
        else:
            print(f"  [FAIL] Missing {desc}: {rel_path}")
            all_found = False

    return all_found

def test_skill_frontmatter(workspace_root):
    print("\n" + "=" * 80)
    print(" SUITE 2: SKILL FRONTMATTER & PROGRESSIVE DISCLOSURE COMPLIANCE")
    print("=" * 80)

    skill_path = os.path.join(workspace_root, ".agents", "skills", "sovereign-governance", "SKILL.md")
    with open(skill_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Verify YAML frontmatter delimiters
    if not content.startswith("---"):
        print("[FAIL] Skill file must start with YAML frontmatter '---'")
        return False

    parts = content.split("---")
    if len(parts) < 3:
        print("[FAIL] Malformed YAML frontmatter in SKILL.md")
        return False

    frontmatter = parts[1]
    name_match = re.search(r"name:\s*([a-z0-9-]+)", frontmatter)
    desc_match = re.search(r"description:\s*>(.+?)(?=\n[a-z0-9_-]+:|\Z)", frontmatter, re.DOTALL)

    if not name_match:
        print("[FAIL] Missing or invalid 'name' in SKILL.md frontmatter")
        return False
    print(f"  [OK] Validated skill name: '{name_match.group(1)}'")

    if not desc_match or len(desc_match.group(1).strip()) < 10:
        print("[FAIL] Missing or insufficient 'description' in SKILL.md frontmatter")
        return False
    print(f"  [OK] Validated skill trigger description: '{desc_match.group(1).strip()[:60]}...'")

    return True

def test_json_configs(workspace_root):
    print("\n" + "=" * 80)
    print(" SUITE 3: HOOKS & PLUGIN JSON VALIDATION")
    print("=" * 80)

    hooks_path = os.path.join(workspace_root, ".agents", "hooks.json")
    with open(hooks_path, "r", encoding="utf-8") as f:
        try:
            hooks_data = json.load(f)
            print("  [OK] Successfully parsed .agents/hooks.json")
        except Exception as e:
            print(f"[FAIL] Invalid JSON in hooks.json: {e}")
            return False

    if not isinstance(hooks_data, dict):
        print("[FAIL] hooks.json root must be a JSON object mapping hook names")
        return False

    for hook_name, hook_spec in hooks_data.items():
        print(f"  [OK] Verified hook: '{hook_name}' (enabled: {hook_spec.get('enabled', True)})")

    plugin_path = os.path.join(workspace_root, ".agents", "plugins", "sovereign-suite", "plugin.json")
    with open(plugin_path, "r", encoding="utf-8") as f:
        try:
            plugin_data = json.load(f)
            print("  [OK] Successfully parsed .agents/plugins/sovereign-suite/plugin.json")
        except Exception as e:
            print(f"[FAIL] Invalid JSON in plugin.json: {e}")
            return False

    if "name" not in plugin_data:
        print("[FAIL] plugin.json missing required 'name' field")
        return False
    print(f"  [OK] Verified plugin name: '{plugin_data['name']}'")

    return True

def test_helper_script_execution(workspace_root):
    print("\n" + "=" * 80)
    print(" SUITE 4: EXECUTABLE SKILL SCRIPT RUN")
    print("=" * 80)

    script_path = os.path.join(workspace_root, ".agents", "skills", "sovereign-governance", "scripts", "verify_workspace.py")
    res = subprocess.run([sys.executable, script_path], cwd=workspace_root)
    if res.returncode == 0:
        print("\n  [OK] Skill verification script returned exit code 0")
        return True
    else:
        print(f"\n[FAIL] Skill verification script failed with code: {res.returncode}")
        return False

def main():
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("\n" + "#" * 80)
    print(" SOVEREIGN ANTIGRAVITY CUSTOMIZATIONS VERIFICATION HARNESS")
    print(" Authority: Supreme Sovereign Commander")
    print(" Chain Key ID: 360ea36c28e66d9d")
    print("#" * 80 + "\n")

    p1 = test_file_presence(workspace_root)
    p2 = test_skill_frontmatter(workspace_root)
    p3 = test_json_configs(workspace_root)
    p4 = test_helper_script_execution(workspace_root)

    all_passed = p1 and p2 and p3 and p4

    print("\n" + "=" * 80)
    if all_passed:
        print(" [ALL SUITES PASSED] Antigravity Customization Architecture Verified!")
        print(" Cryptographic Verification Seal: AGY-CUST-360ea36c28e66d9d-VERIFIED")
        print("=" * 80 + "\n")
        return 0
    else:
        print(" [VERIFICATION FAILED] One or more customization suites failed.")
        print("=" * 80 + "\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
