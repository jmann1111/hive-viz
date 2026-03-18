import fs from 'fs/promises';
import path from 'path';

export async function validateVaultRelativePath(vaultRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return null;
  }

  const absolutePath = path.resolve(vaultRoot, relativePath);
  const relativeToRoot = path.relative(vaultRoot, absolutePath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return null;
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) return null;
  } catch {
    return null;
  }

  return {
    absolutePath,
    relativePath,
  };
}
