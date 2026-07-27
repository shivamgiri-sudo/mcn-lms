import { createHash, timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { mapEmployeeId } from '../utils/empIdMapping.js';

const router = Router();

function digest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function requireHrApiKey(req, res, next) {
  const configured = String(process.env.HR_API_KEY || '').trim();
  const provided = String(req.headers['x-hr-api-key'] || '').trim();

  res.setHeader('Cache-Control', 'no-store');
  if (configured.length < 32) {
    return res.status(503).json({ ok: false, message: 'HR employee mapping integration is unavailable.' });
  }
  if (!provided || !timingSafeEqual(digest(provided), digest(configured))) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  return next();
}

// Single: POST /api/emp-mapping  { mobile, permanentEmpId }
// Batch:  POST /api/emp-mapping  { mappings: [{ mobile, permanentEmpId }, ...] }
router.post('/', requireHrApiKey, async (req, res) => {
  try {
    const { mobile, permanentEmpId, mappings } = req.body;

    if (mappings && Array.isArray(mappings)) {
      const results = [];
      for (const mapping of mappings) {
        const result = await mapEmployeeId({
          mobile: mapping.mobile,
          permanentEmpId: mapping.permanentEmpId,
          triggeredBy: 'HR_API',
          triggeredByRole: 'HR_API',
        });
        results.push({ mobile: mapping.mobile, permanentEmpId: mapping.permanentEmpId, ...result });
      }
      const mapped = results.filter(result => result.ok).length;
      const errors = results
        .filter(result => !result.ok)
        .map(result => ({ mobile: result.mobile, reason: result.error }));
      return res.json({ ok: true, mapped, skipped: errors.length, errors });
    }

    if (mobile && permanentEmpId) {
      const result = await mapEmployeeId({
        mobile,
        permanentEmpId,
        triggeredBy: 'HR_API',
        triggeredByRole: 'HR_API',
      });
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
      return res.json({ ok: true, ...result });
    }

    return res.status(400).json({ ok: false, message: 'Provide { mobile, permanentEmpId } or { mappings: [...] }' });
  } catch (error) {
    console.error('HR emp-mapping error:', error);
    return res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
