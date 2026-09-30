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
    results.push({ test: 'tools_call_verify_chain', pass: verifyData.ok === true && verifyData.status === 'SEAL_INTACT_VERIFIED' });

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
