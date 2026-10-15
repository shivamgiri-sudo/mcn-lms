/**
 * Content Enhancement API Routes — Phase 5
 * /api/content-enhance/*
 */
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import * as enhancement from '../services/contentEnhancement.js';

const router = express.Router();
router.use(requireSession);

// ─── PRACTICE MODE (Trainee) ────────────────────────────────────────────────────

router.get('/practice/:assessmentId/start', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { assessmentId } = req.params;
    const session = await enhancement.startPracticeAttempt(employeeId, assessmentId);
    res.json(session);
  } catch (err) {
    console.error('[ContentEnhance] Practice start error:', err);
    res.status(err.message.includes('No questions') ? 404 : 500).json({ error: err.message });
  }
});

router.post('/practice/:assessmentId/submit', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { assessmentId } = req.params;
    const { answers, timeSpentSeconds } = req.body;

    if (!answers || !Array.isArray(answers)) {
      return res.status(400).json({ error: 'Answers array required' });
    }

    const result = await enhancement.submitPracticeAttempt(employeeId, assessmentId, answers, timeSpentSeconds);
    res.json(result);
  } catch (err) {
    console.error('[ContentEnhance] Practice submit error:', err);
    res.status(500).json({ error: 'Failed to submit practice attempt' });
  }
});

router.get('/practice/history', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { assessmentId } = req.query;
    const history = await enhancement.getPracticeHistory(employeeId, assessmentId);
    res.json(history);
  } catch (err) {
    console.error('[ContentEnhance] Practice history error:', err);
    res.status(500).json({ error: 'Failed to load practice history' });
  }
});

// ─── QUESTION TAGGING (Coordinator/Admin) ───────────────────────────────────────

router.get('/tags/options', async (req, res) => {
  try {
    const options = enhancement.getTagOptions();
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tag options' });
  }
});

router.get('/tags/:questionId', async (req, res) => {
  try {
    const tags = await enhancement.getQuestionTags(req.params.questionId);
    res.json(tags);
  } catch (err) {
    console.error('[ContentEnhance] Get tags error:', err);
    res.status(500).json({ error: 'Failed to load tags' });
  }
});

router.post('/tags/:questionId', async (req, res) => {
  try {
    const { tagType, tagValue } = req.body;
    if (!tagType || !tagValue) {
      return res.status(400).json({ error: 'tagType and tagValue required' });
    }

    const tag = await enhancement.addQuestionTag(req.params.questionId, tagType, tagValue);
    res.status(201).json(tag);
  } catch (err) {
    console.error('[ContentEnhance] Add tag error:', err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/tags/:questionId', async (req, res) => {
  try {
    const { tagType, tagValue } = req.body;
    if (!tagType || !tagValue) {
      return res.status(400).json({ error: 'tagType and tagValue required' });
    }

    await enhancement.removeQuestionTag(req.params.questionId, tagType, tagValue);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContentEnhance] Remove tag error:', err);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

router.post('/tags/bulk', async (req, res) => {
  try {
    const { questionIds, tagType, tagValue } = req.body;
    if (!questionIds?.length || !tagType || !tagValue) {
      return res.status(400).json({ error: 'questionIds, tagType, and tagValue required' });
    }

    const result = await enhancement.bulkTagQuestions(questionIds, tagType, tagValue);
    res.json(result);
  } catch (err) {
    console.error('[ContentEnhance] Bulk tag error:', err);
    res.status(500).json({ error: 'Failed to bulk tag questions' });
  }
});

// ─── VIDEO BOOKMARKS (Trainee) ──────────────────────────────────────────────────

router.get('/bookmarks/:contentId', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const bookmarks = await enhancement.getVideoBookmarks(employeeId, req.params.contentId);
    res.json(bookmarks);
  } catch (err) {
    console.error('[ContentEnhance] Get bookmarks error:', err);
    res.status(500).json({ error: 'Failed to load bookmarks' });
  }
});

router.post('/bookmarks/:contentId', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { positionSeconds, note } = req.body;
    if (positionSeconds === undefined) {
      return res.status(400).json({ error: 'positionSeconds required' });
    }

    const bookmark = await enhancement.addVideoBookmark(employeeId, req.params.contentId, positionSeconds, note);
    res.status(201).json(bookmark);
  } catch (err) {
    console.error('[ContentEnhance] Add bookmark error:', err);
    res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

router.delete('/bookmarks/:id', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    await enhancement.deleteVideoBookmark(req.params.id, employeeId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContentEnhance] Delete bookmark error:', err);
    res.status(500).json({ error: 'Failed to delete bookmark' });
  }
});

// ─── CONTENT NOTES (Trainee) ────────────────────────────────────────────────────

router.get('/notes/:contentId', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const notes = await enhancement.getContentNotes(employeeId, req.params.contentId);
    res.json(notes);
  } catch (err) {
    console.error('[ContentEnhance] Get notes error:', err);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

router.post('/notes/:contentId', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { noteText, timestampSeconds } = req.body;
    if (!noteText) {
      return res.status(400).json({ error: 'noteText required' });
    }

    const note = await enhancement.addContentNote(employeeId, req.params.contentId, noteText, timestampSeconds);
    res.status(201).json(note);
  } catch (err) {
    console.error('[ContentEnhance] Add note error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

router.put('/notes/:id', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { noteText } = req.body;
    if (!noteText) {
      return res.status(400).json({ error: 'noteText required' });
    }

    await enhancement.updateContentNote(req.params.id, employeeId, noteText);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContentEnhance] Update note error:', err);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/notes/:id', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    await enhancement.deleteContentNote(req.params.id, employeeId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[ContentEnhance] Delete note error:', err);
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// ─── CONTENT ANALYTICS (Coordinator/Admin) ──────────────────────────────────────

router.get('/analytics/content/:contentId', async (req, res) => {
  try {
    const engagement = await enhancement.getContentEngagement(req.params.contentId);
    res.json(engagement);
  } catch (err) {
    console.error('[ContentEnhance] Content analytics error:', err);
    res.status(500).json({ error: 'Failed to load content analytics' });
  }
});

router.get('/analytics/assessment/:assessmentId/practice', async (req, res) => {
  try {
    const stats = await enhancement.getAssessmentPracticeStats(req.params.assessmentId);
    res.json(stats);
  } catch (err) {
    console.error('[ContentEnhance] Assessment practice stats error:', err);
    res.status(500).json({ error: 'Failed to load practice stats' });
  }
});

export default router;
