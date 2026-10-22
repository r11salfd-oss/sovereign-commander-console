#!/usr/bin/env python3
"""Capture a rollback snapshot of the live OpenCode service topology.

The OpenCode server reads a location's configuration ONCE, when the location
opens. Any agent/skill added afterwards is invisible until the service is
restarted, so a restart is a state-changing action. This snapshot records the
exact pre-restart state so the restart can be proven reversible and complete.

Usage: python3 tools/service_snapshot.py <output.json>
"""
import json
import os
import subprocess
import sys
import urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(cmd, cwd=None):
    try:
        p = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                           capture_output=True, text=True, timeout=120)
        return (p.stdout or "").strip()
    except Exception as exc:  # noqa: BLE001 - snapshot must never crash the caller
        return f"<error: {exc}>"


def api_ids(endpoint, directory):
    """Read the real agent/skill ids for a location from the live API."""
    enc = urllib.parse.quote(directory, safe="")
    raw = run(["opencode", "api", "get", f"{endpoint}?location%5Bdirectory%5D={enc}"])
    try:
        data = json.loads(raw)
    except Exception:  # noqa: BLE001
        return {"error": raw[:400]}
    items = data.get("data") or []
    return sorted(str(item.get("id")) for item in items if isinstance(item, dict))


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        ROOT, "evidence", "arsenal", "service_snapshot.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    directory = os.getcwd()
    ps = run("ps -eo pid,ppid,etime,args | grep -E 'opencode|arsenal_mcp|opencode_mcp' | grep -v grep")
    processes = []
    for line in ps.splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) == 4:
            processes.append({
                "pid": parts[0], "ppid": parts[1], "etime": parts[2], "args": parts[3]
            })

    snapshot = {
        "captured": datetime.now(timezone.utc).isoformat(),
        "directory": directory,
        "git_head": run(["git", "-C", ROOT, "rev-parse", "HEAD"]),
        "git_head_subject": run(["git", "-C", ROOT, "log", "-1", "--pretty=%s"]),
        "git_status": run(["git", "-C", ROOT, "status", "--short"]),
        "service_url": run(["opencode", "service", "status"]),
        "processes": processes,
        "agents": api_ids("/api/agent", directory),
        "skills": api_ids("/api/skill", directory),
        "mcp_config": json.loads(run(["python3", "-c",
            "import json,sys;print(json.dumps(json.load(open(sys.argv[1]))))",
            os.path.join(ROOT, "opencode.json")])) if os.path.exists(
            os.path.join(ROOT, "opencode.json")) else None,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(snapshot, fh, indent=2)
    print(f"snapshot written: {out_path}")
    print(f"  agents: {len(snapshot['agents']) if isinstance(snapshot['agents'], list) else 'ERR'}")
    print(f"  skills: {len(snapshot['skills']) if isinstance(snapshot['skills'], list) else 'ERR'}")
    for kind in ("agents", "skills"):
        items = snapshot[kind]
        if isinstance(items, list):
            hits = [i for i in items if "arsenal" in i]
            print(f"  {kind} matching 'arsenal': {hits}")


if __name__ == "__main__":
    main()
