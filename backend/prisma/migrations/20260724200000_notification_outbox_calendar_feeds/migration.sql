-- World-class LMS Phase 5: durable notifications, escalation and calendar feeds.
-- MySQL 8.x, forward-only, idempotent DDL.

CREATE TABLE IF NOT EXISTS notification_event (
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(160) NOT NULL,
  actor_id VARCHAR(120) NULL,
  actor_type VARCHAR(40) NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  payload_json JSON NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'NEW',
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  processed_at DATETIME(3) NULL,
  error_details TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_notification_event_idempotency (idempotency_key),
  KEY idx_notification_event_worker (status, occurred_at),
  KEY idx_notification_event_entity (entity_type, entity_id, occurred_at),
  KEY idx_notification_event_scope (branch, process_name, lob_name, event_type),
  CONSTRAINT chk_notification_event_status CHECK (status IN ('NEW','PROCESSING','PROCESSED','FAILED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_template (
  template_id CHAR(36) NOT NULL,
  template_code VARCHAR(120) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  locale VARCHAR(20) NOT NULL DEFAULT 'en-IN',
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  subject_template VARCHAR(500) NULL,
  body_text_template LONGTEXT NOT NULL,
  body_html_template LONGTEXT NULL,
  action_url_template VARCHAR(1000) NULL,
  mandatory TINYINT(1) NOT NULL DEFAULT 0,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_id),
  UNIQUE KEY uq_notification_template_code_version (template_code, version_no),
  KEY idx_notification_template_resolve (event_type, channel, locale, branch, process_name, lob_name, active),
  CONSTRAINT chk_notification_template_channel CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_preference (
  preference_id CHAR(36) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(100) NOT NULL DEFAULT '*',
  channel VARCHAR(30) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  digest_mode VARCHAR(30) NOT NULL DEFAULT 'IMMEDIATE',
  quiet_start TIME NULL,
  quiet_end TIME NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  updated_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (preference_id),
  UNIQUE KEY uq_notification_preference (user_type, user_id, event_type, channel),
  KEY idx_notification_preference_user (user_type, user_id, enabled),
  CONSTRAINT chk_notification_preference_channel CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  CONSTRAINT chk_notification_digest CHECK (digest_mode IN ('IMMEDIATE','DAILY','WEEKLY','OFF'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_outbox (
  outbox_id CHAR(36) NOT NULL,
  event_id CHAR(36) NOT NULL,
  recipient_type VARCHAR(30) NOT NULL,
  recipient_id VARCHAR(120) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  recipient_address VARCHAR(500) NULL,
  template_id CHAR(36) NULL,
  title VARCHAR(500) NULL,
  body_text LONGTEXT NOT NULL,
  body_html LONGTEXT NULL,
  action_url VARCHAR(1000) NULL,
  payload_json JSON NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  idempotency_key VARCHAR(255) NOT NULL,
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 5,
  next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_attempt_at DATETIME(3) NULL,
  sent_at DATETIME(3) NULL,
  provider_message_id VARCHAR(255) NULL,
  last_error TEXT NULL,
  locked_by VARCHAR(120) NULL,
  locked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (outbox_id),
  UNIQUE KEY uq_notification_outbox_idempotency (idempotency_key),
  KEY idx_notification_outbox_worker (status, next_attempt_at, priority, created_at),
  KEY idx_notification_outbox_recipient (recipient_type, recipient_id, created_at),
  KEY idx_notification_outbox_event (event_id, status),
  CONSTRAINT fk_notification_outbox_event FOREIGN KEY (event_id)
    REFERENCES notification_event(event_id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_outbox_template FOREIGN KEY (template_id)
    REFERENCES notification_template(template_id) ON DELETE SET NULL,
  CONSTRAINT chk_notification_outbox_channel CHECK (channel IN ('IN_APP','EMAIL','SMS','WHATSAPP')),
  CONSTRAINT chk_notification_outbox_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  CONSTRAINT chk_notification_outbox_status CHECK (status IN ('PENDING','PROCESSING','RETRY','SENT','FAILED','CANCELLED')),
  CONSTRAINT chk_notification_outbox_attempts CHECK (max_attempts BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_inbox (
  inbox_id CHAR(36) NOT NULL,
  outbox_id CHAR(36) NULL,
  user_type VARCHAR(30) NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  body_text LONGTEXT NOT NULL,
  action_url VARCHAR(1000) NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  idempotency_key VARCHAR(255) NOT NULL,
  read_at DATETIME(3) NULL,
  archived_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (inbox_id),
  UNIQUE KEY uq_notification_inbox_idempotency (idempotency_key),
  KEY idx_notification_inbox_unread (user_type, user_id, read_at, archived_at, created_at),
  KEY idx_notification_inbox_event (event_type, created_at),
  CONSTRAINT fk_notification_inbox_outbox FOREIGN KEY (outbox_id)
    REFERENCES notification_outbox(outbox_id) ON DELETE SET NULL,
  CONSTRAINT chk_notification_inbox_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_escalation_rule (
  rule_id CHAR(36) NOT NULL,
  rule_code VARCHAR(120) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  trigger_after_minutes INT UNSIGNED NOT NULL,
  repeat_every_minutes INT UNSIGNED NULL,
  max_escalations INT UNSIGNED NOT NULL DEFAULT 1,
  target_type VARCHAR(40) NOT NULL,
  target_value VARCHAR(2000) NULL,
  channels_json JSON NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'HIGH',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_notification_escalation_rule (rule_code),
  KEY idx_notification_escalation_resolve (event_type, branch, process_name, lob_name, active),
  CONSTRAINT chk_notification_escalation_target CHECK (target_type IN ('EVENT_OWNER','BATCH_COORDINATOR','BRANCH_ADMINS','EXPLICIT_RECIPIENTS')),
  CONSTRAINT chk_notification_escalation_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  CONSTRAINT chk_notification_escalation_count CHECK (max_escalations BETWEEN 1 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_escalation_instance (
  instance_id CHAR(36) NOT NULL,
  rule_id CHAR(36) NOT NULL,
  source_event_id CHAR(36) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(160) NOT NULL,
  escalation_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  due_at DATETIME(3) NOT NULL,
  sent_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  resolution_note TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instance_id),
  UNIQUE KEY uq_notification_escalation_instance (rule_id, source_event_id, escalation_no),
  KEY idx_notification_escalation_due (status, due_at),
  CONSTRAINT fk_notification_escalation_rule FOREIGN KEY (rule_id)
    REFERENCES notification_escalation_rule(rule_id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_escalation_event FOREIGN KEY (source_event_id)
    REFERENCES notification_event(event_id) ON DELETE CASCADE,
  CONSTRAINT chk_notification_escalation_status CHECK (status IN ('PENDING','SENT','RESOLVED','CANCELLED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_feed_token (
  token_id CHAR(36) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  token_prefix VARCHAR(16) NOT NULL,
  feed_scope VARCHAR(30) NOT NULL DEFAULT 'SELF',
  branch VARCHAR(120) NOT NULL DEFAULT '',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  label VARCHAR(120) NOT NULL DEFAULT 'MCN LMS Calendar',
  expires_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  last_used_at DATETIME(3) NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token_id),
  UNIQUE KEY uq_calendar_feed_token_hash (token_hash),
  KEY idx_calendar_feed_user (user_type, user_id, revoked_at, expires_at),
  CONSTRAINT chk_calendar_feed_scope CHECK (feed_scope IN ('SELF','OWN_BATCH','BRANCH','COMPANY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calendar_feed_access_log (
  access_id CHAR(36) NOT NULL,
  token_id CHAR(36) NOT NULL,
  requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ip_hash CHAR(64) NULL,
  user_agent_hash CHAR(64) NULL,
  event_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'SUCCESS',
  error_details TEXT NULL,
  PRIMARY KEY (access_id),
  KEY idx_calendar_feed_access (token_id, requested_at),
  CONSTRAINT fk_calendar_feed_access_token FOREIGN KEY (token_id)
    REFERENCES calendar_feed_token(token_id) ON DELETE CASCADE,
  CONSTRAINT chk_calendar_feed_access_status CHECK (status IN ('SUCCESS','DENIED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meeting_provider_config (
  provider_config_id CHAR(36) NOT NULL,
  provider VARCHAR(30) NOT NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  display_name VARCHAR(120) NOT NULL,
  credential_source VARCHAR(30) NOT NULL DEFAULT 'ENVIRONMENT',
  organizer_user_id VARCHAR(240) NULL,
  default_timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  auto_create_for_virtual TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON NULL,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider_config_id),
  UNIQUE KEY uq_meeting_provider_scope (provider, branch),
  KEY idx_meeting_provider_active (branch, active),
  CONSTRAINT chk_meeting_provider CHECK (provider IN ('MANUAL','GOOGLE_MEET','MICROSOFT_TEAMS','CUSTOM_WEBHOOK')),
  CONSTRAINT chk_meeting_credential_source CHECK (credential_source IN ('ENVIRONMENT','OAUTH_CONNECTION','NONE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permission_master
  (permission_key, module_name, action_name, description, risk_level, active)
VALUES
  ('notify.view_self', 'Notifications', 'View own notifications', 'View and manage personal in-app notifications and preferences.', 'STANDARD', 1),
  ('notify.manage_scope', 'Notifications', 'Manage scoped notifications', 'View delivery health and resend notifications within assigned data scope.', 'ELEVATED', 1),
  ('notify.configure', 'Notifications', 'Configure notification governance', 'Manage templates, escalation rules, channels and provider policy.', 'HIGH', 1),
  ('notify.audit', 'Notifications', 'Audit deliveries', 'Review events, delivery attempts, failures and escalation history.', 'HIGH', 1),
  ('calendar.feed_self', 'Calendar', 'Manage own calendar feed', 'Create and revoke personal LMS calendar feed tokens.', 'STANDARD', 1),
  ('calendar.manage_scope', 'Calendar', 'Manage scoped calendar feeds', 'Manage calendar feed governance and provider configuration in assigned scope.', 'HIGH', 1)
ON DUPLICATE KEY UPDATE
  module_name = VALUES(module_name), action_name = VALUES(action_name),
  description = VALUES(description), risk_level = VALUES(risk_level), active = VALUES(active);

INSERT INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'trainee', '*', 'notify.view_self', 1, 'self', 'phase5-migration'),
  (UUID(), 'trainee', '*', 'calendar.feed_self', 1, 'self', 'phase5-migration'),
  (UUID(), 'coordinator', '*', 'notify.view_self', 1, 'self', 'phase5-migration'),
  (UUID(), 'coordinator', '*', 'notify.manage_scope', 1, 'own_batch', 'phase5-migration'),
  (UUID(), 'coordinator', '*', 'notify.audit', 1, 'own_batch', 'phase5-migration'),
  (UUID(), 'coordinator', '*', 'calendar.feed_self', 1, 'own_batch', 'phase5-migration'),
  (UUID(), 'admin', '*', 'notify.view_self', 1, 'self', 'phase5-migration'),
  (UUID(), 'admin', '*', 'notify.manage_scope', 1, 'branch', 'phase5-migration'),
  (UUID(), 'admin', '*', 'notify.audit', 1, 'branch', 'phase5-migration'),
  (UUID(), 'admin', '*', 'calendar.feed_self', 1, 'branch', 'phase5-migration'),
  (UUID(), 'admin', 'Admin', 'notify.configure', 1, 'branch', 'phase5-migration'),
  (UUID(), 'admin', 'Admin', 'calendar.manage_scope', 1, 'branch', 'phase5-migration'),
  (UUID(), 'admin', 'Super Admin', 'notify.configure', 1, 'company', 'phase5-migration'),
  (UUID(), 'admin', 'Super Admin', 'calendar.manage_scope', 1, 'company', 'phase5-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'notify.configure', 1, 'company', 'phase5-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calendar.manage_scope', 1, 'company', 'phase5-migration'),
  (UUID(), 'admin', 'CEO', 'notify.configure', 1, 'company', 'phase5-migration'),
  (UUID(), 'admin', 'CEO', 'calendar.manage_scope', 1, 'company', 'phase5-migration')
ON DUPLICATE KEY UPDATE allowed = VALUES(allowed), data_scope = VALUES(data_scope), created_by = VALUES(created_by);

INSERT INTO notification_template
  (template_id, template_code, event_type, channel, subject_template,
   body_text_template, body_html_template, action_url_template, mandatory, created_by)
VALUES
  (UUID(), 'ILT_ENROLLMENT_CONFIRMED_IN_APP', 'ILT_ENROLLMENT_CONFIRMED', 'IN_APP', 'Seat confirmed: {{sessionTitle}}',
   'Your seat is confirmed for {{sessionTitle}} on {{startAt}}.', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_ENROLLMENT_CONFIRMED_EMAIL', 'ILT_ENROLLMENT_CONFIRMED', 'EMAIL', 'Training seat confirmed — {{sessionTitle}}',
   'Your seat is confirmed for {{sessionTitle}} on {{startAt}}. Session code: {{sessionCode}}.',
   '<p>Hi <b>{{traineeName}}</b>,</p><p>Your seat is confirmed for <b>{{sessionTitle}}</b> on <b>{{startAt}}</b>.</p><p>Session code: {{sessionCode}}</p>',
   '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_WAITLISTED_IN_APP', 'ILT_WAITLISTED', 'IN_APP', 'Waitlisted: {{sessionTitle}}',
   'You are waitlisted at position {{waitlistPosition}} for {{sessionTitle}}.', NULL, '/training-calendar?role=trainee', 0, 'phase5-migration'),
  (UUID(), 'ILT_WAITLIST_PROMOTED_IN_APP', 'ILT_WAITLIST_PROMOTED', 'IN_APP', 'A seat opened for {{sessionTitle}}',
   'You were promoted from the waitlist and your seat is now confirmed.', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_REMINDER_24H_IN_APP', 'ILT_REMINDER_24H', 'IN_APP', 'Training tomorrow: {{sessionTitle}}',
   '{{sessionTitle}} starts at {{startAt}}. Complete any prerequisites and arrive on time.', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_REMINDER_2H_IN_APP', 'ILT_REMINDER_2H', 'IN_APP', 'Training starts soon: {{sessionTitle}}',
   '{{sessionTitle}} starts at {{startAt}}. Check-in opens shortly.', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_SESSION_CANCELLED_IN_APP', 'ILT_SESSION_CANCELLED', 'IN_APP', 'Training cancelled: {{sessionTitle}}',
   '{{sessionTitle}} was cancelled. Reason: {{cancellationReason}}', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'ILT_NO_SHOW_IN_APP', 'ILT_NO_SHOW', 'IN_APP', 'Attendance not completed: {{sessionTitle}}',
   'Your attendance for {{sessionTitle}} did not meet the minimum requirement.', NULL, '/training-calendar?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'CERT_RENEWAL_DUE_IN_APP', 'CERT_RENEWAL_DUE', 'IN_APP', 'Certification renewal due',
   '{{certificationType}} renewal is due on {{dueAt}}. {{blockerReason}}', NULL, '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'CERT_RENEWAL_OVERDUE_IN_APP', 'CERT_RENEWAL_OVERDUE', 'IN_APP', 'Certification renewal overdue',
   '{{certificationType}} is overdue since {{dueAt}}. Immediate action is required.', NULL, '/development-hub?role=trainee', 1, 'phase5-migration'),
  (UUID(), 'COACHING_SESSION_REMINDER_IN_APP', 'COACHING_SESSION_REMINDER', 'IN_APP', 'Coaching conversation scheduled',
   'Your coaching session is scheduled for {{scheduledAt}}. Review your goals before joining.', NULL, '/development-hub?role=trainee', 0, 'phase5-migration')
ON DUPLICATE KEY UPDATE
  event_type = VALUES(event_type), channel = VALUES(channel), subject_template = VALUES(subject_template),
  body_text_template = VALUES(body_text_template), body_html_template = VALUES(body_html_template),
  action_url_template = VALUES(action_url_template), mandatory = VALUES(mandatory), active = 1;
