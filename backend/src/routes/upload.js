import { Router } from 'express';
import { requireSession, requireRole } from '../middleware/auth.js';
import { contentUpload } from '../utils/upload.js';

const router = Router();

router.post('/content', requireSession, requireRole('admin'), contentUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, message: 'No file uploaded.' });
  const apiOrigin = String(process.env.API_URL || 'http://localhost:4000').replace(/\/+$/, '');
  const url = `${apiOrigin}/api/content/files/${encodeURIComponent(req.file.filename)}`;
  return res.json({
    ok: true,
    url,
    protected: true,
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
});

export default router;
