import fetch from 'node-fetch';

async function testSingleAgent(agent: string, model: string, message: string) {
  try {
    console.log(`\nTesting agent: ${agent}, model: ${model}`);
    const reqInfo = { agent, model, message };
    const res = await fetch('http://localhost:3000/api/chat/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqInfo)
    });
    
    if (res.ok) {
        const json = await res.json() as any;
        console.log(`- Result [OK]: ${json.message}`);
    } else {
        const text = await res.text();
        console.log(`- Result [ERROR ${res.status}]: ${text}`);
    }
  } catch(e: any) {
    console.log(`- Request Failed: ${e.message}`);
  }
}

async function runTests() {
  const agentsToTest = [
    { id: 'sentinel-agent', model: 'gemini-3.6-flash', message: 'قم بفحص الحالة الأمنية للنظام وتدقيق معايير Zero-Trust' },
    { id: 'lead-engineer', model: 'gemini-3.8-flash', message: 'مرحبا أيها المهندس، هل يمكنك تقديم تشخيص سريع لحالة النظام؟' },
    { id: 'architect-agent', model: 'gemini-3.1-pro-preview', message: 'اشرح التخطيط المعماري للنواة وكيفية عزل المسارات الحساسة.' },
  ];
  
  for (const ag of agentsToTest) {
    await testSingleAgent(ag.id, ag.model, ag.message);
    await new Promise(r => setTimeout(r, 1000));
  }
}

runTests();
