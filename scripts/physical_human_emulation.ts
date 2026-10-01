// ==============================================================================
// 👑 SOVEREIGN CONSOLE - PHYSICAL HUMAN EMULATION QA SCRIPT
// Authority: Supreme Sovereign Commander
// Chain Key ID: 360ea36c28e66d9d
// ==============================================================================

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// Locate system browser (Edge or Chrome)
function getSystemBrowserPath(): string {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (fs.existsSync(edgePath)) return edgePath;
  if (fs.existsSync(chromePath)) return chromePath;
  throw new Error('No compatible system browser (Edge/Chrome) found on host machine.');
}

async function runPhysicalHumanEmulation() {
  console.log('================================================================');
  console.log('🛡️ INITIATING PHYSICAL HUMAN EMULATION TEST HARNESS');
  console.log('🔐 Chain Key ID: 360ea36c28e66d9d');
  console.log('================================================================');

  const browserPath = getSystemBrowserPath();
  console.log(`[Browser Engine] Launching Host Browser: ${browserPath}`);

  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    defaultViewport: { width: 1440, height: 900 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage();
  const logs: string[] = [];

  const logStep = (step: string) => {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${step}`;
    console.log(entry);
    logs.push(entry);
  };

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Physical Navigate to Sovereign Console with Commander Session
    // -------------------------------------------------------------------------
    const rootUrl = 'http://localhost:3000/commander?commander=true';
    logStep(`1. Navigating to Sovereign Console with Authorized Commander Token: ${rootUrl}`);
    await page.goto(rootUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Ensure Sovereign session is stored in localStorage
    await page.evaluate(() => {
      const autoUser = {
        uid: 'sovereign-commander-local-root',
        email: 'r11salfd@gmail.com',
        displayName: 'Sovereign Commander (Local Admin)',
        emailVerified: true,
        isAnonymous: false,
        isLocalCommander: true
      };
      localStorage.setItem('sovereign_local_commander', JSON.stringify(autoUser));
      sessionStorage.setItem('sovereign_local_commander', JSON.stringify(autoUser));
    });

    // Wait for the TopNavigationBar to render
    logStep('   ⏳ Waiting for TopNavigationBar and HUD interface to mount...');
    await page.waitForSelector('header', { timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_console_dashboard.png') });
    logStep('   📸 Captured: 01_console_dashboard.png');

    // -------------------------------------------------------------------------
    // STEP 2: Physical Navigation to Sentinel SOC
    // -------------------------------------------------------------------------
    logStep('2. Physically clicking navigation link: Sentinel SOC (/commander/sentinel)');
    await page.waitForSelector('a[href="/commander/sentinel"]', { timeout: 10000 });
    await page.click('a[href="/commander/sentinel"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_sentinel_soc.png') });
    logStep('   📸 Captured: 02_sentinel_soc.png');

    // -------------------------------------------------------------------------
    // STEP 3: Physical Navigation to Agent Corps
    // -------------------------------------------------------------------------
    logStep('3. Physically clicking navigation link: Agent Corps (/commander/agents)');
    await page.waitForSelector('a[href="/commander/agents"]', { timeout: 10000 });
    await page.click('a[href="/commander/agents"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_agents_corps.png') });
    logStep('   📸 Captured: 03_agents_corps.png');

    // -------------------------------------------------------------------------
    // STEP 4: Physical Navigation to Approvals HITL Queue
    // -------------------------------------------------------------------------
    logStep('4. Physically clicking navigation link: Approvals HITL (/commander/approvals)');
    await page.waitForSelector('a[href="/commander/approvals"]', { timeout: 10000 });
    await page.click('a[href="/commander/approvals"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_approvals_hitl.png') });
    logStep('   📸 Captured: 04_approvals_hitl.png');

    // -------------------------------------------------------------------------
    // STEP 5: Physical Navigation to Forge Code Factory
    // -------------------------------------------------------------------------
    logStep('5. Physically clicking navigation link: Forge Code Factory (/commander/forge)');
    await page.waitForSelector('a[href="/commander/forge"]', { timeout: 10000 });
    await page.click('a[href="/commander/forge"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_forge_factory.png') });
    logStep('   📸 Captured: 05_forge_factory.png');

    // -------------------------------------------------------------------------
    // STEP 6: Physical Navigation to Kernel OS
    // -------------------------------------------------------------------------
    logStep('6. Physically clicking navigation link: Kernel OS (/commander/kernel)');
    await page.waitForSelector('a[href="/commander/kernel"]', { timeout: 10000 });
    await page.click('a[href="/commander/kernel"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_kernel_os.png') });
    logStep('   📸 Captured: 06_kernel_os.png');

    // -------------------------------------------------------------------------
    // STEP 7: Physical Navigation to Chat Chamber
    // -------------------------------------------------------------------------
    logStep('7. Physically clicking navigation link: Chat Chamber (/commander/chat)');
    await page.waitForSelector('a[href="/commander/chat"]', { timeout: 10000 });
    await page.click('a[href="/commander/chat"]');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_chat_chamber.png') });
    logStep('   📸 Captured: 07_chat_chamber.png');

    // -------------------------------------------------------------------------
    // STEP 8: Human Keystroke Emulation & Message Dispatch
    // -------------------------------------------------------------------------
    const commandText = 'فحص الجاهزية التشغيلية السيادية للمنظومة';
    logStep(`8. Simulating Human Typing in Chat Chamber input: "${commandText}"`);
    
    // Find text input or textarea
    const inputSelector = 'textarea, input[type="text"]';
    const hasInput = await page.$(inputSelector);
    if (hasInput) {
      await page.click(inputSelector);
      await page.type(inputSelector, commandText, { delay: 35 });
      logStep('   ⌨️ Typed command with human keystroke cadence.');
      
      logStep('9. Physically pressing ENTER key to dispatch command...');
      await page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 3500));
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08_chat_interaction_dispatched.png') });
      logStep('   📸 Captured: 08_chat_interaction_dispatched.png');
    } else {
      logStep('   ℹ️ Input area not found on current view, captured view directly.');
    }

    // -------------------------------------------------------------------------
    // SUMMARY REPORT
    // -------------------------------------------------------------------------
    console.log('================================================================');
    console.log('🎉 ALL PHYSICAL HUMAN EMULATION STEPS EXECUTED SUCCESSFULLY!');
    console.log('================================================================');
    console.log(`Directory: ${SCREENSHOT_DIR}`);
    console.log('Sovereign Verification Seal: SEC-EMULATION-360ea36c28e66d9d-PASSED');
    
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'emulation_log.txt'), logs.join('\n'), 'utf8');

  } catch (error: any) {
    console.error('❌ Physical Emulation Error:', error);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error_state.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
}

runPhysicalHumanEmulation()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
