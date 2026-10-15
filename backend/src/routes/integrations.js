/**
 * Integrations API Routes — Phase 6
 * /api/integrations/*
 */
import express from 'express';
import { requireSession } from '../middleware/auth.js';
import * as integrations from '../services/integrations.js';

const router = express.Router();
router.use(requireSession);

// ─── WEBHOOK MANAGEMENT ─────────────────────────────────────────────────────────

router.get('/webhooks/events', async (req, res) => {
  try {
    const events = integrations.getAvailableWebhookEvents();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get webhook events' });
  }
});

router.get('/webhooks', async (req, res) => {
  try {
    const userId = req.userId || req.headers['x-user-id'];
    const subs = await integrations.listWebhookSubscriptions(userId);
    res.json(subs);
  } catch (err) {
    console.error('[Integrations] List webhooks error:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

router.post('/webhooks', async (req, res) => {
  try {
    const userId = req.userId || req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const { url, events, secret, name } = req.body;
    if (!url || !events?.length) {
      return res.status(400).json({ error: 'url and events are required' });
    }

    const sub = await integrations.createWebhookSubscription({
      url, events, secret, name, createdBy: userId,
    });
    res.status(201).json(sub);
  } catch (err) {
    console.error('[Integrations] Create webhook error:', err);
    res.status(400).json({ error: err.message });
  }
});

router.put('/webhooks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await integrations.updateWebhookSubscription(id, req.body);
    res.json(updated);
  } catch (err) {
    console.error('[Integrations] Update webhook error:', err);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    await integrations.deleteWebhookSubscription(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Integrations] Delete webhook error:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

router.get('/webhooks/:id/deliveries', async (req, res) => {
  try {
    const deliveries = await integrations.getWebhookDeliveries(req.params.id);
    res.json(deliveries);
  } catch (err) {
    console.error('[Integrations] Get deliveries error:', err);
    res.status(500).json({ error: 'Failed to get deliveries' });
  }
});

// Test webhook endpoint
router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const results = await integrations.triggerWebhook('test.ping', {
      message: 'Test webhook from MCN LMS',
      timestamp: new Date().toISOString(),
    });
    res.json({ results });
  } catch (err) {
    console.error('[Integrations] Test webhook error:', err);
    res.status(500).json({ error: 'Failed to test webhook' });
  }
});

// ─── NOTIFICATION PREFERENCES ───────────────────────────────────────────────────

router.get('/notifications/preferences', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const prefs = await integrations.getNotificationPreferences(employeeId);
    res.json(prefs);
  } catch (err) {
    console.error('[Integrations] Get prefs error:', err);
    res.status(500).json({ error: 'Failed to get notification preferences' });
  }
});

router.put('/notifications/preferences', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const updated = await integrations.updateNotificationPreferences(employeeId, req.body);
    res.json(updated);
  } catch (err) {
    console.error('[Integrations] Update prefs error:', err);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// ─── WHATSAPP ───────────────────────────────────────────────────────────────────

router.post('/notifications/whatsapp/send', async (req, res) => {
  try {
    const { employeeId, template, params } = req.body;
    if (!employeeId || !template) {
      return res.status(400).json({ error: 'employeeId and template are required' });
    }

    const result = await integrations.sendWhatsAppNotification(employeeId, template, params);
    res.json(result);
  } catch (err) {
    console.error('[Integrations] WhatsApp send error:', err);
    res.status(500).json({ error: 'Failed to send WhatsApp notification' });
  }
});

// ─── CALENDAR ───────────────────────────────────────────────────────────────────

router.get('/calendar/events', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }

    const events = await integrations.getCalendarEvents(employeeId, startDate, endDate);
    res.json(events);
  } catch (err) {
    console.error('[Integrations] Get calendar events error:', err);
    res.status(500).json({ error: 'Failed to get calendar events' });
  }
});

router.post('/calendar/events', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const event = await integrations.createCalendarEvent({
      employeeId,
      ...req.body,
    });
    res.status(201).json(event);
  } catch (err) {
    console.error('[Integrations] Create calendar event error:', err);
    res.status(500).json({ error: 'Failed to create calendar event' });
  }
});

router.get('/calendar/export.ics', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { startDate, endDate } = req.query;
    const start = startDate || new Date().toISOString().split('T')[0];
    const end = endDate || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const events = await integrations.getCalendarEvents(employeeId, start, end);
    const ics = await integrations.generateICSContent(events);

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="lms-events.ics"');
    res.send(ics);
  } catch (err) {
    console.error('[Integrations] Export ICS error:', err);
    res.status(500).json({ error: 'Failed to export calendar' });
  }
});

router.post('/calendar/sync/google', async (req, res) => {
  try {
    const employeeId = req.userId || req.headers['x-employee-id'];
    if (!employeeId) return res.status(401).json({ error: 'Authentication required' });

    const { eventId } = req.body;
    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required' });
    }

    const result = await integrations.syncToGoogleCalendar(employeeId, { id: eventId });
    res.json(result);
  } catch (err) {
    console.error('[Integrations] Google sync error:', err);
    res.status(500).json({ error: 'Failed to sync to Google Calendar' });
  }
});

// ─── INTEGRATION HEALTH ─────────────────────────────────────────────────────────

router.get('/health', async (req, res) => {
  try {
    const health = await integrations.getIntegrationHealth();
    res.json(health);
  } catch (err) {
    console.error('[Integrations] Health check error:', err);
    res.status(500).json({ error: 'Failed to check integration health' });
  }
});

export default router;
