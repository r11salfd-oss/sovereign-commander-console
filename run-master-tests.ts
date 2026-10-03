import http from 'http';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

/**
 * Resolves the CLI admin credential the same way production does: from a FILE,
 * never from an environment variable or a literal. Returns `null` when none is
 * configured, which callers must treat as "unauthenticated", not as "skip".
 *
 * The value is never logged, never echoed, and never included in a failure
 * message — only its presence is reportable.
 */
function readCliCredential(): string | null {
  const candidates = [
    process.env.SOVEREIGN_CLI_TOKEN_FILE,
    path.join(process.env.APPDATA || '', 'sovereign-commander-console', 'secrets', 'cli-token.txt')
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);
  for (const candidate of candidates) {
    try {
      const value = fs.readFileSync(candidate, 'utf8').trim();
      if (value.length >= 16) return value;
    } catch {
      // Try the next candidate. Absence is reported by the caller, never invented.
    }
  }
  return null;
}

function makeRequest(path: string, method: string = 'GET', body?: any, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    
    const req = http.request(url, {
      method,
      headers: {
        ...extraHeaders,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          resolve({ status: res.statusCode || 500, data: parsed });
        } catch {
          resolve({ status: res.statusCode || 500, data: responseBody });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function runMasterTestSuites(): Promise<{ passed: number; failed: number }> {
  console.log('================================================================');
  console.log('👑 MASTER SOVEREIGN & COPILOT BRIDGE E2E TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<boolean>) {
    process.stdout.write(`⏳ Test: ${name}... `);
    try {
      const ok = await fn();
      if (ok) {
        console.log('✅ PASSED');
        passed++;
      } else {
        console.log('❌ FAILED');
        failed++;
      }
    } catch (err: any) {
      console.log(`❌ FAILED (${err?.message})`);
      failed++;
    }
  }

  // --- PART 1: Core E2E Human Simulation Tests (10 tests) ---
  console.log('--- [PART 1] Core Sovereign Human Simulation Suite ---');
  
  await test('1. Health Probe (/api/health)', async () => {
    const r = await makeRequest('/api/health');
    return r.status === 200 && r.data.ok === true;
  });

  await test('2. System Telemetry (/api/system/telemetry)', async () => {
    const r = await makeRequest('/api/system/telemetry');
    return r.status === 200 && r.data.subsystems?.coreServer?.status === 'ONLINE';
  });

  await test('3. Memory Clean & GC (/api/system/memory/clean)', async () => {
    const r = await makeRequest('/api/system/memory/clean', 'POST');
    return r.status === 200 && r.data.ok === true;
  });

  await test('4. MCP Protocol Status (/api/mcp/status)', async () => {
    const r = await makeRequest('/api/mcp/status');
    return r.status === 200 && r.data.ok === true;
  });

  await test('5. Agent Activity Metrics (/api/agents/metrics)', async () => {
    const r = await makeRequest('/api/agents/metrics');
    return r.status === 200 && r.data.agents?.architect !== undefined;
  });

  await test('6. HITL Approvals (/api/hitl/approvals)', async () => {
    const r = await makeRequest('/api/hitl/approvals');
    return r.status === 200 && Array.isArray(r.data.approvals);
  });

  await test('7. Audit Chain Verification (/api/hitl/audit/verify)', async () => {
    const r = await makeRequest('/api/hitl/audit/verify');
    if (r.status !== 200) return false;
    // This suite used to demand `status === 'INTACT'`. That expectation encoded
    // the old self-attested verdict, which the system has legitimately retired:
    // there is no external attestation, so `INTACT` is not a reachable state and
    // demanding it would only ever have been satisfiable by a fabrication.
    //
    // What is actually worth asserting is the shape of the honest answer: the
    // endpoint answered, it committed to a known verdict, and it said WHY. A
    // verdict without a reason is an unfalsifiable claim, so its absence fails.
    const VERDICTS = ['UNVERIFIED_NO_EXTERNAL_ATTESTATION', 'UNVERIFIED', 'TAMPERED_REJECTED'];
    if (!VERDICTS.includes(r.data.status)) return false;
    if (r.data.status !== 'TAMPERED_REJECTED') {
      return typeof r.data.reason === 'string' && r.data.reason.trim().length > 0;
    }
    return true;
  });

  await test('8. Propose Sovereign Action (/api/hitl/propose)', async () => {
    const r = await makeRequest('/api/hitl/propose', 'POST', {
      agent: 'Sentinel',
      type: 'READ_FILE',
      summary: 'Master test validation',
      reason: 'Testing governance workflow',
      risk: 'medium',
      payload: { path: '/package.json' }
    });
    return r.status === 201 && r.data.success === true;
  });

  await test('9. Sentinel Agent Chat (/api/chat/agent)', async () => {
    const r = await makeRequest('/api/chat/agent', 'POST', {
      agent: 'sentinel-agent',
      message: 'فحص الحارس'
    });
    return r.status === 200 && r.data.ok === true;
  });

  await test('10. Developer Agent Chat (/api/chat/agent)', async () => {
    const r = await makeRequest('/api/chat/agent', 'POST', {
      agent: 'lead-engineer',
      message: 'تحليل تكامل النظام'
    });
    return r.status === 200 && r.data.ok === true;
  });

  // --- PART 2: Microsoft 365 Copilot & Semantic Kernel Bridge Tests (3 tests) ---
  console.log('\n--- [PART 2] M365 Copilot & Semantic Kernel Bridge Suite ---');

  await test('11. Copilot Bridge Status (/api/bridge/copilot/status)', async () => {
    const r = await makeRequest('/api/bridge/copilot/status');
    return r.status === 200 && r.data.ok === true && r.data.bridge.includes('Copilot');
  });

  await test('12. Copilot Query Transmission (/api/bridge/copilot/query)', async () => {
    const r = await makeRequest('/api/bridge/copilot/query', 'POST', {
      prompt: 'فحص إرسال واستقبال البيانات السيادية'
    });
    return r.status === 200 && r.data.ok === true && typeof r.data.response === 'string';
  });

  await test('13. Copilot Audit Synchronization (/api/bridge/copilot/sync)', async () => {
    const r = await makeRequest('/api/bridge/copilot/sync', 'POST', {
      scope: 'sovereign_audit_ledger'
    });
    return r.status === 200 && r.data.ok === true && typeof r.data.synchronizedItems === 'number';
  });

  // --- PART 3: Unified Multi-CLI Bridge (OpenCode + AGY + Antigravity) (2 tests) ---
  console.log('\n--- [PART 3] Unified Multi-CLI Bridge Suite (OpenCode + AGY + Antigravity) ---');

  await test('14. Multi-CLI Bridge Status (/api/cli/multibridge/status)', async () => {
    const r = await makeRequest('/api/cli/multibridge/status');
    return r.status === 200 && r.data.ok === true && Array.isArray(r.data.engines) && r.data.engines.length === 3;
  });

  await test('15. Multi-CLI Dispatch (/api/cli/multibridge/dispatch)', async () => {
    // This endpoint sits behind `requireCliAuth`. The suite previously called it
    // with no credential and asserted 200 — which is to say it asserted that the
    // authentication wall is NOT there. It was failing because the protection
    // works, not because anything regressed.
    //
    // Both branches assert something real:
    //   - with a credential, the dispatch path itself;
    //   - without one, that the wall holds (401 and no command output leaked).
    const credential = readCliCredential();
    const r = await makeRequest(
      '/api/cli/multibridge/dispatch',
      'POST',
      {
        engine: 'antigravity',
        command: 'agent:mesh:sync',
        args: ['--mesh', 'sovereign-unified']
      },
      credential ? { Authorization: `Bearer ${credential}` } : {}
    );

    if (!credential) {
      return r.status === 401 && r.data?.ok !== true;
    }
    return r.status === 200 && r.data.ok === true && r.data.exitCode === 0 && typeof r.data.output === 'string';
  });

  console.log('\n================================================================');
  console.log(`📊 MASTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('================================================================');

  // Returned so the process exit code is derived from the tally rather than from
  // whether the function merely finished running.
  return { passed, failed };
}

// The exit code IS the verdict. Previously this was `.catch(console.error)` with no
// `process.exit`, so a run that printed "13 PASSED, 2 FAILED" still exited 0 — a CI
// gate reading only the exit status recorded a green build over a failing suite. A
// runner that cannot fail is the exact defect this programme exists to remove.
runMasterTestSuites()
  .then(({ passed, failed }) => {
    if (failed > 0) {
      console.error(`\n🚫 MASTER SUITE FAILED: ${failed} of ${passed + failed} tests failed. Exiting 1.`);
      process.exit(1);
    }
    console.log(`\n✅ MASTER SUITE PASSED: ${passed}/${passed}. Exiting 0.`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
