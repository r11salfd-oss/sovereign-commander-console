// Dynamic Sovereign Workspace Path Configuration & Resolver
// Replaces all hardcoded static paths with environment & platform-aware dynamic paths.

export interface DynamicWorkspaceInfo {
  root: string;
  displayPath: string;
  platform: string;
  isWsl: boolean;
  sep: string;
  warChestBlockTarget: string;
  subpaths: {
    commander: string;
    forge: string;
    apps: string;
    src: string;
  };
}

// In Node.js server context, compute dynamic paths from process
export function getDynamicWorkspaceRoot(): string {
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.WORKSPACE_ROOT) return process.env.WORKSPACE_ROOT;
    if (process.env.WORKSPACE_PATH) return process.env.WORKSPACE_PATH;
    if (typeof process.cwd === 'function') {
      try {
        return process.cwd();
      } catch {
        // Fallback
      }
    }
  }
  // Client browser fallback
  return '/workspace';
}

export function getPlatformName(): string {
  if (typeof process !== 'undefined' && process.platform) {
    const isWsl = Boolean(process.env?.WSL_DISTRO_NAME || process.env?.WSL_INTEROP);
    return `${process.platform}${isWsl ? '-wsl' : ''}`;
  }
  return 'dynamic-web';
}

export function getDynamicWarChestBlockedPath(): string {
  const root = getDynamicWorkspaceRoot();
  const isWindows = root.includes('\\') || (typeof process !== 'undefined' && process.platform === 'win32');
  if (isWindows) {
    return `${root}\\SOVEREIGN_WAR_CHEST\\vault.key`;
  }
  return `${root}/SOVEREIGN_WAR_CHEST/vault.key`;
}

export function resolveDynamicPath(subpath: string): string {
  const root = getDynamicWorkspaceRoot();
  const isWindows = root.includes('\\');
  const cleanSub = subpath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, isWindows ? '\\' : '/');
  return isWindows ? `${root}\\${cleanSub}` : `${root}/${cleanSub}`;
}

export function getFullDynamicWorkspaceInfo(): DynamicWorkspaceInfo {
  const root = getDynamicWorkspaceRoot();
  const isWindows = root.includes('\\') || (typeof process !== 'undefined' && process.platform === 'win32');
  const sep = isWindows ? '\\' : '/';
  const isWsl = Boolean(typeof process !== 'undefined' && (process.env?.WSL_DISTRO_NAME || process.env?.WSL_INTEROP));

  return {
    root,
    displayPath: root,
    platform: getPlatformName(),
    isWsl,
    sep,
    warChestBlockTarget: getDynamicWarChestBlockedPath(),
    subpaths: {
      commander: resolveDynamicPath('apps/forge-backend/public/commander'),
      forge: resolveDynamicPath('apps/forge-backend'),
      apps: resolveDynamicPath('apps'),
      src: resolveDynamicPath('src')
    }
  };
}

// Client-side cache for dynamically retrieved workspace info
let cachedClientWorkspace: DynamicWorkspaceInfo | null = null;

export async function fetchDynamicWorkspaceInfo(): Promise<DynamicWorkspaceInfo> {
  if (cachedClientWorkspace) return cachedClientWorkspace;
  try {
    const res = await fetch('/api/workspace/info');
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.info) {
        cachedClientWorkspace = data.info;
        return data.info;
      }
    }
  } catch {
    // Continue to fallback
  }

  // Fallback to locally derived dynamic info
  const fallback = getFullDynamicWorkspaceInfo();
  cachedClientWorkspace = fallback;
  return fallback;
}
