# Root Cause Register

Seven real defects were found in the CI pipeline by **running** it, not by reading it. Fixing the
seven symptoms left the mechanisms that produced them intact: the same classes would have returned
with the next path, the next dependency bump, the next timing-sensitive assertion. Three more (#8,
#9 and #10) surfaced while the guards themselves were being exercised, which is the point of the
exercise: a guard that is really run finds things a review does not.

This register is the answer to that. It names three root classes, binds each one to an executable
guard in **Gate 9** (`tools/root_guard.ts`), and states exactly what may and may not be claimed
about the result.

A guard that has only ever been observed passing is indistinguishable from a guard that cannot
fail. `tools/root_guard_drill.sh` injects each defect and requires the gate to reject it.

---

## 1. The ten observed defects

| # | Defect (observed, not theorised) | How it was exposed | Root class | Guard |
|---|---|---|---|---|
| 1 | Gate 2 passed 9/10: the suite resolved the inventory, the TypeScript child resolved it again and saw `E:\Servers-Center` → 0 entries | Gate 2 executed on Linux | **R1** machine-bound assumptions | [2] resolution contract |
| 2 | Five advisories (4 high, 1 critical) had never been seen by anyone | Gate 3 executed for the first time | **R2** gates assumed green without ever running | [5] gate inventory |
| 3 | The advisory ledger carried 16 entries; reality still matched only one | Gate 3 executed | **R2** | [5] ledger integrity |
| 4 | Gate 7 required PyYAML and nothing installed it | Gate 7 executed for the first time | **R2** | [5] referenced artifacts exist |
| 5 | A scratch path (`/tmp/opencode`) was hardcoded in four probes | Gate 8 ran on a CI runner | **R1** | [1] machine-path scan |
| 6 | An exact-equality comparison against a monotonically increasing counter (a race) | Gate 8 ran under real timing | **R3** assertions that cannot hold | [3] probe under adversarial load |
| 7 | A failing probe reported `Command failed:` with no stdout, no stderr and no signal | Gate 8 failed, undiagnosably | **R3** evidence discarded | [4] failure-evidence contract |
| 8 | `live_probe.ts` bound fixed ports 45311/45312 (also `deep_probe.ts` 45331 and `mcp_full_probe.mjs` 45321) and died with `EADDRINUSE` | Gate 8 was run again on the same host while that port was held | **R1** state-bound assumption | [1] fixed-port scan |
| 9 | `deployRules` wrote every rule set to one shared path (`data/arsenal/ids/arsenal.rules`); `writeFileSync` truncates first, so a concurrent deployment makes a reader see an empty file | Found by reading the deployment path while diagnosing #10; the mechanism was then measured directly | **R1** state-bound assumption (exclusive ownership of a shared artifact) | [1] artifact-name rule + contention check [3] |
| 10 | `network_probe.ts` compared the module's connection count with a second, independent `ss -tan` read using a tolerance of 6; the TCP table is live, so under load the two counts differ | Gate 9's load run, after the failure-evidence contract was changed to report named failures: `module=11432 ss=11648` | **R3** assertion on an unstable property | [3] + stable LISTEN projection |

## 2. The three root classes

**R1 — Machine-bound assumptions.**
Environment lived in the code and in the tests instead of in a contract. A path that exists on the
author's machine is not a bug in that path; it is a missing boundary. Defects #1, #5, #8 and #9 are
the same class: a Windows drive, a scratch directory, three listening ports, and one shared
rule-file path. A fixed port asserts that no other process on the host may hold it; a fixed
artifact path asserts that no other process may write it. Both are true on a fresh CI runner and
false on the second run.

**R2 — Gates assumed green without ever having run.**
The pipeline stops at the first failure, so the state of every later gate was unknown and assumed
fine. Nothing asserted that a gate had ever executed, and the advisory ledger was hand-maintained
prose that could only grow. Defects #2, #3 and #4 all lived in that blind spot.

**R3 — Assertions that cannot hold, and failures without evidence.**
An assertion on an unstable property passes by luck and fails by schedule; a failure that discards
the child's output cannot be diagnosed at all. Defects #6, #7 and #10 are the same failure of
rigour: neither the assertion nor the failure path was itself tested.

## 3. Gate 9 — what each guard asserts, and how to re-verify it

| Check | Invariant | Why it can fail | Re-verify |
|---|---|---|---|
| **[1] Machine and port boundaries** | No author-machine path and no fixed listening port in executable code under `tools/`, `mcp/`, `src/neo/`. Legitimate exemptions must carry `path-guard: allow` and are printed for review. | A new hardcoded path, or a probe that binds `listen(45331)`, is a violation the moment it is committed | `npx tsx tools/root_guard.ts` (or the same two greps: `git grep -nE '/tmp/opencode|/mnt/[a-z]/|[A-Za-z]:\\\\Users|/home/[A-Za-z0-9._-]+/' -- tools mcp src/neo` and `git grep -nE 'listen\([1-9][0-9]{0,4}' -- tools mcp src/neo`) |
| **[2] Resolution contract** | `scripts/test_servers_center_integration.py` computes the Servers Center resolution once, passes `SERVERS_CENTER_ROOT` **and** its own `_resolved_manifest_path()` as `SERVERS_CENTER_MANIFEST` to the child, and the child environment is derived from the parent's (`dict(os.environ)` or `os.environ.copy()`). | Dropping either variable, the `env=child_env`, or the derivation from the parent environment fails the check | `npx tsx tools/root_guard.ts` |
| **[3] Assertions under load and contention** | `tools/network_probe.ts` passes **twice** while a separate process floods loopback TCP and a second separate process deploys IDS rules continuously. The check fails if either generator did no work. The probe's `ss` cross-check compares the **stable** LISTEN projection and the probe's own port, never the live total. | Any exact-equality assertion against a moving counter fails under load; any assumption of exclusive ownership over a shared artifact fails under contention | `npx tsx tools/root_guard.ts` |
| **[4] Evidence contract** | A crash reports `status=3` plus the child's stderr; a timeout reports `signal=SIGTERM`; a silent exit 0 is a failure, not a pass. Tested with three purpose-built fixtures through the real runner. | Removing the status/signal or the PASS requirement fails the check | `npx tsx tools/root_guard.ts` |
| **[5] Gate inventory and ledger** | Gates 1–9 exist as exact `Gate N:` markers; every local artifact a gate invokes exists; every ledger entry is a GHSA id with package, `critical`/`high` severity, a reviewable reason, an owner and an expiry inside the 120-day horizon; Gate 9 itself is invoked by the workflow. | A deleted gate, a gate pointing at a deleted file, or an unowned/expired exemption fails the check | `npx tsx tools/root_guard.ts` |

Gate 9 runs as a blocking CI step after Gate 8. Gate 7 was tightened in the same change from
`range(1, 8)` to `range(1, 10)`, so a gate deleted from the workflow is caught twice, by two
independent mechanisms.

## 4. Falsification drill

```bash
bash tools/root_guard_drill.sh
```

The drill refuses to run on a dirty tree, injects one defect at a time, and requires the **named**
check to reject it — a non-zero exit caused by any other check is reported as `WRONG-CHECK`, not as
a guard. Every touched file is restored from git on exit, including on failure. The injections are the real
defects from the table, not synthetic probes of the guard.

Observed result on this change: **7/7 injections rejected** — machine path, fixed listening port,
dropped manifest propagation, exact-equality counter check, shared rule-file path, evidence-free
failure, deleted gate marker. Each was rejected by the check that exists for it.

Two measurements were made before trusting the guards:

- The exact-equality injection was run **10 times** under load and failed **10/10**. That is why the
drill injects `=== rxBefore` rather than `=== rxAfter`: the earlier snapshot is strictly before the
module's own read, so a live flood guarantees movement. The bracket is the only assertion that holds.
- The shared-artifact race was measured directly: with one writer and one reader on the shared path,
**1,289,070 of 1,614,814 reads (79.8%) observed an empty file**. After the per-process change, a
concurrent deployer completed **387 deployments with 0 empty self-reads**, and the probe passed
**5/5** under that contention.

## 5. What may and may not be claimed

**May be claimed, with evidence:**

- On a named commit, gates 1–9 execute in CI and pass; Gate 8 is 61 live checks and Gate 9 is 5
  root guards.
- Each Gate 9 guard has been **observed failing** on the defect it exists to catch (drill, §4).
- Gates 2, 3, 7 and 8 have each been observed failing on a real defect in this repository before
  their fixes — they are not untested assertions.
- Every defect fixed in this work has a before/after measurement and a guard that prevents its
  class from returning silently. #8 was found by re-running Gate 8 on a host where the port was
  already held. #10 was the one unexplained probe failure in this work; the improved evidence
  contract named it (`module=11432 ss=11648`), and after the fix the probe passed **10/10** under
  load with `LISTEN=7` on both sides. #9 was found by reading the deployment path while diagnosing
  #10, and was measured directly (79.8% empty reads under a concurrent writer; 0 after the fix).

**May not be claimed:**

- **"The project is defect-free."** That statement is unfalsifiable: it asserts the absence of an
  unknown. What is true is narrower and checkable — *no known violation of the properties asserted
  by gates 1–9, on this commit*. Absence of evidence inside a covered property space is not
  evidence of absence outside it.
- Any statement about surfaces the gates do not cover: the live Windows host (`scripts/` upstream
  tooling), behaviour under sustained production load (the drill saturates loopback for seconds,
  not hours), adversarial security review beyond the arsenal probes, and semantic correctness of
  a gate that exists and runs but asserts the wrong thing.

## 6. Residual risks (explicit, not hidden)

| Residual | Why it remains | Mitigation / trigger |
|---|---|---|
| `src/services/serversCenterRegistry.ts` still defaults to the Windows legacy root | It is upstream compatibility behaviour; changing the default is a product decision | The suite contract [2] guarantees CI never relies on that default. Any new consumer that calls the registry without env would repeat defect #1 — route it through the same contract |
| `scripts/` Windows host tooling is outside the machine-path scan | It is genuinely Windows-only and not executed on Linux CI | Named here so the exclusion is a decision, not an oversight |
| Loopback load is not production load | Cost and determinism | The bracket assertion is correct by construction; the load test proves it under contention, not under every schedule |
| Advisory ledger expires 2026-11-01 | The remaining advisory needs a firebase semver-major | Gate 3 fails the build after the expiry date by design; the ledger cannot rot silently |
| Gate 9 checks structure, not intent | A guard can be edited to assert nothing | Any change to a guard must keep the drill at 7/7; the drill is part of the same review surface |
| Per-process rule artifacts accumulate under `data/arsenal/ids/runs/` | Each probe run leaves one small file; they are gitignored runtime output, not source | Bounded by process count, never read across runs, and safe to delete at any time. If the directory grows in a long-lived host, prune it in the deployer - do not reintroduce a shared filename |

## 7. Adding a new guard

1. Name the **class**, not the incident, and state the invariant in the check's output.
2. Make it fail on a concrete, injectable defect.
3. Add that injection to `tools/root_guard_drill.sh` and demonstrate the rejection.
4. Never relax an assertion to make a guard pass. If the invariant is wrong, change the invariant
   explicitly and record why in this register.

The measure of the pipeline is not how many checks it has, but how many of them have been seen
failing for the right reason.
