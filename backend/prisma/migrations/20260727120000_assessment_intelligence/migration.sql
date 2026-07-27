-- Phase 14: governed assessment blueprints, immutable forms, accommodations and item analytics.
-- MySQL 8.x, forward-only and additive. Existing assessment evidence remains unchanged.

CREATE TABLE IF NOT EXISTS assessment_blueprint (
  blueprint_id CHAR(36) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  blueprint_name VARCHAR(200) NOT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  total_questions INT UNSIGNED NOT NULL,
  randomize_questions TINYINT(1) NOT NULL DEFAULT 1,
  randomize_options TINYINT(1) NOT NULL DEFAULT 1,
  selection_strategy VARCHAR(40) NOT NULL DEFAULT 'SECURE_RANDOM',
  effective_from DATETIME(3) NULL,
  effective_to DATETIME(3) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  reviewed_by VARCHAR(120) NULL,
  reviewed_at DATETIME(3) NULL,
  published_by VARCHAR(120) NULL,
  published_at DATETIME(3) NULL,
  retired_by VARCHAR(120) NULL,
  retired_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  published_assessment_key VARCHAR(191) GENERATED ALWAYS AS (
    CASE WHEN status = 'PUBLISHED' AND active = 1 THEN assessment_id ELSE NULL END
  ) STORED,
  draft_assessment_key VARCHAR(191) GENERATED ALWAYS AS (
    CASE WHEN status = 'DRAFT' AND active = 1 THEN assessment_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (blueprint_id),
  UNIQUE KEY uq_assessment_blueprint_version (assessment_id, version_no),
  UNIQUE KEY uq_assessment_blueprint_published (published_assessment_key),
  UNIQUE KEY uq_assessment_blueprint_draft (draft_assessment_key),
  KEY idx_assessment_blueprint_status (assessment_id, status, active),
  CONSTRAINT fk_assessment_blueprint_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT chk_assessment_blueprint_status CHECK (status IN ('DRAFT','IN_REVIEW','PUBLISHED','RETIRED')),
  CONSTRAINT chk_assessment_blueprint_questions CHECK (total_questions BETWEEN 1 AND 500),
  CONSTRAINT chk_assessment_blueprint_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_blueprint_rule (
  rule_id CHAR(36) NOT NULL,
  blueprint_id CHAR(36) NOT NULL,
  rule_order INT UNSIGNED NOT NULL,
  topic VARCHAR(160) NOT NULL DEFAULT '',
  objective_code VARCHAR(100) NOT NULL DEFAULT '',
  skill_id CHAR(36) NULL,
  difficulty VARCHAR(30) NOT NULL DEFAULT '',
  question_type VARCHAR(40) NOT NULL DEFAULT '',
  cognitive_level VARCHAR(40) NOT NULL DEFAULT '',
  language_code VARCHAR(20) NOT NULL DEFAULT '',
  question_count INT UNSIGNED NOT NULL,
  marks_each DECIMAL(8,2) NULL,
  negative_marks_each DECIMAL(8,2) NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_assessment_blueprint_rule_order (blueprint_id, rule_order),
  KEY idx_assessment_blueprint_rule_skill (skill_id),
  CONSTRAINT fk_assessment_blueprint_rule_blueprint FOREIGN KEY (blueprint_id)
    REFERENCES assessment_blueprint(blueprint_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_blueprint_rule_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE SET NULL,
  CONSTRAINT chk_assessment_blueprint_rule_count CHECK (question_count BETWEEN 1 AND 500),
  CONSTRAINT chk_assessment_blueprint_rule_marks CHECK (marks_each IS NULL OR marks_each > 0),
  CONSTRAINT chk_assessment_blueprint_rule_negative CHECK (negative_marks_each IS NULL OR negative_marks_each >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_question_metadata (
  question_id VARCHAR(191) NOT NULL,
  topic VARCHAR(160) NOT NULL DEFAULT '',
  objective_code VARCHAR(100) NOT NULL DEFAULT '',
  skill_id CHAR(36) NULL,
  difficulty VARCHAR(30) NOT NULL DEFAULT '',
  question_type VARCHAR(40) NOT NULL DEFAULT 'SINGLE_CHOICE',
  cognitive_level VARCHAR(40) NOT NULL DEFAULT 'UNDERSTAND',
  language_code VARCHAR(20) NOT NULL DEFAULT 'en-IN',
  review_status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  source_reference VARCHAR(500) NULL,
  max_exposure_count INT UNSIGNED NULL,
  usage_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at DATETIME(3) NULL,
  reviewed_by VARCHAR(120) NULL,
  reviewed_at DATETIME(3) NULL,
  review_notes TEXT NULL,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (question_id),
  KEY idx_assessment_question_metadata_filters (review_status, topic, difficulty),
  KEY idx_assessment_question_metadata_skill (skill_id, review_status),
  CONSTRAINT fk_assessment_question_metadata_question FOREIGN KEY (question_id)
    REFERENCES question_bank(question_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_question_metadata_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE SET NULL,
  CONSTRAINT chk_assessment_question_review_status CHECK (review_status IN ('DRAFT','IN_REVIEW','APPROVED','RETIRED','REJECTED')),
  CONSTRAINT chk_assessment_question_type CHECK (question_type IN ('SINGLE_CHOICE','MULTI_CHOICE','TRUE_FALSE','SCENARIO','CASE_STUDY','AUDIO','VIDEO')),
  CONSTRAINT chk_assessment_cognitive_level CHECK (cognitive_level IN ('REMEMBER','UNDERSTAND','APPLY','ANALYSE','EVALUATE','CREATE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_attempt_form (
  form_id CHAR(36) NOT NULL,
  attempt_id VARCHAR(191) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  blueprint_id CHAR(36) NULL,
  blueprint_version INT UNSIGNED NULL,
  question_snapshot_json JSON NOT NULL,
  accommodation_snapshot_json JSON NULL,
  total_marks DECIMAL(10,2) NOT NULL DEFAULT 0,
  effective_time_limit_seconds INT UNSIGNED NOT NULL,
  integrity_hash CHAR(64) NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (form_id),
  UNIQUE KEY uq_assessment_attempt_form_attempt (attempt_id),
  KEY idx_assessment_attempt_form_assessment (assessment_id, generated_at),
  CONSTRAINT fk_assessment_attempt_form_attempt FOREIGN KEY (attempt_id)
    REFERENCES assessment_attempts(attempt_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_attempt_form_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_attempt_form_blueprint FOREIGN KEY (blueprint_id)
    REFERENCES assessment_blueprint(blueprint_id) ON DELETE SET NULL,
  CONSTRAINT chk_assessment_attempt_form_time CHECK (effective_time_limit_seconds BETWEEN 60 AND 86400)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_question_response (
  response_id CHAR(36) NOT NULL,
  attempt_id VARCHAR(191) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  question_id VARCHAR(191) NOT NULL,
  displayed_option VARCHAR(10) NULL,
  selected_option VARCHAR(10) NULL,
  correct_option VARCHAR(10) NOT NULL,
  is_correct TINYINT(1) NOT NULL DEFAULT 0,
  is_blank TINYINT(1) NOT NULL DEFAULT 0,
  marks_available DECIMAL(8,2) NOT NULL DEFAULT 0,
  marks_awarded DECIMAL(8,2) NOT NULL DEFAULT 0,
  response_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  learner_flagged TINYINT(1) NOT NULL DEFAULT 0,
  topic VARCHAR(160) NOT NULL DEFAULT '',
  objective_code VARCHAR(100) NOT NULL DEFAULT '',
  skill_id CHAR(36) NULL,
  difficulty VARCHAR(30) NOT NULL DEFAULT '',
  question_type VARCHAR(40) NOT NULL DEFAULT 'SINGLE_CHOICE',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (response_id),
  UNIQUE KEY uq_assessment_question_response (attempt_id, question_id),
  KEY idx_assessment_question_response_question (assessment_id, question_id, is_correct),
  KEY idx_assessment_question_response_skill (skill_id, is_correct),
  CONSTRAINT fk_assessment_question_response_attempt FOREIGN KEY (attempt_id)
    REFERENCES assessment_attempts(attempt_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_question_response_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_question_response_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_accommodation (
  accommodation_id CHAR(36) NOT NULL,
  employee_id VARCHAR(191) NOT NULL,
  accommodation_type VARCHAR(40) NOT NULL DEFAULT 'TIME_EXTENSION',
  time_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  extra_break_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  display_preferences_json JSON NULL,
  language_code VARCHAR(20) NULL,
  effective_from DATETIME(3) NOT NULL,
  effective_to DATETIME(3) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED',
  reason TEXT NOT NULL,
  approved_by VARCHAR(120) NOT NULL,
  approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_by VARCHAR(120) NULL,
  revoked_at DATETIME(3) NULL,
  revocation_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_employee_key VARCHAR(191) GENERATED ALWAYS AS (
    CASE WHEN status = 'APPROVED' THEN employee_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (accommodation_id),
  UNIQUE KEY uq_assessment_accommodation_active (active_employee_key),
  KEY idx_assessment_accommodation_employee (employee_id, status, effective_from),
  CONSTRAINT chk_assessment_accommodation_status CHECK (status IN ('APPROVED','EXPIRED','REVOKED')),
  CONSTRAINT chk_assessment_accommodation_time CHECK (time_multiplier BETWEEN 1.00 AND 3.00),
  CONSTRAINT chk_assessment_accommodation_break CHECK (extra_break_minutes <= 120),
  CONSTRAINT chk_assessment_accommodation_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_item_analytics (
  analytics_id CHAR(36) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  question_id VARCHAR(191) NOT NULL,
  sample_size INT UNSIGNED NOT NULL DEFAULT 0,
  correct_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  blank_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  avg_response_seconds DECIMAL(10,2) NOT NULL DEFAULT 0,
  discrimination_index DECIMAL(7,3) NULL,
  distractor_json JSON NULL,
  quality_status VARCHAR(40) NOT NULL DEFAULT 'INSUFFICIENT_DATA',
  calculated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (analytics_id),
  UNIQUE KEY uq_assessment_item_analytics (assessment_id, question_id),
  KEY idx_assessment_item_quality (assessment_id, quality_status),
  CONSTRAINT fk_assessment_item_analytics_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT chk_assessment_item_quality CHECK (quality_status IN ('INSUFFICIENT_DATA','HEALTHY','TOO_EASY','TOO_HARD','LOW_DISCRIMINATION','HIGH_BLANK_RATE')),
  CONSTRAINT chk_assessment_item_pct CHECK (correct_pct BETWEEN 0 AND 100 AND blank_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_quality_alert (
  alert_id CHAR(36) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  question_id VARCHAR(191) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'WATCH',
  evidence_json JSON NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  owner_id VARCHAR(120) NULL,
  resolution_notes TEXT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_by VARCHAR(120) NULL,
  resolved_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  open_alert_key VARCHAR(500) GENERATED ALWAYS AS (
    CASE WHEN status IN ('OPEN','REVIEWING') THEN CONCAT(assessment_id, ':', question_id, ':', alert_type) ELSE NULL END
  ) STORED,
  PRIMARY KEY (alert_id),
  UNIQUE KEY uq_assessment_quality_open_alert (open_alert_key),
  KEY idx_assessment_quality_alert_queue (assessment_id, status, severity),
  CONSTRAINT fk_assessment_quality_alert_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT chk_assessment_quality_alert_status CHECK (status IN ('OPEN','REVIEWING','RESOLVED','DISMISSED')),
  CONSTRAINT chk_assessment_quality_alert_severity CHECK (severity IN ('WATCH','MEDIUM','HIGH','CRITICAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_remedial_recommendation (
  recommendation_id CHAR(36) NOT NULL,
  attempt_id VARCHAR(191) NOT NULL,
  employee_id VARCHAR(191) NOT NULL,
  assessment_id VARCHAR(191) NOT NULL,
  rule_key VARCHAR(255) NOT NULL,
  recommendation_type VARCHAR(40) NOT NULL,
  reference_id VARCHAR(191) NULL,
  title VARCHAR(240) NOT NULL,
  reason TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (recommendation_id),
  UNIQUE KEY uq_assessment_remedial_rule (attempt_id, rule_key),
  KEY idx_assessment_remedial_employee (employee_id, status, priority),
  CONSTRAINT fk_assessment_remedial_attempt FOREIGN KEY (attempt_id)
    REFERENCES assessment_attempts(attempt_id) ON DELETE CASCADE,
  CONSTRAINT fk_assessment_remedial_assessment FOREIGN KEY (assessment_id)
    REFERENCES assessment_master(assessment_id) ON DELETE CASCADE,
  CONSTRAINT chk_assessment_remedial_status CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','DISMISSED')),
  CONSTRAINT chk_assessment_remedial_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Existing questions remain eligible and approved until an administrator applies richer governance metadata.
INSERT IGNORE INTO assessment_question_metadata (
  question_id, topic, objective_code, question_type, cognitive_level, language_code,
  review_status, version_no, reviewed_by, reviewed_at, created_by
)
SELECT
  question_id, '', '', 'SINGLE_CHOICE', 'UNDERSTAND', 'en-IN',
  'APPROVED', 1, 'migration', CURRENT_TIMESTAMP(3), 'migration'
FROM question_bank;

INSERT IGNORE INTO permission_master (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('assessment.blueprint.manage', 'Assessment Intelligence', 'Manage blueprints', 'Create, review, publish and retire versioned assessment blueprints.', 'HIGH'),
  ('assessment.question.review', 'Assessment Intelligence', 'Review questions', 'Govern question metadata, approval, retirement and quality status.', 'HIGH'),
  ('assessment.analytics.view', 'Assessment Intelligence', 'View analytics', 'View item analytics and question-quality evidence within scope.', 'STANDARD'),
  ('assessment.accommodation.manage', 'Assessment Intelligence', 'Manage accommodations', 'Approve and revoke learner assessment accommodations.', 'HIGH');

INSERT IGNORE INTO role_permission (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'admin', '*', 'assessment.blueprint.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'assessment.question.review', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'assessment.analytics.view', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'assessment.accommodation.manage', 1, 'branch', 'migration'),
  (UUID(), 'coordinator', '*', 'assessment.analytics.view', 1, 'own_batch', 'migration');
