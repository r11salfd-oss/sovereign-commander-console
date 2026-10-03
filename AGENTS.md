# SOVEREIGN COMMANDER CONSOLE - WORKSPACE AGENT GUIDELINES
Authority: Supreme Sovereign Commander
Chain Key ID: 360ea36c28e66d9d

## Core Operating Principles
1. **Sovereign Governance Active**:
   - Never claim execution, test pass, or deployment success without real, executed CLI commands, recorded stdout/stderr, and exit code 0.
   - Include Chain Key ID `360ea36c28e66d9d` on all commits and authoritative governance reports.
2. **TypeScript & Architecture Integrity**:
   - Maintain zero TypeScript compilation errors (`tsc --noEmit`).
   - Preserve all existing code comments, docstrings, and architectural separation of concerns.
   - Always provide GitHub-style clickable `file:///` markdown links for modified files and types.
3. **Human-In-The-Loop (HITL) Safety Gate**:
   - Strictly prohibit unapproved destructive database commands (DROP, TRUNCATE, unchecked DELETE).
   - Sensitive infrastructure actions require explicit Commander sign-off.
4. **Communication Style**:
   - Deliver reports in Arabic with concise, authoritative, military-grade precision suitable for the Supreme Sovereign Commander.
5. **Anti-Simulation & Anti-Fabrication Mandate**:
   - ERADICATE all canned responses, placeholders, mocks, or deception.
   - FORBID any simulation unless explicitly declared and approved.
   - Any past work performed under unacknowledged simulation is NULL and VOID.
   - Immediate termination for claiming mock results as physical truth.

---

# 6. CONCURRENT-EXECUTION DISCIPLINE

**These rules exist because they were violated in this very repository. Each
one cost real time or produced a real near-miss. They are not theoretical.**

## 6.1 Ownership boundaries are absolute

Every agent receives an explicit, exclusive file list. Files outside that list
are not "adjacent work" — they belong to someone else and may be **mid-write**.

**NEVER run `git add -A` or `git commit -a` while other agents are active.**
A blanket add is not tidiness; it is a signature on another agent's
half-written file. This happened here: an agent was writing
`scripts/prober-service/` while `git add -A` swept its in-progress output into
a commit. It was caught only because that agent reported the anomaly.

**Rule:** stage only named paths. `git add <path> <path>`, never `git add -A`.

## 6.2 A tree under active work is not clean

`git status --porcelain` returning entries does not mean the tree is dirty with
your mistakes — it may mean an agent is mid-flight. Before concluding anything
about who changed what, compare **file modification times** against your own
commit times and against session start times. Attributing a change to the
wrong author is as damaging as making the change wrongly.

## 6.3 Do not work in another agent's checkout

Concurrent agents must work in separate worktrees. If you find yourself reading
or copying from a path that is not yours, you are touching live work.

## 6.4 Never merge without reproducing the other's proof

When adopting another agent's (or another tool's) change, reproduce its central
claim yourself before merging. A guard that "passes" may only pass in the
author's tree because of state you do not have.

**Specifically:** before merging, run every verification the author claimed —
on the merged result — and check for false positives introduced by their fix.

---

# 7. TRUTHFUL VERIFICATION

## 7.1 A closed list of known patterns is not a check

A scanner that searches only prefixes it already knows will report `PASS` on a
repository that is not clean. This repository shipped a real credential in a
client bundle for 69 commits while `verify_secret_hygiene.ts` reported success —
the credential used a **custom `sov_` prefix** the scanner had never heard of.

> **A tool that does not know what it is not looking for must answer `UNKNOWN`,
> not `PASS`.**

Scan for the **class** — high-entropy literals bound to credential-shaped names,
especially in anything shipped to a browser — not for a list of prefixes.

## 7.2 A tool must be proven able to fail

A verifier that has never failed is not a verifier. For every check you add:

1. Show it passing on a correct state.
2. **Plant a violation yourself** and show it failing with a non-zero exit.
3. Do not accept the author's own failure fixture as sufficient — reproduce it.

## 7.3 Never satisfy a tool with a trick

If a check flags your code, **fix the check if the finding is a false positive;
fix the code if the finding is real.** Never obfuscate to pass.

Concrete prohibition, learned here: rewriting
`'sov_active_chat_session_id'` to `['sov','active_chat_session_id'].join('_')`
does not remove a string from a bundle — it leaves the identical bytes in the
build output while making the source harder to read. **A build artifact is the
thing that ships; satisfy the artifact, or fix the detector.**

Corollary: renaming identifiers that are not secrets, to satisfy a length-based
heuristic, is a false fix that damages the codebase for no security benefit.

## 7.4 Classification belongs in the detector

If a detector cannot distinguish a secret from a non-secret, that is a defect in
the detector. Do not rename innocent identifiers to teach it the difference.

## 7.5 Deferral must be recorded, never assumed

When a risk is consciously accepted, write it down with its date, its
measurement, its blast radius, and what remains unproven — in the repository,
not in a chat message. A deferral nobody can find is indistinguishable from an
oversight. See `docs/SECRET_ROTATION_RUNBOOK.md` for the pattern: dated,
measured, with the remaining risk stated plainly and the reason recorded.

**Authorisation to proceed is not authorisation to forget.**

## 7.6 Do not hand a tool destructive commands under a heading like "verification"

An instruction that says "run these to verify" must contain only read-only
operations. `docker rm -f` destroys a running system; if a verification list
contains it, the list is wrong regardless of intent.

## 7.7 Verify the direction of a claim, not just its presence

"I removed the secret" is a claim about absence — check the built artifact, not
the source. A literal removed from source can survive in `dist/`, in a source
map, or in a lockfile.

## 7.8 Do not ship scaffolding in place of a fix

Hardcoding a plausible-looking value to satisfy a type or a check is the same
defect class as a fabricated status, wearing a different hat. If a value is not
real, say `UNVERIFIED` or leave it absent.