import http from 'http';

const BASE_URL = 'http://localhost:3000';

function makeRequest(path: string, method: string = 'GET', body?: any): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    
    const req = http.request(url, {
      method,
      headers: {
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

async function runMasterTestSuites() {
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
    return r.status === 200 && r.data.status === 'INTACT';
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
    const r = await makeRequest('/api/cli/multibridge/dispatch', 'POST', {
      engine: 'antigravity',
      command: 'agent:mesh:sync',
      args: ['--mesh', 'sovereign-unified']
    });
    return r.status === 200 && r.data.ok === true && r.data.exitCode === 0 && typeof r.data.output === 'string';
  });

  console.log('\n================================================================');
  console.log(`📊 MASTER TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('================================================================');
}

runMasterTestSuites().catch(console.error);
