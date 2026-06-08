import fs from 'fs';
import path from 'path';

const DEFAULT_UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

export function getUploadRoot() {
  return path.resolve(process.env.LMS_UPLOAD_DIR || process.env.UPLOAD_DIR || DEFAULT_UPLOAD_ROOT);
}

export function getContentUploadDir() {
  return path.join(getUploadRoot(), 'content');
}

export function getScormTempDir() {
  return path.join(getUploadRoot(), 'scorm-tmp');
}

export function getScormPackageDir() {
  return path.join(getUploadRoot(), 'scorm');
}

export function ensureLocalDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getPublicUploadPath(...parts) {
  return ['/uploads', ...parts].join('/').replace(/\/+/g, '/');
}

export function getPublicUploadUrl(req, ...parts) {
  const base = process.env.LMS_PUBLIC_UPLOAD_URL || `${process.env.API_URL || `${req.protocol}://${req.get('host')}`}/uploads`;
  const suffix = parts.filter(Boolean).join('/').replace(/^\/+/, '');
  return suffix ? `${base.replace(/\/+$/, '')}/${suffix}` : base.replace(/\/+$/, '');
}

export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024;
    unit = units[i];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

export function getDirectorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

export function getStorageHealth() {
  const root = getUploadRoot();
  const contentDir = getContentUploadDir();
  ensureLocalDir(root);
  ensureLocalDir(contentDir);

  const health = {
    uploadRoot: root,
    contentDir,
    rootExists: fs.existsSync(root),
    contentDirExists: fs.existsSync(contentDir),
    rootWritable: false,
    contentDirWritable: false,
    totalBytes: 0,
    totalHuman: '0 B',
    fileCount: 0,
    statfsSupported: typeof fs.statfsSync === 'function',
    disk: null,
  };

  try {
    fs.accessSync(root, fs.constants.W_OK);
    health.rootWritable = true;
  } catch (err) {
    health.rootWritableMessage = err.message;
  }

  try {
    fs.accessSync(contentDir, fs.constants.W_OK);
    health.contentDirWritable = true;
  } catch (err) {
    health.contentDirWritableMessage = err.message;
  }

  try {
    health.totalBytes = getDirectorySize(root);
    health.totalHuman = formatBytes(health.totalBytes);
  } catch (err) {
    health.sizeMessage = err.message;
  }

  try {
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        else if (entry.isFile()) health.fileCount += 1;
      }
    }
  } catch (err) {
    health.fileCountMessage = err.message;
  }

  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(root);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      const used = total - free;
      health.disk = {
        totalBytes: total,
        freeBytes: free,
        usedBytes: used,
        totalHuman: formatBytes(total),
        freeHuman: formatBytes(free),
        usedHuman: formatBytes(used),
        freePct: total > 0 ? Math.round((free / total) * 100) : null,
      };
    }
  } catch (err) {
    health.diskMessage = err.message;
  }

  return health;
}
