#!/usr/bin/env bash
# ====================================================================================================
# GATE 9 FALSIFICATION DRILL
#
# A guard that has only ever been observed passing is indistinguishable from a guard that cannot
# fail. This drill injects, one at a time, the exact defect each Gate 9 check exists to catch, and
# requires the gate to reject it. After each injection the file is restored from git.
#
# Safety:
#   - refuses to run on a dirty working tree (nothing of yours can be overwritten)
#   - every touched file is restored with `git checkout --` on exit, including on failure
#   - every injection is a defect, never a weakening of the guard
#
# Run: bash tools/root_guard_drill.sh
# Expected: 7/7 injections rejected. Any "UNGUARDED" line means a guard is decorative.
# ====================================================================================================
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

TOUCHED=(
    tools/crypto_probe.ts
    tools/deep_probe.ts
    scripts/test_servers_center_integration.py
    tools/network_probe.ts
    tools/lib/probe_runner.ts
    src/neo/arsenal/network/network_arsenal.ts
    .github/workflows/ci.yml
)

restore_all() {
    git checkout -- "${TOUCHED[@]}" 2>/dev/null
}
trap restore_all EXIT

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "REFUSED: tracked files have uncommitted changes. The drill rewrites tracked files and restores them from git."
    exit 2
fi

TMP="$(mktemp -d)"
trap 'restore_all; rm -rf "$TMP"' EXIT

PASSES=0
FAILURES=0

# A non-zero exit is not enough: the gate must fail on the check that exists for this defect.
# Otherwise ANY unrelated failure would be counted as a guard working - the drill itself would lie.
expect_rejection() {
    local label="$1"
    local expected="$2"
    local code=0
    npx tsx tools/root_guard.ts > "$TMP/out.txt" 2>&1 || code=$?
    if [[ $code -eq 0 ]]; then
        echo "  [UNGUARDED]  $label -> the gate still passed"
        FAILURES=$((FAILURES + 1))
    elif ! grep -qF "[FAIL] ${expected}" "$TMP/out.txt"; then
        echo "  [WRONG-CHECK] $label -> failed, but not on '${expected}'"
        FAILURES=$((FAILURES + 1))
    else
        echo "  [GUARDED]    $label -> '${expected}' rejected it"
        PASSES=$((PASSES + 1))
    fi
    grep -m1 '\[FAIL\]' "$TMP/out.txt" | sed 's/^/               /'
}

echo "===================================================================================================="
echo "GATE 9 FALSIFICATION DRILL - inject the defect, require the guard to catch it"
echo "===================================================================================================="

echo
echo "[1] R1 machine-bound path"
printf '\n// /tmp/opencode\n' >> tools/crypto_probe.ts  # path-guard: allow (the injected defect string itself, not a code dependency)
expect_rejection "author scratch path added to executable code" "no author-machine paths or fixed ports in executable code"
restore_all

echo
echo "[1b] R1 fixed listening port"
DEAD_PORT=45331
sed -i "s|webServer.listen(0, '127.0.0.1', r)|webServer.listen(${DEAD_PORT}, '127.0.0.1', r)|" tools/deep_probe.ts
expect_rejection "a probe binds a fixed port again" "no author-machine paths or fixed ports in executable code"
restore_all

echo
echo "[2] R1 resolution computed twice"
sed -i 's|^        child_env\["SERVERS_CENTER_MANIFEST"\] = _resolved_manifest_path()$|        # drill: manifest no longer forwarded|' \
    scripts/test_servers_center_integration.py
expect_rejection "child no longer receives the parent's manifest resolution" "Servers Center resolution is computed once and passed to the child"
restore_all

echo
echo "[3] R3 exact equality against a moving counter"
# rxBefore is captured before the module reads /proc/net/dev, so a live flood guarantees movement:
# measured 10/10 failures under load. The bracket is the only assertion that holds.
sed -i 's|lo.rxBytes >= rxBefore && lo.rxBytes <= rxAfter|lo.rxBytes === rxBefore|' tools/network_probe.ts
expect_rejection "bracketed counter check replaced by exact equality" "probe holds under adversarial load and shared-artifact contention"
restore_all

echo
echo "[3b] R1 shared artifact path"
sed -i 's|arsenal-${process.pid}.rules|arsenal.rules|' src/neo/arsenal/network/network_arsenal.ts
expect_rejection "the IDS rule set is written to one shared path again" "no author-machine paths or fixed ports in executable code"
restore_all

echo
echo "[4] R3 failure without evidence"
sed -i 's| \[${how}\]||' tools/lib/probe_runner.ts
expect_rejection "probe failure no longer reports status and signal" "failure evidence contract (status, signal, output) is tested"
restore_all

echo
echo "[5] R2 gate silently removed"
sed -i "s|Gate 9: Root Guards|Gate nine: Root Guards|" .github/workflows/ci.yml
expect_rejection "Gate 9 marker deleted from the workflow" "gate inventory, referenced artifacts and ledger integrity"
restore_all

echo
echo "===================================================================================================="
echo "RESULT: ${PASSES} injection(s) rejected, ${FAILURES} injection(s) went unnoticed"
if [[ $FAILURES -gt 0 ]]; then
    echo "A guard that cannot fail is decoration. Fix the guard."
    exit 1
fi
echo "Every Gate 9 check was observed failing on the defect it exists to catch."
echo "===================================================================================================="
