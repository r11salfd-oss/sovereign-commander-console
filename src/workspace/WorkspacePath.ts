import path from 'path';
import { getDynamicWorkspaceRoot } from './WorkspaceConfig';

export function getBaseRoot(): string {
  return getDynamicWorkspaceRoot();
}

export function normalizePath(relativePath: string): string {
  const baseRoot = getBaseRoot();
  // Prevent path traversal
  const safeRelativePath = relativePath.replace(/^(\.\.[\/\\\\])+/, '').replace(/[\/\\\\]\.\.[\/\\\\]/g, '/');
  return path.resolve(baseRoot, safeRelativePath);
}

export function isAllowedPath(absolutePath: string): boolean {
  const baseRoot = getBaseRoot();
  if (!absolutePath.toLowerCase().startsWith(baseRoot.toLowerCase())) return false;
  
  // Reject WAR_CHEST dynamically
  if (absolutePath.toLowerCase().includes('war_chest')) return false;
  if (absolutePath.includes('SOVEREIGN_WAR_CHEST')) return false;
  
  // Reject secrets
  const filename = path.basename(absolutePath);
  if (['.env', 'commander.hmac.key'].includes(filename)) return false;
  if (filename.endsWith('.key') || filename.endsWith('.pem') || filename.includes('token') || filename.includes('secret')) return false;

  return true;
}
