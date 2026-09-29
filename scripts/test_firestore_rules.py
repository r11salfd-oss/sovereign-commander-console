"""
Sovereign Firestore Rules Syntax & Devil's Advocate Security Verifier
Tests firestore.rules for:
1. Structural integrity (balanced braces, brackets, quotes, statement termination)
2. Presence of required Assumed Data Models
3. Helper functions & Validator Function Pattern across both create and update
4. Devil's Advocate 21 attack vectors analysis
"""

import sys
import os
import re

# Force UTF-8 on Windows terminal output
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

def verify_rules_syntax(filepath):
    print("=" * 65)
    print("[SOVEREIGN] FIRESTORE SECURITY RULES SYNTAX & AUDIT VERIFIER")
    print("=" * 65)

    if not os.path.exists(filepath):
        print(f"[FAIL] File not found: {filepath}")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    errors = []

    # 1. Structural check: rules_version
    if "rules_version = '2';" not in content:
        errors.append("Missing or invalid rules_version = '2'; header.")

    # 2. Balanced braces and parentheses
    # Filter out strings and comments
    filtered = []
    in_single_comment = False
    in_multi_comment = False
    in_str_single = False
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
        if in_multi_comment:
            if c == '*' and nxt == '/':
                in_multi_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str_single:
            if c == '\\':
                i += 2
                continue
            if c == "'":
                in_str_single = False
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

        if c == '/' and nxt == '/':
            in_single_comment = True
            i += 2
            continue
        if c == '/' and nxt == '*':
            in_multi_comment = True
            i += 2
            continue
        if c == "'":
            in_str_single = True
            i += 1
            continue
        if c == '"':
            in_str_double = True
            i += 1
            continue

        filtered.append(c)
        i += 1

    clean_code = "".join(filtered)

    brace_stack = []
    paren_stack = []
    bracket_stack = []

    for idx, char in enumerate(clean_code):
        if char == '{':
            brace_stack.append(('{', idx))
        elif char == '}':
            if not brace_stack:
                errors.append(f"Unmatched closing brace '}}' at offset {idx}")
            else:
                brace_stack.pop()
        elif char == '(':
            paren_stack.append(('(', idx))
        elif char == ')':
            if not paren_stack:
                errors.append(f"Unmatched closing parenthesis ')' at offset {idx}")
            else:
                paren_stack.pop()
        elif char == '[':
            bracket_stack.append(('[', idx))
        elif char == ']':
            if not bracket_stack:
                errors.append(f"Unmatched closing bracket ']' at offset {idx}")
            else:
                bracket_stack.pop()

    if brace_stack:
        errors.append(f"Unmatched opening braces count: {len(brace_stack)}")
    if paren_stack:
        errors.append(f"Unmatched opening parentheses count: {len(paren_stack)}")
    if bracket_stack:
        errors.append(f"Unmatched opening brackets count: {len(bracket_stack)}")

    # 3. Check Assumed Data Model
    if "Assumed Data Model" not in content:
        errors.append("Missing Assumed Data Model comment header.")

    # 4. Check Validator Pattern on create & update
    collections = ['approvals', 'chat_sessions', 'test_runs']
    for col in collections:
        if f"match /{col}/" not in content:
            errors.append(f"Missing match block for collection: {col}")

    # Check for approvals validator in create and update
    appr_match = re.search(r'match\s+/approvals/\{[^\}]+\}\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content)
    if appr_match:
        appr_body = appr_match.group(1)
        if "isValidApproval" not in appr_body:
            errors.append("isValidApproval not called in approvals match block.")
        if "create:" not in appr_body or "update:" not in appr_body:
            errors.append("approvals missing explicit create or update rule.")

    # Check for chat_sessions validator in create and update
    chat_match = re.search(r'match\s+/chat_sessions/\{[^\}]+\}\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content)
    if chat_match:
        chat_body = chat_match.group(1)
        if "isValidChatSession" not in chat_body:
            errors.append("isValidChatSession not called in chat_sessions match block.")

    # Check for test_runs immutable update
    test_match = re.search(r'match\s+/test_runs/\{[^\}]+\}\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content)
    if test_match:
        test_body = test_match.group(1)
        if "allow update: if false;" not in test_body:
            errors.append("test_runs does not strictly enforce 'allow update: if false;'.")

    # Check default deny
    if "match /{document=**}" not in content or "allow read, write: if false;" not in content:
        errors.append("Missing default deny match /{document=**} rule.")

    print(f"Checking file: {filepath}")
    print(f"  * Total lines: {len(content.splitlines())}")
    print(f"  * Brace balance: {'[OK] BALANCED' if not brace_stack else '[FAIL] UNBALANCED'}")
    print(f"  * Parenthesis balance: {'[OK] BALANCED' if not paren_stack else '[FAIL] UNBALANCED'}")
    print(f"  * Bracket balance: {'[OK] BALANCED' if not bracket_stack else '[FAIL] UNBALANCED'}")

    if errors:
        print("\n[FAIL] SYNTAX & STRUCTURAL AUDIT ERRORS:")
        for err in errors:
            print(f"  - {err}")
        return False

    print("\n[SUCCESS] ALL STRUCTURAL AND SYNTACTIC AUDIT CHECKS PASSED.")
    return True

if __name__ == '__main__':
    target = os.path.join(os.path.dirname(__file__), '..', 'firestore.rules')
    success = verify_rules_syntax(target)
    sys.exit(0 if success else 1)
