-- World-class LMS Phase 9: evaluator appeals, tamper-evident governance timeline and evidence packs.
-- MySQL 8.x; forward-only and trigger-free.

CREATE TABLE IF NOT EXISTS evaluator_calibration_appeal (
  appeal_id CHAR(36) NOT NULL,
  appeal_code VARCHAR(80) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  category VARCHAR(50) NOT NULL,
  desired_outcome VARCHAR(50) NOT NULL,
  appeal_statement LONGTEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED',
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  appeal_window_ends_at DATETIME(3) NOT NULL,
  sla_due_at DATETIME(3) NOT NULL,
  assigned_reviewer_id VARCHAR(120) NULL,
  assigned_at DATETIME(3) NULL,
  acknowledged_at DATETIME(3) NULL,
  last_information_requested_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  resolved_by VARCHAR(120) NULL,
  resolution_type VARCHAR(50) NULL,
  resolution_summary LONGTEXT NULL,
  recommended_action VARCHAR(50) NULL,
  reassessment_assignment_id CHAR(36) NULL,
  withdrawn_at DATETIME(3) NULL,
  withdrawal_reason LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (appeal_id),
  UNIQUE KEY uq_evaluator_appeal_code (appeal_code),
  UNIQUE KEY uq_evaluator_appeal_assignment (assignment_id),
  KEY idx_evaluator_appeal_owner (evaluator_id, evaluator_type, status, submitted_at),
  KEY idx_evaluator_appeal_scope (branch, process_name, lob_name, status, sla_due_at),
  KEY idx_evaluator_appeal_reviewer (assigned_reviewer_id, status, sla_due_at),
  CONSTRAINT fk_evaluator_appeal_assignment FOREIGN KEY (assignment_id)
    REFERENCES evaluator_calibration_assignment(assignment_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluator_appeal_reassessment FOREIGN KEY (reassessment_assignment_id)
    REFERENCES evaluator_calibration_assignment(assignment_id) ON DELETE SET NULL,
  CONSTRAINT chk_evaluator_appeal_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_evaluator_appeal_category CHECK (category IN ('SCORE_DISAGREEMENT','CRITICAL_FAIL_DISAGREEMENT','EVIDENCE_ACCESS','PROCESS_VIOLATION','OTHER')),
  CONSTRAINT chk_evaluator_appeal_outcome CHECK (desired_outcome IN ('REASSESSMENT','SCORE_REVIEW','CRITICAL_FAIL_REVIEW','PROCESS_REVIEW','OTHER')),
  CONSTRAINT chk_evaluator_appeal_status CHECK (status IN ('SUBMITTED','ACKNOWLEDGED','INFORMATION_REQUESTED','UNDER_REVIEW','RESOLVED','WITHDRAWN','DISMISSED')),
  CONSTRAINT chk_evaluator_appeal_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  CONSTRAINT chk_evaluator_appeal_statement CHECK (CHAR_LENGTH(TRIM(appeal_statement)) >= 40),
  CONSTRAINT chk_evaluator_appeal_window CHECK (appeal_window_ends_at >= submitted_at),
  CONSTRAINT chk_evaluator_appeal_sla CHECK (sla_due_at >= submitted_at),
  CONSTRAINT chk_evaluator_appeal_resolution CHECK (
    (status NOT IN ('RESOLVED','DISMISSED')) OR
    (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_type IS NOT NULL AND CHAR_LENGTH(TRIM(resolution_summary)) >= 40)
  ),
  CONSTRAINT chk_evaluator_appeal_resolution_type CHECK (resolution_type IS NULL OR resolution_type IN ('UPHELD','PARTIALLY_UPHELD','OVERTURNED','PROCEDURAL_REMEDY','NO_ACTION')),
  CONSTRAINT chk_evaluator_appeal_action CHECK (recommended_action IS NULL OR recommended_action IN ('NONE','REASSESSMENT','COACHING','RESTORE_AUTHORIZATION','SUSPEND_AUTHORIZATION','POLICY_REVIEW'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_calibration_appeal_event (
  event_id CHAR(36) NOT NULL,
  appeal_id CHAR(36) NOT NULL,
  sequence_no INT UNSIGNED NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(120) NOT NULL,
  actor_type VARCHAR(30) NOT NULL,
  event_comment LONGTEXT NULL,
  payload_json JSON NULL,
  previous_hash CHAR(64) NULL,
  event_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_evaluator_appeal_event_sequence (appeal_id, sequence_no),
  UNIQUE KEY uq_evaluator_appeal_event_hash (event_hash),
  KEY idx_evaluator_appeal_event_time (appeal_id, created_at),
  CONSTRAINT fk_evaluator_appeal_event_appeal FOREIGN KEY (appeal_id)
    REFERENCES evaluator_calibration_appeal(appeal_id) ON DELETE CASCADE,
  CONSTRAINT chk_evaluator_appeal_event_sequence CHECK (sequence_no >= 1),
  CONSTRAINT chk_evaluator_appeal_event_type CHECK (event_type IN ('SUBMITTED','ACKNOWLEDGED','ASSIGNED','INFORMATION_REQUESTED','INFORMATION_PROVIDED','UNDER_REVIEW','RESOLVED','WITHDRAWN','SLA_BREACHED','PACK_GENERATED')),
  CONSTRAINT chk_evaluator_appeal_event_actor CHECK (actor_type IN ('coordinator','admin','management','system')),
  CONSTRAINT chk_evaluator_appeal_event_previous_hash CHECK (previous_hash IS NULL OR previous_hash REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT chk_evaluator_appeal_event_hash CHECK (event_hash REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_governance_evidence_pack (
  pack_id CHAR(36) NOT NULL,
  pack_code VARCHAR(90) NOT NULL,
  subject_key VARCHAR(120) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  appeal_id CHAR(36) NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  pack_type VARCHAR(40) NOT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  scope_level VARCHAR(20) NOT NULL DEFAULT 'SELF',
  manifest_json JSON NOT NULL,
  manifest_hash CHAR(64) NOT NULL,
  generated_by VARCHAR(120) NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  revoked_by VARCHAR(120) NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason LONGTEXT NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_downloaded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (pack_id),
  UNIQUE KEY uq_evaluator_governance_pack_code (pack_code),
  UNIQUE KEY uq_evaluator_governance_pack_hash (manifest_hash),
  UNIQUE KEY uq_evaluator_governance_pack_version (subject_key, pack_type, version_no),
  KEY idx_evaluator_governance_pack_owner (evaluator_id, evaluator_type, status, generated_at),
  KEY idx_evaluator_governance_pack_appeal (appeal_id, status, generated_at),
  CONSTRAINT fk_evaluator_governance_pack_assignment FOREIGN KEY (assignment_id)
    REFERENCES evaluator_calibration_assignment(assignment_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluator_governance_pack_appeal FOREIGN KEY (appeal_id)
    REFERENCES evaluator_calibration_appeal(appeal_id) ON DELETE SET NULL,
  CONSTRAINT chk_evaluator_governance_pack_type CHECK (pack_type IN ('ASSIGNMENT','APPEAL','COMPLETE_GOVERNANCE')),
  CONSTRAINT chk_evaluator_governance_pack_status CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  CONSTRAINT chk_evaluator_governance_pack_scope CHECK (scope_level IN ('SELF','BRANCH','COMPANY')),
  CONSTRAINT chk_evaluator_governance_pack_version CHECK (version_no >= 1),
  CONSTRAINT chk_evaluator_governance_pack_hash CHECK (manifest_hash REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT chk_evaluator_governance_pack_revocation CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND CHAR_LENGTH(TRIM(revocation_reason)) >= 20))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('calibration.appeal_self', 'Evaluator Quality', 'Raise own calibration appeal', 'Submit and respond to an appeal against the evaluator own finalized calibration result.', 'SENSITIVE'),
  ('calibration.appeal_manage', 'Evaluator Quality', 'Manage calibration appeals', 'Acknowledge, assign, investigate and resolve calibration appeals without mutating original evidence.', 'CRITICAL'),
  ('calibration.evidence_export', 'Evaluator Quality', 'Generate governance evidence packs', 'Generate and download hash-verified calibration and appeal evidence packs.', 'CRITICAL');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'coordinator', '*', 'calibration.appeal_self', 1, 'self', 'migration'),
  (UUID(), 'admin', '*', 'calibration.appeal_self', 1, 'self', 'migration'),
  (UUID(), 'admin', '*', 'calibration.appeal_manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'calibration.evidence_export', 1, 'branch', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.appeal_manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.appeal_manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.evidence_export', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.evidence_export', 1, 'company', 'migration');

INSERT IGNORE INTO notification_template
  (template_id, template_code, event_type, channel, locale,
   subject_template, body_text_template, body_html_template,
   action_url_template, mandatory, version_no, active, created_by)
VALUES
  (UUID(), 'CAL_APPEAL_SUBMITTED_INAPP_V1', 'CALIBRATION_APPEAL_SUBMITTED', 'IN_APP', 'en-IN',
   'Calibration appeal submitted', '{{evaluatorName}} submitted appeal {{appealCode}} for {{programName}}.', NULL,
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_SUBMITTED_EMAIL_V1', 'CALIBRATION_APPEAL_SUBMITTED', 'EMAIL', 'en-IN',
   'Calibration appeal {{appealCode}} requires review', '{{evaluatorName}} submitted a calibration appeal for {{programName}}. SLA due {{slaDueAt}}.',
   '<p><b>{{evaluatorName}}</b> submitted calibration appeal <b>{{appealCode}}</b> for {{programName}}.</p><p>Review SLA: <b>{{slaDueAt}}</b>.</p>',
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration'),

  (UUID(), 'CAL_APPEAL_ACK_INAPP_V1', 'CALIBRATION_APPEAL_ACKNOWLEDGED', 'IN_APP', 'en-IN',
   'Calibration appeal acknowledged', 'Appeal {{appealCode}} has been acknowledged and is under governance review.', NULL,
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_ACK_EMAIL_V1', 'CALIBRATION_APPEAL_ACKNOWLEDGED', 'EMAIL', 'en-IN',
   'Appeal {{appealCode}} acknowledged', 'Your calibration appeal {{appealCode}} has been acknowledged. The governance reviewer is assessing the original evidence.',
   '<p>Your calibration appeal <b>{{appealCode}}</b> has been acknowledged.</p><p>The reviewer is assessing the immutable original scoring and evidence.</p>',
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),

  (UUID(), 'CAL_APPEAL_INFO_INAPP_V1', 'CALIBRATION_APPEAL_INFORMATION_REQUESTED', 'IN_APP', 'en-IN',
   'More information required', 'Appeal {{appealCode}} needs additional information before review can continue.', NULL,
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_INFO_EMAIL_V1', 'CALIBRATION_APPEAL_INFORMATION_REQUESTED', 'EMAIL', 'en-IN',
   'Information required for appeal {{appealCode}}', 'Additional information is required for your calibration appeal {{appealCode}}. Open MCN LMS and respond to the governance request.',
   '<p>Additional information is required for appeal <b>{{appealCode}}</b>.</p><p>Open MCN LMS and respond to the governance request.</p>',
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),

  (UUID(), 'CAL_APPEAL_RESOLVED_INAPP_V1', 'CALIBRATION_APPEAL_RESOLVED', 'IN_APP', 'en-IN',
   'Calibration appeal resolved', 'Appeal {{appealCode}} was resolved as {{resolutionType}}. Recommended action: {{recommendedAction}}.', NULL,
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_RESOLVED_EMAIL_V1', 'CALIBRATION_APPEAL_RESOLVED', 'EMAIL', 'en-IN',
   'Appeal {{appealCode}} resolved · {{resolutionType}}', 'Your calibration appeal {{appealCode}} has been resolved as {{resolutionType}}. Recommended action: {{recommendedAction}}.',
   '<p>Appeal <b>{{appealCode}}</b> has been resolved as <b>{{resolutionType}}</b>.</p><p>Recommended action: <b>{{recommendedAction}}</b>.</p>',
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),

  (UUID(), 'CAL_APPEAL_SLA_INAPP_V1', 'CALIBRATION_APPEAL_SLA_BREACHED', 'IN_APP', 'en-IN',
   'Calibration appeal SLA breached', 'Appeal {{appealCode}} is overdue for governance action.', NULL,
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_SLA_EMAIL_V1', 'CALIBRATION_APPEAL_SLA_BREACHED', 'EMAIL', 'en-IN',
   'SLA breached: calibration appeal {{appealCode}}', 'Calibration appeal {{appealCode}} for {{evaluatorName}} is overdue. Review and record the next governance action.',
   '<p>Calibration appeal <b>{{appealCode}}</b> for <b>{{evaluatorName}}</b> is overdue.</p><p>Review and record the next governance action immediately.</p>',
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration'),

  (UUID(), 'CAL_PACK_READY_INAPP_V1', 'CALIBRATION_EVIDENCE_PACK_READY', 'IN_APP', 'en-IN',
   'Governance evidence pack ready', 'Evidence pack {{packCode}} is ready for {{programName}}.', NULL,
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_PACK_READY_EMAIL_V1', 'CALIBRATION_EVIDENCE_PACK_READY', 'EMAIL', 'en-IN',
   'Evidence pack {{packCode}} is ready', 'The hash-verified governance evidence pack {{packCode}} for {{programName}} is ready in MCN LMS.',
   '<p>Evidence pack <b>{{packCode}}</b> for <b>{{programName}}</b> is ready.</p><p>The pack contains a tamper-evident manifest and audit timeline.</p>',
   '/evaluator-quality?role={{recipientType}}', 1, 1, 1, 'migration');
