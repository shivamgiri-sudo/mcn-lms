import { loadMapping, saveMapping, DEFAULT_MAPPING } from '../utils/hrmsConfig.js';

export async function getHrmsConfig(req, res) {
  try {
    const config = loadMapping();
    res.json({ ok: true, data: config });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

export async function setHrmsConfig(req, res) {
  try {
    const mapping = req.body?.mapping;
    if (!mapping) return res.status(400).json({ ok: false, message: 'Mapping object is required.' });
    saveMapping(mapping);
    res.json({ ok: true, message: 'HRMS mapping config saved.' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}
