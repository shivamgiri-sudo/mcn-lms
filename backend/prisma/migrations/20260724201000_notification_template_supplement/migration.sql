-- Phase 5 notification template and escalation supplements.

INSERT INTO notification_template
  (template_id, template_code, event_type, channel, subject_template,
   body_text_template, body_html_template, action_url_template, mandatory, created_by)
VALUES
  (UUID(), 'COACHING_SESSION_SCHEDULED_IN_APP', 'COACHING_SESSION_SCHEDULED', 'IN_APP', 'Coaching session scheduled',
   'A coaching conversation for {{planTitle}} is scheduled on {{scheduledAt}}.', NULL,
   '/development-hub?role=trainee', 0, 'phase5-migration'),
  (UUID(), 'COACHING_SESSION_REMINDER_EMAIL', 'COACHING_SESSION_REMINDER', 'EMAIL', 'Coaching reminder — {{scheduledAt}}',
   'Your coaching conversation for {{planTitle}} is scheduled on {{scheduledAt}}.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>Your coaching conversation for <b>{{planTitle}}</b> is scheduled on <b>{{scheduledAt}}</b>.</p><p>Please review your goals and commitments before joining.</p>',
   '/development-hub?role=trainee', 0, 'phase5-migration'),
  (UUID(), 'CERT_RENEWED_IN_APP', 'CERT_RENEWED', 'IN_APP', 'Certification renewed',
   '{{certificationType}} was renewed successfully. New credential: {{credentialNumber}}.', NULL,
   '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'CERT_RENEWED_EMAIL', 'CERT_RENEWED', 'EMAIL', 'Certification renewed — {{credentialNumber}}',
   'Your {{certificationType}} credential {{credentialNumber}} is active until {{expiresAt}}.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>Your <b>{{certificationType}}</b> was renewed successfully.</p><p>Credential: <b>{{credentialNumber}}</b><br/>Valid until: <b>{{expiresAt}}</b></p>',
   '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_REMINDER_24H_EMAIL', 'ILT_REMINDER_24H', 'EMAIL', 'Training tomorrow — {{sessionTitle}}',
   '{{sessionTitle}} starts on {{startAt}}. Complete prerequisites and arrive on time.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p><b>{{sessionTitle}}</b> starts on <b>{{startAt}}</b>.</p><p>Session code: {{sessionCode}}<br/>Venue: {{venueName}}</p>',
   '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_REMINDER_2H_EMAIL', 'ILT_REMINDER_2H', 'EMAIL', 'Training starts soon — {{sessionTitle}}',
   '{{sessionTitle}} starts on {{startAt}}. Check-in opens shortly.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p><b>{{sessionTitle}}</b> starts soon at <b>{{startAt}}</b>.</p><p>Open the training calendar for check-in and joining details.</p>',
   '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_WAITLIST_PROMOTED_EMAIL', 'ILT_WAITLIST_PROMOTED', 'EMAIL', 'Seat confirmed — {{sessionTitle}}',
   'A seat opened and your enrolment for {{sessionTitle}} is now confirmed.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>A seat opened and you have been promoted from the waitlist for <b>{{sessionTitle}}</b>.</p><p>Start: {{startAt}}</p>',
   '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_SESSION_CANCELLED_EMAIL', 'ILT_SESSION_CANCELLED', 'EMAIL', 'Training cancelled — {{sessionTitle}}',
   '{{sessionTitle}} was cancelled. Reason: {{cancellationReason}}',
   '<p>Hi <b>{{traineeName}}</b>,</p><p><b>{{sessionTitle}}</b> has been cancelled.</p><p>Reason: {{cancellationReason}}</p>',
   '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'CERT_RENEWAL_DUE_EMAIL', 'CERT_RENEWAL_DUE', 'EMAIL', 'Certification renewal due — {{dueAt}}',
   '{{certificationType}} renewal is due on {{dueAt}}. {{blockerReason}}',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>Your <b>{{certificationType}}</b> renewal is due on <b>{{dueAt}}</b>.</p><p>{{blockerReason}}</p>',
   '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'CERT_RENEWAL_OVERDUE_EMAIL', 'CERT_RENEWAL_OVERDUE', 'EMAIL', 'Certification renewal overdue',
   '{{certificationType}} renewal is overdue since {{dueAt}}. Immediate action is required.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>Your <b>{{certificationType}}</b> renewal is overdue since <b>{{dueAt}}</b>.</p><p>Immediate action is required.</p>',
   '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ESCALATION_ALERT_IN_APP', 'ESCALATION_ALERT', 'IN_APP', 'Escalation: {{sourceEventType}}',
   '{{message}}', NULL, '{{actionUrl}}', 1, 'phase5-migration'),
  (UUID(), 'ESCALATION_ALERT_EMAIL', 'ESCALATION_ALERT', 'EMAIL', 'LMS escalation — {{sourceEventType}}',
   '{{message}}', '<p><b>LMS escalation</b></p><p>{{message}}</p>', '{{actionUrl}}', 1, 'phase5-migration')
ON DUPLICATE KEY UPDATE
  event_type = VALUES(event_type), channel = VALUES(channel), subject_template = VALUES(subject_template),
  body_text_template = VALUES(body_text_template), body_html_template = VALUES(body_html_template),
  action_url_template = VALUES(action_url_template), mandatory = VALUES(mandatory), active = 1;

INSERT INTO notification_escalation_rule
  (rule_id, rule_code, event_type, trigger_after_minutes, repeat_every_minutes,
   max_escalations, target_type, target_value, channels_json, priority, active, created_by)
VALUES
  (UUID(), 'ILT_NO_SHOW_TO_BATCH_COORDINATOR', 'ILT_NO_SHOW', 5, NULL, 1,
   'BATCH_COORDINATOR', NULL, JSON_ARRAY('IN_APP','EMAIL'), 'HIGH', 1, 'phase5-migration'),
  (UUID(), 'CERT_OVERDUE_TO_BATCH_COORDINATOR', 'CERT_RENEWAL_OVERDUE', 60, 10080, 4,
   'BATCH_COORDINATOR', NULL, JSON_ARRAY('IN_APP','EMAIL'), 'CRITICAL', 1, 'phase5-migration')
ON DUPLICATE KEY UPDATE
  trigger_after_minutes = VALUES(trigger_after_minutes), repeat_every_minutes = VALUES(repeat_every_minutes),
  max_escalations = VALUES(max_escalations), target_type = VALUES(target_type),
  channels_json = VALUES(channels_json), priority = VALUES(priority), active = 1;
