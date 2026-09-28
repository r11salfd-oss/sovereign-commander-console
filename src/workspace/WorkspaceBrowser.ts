import fs from 'fs';
import path from 'path';
import { normalizePath, isAllowedPath } from './WorkspacePath';

const MAX_PREVIEW_SIZE = 256 * 1024; // 256 KB
const MAX_DIR_ENTRIES = 500;

export function listWorkspaceTree(relativePath: string) {
  const targetPath = normalizePath(relativePath);
  if (!isAllowedPath(targetPath)) {
    throw new Error('SECURE_EXCEPTION: Path access denied by Sovereign Policy.');
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error('NOT_FOUND: Path does not exist.');
  }

  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    throw new Error('INVALID_TARGET: Target is a file, use getWorkspaceFilePreview instead.');
  }

  const files = fs.readdirSync(targetPath);
  if (files.length > MAX_DIR_ENTRIES) {
    throw new Error('LIMIT_EXCEEDED: Directory contains too many entries.');
  }

  const entries = files.map(file => {
    const fullPath = path.join(targetPath, file);
    try {
      const isAllowed = isAllowedPath(fullPath);
      if (!isAllowed) return null;
      
      const fileStat = fs.statSync(fullPath);
      return {
        name: file,
        type: fileStat.isDirectory() ? 'directory' : 'file',
        size: fileStat.isFile() ? fileStat.size : undefined,
        relativePath: path.join(relativePath, file).replace(/\\\\/g, '/')
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return {
    path: relativePath,
    entries
  };
}

export function getWorkspaceFilePreview(relativePath: string) {
  const targetPath = normalizePath(relativePath);
  if (!isAllowedPath(targetPath)) {
    throw new Error('SECURE_EXCEPTION: Path access denied by Sovereign Policy.');
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error('NOT_FOUND: File does not exist.');
  }

  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    throw new Error('INVALID_TARGET: Target is a directory, use listWorkspaceTree instead.');
  }

  if (stat.size > MAX_PREVIEW_SIZE) {
    throw new Error('LIMIT_EXCEEDED: File size exceeds 256 KB preview limit.');
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  return {
    path: relativePath,
    size: stat.size,
    content
  };
}
