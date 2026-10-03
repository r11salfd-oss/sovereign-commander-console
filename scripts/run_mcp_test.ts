/**
 * Sovereign MCP Server & Tool Developer Live Runner
 * Standards: Model Context Protocol (MCP) JSON-RPC 2.0
 * Chain Key ID: 360ea36c28e66d9d
 */

import { globalSovereignMcpServer } from '../src/services/sovereignMcpServer';

async function main() {
  console.log('[MCP_TEST_START]');
  const results: Array<{ test: string; pass: boolean; details?: string }> = [];
  const CHAIN_KEY_ID = '360ea36c28e66d9d';

  try {
    // 1. Initialize
    const initRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'sovereign-qa-client', version: '2.4.0' } }
    });
    const initPass = initRes.result?.protocolVersion === '2024-11-05' && !!initRes.result?.capabilities?.tools;
    results.push({ test: 'initialize_handshake', pass: initPass });

    // 2. Tools List
    const toolsRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    });
    const toolsList = toolsRes.result?.tools || [];
    const hasAllTools = ['sovereign_kernel_query', 'sovereign_memory_recall', 'sovereign_verify_chain', 'sovereign_hitl_propose']
      .every(t => toolsList.some((item: any) => item.name === t));
    results.push({ test: 'tools_catalog_completeness', pass: hasAllTools && toolsList.length >= 4 });

    // 3. Tool Call: sovereign_verify_chain (Valid Key)
    const verifyRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'sovereign_verify_chain',
        arguments: { chainKeyId: CHAIN_KEY_ID }
      }
    });
    const verifyData = JSON.parse(verifyRes.result?.content?.[0]?.text || '{}');
    // ── CHAIN VERDICT ASSERTION ──────────────────────────────────────────────
    // This assertion used to demand `verifyData.ok === true` plus
    // `status === 'SEAL_INTACT_VERIFIED'`. That encoded the OLD fabrication: it
    // treated "the chain could not be proven intact" as a test failure, so the
    // only way to make it green was for the verifier to keep claiming INTACT.
    //
    // A PREVIOUS REPAIR of this line removed the `status === 'SEAL_INTACT_VERIFIED'`
    // conjunct but LEFT `verifyData.ok === true` in place — and `ok` is computed as
    // `status === 'SEAL_INTACT_VERIFIED'` (see `verifySovereignChain`). The stale
    // constant therefore survived the rewrite by a different name: the suite still
    // failed, and it still failed *because the system became honest*. Measured
    // baseline before this fix: `tools_call_verify_chain pass=false` with
    // `status=UNVERIFIED_NO_SEALED_EVIDENCE`.
    //
    // What is genuinely testable, and what is asserted below:
    //   1. the tool answers with a well-formed verdict object (protocol conformance);
    //   2. the verdict is one of the declared status codes;
    //   3. every non-verified verdict carries a machine-readable reason (an operator
    //      must never see an unexplained "not verified");
    //   4. `ok` and `verified` are CONSISTENT with the verdict — a tool that reports
    //      ok:true alongside an UNVERIFIED_* status would be padding, and that must
    //      fail even though neither field is individually wrong;
    //   5. a WRONG chain key is still rejected — the security property holds
    //      regardless of whether the ledger can be proven.
    // SEAL_INTACT_VERIFIED remains ACCEPTED if genuinely produced (e.g. once an
    // independent sealed-evidence producer exists), but it is no longer REQUIRED.
    const VERDICT_CODES = [
      'SEAL_INTACT_VERIFIED',
      'UNVERIFIED_EMPTY_LEDGER',
      'UNVERIFIED_NO_SEALED_EVIDENCE',
      'CHAIN_KEY_MISMATCH_REJECTED',
      'TAMPERED_REJECTED',
    ] as const;
    const verdictCode = typeof verifyData.status === 'string' ? verifyData.status : '';
    const verdictIsDeclared = (VERDICT_CODES as readonly string[]).includes(verdictCode);
    // The correct key must NOT be rejected as a mismatch, and must NOT be reported tampered.
    const correctKeyNotRejected =
      verdictCode !== 'CHAIN_KEY_MISMATCH_REJECTED' && verdictCode !== 'TAMPERED_REJECTED';
    // A negative verdict must explain itself; a positive one needs no excuse.
    const negativeVerdictExplained =
      verdictCode === 'SEAL_INTACT_VERIFIED' ||
      (typeof verifyData.reason === 'string' && verifyData.reason.trim().length > 0);
    // ── SELF-CONSISTENCY (new, anti-padding) ──────────────────────────────────
    // `ok`/`verified` mirror the verdict. If any of the three disagrees with the
    // others, the payload is internally contradictory and an operator reading
    // `ok:true` would be told the chain is proven while the reason field says it is
    // not. Contradiction is the fabrication this suite must be able to catch.
    const positivityExpected = verdictCode === 'SEAL_INTACT_VERIFIED';
    const okConsistentWithVerdict =
      typeof verifyData.ok === 'boolean' && verifyData.ok === positivityExpected;
    const verifiedConsistentWithVerdict =
      verifyData.verified === undefined || verifyData.verified === positivityExpected;
    // A verified verdict that still carries a reason is contradictory in the
    // opposite direction: it claims success while apologising for it.
    const verifiedVerdictHasNoApology =
      verdictCode !== 'SEAL_INTACT_VERIFIED' || !(
        typeof verifyData.reason === 'string' && verifyData.reason.trim().length > 0
      );
    const verdictSelfConsistent =
      okConsistentWithVerdict && verifiedConsistentWithVerdict && verifiedVerdictHasNoApology;
    results.push({
      test: 'tools_call_verify_chain',
      pass:
        verdictIsDeclared &&
        correctKeyNotRejected &&
        negativeVerdictExplained &&
        verdictSelfConsistent,
      details:
        `status=${verdictCode || '(none)'} ok=${String(verifyData.ok)} ` +
        `verified=${String(verifyData.verified)} consistent=${String(verdictSelfConsistent)} ` +
        `reason=${verdictCode === 'SEAL_INTACT_VERIFIED' ? '(n/a)' : (verifyData.reason ? 'present' : '(MISSING)')}`,
    });

    // 4. Tool Call: Missing required parameter error (-32602)
    const errMissingRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'sovereign_verify_chain',
        arguments: {}
      }
    });
    results.push({ test: 'tools_call_error_missing_param', pass: errMissingRes.error?.code === -32602 });

    // 5. Tool Call: Unknown tool error (-32601)
    const errUnknownRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'unknown_sovereign_subsystem',
        arguments: {}
      }
    });
    results.push({ test: 'tools_call_error_unknown_tool', pass: errUnknownRes.error?.code === -32601 });

    // 5b. Tool Call: sovereign_verify_chain (WRONG Key)
    // The binding check. It is the property that must survive regardless of what the
    // honest verifier reports about the ledger: a key that is not the sovereign key is
    // REJECTED. If this ever passes silently the security boundary is gone, and no
    // amount of honest UNVERIFIED reporting elsewhere would matter.
    const wrongKeyRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'sovereign_verify_chain',
        arguments: { chainKeyId: '0000000000000000' }
      }
    });
    const wrongKeyData = JSON.parse(wrongKeyRes.result?.content?.[0]?.text || '{}');
    const wrongKeyCode = typeof wrongKeyData.status === 'string' ? wrongKeyData.status : '';
    const wrongKeyRejected =
      wrongKeyCode === 'CHAIN_KEY_MISMATCH_REJECTED' ||
      (wrongKeyData.ok === false && wrongKeyCode !== 'SEAL_INTACT_VERIFIED');
    results.push({
      test: 'tools_call_verify_chain_wrong_key_rejected',
      pass: wrongKeyRejected,
      details: `status=${wrongKeyCode || '(none)'} ok=${String(wrongKeyData.ok)} verified=${String(wrongKeyData.verified)}`,
    });

    // 6. Tool Call: sovereign_kernel_query (Processes)
    const kernelRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'sovereign_kernel_query',
        arguments: { subsystem: 'processes' }
      }
    });
    const kernelData = JSON.parse(kernelRes.result?.content?.[0]?.text || '{}');
    results.push({ test: 'tools_call_kernel_query', pass: kernelData.ok === true && Array.isArray(kernelData.data) });

    // 7. Tool Call: sovereign_hitl_propose
    const hitlRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'sovereign_hitl_propose',
        arguments: {
          action: 'RESTART_RING0_KERNEL',
          target: 'microkernel_core',
          justification: 'Scheduled sovereign maintenance cycle'
        }
      }
    });
    const hitlData = JSON.parse(hitlRes.result?.content?.[0]?.text || '{}');
    results.push({ test: 'tools_call_hitl_propose', pass: hitlData.ok === true && hitlData.proposal?.status === 'PENDING_COMMANDER_SIGN_OFF' });

    // 8. Resources List & Read
    const resListRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'resources/list'
    });
    const resList = resListRes.result?.resources || [];
    const hasLiveTelemetry = resList.some((r: any) => r.uri === 'sovereign://telemetry/live');

    const resReadRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'resources/read',
      params: { uri: 'sovereign://telemetry/live' }
    });
    const telemetryText = resReadRes.result?.contents?.[0]?.text || '';
    const telemetryObj = JSON.parse(telemetryText || '{}');
    results.push({ test: 'resources_list_and_read', pass: hasLiveTelemetry && telemetryObj.status === 'ONLINE' && telemetryObj.chainKey === CHAIN_KEY_ID });

    // 9. Prompts List & Get
    const promptsListRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 10,
      method: 'prompts/list'
    });
    const promptsList = promptsListRes.result?.prompts || [];
    const hasBriefing = promptsList.some((p: any) => p.name === 'sovereign-commander-briefing');

    const promptGetRes = await globalSovereignMcpServer.handleJsonRpcMessage({
      jsonrpc: '2.0',
      id: 11,
      method: 'prompts/get',
      params: {
        name: 'sovereign-commander-briefing',
        arguments: { topic: 'MCP Protocol Deployment', urgency: 'critical' }
      }
    });
    const promptMessage = promptGetRes.result?.messages?.[0]?.content?.text || '';
    const promptPass = hasBriefing && promptMessage.includes(CHAIN_KEY_ID) && promptMessage.includes('CRITICAL');
    results.push({ test: 'prompts_list_and_get', pass: promptPass });

    console.log(JSON.stringify(results));
    console.log('[MCP_TEST_END]');

    const allPassed = results.every(r => r.pass);
    if (!allPassed) {
      process.exit(1);
    }
  } catch (err) {
    console.error('[MCP_TEST_FATAL_ERROR]', err);
    process.exit(1);
  }
}

main();
