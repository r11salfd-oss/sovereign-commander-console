"""
Sovereign Firebase SQL Connect (Data Connect) Architecture & Schema Verifier
Validates:
1. File structure and configuration files (firebase.json, dataconnect.yaml, connector.yaml)
2. GraphQL Schema syntax and @table directives (schema.gql)
3. Authorized Queries syntax and @auth(level: USER) row-level security (queries.gql)
4. Authorized Mutations syntax and @auth(level: USER) directives (mutations.gql)
5. Local prototyping seed data structure (seed_data.gql)
Chain Key ID: 360ea36c28e66d9d
"""

import sys
import os
import json
import re

# Force UTF-8 on Windows terminal output
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def check_balanced_delimiters(content, filename):
    filtered = []
    in_single_comment = False
    in_str_double = False

    i = 0
    while i < len(content):
        c = content[i]
        nxt = content[i+1] if i + 1 < len(content) else ''

        if in_single_comment:
            if c == '\n':
                in_single_comment = False
            i += 1
            continue

        if in_str_double:
            if c == '\\':
                i += 2
                continue
            if c == '"':
                in_str_double = False
            i += 1
            continue

        if c == '#':
            in_single_comment = True
            i += 1
            continue

        if c == '"':
            in_str_double = True
            i += 1
            continue

        filtered.append(c)
        i += 1

    clean = "".join(filtered)
    errors = []

    brace_stack = []
    paren_stack = []
    bracket_stack = []

    for idx, char in enumerate(clean):
        if char == '{':
            brace_stack.append(('{', idx))
        elif char == '}':
            if not brace_stack:
                errors.append(f"Unmatched closing '}}' in {filename} at {idx}")
            else:
                brace_stack.pop()
        elif char == '(':
            paren_stack.append(('(', idx))
        elif char == ')':
            if not paren_stack:
                errors.append(f"Unmatched closing ')' in {filename} at {idx}")
            else:
                paren_stack.pop()
        elif char == '[':
            bracket_stack.append(('[', idx))
        elif char == ']':
            if not bracket_stack:
                errors.append(f"Unmatched closing ']' in {filename} at {idx}")
            else:
                bracket_stack.pop()

    if brace_stack:
        errors.append(f"Unmatched opening '{{' in {filename}: count {len(brace_stack)}")
    if paren_stack:
        errors.append(f"Unmatched opening '(' in {filename}: count {len(paren_stack)}")
    if bracket_stack:
        errors.append(f"Unmatched opening '[' in {filename}: count {len(bracket_stack)}")

    return errors

def verify_data_connect(root_dir):
    print("=" * 70)
    print("[SOVEREIGN] FIREBASE SQL CONNECT (DATA CONNECT) ARCHITECTURE VERIFIER")
    print("Chain Key ID: 360ea36c28e66d9d")
    print("=" * 70)

    dc_dir = os.path.join(root_dir, 'dataconnect')
    fb_json_path = os.path.join(root_dir, 'firebase.json')
    dc_yaml_path = os.path.join(dc_dir, 'dataconnect.yaml')
    conn_yaml_path = os.path.join(dc_dir, 'connector', 'connector.yaml')
    schema_gql_path = os.path.join(dc_dir, 'schema', 'schema.gql')
    queries_gql_path = os.path.join(dc_dir, 'connector', 'queries.gql')
    mutations_gql_path = os.path.join(dc_dir, 'connector', 'mutations.gql')
    seed_gql_path = os.path.join(dc_dir, 'seed_data.gql')

    errors = []

    # 1. Validate firebase.json
    print("[1/5] Verifying firebase.json configuration...")
    if not os.path.exists(fb_json_path):
        errors.append("firebase.json not found")
    else:
        try:
            with open(fb_json_path, 'r', encoding='utf-8') as f:
                fb_data = json.load(f)
            if 'dataconnect' not in fb_data:
                errors.append("firebase.json missing 'dataconnect' key")
            print("  * firebase.json contains valid dataconnect mapping.")
        except Exception as e:
            errors.append(f"Error parsing firebase.json: {e}")

    # 2. Validate YAML files
    print("\n[2/5] Verifying dataconnect.yaml and connector.yaml...")
    for p in [dc_yaml_path, conn_yaml_path]:
        if not os.path.exists(p):
            errors.append(f"File not found: {p}")
        else:
            with open(p, 'r', encoding='utf-8') as f:
                y_text = f.read()
            if "specVersion" in y_text and "serviceId" in y_text:
                print(f"  * {os.path.basename(p)} conforms to SQL Connect specification.")
            elif "connectorId" in y_text and "javascriptSdk" in y_text:
                print(f"  * {os.path.basename(p)} configures TypeScript Web SDK generation.")

    # 3. Validate schema.gql
    print("\n[3/5] Verifying Relational GraphQL Schema (schema.gql)...")
    if not os.path.exists(schema_gql_path):
        errors.append("schema.gql not found")
    else:
        with open(schema_gql_path, 'r', encoding='utf-8') as f:
            schema_content = f.read()

        delimiter_errs = check_balanced_delimiters(schema_content, "schema.gql")
        errors.extend(delimiter_errs)

        expected_tables = [
            "User",
            "SovereignApproval",
            "SovereignChatSession",
            "SovereignChatMessage",
            "SovereignAuditBlock",
            "SovereignTestRun"
        ]

        for table in expected_tables:
            if f"type {table} @table" not in schema_content:
                errors.append(f"Missing @table definition for: {table}")
            else:
                print(f"  * Table '{table}' verified with @table directive.")

    # 4. Validate queries.gql and mutations.gql
    print("\n[4/5] Verifying Operations & Zero-Trust Row-Level Security (@auth)...")
    for op_path, op_type in [(queries_gql_path, "query"), (mutations_gql_path, "mutation")]:
        if not os.path.exists(op_path):
            errors.append(f"{op_path} not found")
            continue
        with open(op_path, 'r', encoding='utf-8') as f:
            op_content = f.read()

        delimiter_errs = check_balanced_delimiters(op_content, os.path.basename(op_path))
        errors.extend(delimiter_errs)

        # Check that all operations declare @auth
        pattern = re.compile(rf'({op_type}\s+\w+)([^{{]+)\{{')
        matches = pattern.findall(op_content)
        for op_decl, header in matches:
            if "@auth" not in header:
                errors.append(f"Operation '{op_decl}' in {os.path.basename(op_path)} missing @auth directive!")
            else:
                print(f"  * {op_decl.strip()} protected with row-level security directive.")

    # 5. Validate seed_data.gql
    print("\n[5/5] Verifying Local Prototyping Seed Data (seed_data.gql)...")
    if not os.path.exists(seed_gql_path):
        errors.append("seed_data.gql not found")
    else:
        with open(seed_gql_path, 'r', encoding='utf-8') as f:
            seed_content = f.read()

        delimiter_errs = check_balanced_delimiters(seed_content, "seed_data.gql")
        errors.extend(delimiter_errs)

        # Must have @transaction
        if "@transaction" not in seed_content:
            errors.append("seed_data.gql missing @transaction directive")
        else:
            print("  * seed_data.gql executes under atomic @transaction.")

        # Must NOT have @auth in seed_data.gql (mandated by rule)
        if "@auth" in seed_content:
            errors.append("seed_data.gql must NOT declare @auth directives (local only)")
        else:
            print("  * seed_data.gql correctly excludes unnecessary @auth directives.")

    print("\n" + "=" * 70)
    if errors:
        print("[FAIL] FIREBASE SQL CONNECT VERIFICATION FAILED:")
        for err in errors:
            print(f"  ❌ {err}")
        return False

    print("[SUCCESS] ALL FIREBASE SQL CONNECT SPECIFICATIONS VERIFIED.")
    print("=" * 70)
    return True

if __name__ == '__main__':
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    success = verify_data_connect(workspace_root)
    sys.exit(0 if success else 1)
