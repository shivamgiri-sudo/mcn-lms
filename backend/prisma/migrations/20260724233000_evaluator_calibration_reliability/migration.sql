-- World-class LMS Phase 7: evaluator calibration, authorization and inter-rater reliability.
-- MySQL 8.x; forward-only, trigger-free and compatible with Prisma Migrate.

CREATE TABLE IF NOT EXISTS evaluator_calibration_program (
  program_id CHAR(36) NOT NULL,
  program_code VARCHAR(100) NOT NULL,
  program_name VARCHAR(220) NOT NULL,
  template_id CHAR(36) NOT NULL,
  description LONGTEXT NULL,
  evaluator_instructions LONGTEXT NULL,
  audience_branch VARCHAR(120) NOT NULL DEFAULT '',
  audience_process VARCHAR(120) NOT NULL DEFAULT '',
  audience_lob VARCHAR(120) NOT NULL DEFAULT '',
  passing_pct DECIMAL(6,2) NOT NULL DEFAULT 85.00,
  min_anchor_cases INT UNSIGNED NOT NULL DEFAULT 2,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
  authorization_valid_days INT UNSIGNED NOT NULL DEFAULT 180,
  default_score_tolerance DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  minimum_agreement_pct DECIMAL(6,2) NOT NULL DEFAULT 80.00,
  maximum_severity_index DECIMAL(6,2) NOT NULL DEFAULT 8.00,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  published_by VARCHAR(120) NULL,
  published_at DATETIME(3) NULL,
  closed_by VARCHAR(120) NULL,
  closed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (program_id),
  UNIQUE KEY uq_calibration_program_code (program_code),
  UNIQUE KEY uq_calibration_program_template_active (template_id, active),
  KEY idx_calibration_program_scope (audience_branch, audience_process, audience_lob, status),
  CONSTRAINT fk_calibration_program_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT chk_calibration_program_pass CHECK (passing_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_program_anchors CHECK (min_anchor_cases BETWEEN 1 AND 100),
  CONSTRAINT chk_calibration_program_attempts CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT chk_calibration_program_validity CHECK (authorization_valid_days BETWEEN 1 AND 3650),
  CONSTRAINT chk_calibration_program_tolerance CHECK (default_score_tolerance >= 0),
  CONSTRAINT chk_calibration_program_agreement CHECK (minimum_agreement_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_program_severity CHECK (maximum_severity_index BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_program_status CHECK (status IN ('DRAFT','PUBLISHED','CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_calibration_anchor (
  anchor_id CHAR(36) NOT NULL,
  program_id CHAR(36) NOT NULL,
  anchor_code VARCHAR(100) NOT NULL,
  anchor_title VARCHAR(240) NOT NULL,
  scenario_description LONGTEXT NOT NULL,
  evidence_reference VARCHAR(500) NULL,
  evidence_url TEXT NULL,
  evaluator_notes LONGTEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (anchor_id),
  UNIQUE KEY uq_calibration_anchor_code (program_id, anchor_code),
  UNIQUE KEY uq_calibration_anchor_order (program_id, sort_order),
  KEY idx_calibration_anchor_program (program_id, active, sort_order),
  CONSTRAINT fk_calibration_anchor_program FOREIGN KEY (program_id)
    REFERENCES evaluator_calibration_program(program_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_calibration_expected_score (
  expected_score_id CHAR(36) NOT NULL,
  anchor_id CHAR(36) NOT NULL,
  criterion_id CHAR(36) NOT NULL,
  expected_score DECIMAL(8,2) NOT NULL,
  tolerance DECIMAL(8,2) NOT NULL,
  expected_critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  rationale LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (expected_score_id),
  UNIQUE KEY uq_calibration_expected_criterion (anchor_id, criterion_id),
  KEY idx_calibration_expected_anchor (anchor_id),
  KEY idx_calibration_expected_criterion (criterion_id),
  CONSTRAINT fk_calibration_expected_anchor FOREIGN KEY (anchor_id)
    REFERENCES evaluator_calibration_anchor(anchor_id) ON DELETE CASCADE,
  CONSTRAINT fk_calibration_expected_criterion FOREIGN KEY (criterion_id)
    REFERENCES practical_rubric_criterion(criterion_id) ON DELETE RESTRICT,
  CONSTRAINT chk_calibration_expected_score CHECK (expected_score >= 0),
  CONSTRAINT chk_calibration_expected_tolerance CHECK (tolerance >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_calibration_assignment (
  assignment_id CHAR(36) NOT NULL,
  program_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED',
  assigned_by VARCHAR(120) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  submitted_at DATETIME(3) NULL,
  score_pct DECIMAL(6,2) NULL,
  mean_absolute_deviation DECIMAL(8,2) NULL,
  agreement_pct DECIMAL(6,2) NULL,
  critical_agreement_pct DECIMAL(6,2) NULL,
  result VARCHAR(20) NULL,
  certified_at DATETIME(3) NULL,
  valid_until DATETIME(3) NULL,
  finalized_by VARCHAR(120) NULL,
  cancellation_reason LONGTEXT NULL,
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (assignment_id),
  UNIQUE KEY uq_calibration_assignment_attempt (program_id, evaluator_id, evaluator_type, attempt_no),
  KEY idx_calibration_assignment_evaluator (evaluator_id, evaluator_type, status, due_at),
  KEY idx_calibration_assignment_program (program_id, status, assigned_at),
  CONSTRAINT fk_calibration_assignment_program FOREIGN KEY (program_id)
    REFERENCES evaluator_calibration_program(program_id) ON DELETE RESTRICT,
  CONSTRAINT chk_calibration_assignment_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_calibration_assignment_attempt CHECK (attempt_no BETWEEN 1 AND 20),
  CONSTRAINT chk_calibration_assignment_status CHECK (status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','PASSED','FAILED','EXPIRED','CANCELLED')),
  CONSTRAINT chk_calibration_assignment_score CHECK (score_pct IS NULL OR score_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_assignment_agreement CHECK (agreement_pct IS NULL OR agreement_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_assignment_critical_agreement CHECK (critical_agreement_pct IS NULL OR critical_agreement_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_calibration_assignment_result CHECK (result IS NULL OR result IN ('PASS','FAIL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_calibration_response (
  response_id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  anchor_id CHAR(36) NOT NULL,
  criterion_id CHAR(36) NOT NULL,
  submitted_score DECIMAL(8,2) NOT NULL,
  expected_score DECIMAL(8,2) NOT NULL,
  tolerance DECIMAL(8,2) NOT NULL,
  absolute_deviation DECIMAL(8,2) NOT NULL,
  within_tolerance TINYINT(1) NOT NULL DEFAULT 0,
  submitted_critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  expected_critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  critical_agreement TINYINT(1) NOT NULL DEFAULT 0,
  evaluator_observation LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (response_id),
  UNIQUE KEY uq_calibration_response (assignment_id, anchor_id, criterion_id),
  KEY idx_calibration_response_assignment (assignment_id, within_tolerance),
  KEY idx_calibration_response_criterion (criterion_id),
  CONSTRAINT fk_calibration_response_assignment FOREIGN KEY (assignment_id)
    REFERENCES evaluator_calibration_assignment(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_calibration_response_anchor FOREIGN KEY (anchor_id)
    REFERENCES evaluator_calibration_anchor(anchor_id) ON DELETE RESTRICT,
  CONSTRAINT fk_calibration_response_criterion FOREIGN KEY (criterion_id)
    REFERENCES practical_rubric_criterion(criterion_id) ON DELETE RESTRICT,
  CONSTRAINT chk_calibration_response_score CHECK (submitted_score >= 0),
  CONSTRAINT chk_calibration_response_expected CHECK (expected_score >= 0),
  CONSTRAINT chk_calibration_response_tolerance CHECK (tolerance >= 0),
  CONSTRAINT chk_calibration_response_deviation CHECK (absolute_deviation >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_authorization (
  authorization_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  template_id CHAR(36) NOT NULL,
  program_id CHAR(36) NOT NULL,
  calibration_assignment_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  calibration_score_pct DECIMAL(6,2) NULL,
  authorized_by VARCHAR(120) NOT NULL,
  authorized_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  valid_until DATETIME(3) NOT NULL,
  suspended_by VARCHAR(120) NULL,
  suspended_at DATETIME(3) NULL,
  suspension_reason LONGTEXT NULL,
  revoked_by VARCHAR(120) NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (authorization_id),
  UNIQUE KEY uq_evaluator_authorization (evaluator_id, evaluator_type, template_id),
  KEY idx_evaluator_authorization_status (status, valid_until),
  KEY idx_evaluator_authorization_template (template_id, status, valid_until),
  CONSTRAINT fk_evaluator_authorization_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluator_authorization_program FOREIGN KEY (program_id)
    REFERENCES evaluator_calibration_program(program_id) ON DELETE RESTRICT,
  CONSTRAINT fk_evaluator_authorization_assignment FOREIGN KEY (calibration_assignment_id)
    REFERENCES evaluator_calibration_assignment(assignment_id) ON DELETE SET NULL,
  CONSTRAINT chk_evaluator_authorization_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_evaluator_authorization_status CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED','REVOKED')),
  CONSTRAINT chk_evaluator_authorization_score CHECK (calibration_score_pct IS NULL OR calibration_score_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_reliability_snapshot (
  snapshot_id CHAR(36) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  template_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  evaluation_count INT UNSIGNED NOT NULL DEFAULT 0,
  paired_evaluation_count INT UNSIGNED NOT NULL DEFAULT 0,
  average_score_pct DECIMAL(6,2) NULL,
  template_average_score_pct DECIMAL(6,2) NULL,
  mean_absolute_difference DECIMAL(8,2) NULL,
  agreement_within_five_pct DECIMAL(6,2) NULL,
  critical_agreement_pct DECIMAL(6,2) NULL,
  moderation_rate_pct DECIMAL(6,2) NULL,
  severity_index DECIMAL(6,2) NULL,
  reliability_status VARCHAR(30) NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  bias_flag TINYINT(1) NOT NULL DEFAULT 0,
  calculated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  calculated_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (snapshot_id),
  UNIQUE KEY uq_evaluator_reliability_period (period_start, period_end, template_id, evaluator_id, evaluator_type),
  KEY idx_evaluator_reliability_status (reliability_status, bias_flag, period_end),
  KEY idx_evaluator_reliability_template (template_id, period_end),
  CONSTRAINT fk_evaluator_reliability_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT chk_evaluator_reliability_period CHECK (period_end >= period_start),
  CONSTRAINT chk_evaluator_reliability_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_evaluator_reliability_agreement CHECK (agreement_within_five_pct IS NULL OR agreement_within_five_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_evaluator_reliability_critical CHECK (critical_agreement_pct IS NULL OR critical_agreement_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_evaluator_reliability_moderation CHECK (moderation_rate_pct IS NULL OR moderation_rate_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_evaluator_reliability_status CHECK (reliability_status IN ('RELIABLE','WATCH','RECALIBRATION_REQUIRED','INSUFFICIENT_DATA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_reliability_pair (
  pair_id CHAR(36) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  template_id CHAR(36) NOT NULL,
  evaluator_a_id VARCHAR(120) NOT NULL,
  evaluator_a_type VARCHAR(30) NOT NULL,
  evaluator_b_id VARCHAR(120) NOT NULL,
  evaluator_b_type VARCHAR(30) NOT NULL,
  paired_count INT UNSIGNED NOT NULL DEFAULT 0,
  mean_absolute_difference DECIMAL(8,2) NULL,
  agreement_within_five_pct DECIMAL(6,2) NULL,
  critical_agreement_pct DECIMAL(6,2) NULL,
  moderation_rate_pct DECIMAL(6,2) NULL,
  calculated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (pair_id),
  UNIQUE KEY uq_evaluator_reliability_pair (period_start, period_end, template_id, evaluator_a_id, evaluator_a_type, evaluator_b_id, evaluator_b_type),
  KEY idx_evaluator_pair_template (template_id, period_end),
  CONSTRAINT fk_evaluator_pair_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT chk_evaluator_pair_period CHECK (period_end >= period_start),
  CONSTRAINT chk_evaluator_pair_types CHECK (evaluator_a_type IN ('coordinator','admin','management') AND evaluator_b_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_evaluator_pair_distinct CHECK (evaluator_a_id <> evaluator_b_id OR evaluator_a_type <> evaluator_b_type),
  CONSTRAINT chk_evaluator_pair_agreement CHECK (agreement_within_five_pct IS NULL OR agreement_within_five_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_evaluator_pair_critical CHECK (critical_agreement_pct IS NULL OR critical_agreement_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_evaluator_pair_moderation CHECK (moderation_rate_pct IS NULL OR moderation_rate_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS evaluator_quality_action (
  action_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  template_id CHAR(36) NULL,
  source_snapshot_id CHAR(36) NULL,
  action_type VARCHAR(40) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  reason LONGTEXT NOT NULL,
  assigned_by VARCHAR(120) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  completed_by VARCHAR(120) NULL,
  completed_at DATETIME(3) NULL,
  completion_notes LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (action_id),
  KEY idx_evaluator_quality_action_owner (evaluator_id, evaluator_type, status, due_at),
  KEY idx_evaluator_quality_action_scope (template_id, status, priority),
  CONSTRAINT fk_evaluator_quality_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE SET NULL,
  CONSTRAINT fk_evaluator_quality_snapshot FOREIGN KEY (source_snapshot_id)
    REFERENCES evaluator_reliability_snapshot(snapshot_id) ON DELETE SET NULL,
  CONSTRAINT chk_evaluator_quality_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_evaluator_quality_action CHECK (action_type IN ('COACHING','RECALIBRATION','SUSPEND_AUTHORIZATION','RESTORE_AUTHORIZATION','MONITOR')),
  CONSTRAINT chk_evaluator_quality_priority CHECK (priority IN ('LOW','NORMAL','HIGH','CRITICAL')),
  CONSTRAINT chk_evaluator_quality_status CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('calibration.view_self', 'Evaluator Quality', 'View own calibration', 'View personal calibration assignments, authorization status and reliability metrics.', 'STANDARD'),
  ('calibration.submit_self', 'Evaluator Quality', 'Submit calibration', 'Complete assigned anchor-case calibration exercises.', 'SENSITIVE'),
  ('calibration.manage', 'Evaluator Quality', 'Manage calibration programs', 'Create and publish calibration programs, anchor cases and assignments.', 'CRITICAL'),
  ('calibration.authorize', 'Evaluator Quality', 'Manage evaluator authorization', 'Suspend, revoke and restore template-specific evaluator authorization.', 'CRITICAL'),
  ('calibration.report', 'Evaluator Quality', 'View reliability analytics', 'View inter-rater reliability, severity and pair comparison analytics.', 'SENSITIVE'),
  ('calibration.action', 'Evaluator Quality', 'Manage evaluator quality actions', 'Assign and close coaching, monitoring and recalibration actions.', 'CRITICAL');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'coordinator', '*', 'calibration.view_self', 1, 'self', 'migration'),
  (UUID(), 'coordinator', '*', 'calibration.submit_self', 1, 'self', 'migration'),
  (UUID(), 'admin', '*', 'calibration.view_self', 1, 'self', 'migration'),
  (UUID(), 'admin', '*', 'calibration.submit_self', 1, 'self', 'migration'),
  (UUID(), 'admin', '*', 'calibration.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'calibration.authorize', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'calibration.report', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'calibration.action', 1, 'branch', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.authorize', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.authorize', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.report', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.report', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'calibration.action', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'calibration.action', 1, 'company', 'migration');
