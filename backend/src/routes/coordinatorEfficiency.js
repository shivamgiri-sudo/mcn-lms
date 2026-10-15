/**
 * Coordinator Efficiency API Routes — Phase 3
 * /api/coordinator/efficiency/*
 */
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import * as efficiency from '../services/coordinatorEfficiency.js';

const router = express.Router();
router.use(requireSession);

// ─── BATCH TEMPLATES ────────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    const { branch, process } = req.query;

    const templates = await efficiency.getBatchTemplates({
      createdBy: userId,
      branch,
      process,
      includePublic: true,
    });

    res.json(templates);
  } catch (err) {
    console.error('[Efficiency] Get templates error:', err);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

router.get('/templates/:id', async (req, res) => {
  try {
    const template = await efficiency.getBatchTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (err) {
    console.error('[Efficiency] Get template error:', err);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const { name, description, config, branch, process, isPublic } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'Name and config required' });

    const template = await efficiency.createBatchTemplate({
      name,
      description,
      config,
      createdBy: userId,
      branch,
      process,
      isPublic,
    });

    res.status(201).json(template);
  } catch (err) {
    console.error('[Efficiency] Create template error:', err);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.post('/templates/:id/use', async (req, res) => {
  try {
    const template = await efficiency.useBatchTemplate(req.params.id);
    res.json(template);
  } catch (err) {
    console.error('[Efficiency] Use template error:', err);
    res.status(500).json({ error: 'Failed to use template' });
  }
});

router.delete('/templates/:id', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    await efficiency.deleteBatchTemplate(req.params.id, userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Efficiency] Delete template error:', err);
    res.status(err.message.includes('Not authorized') ? 403 : 500).json({ error: err.message });
  }
});

// ─── BULK ACTIONS ───────────────────────────────────────────────────────────────

router.post('/bulk/update-status', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const { traineeIds, newStatus, reason } = req.body;
    if (!traineeIds?.length || !newStatus) {
      return res.status(400).json({ error: 'traineeIds and newStatus required' });
    }

    const result = await efficiency.bulkUpdateTraineeStatus(traineeIds, newStatus, userId, reason);
    res.json(result);
  } catch (err) {
    console.error('[Efficiency] Bulk update status error:', err);
    res.status(500).json({ error: 'Failed to update statuses' });
  }
});

router.post('/bulk/assign-classroom', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const { traineeIds, classroomId } = req.body;
    if (!traineeIds?.length || !classroomId) {
      return res.status(400).json({ error: 'traineeIds and classroomId required' });
    }

    const result = await efficiency.bulkAssignClassroom(traineeIds, classroomId, userId);
    res.json(result);
  } catch (err) {
    console.error('[Efficiency] Bulk assign classroom error:', err);
    res.status(500).json({ error: 'Failed to assign classroom' });
  }
});

router.post('/bulk/mark-ojt-ready', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const { traineeIds } = req.body;
    if (!traineeIds?.length) {
      return res.status(400).json({ error: 'traineeIds required' });
    }

    const result = await efficiency.bulkMarkOJTReady(traineeIds, userId);
    res.json(result);
  } catch (err) {
    console.error('[Efficiency] Bulk mark OJT ready error:', err);
    res.status(500).json({ error: 'Failed to mark OJT ready' });
  }
});

router.get('/bulk/history', async (req, res) => {
  try {
    const userId = req.user?.loginId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const { limit = 20 } = req.query;
    const history = await efficiency.getBulkActionHistory(userId, parseInt(limit, 10));
    res.json(history);
  } catch (err) {
    console.error('[Efficiency] Bulk history error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ─── RISK HEATMAP ───────────────────────────────────────────────────────────────

router.get('/risk-heatmap', async (req, res) => {
  try {
    const { batchNo, branch, process } = req.query;
    const heatmap = await efficiency.getRiskHeatmap({ batchNo, branch, process });
    res.json(heatmap);
  } catch (err) {
    console.error('[Efficiency] Risk heatmap error:', err);
    res.status(500).json({ error: 'Failed to load risk heatmap' });
  }
});

// ─── CERTIFICATION QUEUE ────────────────────────────────────────────────────────

router.get('/certification-queue', async (req, res) => {
  try {
    const { batchNo, branch, process } = req.query;
    const queue = await efficiency.getCertificationQueue({ batchNo, branch, process });
    res.json(queue);
  } catch (err) {
    console.error('[Efficiency] Certification queue error:', err);
    res.status(500).json({ error: 'Failed to load certification queue' });
  }
});

// ─── QUICK STATS ────────────────────────────────────────────────────────────────

router.get('/quick-stats', async (req, res) => {
  try {
    const { batchNo, branch, process } = req.query;
    const stats = await efficiency.getCoordinatorQuickStats({ batchNo, branch, process });
    res.json(stats);
  } catch (err) {
    console.error('[Efficiency] Quick stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
