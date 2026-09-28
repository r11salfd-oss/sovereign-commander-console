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

async function runE2EHumanSimulation() {
  console.log('================================================================');
  console.log('🤖 STARTING HUMAN-SIMULATION E2E COMPREHENSIVE TEST SUITE');
  console.log('================================================================\n');

  let totalPassed = 0;
  let totalFailed = 0;

  async function testStep(name: string, fn: () => Promise<boolean>) {
    process.stdout.write(`⏳ Testing: ${name}... `);
    try {
      const result = await fn();
      if (result) {
        console.log('✅ PASSED');
        totalPassed++;
      } else {
        console.log('❌ FAILED');
        totalFailed++;
      }
    } catch (err: any) {
      console.log(`❌ FAILED (${err.message})`);
      totalFailed++;
    }
  }

  // 1. Health Probe
  await testStep('1. Health Probe (/api/health)', async () => {
    const res = await makeRequest('/api/health');
    return res.status === 200 && res.data.ok === true;
  });

  // 2. System Telemetry & Memory Clean
  await testStep('2. System Telemetry Probe (/api/system/telemetry)', async () => {
    const res = await makeRequest('/api/system/telemetry');
    return res.status === 200 && res.data.subsystems?.coreServer?.status === 'ONLINE';
  });

  await testStep('3. System Memory Clean & GC (/api/system/memory/clean)', async () => {
    const res = await makeRequest('/api/system/memory/clean', 'POST');
    return res.status === 200 && res.data.ok === true;
  });

  // 3. MCP Protocol Status
  await testStep('4. MCP Protocol Subsystem Status (/api/mcp/status)', async () => {
    const res = await makeRequest('/api/mcp/status');
    return res.status === 200 && res.data.ok === true && res.data.status === 'active';
  });

  // 4. Agent Metrics
  await testStep('5. 24-Hour Agent Activity Metrics (/api/agents/metrics)', async () => {
    const res = await makeRequest('/api/agents/metrics');
    return res.status === 200 && res.data.agents?.architect !== undefined && res.data.agents?.sentinel !== undefined;
  });

  // 5. HITL Approvals & Audit Verification
  await testStep('6. HITL Approvals Endpoint (/api/hitl/approvals)', async () => {
    const res = await makeRequest('/api/hitl/approvals');
    return res.status === 200 && Array.isArray(res.data.approvals);
  });

  await testStep('7. Audit Chain Verification (/api/hitl/audit/verify)', async () => {
    const res = await makeRequest('/api/hitl/audit/verify');
    return res.status === 200 && res.data.status === 'INTACT';
  });

  // 6. Propose Action Endpoint
  await testStep('8. Propose Sovereign Action (/api/hitl/propose)', async () => {
    const res = await makeRequest('/api/hitl/propose', 'POST', {
      agent: 'Sentinel Agent',
      type: 'READ_FILE',
      summary: 'Human simulation test for code integrity',
      reason: 'Testing sovereign governance approval workflow',
      risk: 'medium',
      payload: { path: '/package.json' }
    });
    return res.status === 201 && res.data.success === true;
  });

  // 7. Interactive Agent Chat Session
  await testStep('9. Agent Interaction (Sentinel Agent Chat)', async () => {
    const res = await makeRequest('/api/chat/agent', 'POST', {
      agent: 'sentinel-agent',
      message: 'فحص الحارس لسلامة النظام والنواة'
    });
    return res.status === 200 && res.data.ok === true && typeof res.data.message === 'string';
  });

  // 8. Lead Engineer Agent Chat
  await testStep('10. Agent Interaction (Developer Agent Chat)', async () => {
    const res = await makeRequest('/api/chat/agent', 'POST', {
      agent: 'lead-engineer',
      message: 'تحليل تكامل التليمتري والذاكرة'
    });
    return res.status === 200 && res.data.ok === true && typeof res.data.message === 'string';
  });

  console.log('\n================================================================');
  console.log(`📊 SIMULATION COMPLETE: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log('================================================================');
}

runE2EHumanSimulation().catch(console.error);
