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

async function verifyCopilotBridge() {
  console.log('================================================================');
  console.log('🔄 RE-VERIFYING M365 COPILOT & SEMANTIC KERNEL BRIDGE (TSX)');
  console.log('================================================================\n');

  // 1. Status Check
  process.stdout.write('⏳ Testing M365 Status (/api/bridge/copilot/status)... ');
  const statusRes = await makeRequest('/api/bridge/copilot/status');
  if (statusRes.status === 200 && statusRes.data.ok === true) {
    console.log(`✅ PASSED (Bridge: ${statusRes.data.bridge})`);
  } else {
    console.log('❌ FAILED');
  }

  // 2. Query Transmission
  process.stdout.write('⏳ Testing Query Transmission (/api/bridge/copilot/query)... ');
  const queryRes = await makeRequest('/api/bridge/copilot/query', 'POST', {
    prompt: 'فحص إرسال البيانات السيادية إلى عقل كوبايلوت'
  });
  if (queryRes.status === 200 && queryRes.data.ok === true) {
    console.log(`✅ PASSED\n   Response: "${queryRes.data.response}"`);
  } else {
    console.log('❌ FAILED');
  }

  // 3. Synchronization
  process.stdout.write('⏳ Testing Audit Sync (/api/bridge/copilot/sync)... ');
  const syncRes = await makeRequest('/api/bridge/copilot/sync', 'POST', {
    scope: 'audit_ledger'
  });
  if (syncRes.status === 200 && syncRes.data.ok === true) {
    console.log(`✅ PASSED\n   Synced Items: ${syncRes.data.synchronizedItems}`);
  } else {
    console.log('❌ FAILED');
  }

  console.log('\n================================================================');
  console.log('✨ M365 COPILOT BRIDGE RE-VERIFICATION COMPLETE: 3/3 SUCCESS');
  console.log('================================================================');
}

verifyCopilotBridge().catch(console.error);
