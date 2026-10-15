/**
 * Analytics API Routes — Phase 4
 * /api/analytics/*
 */
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import * as analytics from '../services/analytics.js';

const router = express.Router();
router.use(requireSession);

// ─── EXECUTIVE DASHBOARD ────────────────────────────────────────────────────────

router.get('/executive/kpis', async (req, res) => {
  try {
    const { branch, process, dateFrom, dateTo } = req.query;
    const kpis = await analytics.getExecutiveKPIs({ branch, process, dateFrom, dateTo });
    res.json(kpis);
  } catch (err) {
    console.error('[Analytics] Executive KPIs error:', err);
    res.status(500).json({ error: 'Failed to load KPIs' });
  }
});

// ─── TRAINING ROI ───────────────────────────────────────────────────────────────

router.get('/roi', async (req, res) => {
  try {
    const { branch, process, batchNo } = req.query;
    const roi = await analytics.calculateTrainingROI({ branch, process, batchNo });
    res.json(roi);
  } catch (err) {
    console.error('[Analytics] ROI error:', err);
    res.status(500).json({ error: 'Failed to calculate ROI' });
  }
});

// ─── COHORT ANALYSIS ────────────────────────────────────────────────────────────

router.get('/cohorts', async (req, res) => {
  try {
    const { branch, process, groupBy } = req.query;
    const cohorts = await analytics.getCohortAnalysis({ branch, process, groupBy });
    res.json(cohorts);
  } catch (err) {
    console.error('[Analytics] Cohort analysis error:', err);
    res.status(500).json({ error: 'Failed to load cohort analysis' });
  }
});

// ─── TRAINING FUNNEL ────────────────────────────────────────────────────────────

router.get('/funnel', async (req, res) => {
  try {
    const { branch, process, batchNo } = req.query;
    const funnel = await analytics.getTrainingFunnel({ branch, process, batchNo });
    res.json(funnel);
  } catch (err) {
    console.error('[Analytics] Funnel error:', err);
    res.status(500).json({ error: 'Failed to load training funnel' });
  }
});

// ─── PROCESS PERFORMANCE (Client Portal) ────────────────────────────────────────

router.get('/process/:processName', async (req, res) => {
  try {
    const { processName } = req.params;
    const performance = await analytics.getProcessPerformance(processName);
    res.json(performance);
  } catch (err) {
    console.error('[Analytics] Process performance error:', err);
    res.status(500).json({ error: 'Failed to load process performance' });
  }
});

export default router;
