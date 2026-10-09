---
name: sovereign-governance
description: >-
  Use this skill whenever verifying workspace health, running sovereign test suites,
  validating TypeScript integrity, or executing sovereign git governance workflows.
---

# Sovereign Governance Skill
Authority: Supreme Sovereign Commander
Chain Key ID: 360ea36c28e66d9d

## Purpose
This skill equips the Antigravity agent with the necessary runbooks and scripts to execute complete sovereign workspace audits, verify compilation integrity, and guarantee strict conformance to the Sovereign Governance Engine standards.

## Execution Runbook
1. Run the workspace verification script:
   `python .agents/skills/sovereign-governance/scripts/verify_workspace.py`
2. Confirm TypeScript zero-error status:
   `npx tsc --noEmit`
3. Check Git branch status and staged files:
   `git status --short`
4. If committing, include Chain Key ID `360ea36c28e66d9d` in the commit message.
