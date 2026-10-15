import path from 'path';
import { prisma } from '../utils/db.js';
import { audit } from '../utils/audit.js';

// Replaces the FILE behind an existing curriculum content item (e.g. swap a PPT for a
// PDF) without deleting it: the content id, its order, lock, module, assignments and
// every trainee's progress stay attached. The previous file is left on disk. Whether
// trainees must re-acknowledge is a separate, deliberate step (publish-version), which
// the UI offers by calling the existing publish-version action afterwards.

const TYPE_BY_EXT = {
  '.pdf': 'pdf',
  '.ppt': 'ppt', '.pptx': 'ppt',
  '.doc': 'doc', '.docx': 'doc', '.xls': 'doc', '.xlsx': 'doc',
  '.mp4': 'video', '.webm': 'video', '.ogg': 'video', '.mov': 'video',
  '.jpg': 'doc', '.jpeg': 'doc', '.png': 'doc', '.gif': 'doc', '.webp': 'doc',
  '.html': 'html', '.htm': 'html',
};

const text = (v) => {
  const t = String(v ?? '').trim();
  return t || null;
};

export async function replaceContentFile(req, res) {
  try {
    const { contentId } = req.params;
    if (!req.file) return res.status(400).json({ ok: false, message: 'Choose a file to upload.' });

    const existing = await prisma.contentMaster.findUnique({ where: { contentId } });
    if (!existing) return res.status(404).json({ ok: false, message: 'Content not found.' });

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const localFilePath = `/uploads/content/${req.file.filename}`;
    const apiBase = process.env.API_URL || `${req.protocol}://${req.get('host')}`;
    const data = {
      localFilePath,
      directMediaUrl: `${apiBase}${localFilePath}`,
      // A Drive id would take precedence over the new file in the viewer.
      driveFileId: null,
      driveUrl: null,
      contentType: text(req.body?.contentType) || TYPE_BY_EXT[ext] || existing.contentType,
    };
    const title = text(req.body?.contentTitle);
    if (title) data.contentTitle = title;
    if (req.body?.description !== undefined) data.description = text(req.body.description);

    const content = await prisma.contentMaster.update({ where: { contentId }, data });

    await audit({
      userIdentity: req.userId, userRole: 'Admin', action: 'REPLACE_CONTENT_FILE', module: 'Curriculum', referenceId: contentId,
      oldValue: { contentType: existing.contentType, directMediaUrl: existing.directMediaUrl, localFilePath: existing.localFilePath, driveFileId: existing.driveFileId },
      newValue: { contentType: content.contentType, directMediaUrl: content.directMediaUrl, localFilePath, originalName: req.file.originalname },
    });

    return res.json({ ok: true, data: content });
  } catch (err) {
    console.error('[contentReplace] failed:', err);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
}
