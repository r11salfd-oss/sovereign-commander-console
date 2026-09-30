/**
 * ============================================================================
 * SOVEREIGN SERVERS CENTER REGISTRY (E:\Servers-Center)
 * Standard: Model Context Protocol (MCP) + Language Server Protocol (LSP)
 * Unifies all 6 MCP Servers + LSP Servers into Sovereign Architecture
 * Chain Key ID: 360ea36c28e66d9d
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';

export interface McpServerInfo {
  id: string;
  name: string;
  version: string;
  type: 'mcp';
  entry: string;
  fullPath: string;
  args?: string[];
  tools: string[];
  description: string;
  status: 'ONLINE' | 'STANDBY' | 'MISSING';
  isHealthy: boolean;
}

export interface LspServerInfo {
  id: string;
  name: string;
  version: string;
  type: 'lsp';
  entry?: string;
  fullPath?: string;
  source?: string;
  note?: string;
  language: string;
  description: string;
  status: 'READY' | 'SYSTEM_PINNED' | 'STANDBY';
  isHealthy: boolean;
}

export interface ServersCenterOverview {
  ok: boolean;
  centerPath: string;
  isAvailable: boolean;
  nodeRuntime: {
    path: string;
    version: string;
    exists: boolean;
  };
  mcpSummary: {
    total: number;
    onlineCount: number;
    servers: McpServerInfo[];
  };
  lspSummary: {
    total: number;
    readyCount: number;
    servers: LspServerInfo[];
  };
  chainKey: string;
  lastSync: string;
}

const MCP_METADATA: Record<string, { label: string; description: string; defaultTools: string[] }> = {
  'shell': {
    label: 'Hardened Shell MCP Server',
    description: 'Host shell execution, sandboxed terminal dispatch, and policy-governed command execution',
    defaultTools: ['run_shell_command']
  },
  'chrome-devtools': {
    label: 'Chrome DevTools MCP Server',
    description: 'Headless Chromium debugging, performance profiling, DOM inspection, and network analysis',
    defaultTools: ['list_pages', 'navigate_page', 'take_screenshot', 'evaluate_script']
  },
  'github': {
    label: 'GitHub Native MCP Server',
    description: 'Git operations, pull requests, issue tracking, and repository automation via GitHub API',
    defaultTools: ['search_repositories', 'get_file_contents', 'create_pull_request', 'list_issues']
  },
  'syncfusion': {
    label: 'Syncfusion React DataGrid Generator',
    description: 'Generates hardened and licensed enterprise React DataGrid components and schemas',
    defaultTools: ['generate_react_datagrid']
  },
  'context7': {
    label: 'Context7 Upstash Documentation Server',
    description: 'Documentation indexer and real-time library resolver for modern web frameworks',
    defaultTools: ['resolve-library-id', 'query-docs']
  },
  'playwright': {
    label: 'Playwright Headless Browser MCP',
    description: 'Automated browser testing, synthetic user simulation, and multi-browser rendering',
    defaultTools: ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_evaluate']
  },
  'sovereign-commander': {
    label: 'Sovereign Commander Microkernel & Governance MCP',
    description: 'Ring-0 kernel telemetry, CoALA cognitive memory, cryptographic hash chain, and HITL authorization',
    defaultTools: ['sovereign_verify_chain', 'sovereign_kernel_query', 'sovereign_memory_recall', 'sovereign_hitl_propose']
  }
};

const LSP_METADATA: Record<string, { label: string; language: string; description: string }> = {
  'typescript': {
    label: 'TypeScript / JavaScript Language Server',
    language: 'TypeScript / JavaScript',
    description: 'Real-time type checking, refactoring, hover diagnostics, and symbol indexing via TSServer'
  },
  'eslint': {
    label: 'ESLint Diagnostic Server',
    language: 'JavaScript / TypeScript / JSX',
    description: 'Static code analysis, security rule enforcement, and stylistic linting diagnostics'
  },
  'bash': {
    label: 'Bash Language Server',
    language: 'Shell Script / Bash',
    description: 'Shell script parsing, syntax validation, autocomplete, and shellcheck integration'
  },
  'yaml': {
    label: 'YAML Language Server',
    language: 'YAML / JSON Schema',
    description: 'Validation of Kubernetes manifests, GitHub Actions workflows, and YAML schemas'
  },
  'pyright': {
    label: 'Pyright Python Type Server',
    language: 'Python',
    description: 'High-speed type inference, static analysis, and language features for Python 3'
  },
  'dotnet': {
    label: 'DotNet C# Language Server',
    language: 'C# / .NET SDK',
    description: 'Roslyn-based language services for C# enterprise backend microservices'
  }
};

export class ServersCenterRegistry {
  private readonly centerRoot = 'E:\\Servers-Center';
  private readonly manifestPath = 'E:\\Servers-Center\\manifest.json';
  private readonly runtimeNode = 'E:\\Servers-Center\\runtime\\node-v24.19.0-win-x64\\node.exe';

  /**
   * Scans and returns full overview of all MCP and LSP servers from E:\Servers-Center
   */
  public getOverview(): ServersCenterOverview {
    const isCenterAvailable = fs.existsSync(this.centerRoot) && fs.existsSync(this.manifestPath);
    const isNodeAvailable = fs.existsSync(this.runtimeNode);

    let manifestData: any = null;
    if (isCenterAvailable) {
      try {
        const raw = fs.readFileSync(this.manifestPath, 'utf8');
        manifestData = JSON.parse(raw);
      } catch (err) {
        console.error('[ServersCenterRegistry] Failed to parse manifest.json:', err);
      }
    }

    const mcpServers = this.resolveMcpServers(manifestData);
    const lspServers = this.resolveLspServers(manifestData);

    return {
      ok: true,
      centerPath: this.centerRoot,
      isAvailable: isCenterAvailable,
      nodeRuntime: {
        path: this.runtimeNode,
        version: manifestData?.runtime?.node_version || 'v24.19.0',
        exists: isNodeAvailable
      },
      mcpSummary: {
        total: mcpServers.length,
        onlineCount: mcpServers.filter(s => s.status === 'ONLINE').length,
        servers: mcpServers
      },
      lspSummary: {
        total: lspServers.length,
        readyCount: lspServers.filter(s => s.isHealthy).length,
        servers: lspServers
      },
      chainKey: '360ea36c28e66d9d',
      lastSync: new Date().toISOString()
    };
  }

  private resolveMcpServers(manifest: any): McpServerInfo[] {
    const mcpEntries = manifest?.mcp || {};
    const defaultMcpKeys = ['shell', 'chrome-devtools', 'github', 'syncfusion', 'context7', 'playwright', 'sovereign-commander'];
    const allKeys = Array.from(new Set([...defaultMcpKeys, ...Object.keys(mcpEntries)]));

    return allKeys.map(key => {
      const entryCfg = mcpEntries[key] || {};
      const meta = MCP_METADATA[key] || {
        label: `${key.toUpperCase()} MCP Server`,
        description: `External Model Context Protocol tool provider: ${key}`,
        defaultTools: [key]
      };

      const relEntry = entryCfg.entry || `servers\\mcp\\${key}\\server.js`;
      const fullPath = path.join(this.centerRoot, relEntry);
      const exists = fs.existsSync(fullPath);

      let tools: string[] = [];
      if (entryCfg.tools && Array.isArray(entryCfg.tools)) {
        tools = entryCfg.tools;
      } else if (entryCfg.tool) {
        tools = [entryCfg.tool];
      } else {
        tools = meta.defaultTools;
      }

      return {
        id: key,
        name: meta.label,
        version: entryCfg.version || '1.0.0',
        type: 'mcp',
        entry: relEntry,
        fullPath,
        args: entryCfg.args || [],
        tools,
        description: meta.description,
        status: exists ? 'ONLINE' : 'STANDBY',
        isHealthy: exists
      };
    });
  }

  private resolveLspServers(manifest: any): LspServerInfo[] {
    const lspEntries = manifest?.lsp || {};
    const defaultLspKeys = ['typescript', 'eslint', 'bash', 'yaml', 'pyright', 'dotnet'];
    const allKeys = Array.from(new Set([...defaultLspKeys, ...Object.keys(lspEntries)]));

    return allKeys.map(key => {
      const entryCfg = lspEntries[key] || {};
      const meta = LSP_METADATA[key] || {
        label: `${key.toUpperCase()} LSP`,
        language: key,
        description: `Language Server Protocol service for ${key}`
      };

      const relEntry = entryCfg.entry || (entryCfg.source ? undefined : `servers\\lsp\\${key}`);
      const fullPath = relEntry ? path.join(this.centerRoot, relEntry) : undefined;
      const isSystemToolchain = !!entryCfg.source;
      const exists = fullPath ? fs.existsSync(fullPath) : isSystemToolchain;

      return {
        id: key,
        name: meta.label,
        version: entryCfg.version || '1.0.0',
        type: 'lsp',
        entry: relEntry,
        fullPath,
        source: entryCfg.source,
        note: entryCfg.note,
        language: meta.language,
        description: meta.description,
        status: isSystemToolchain ? 'SYSTEM_PINNED' : (exists ? 'READY' : 'STANDBY'),
        isHealthy: exists
      };
    });
  }
}

// Global Singleton Instance
export const globalServersCenterRegistry = new ServersCenterRegistry();
