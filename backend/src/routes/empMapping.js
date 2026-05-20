// backend/src/routes/empMapping.js
import { Router } from 'express';
import { mapEmployeeId } from '../utils/empIdMapping.js';

const router = Router();

function requireHrApiKey(req, res, next) {
  const key = req.headers['x-hr-api-key'];
  if (!key || key !== process.env.HR_API_KEY) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  next();
}

// Single: POST /api/emp-mapping  { mobile, permanentEmpId }
// Batch:  POST /api/emp-mapping  { mappings: [{ mobile, permanentEmpId }, ...] }
router.post('/', requireHrApiKey, async (req, res) => {
  try {
    const { mobile, permanentEmpId, mappings } = req.body;

    if (mappings && Array.isArray(mappings)) {
      const results = [];
      for (const m of mappings) {
        const r = await mapEmployeeId({
          mobile: m.mobile,
          permanentEmpId: m.permanentEmpId,
          triggeredBy: 'HR_API',
          triggeredByRole: 'HR_API',
        });
        results.push({ mobile: m.mobile, permanentEmpId: m.permanentEmpId, ...r });
      }
      const mapped = results.filter(r => r.ok).length;
      const errors = results.filter(r => !r.ok).map(r => ({ mobile: r.mobile, reason: r.error }));
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

    res.status(400).json({ ok: false, message: 'Provide { mobile, permanentEmpId } or { mappings: [...] }' });
  } catch (err) {
    console.error('HR emp-mapping error:', err);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
});

export default router;
