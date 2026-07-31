-- World-class LMS Phase 6: governed practical assessments and observation rubrics.
-- MySQL 8.x; forward-only, trigger-free and compatible with Prisma Migrate.

CREATE TABLE IF NOT EXISTS practical_assessment_template (
  template_id CHAR(36) NOT NULL,
  template_code VARCHAR(80) NOT NULL,
  template_name VARCHAR(220) NOT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  supersedes_template_id CHAR(36) NULL,
  description LONGTEXT NULL,
  learner_instructions LONGTEXT NULL,
  evaluator_instructions LONGTEXT NULL,
  audience_branch VARCHAR(120) NOT NULL DEFAULT '',
  audience_process VARCHAR(120) NOT NULL DEFAULT '',
  audience_lob VARCHAR(120) NOT NULL DEFAULT '',
  classroom_id VARCHAR(120) NULL,
  module_id VARCHAR(120) NULL,
  ilt_session_id CHAR(36) NULL,
  passing_pct DECIMAL(6,2) NOT NULL DEFAULT 70.00,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 2,
  evaluator_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  blind_evaluation TINYINT(1) NOT NULL DEFAULT 0,
  moderation_threshold_pct DECIMAL(6,2) NOT NULL DEFAULT 15.00,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  published_by VARCHAR(120) NULL,
  published_at DATETIME(3) NULL,
  retired_by VARCHAR(120) NULL,
  retired_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_id),
  UNIQUE KEY uq_practical_template_code_version (template_code, version_no),
  KEY idx_practical_template_scope (audience_branch, audience_process, audience_lob, status, active),
  KEY idx_practical_template_supersedes (supersedes_template_id),
  CONSTRAINT fk_practical_template_supersedes FOREIGN KEY (supersedes_template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT fk_practical_template_ilt FOREIGN KEY (ilt_session_id)
    REFERENCES ilt_session(session_id) ON DELETE SET NULL,
  CONSTRAINT chk_practical_template_score CHECK (passing_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_practical_template_attempts CHECK (max_attempts BETWEEN 1 AND 20),
  CONSTRAINT chk_practical_template_evaluators CHECK (evaluator_count IN (1,2)),
  CONSTRAINT chk_practical_template_moderation CHECK (moderation_threshold_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_practical_template_status CHECK (status IN ('DRAFT','PUBLISHED','RETIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_rubric_section (
  section_id CHAR(36) NOT NULL,
  template_id CHAR(36) NOT NULL,
  section_code VARCHAR(80) NOT NULL,
  section_title VARCHAR(220) NOT NULL,
  description LONGTEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 1,
  weight_pct DECIMAL(6,2) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (section_id),
  UNIQUE KEY uq_practical_section_code (template_id, section_code),
  UNIQUE KEY uq_practical_section_order (template_id, sort_order),
  KEY idx_practical_section_template (template_id, sort_order),
  CONSTRAINT fk_practical_section_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE CASCADE,
  CONSTRAINT chk_practical_section_weight CHECK (weight_pct > 0 AND weight_pct <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_rubric_criterion (
  criterion_id CHAR(36) NOT NULL,
  section_id CHAR(36) NOT NULL,
  criterion_code VARCHAR(80) NOT NULL,
  criterion_title VARCHAR(240) NOT NULL,
  description LONGTEXT NULL,
  observable_behavior LONGTEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 1,
  max_score DECIMAL(8,2) NOT NULL DEFAULT 5.00,
  weight_pct DECIMAL(6,2) NOT NULL,
  critical TINYINT(1) NOT NULL DEFAULT 0,
  critical_min_score DECIMAL(8,2) NULL,
  evidence_required TINYINT(1) NOT NULL DEFAULT 0,
  skill_id CHAR(36) NULL,
  skill_level_awarded DECIMAL(5,2) NULL,
  rating_scale_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (criterion_id),
  UNIQUE KEY uq_practical_criterion_code (section_id, criterion_code),
  UNIQUE KEY uq_practical_criterion_order (section_id, sort_order),
  KEY idx_practical_criterion_section (section_id, sort_order),
  KEY idx_practical_criterion_skill (skill_id),
  CONSTRAINT fk_practical_criterion_section FOREIGN KEY (section_id)
    REFERENCES practical_rubric_section(section_id) ON DELETE CASCADE,
  CONSTRAINT fk_practical_criterion_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE SET NULL,
  CONSTRAINT chk_practical_criterion_score CHECK (max_score > 0),
  CONSTRAINT chk_practical_criterion_weight CHECK (weight_pct > 0 AND weight_pct <= 100),
  CONSTRAINT chk_practical_critical_min CHECK (critical_min_score IS NULL OR (critical_min_score >= 0 AND critical_min_score <= max_score)),
  CONSTRAINT chk_practical_skill_level CHECK (skill_level_awarded IS NULL OR (skill_level_awarded > 0 AND skill_level_awarded <= 10))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_assessment_assignment (
  assignment_id CHAR(36) NOT NULL,
  template_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  batch_no VARCHAR(120) NULL,
  branch VARCHAR(120) NULL,
  process_name VARCHAR(120) NULL,
  lob_name VARCHAR(120) NULL,
  classroom_id VARCHAR(120) NULL,
  module_id VARCHAR(120) NULL,
  ilt_session_id CHAR(36) NULL,
  attempt_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(40) NOT NULL DEFAULT 'ASSIGNED',
  assigned_by VARCHAR(120) NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  submitted_at DATETIME(3) NULL,
  final_score DECIMAL(8,2) NULL,
  final_percentage DECIMAL(6,2) NULL,
  final_result VARCHAR(20) NULL,
  critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  finalized_by VARCHAR(120) NULL,
  finalized_at DATETIME(3) NULL,
  cancellation_reason LONGTEXT NULL,
  cancelled_by VARCHAR(120) NULL,
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (assignment_id),
  UNIQUE KEY uq_practical_assignment_attempt (template_id, employee_id, attempt_no),
  KEY idx_practical_assignment_employee (employee_id, status, due_at),
  KEY idx_practical_assignment_batch (batch_no, status, due_at),
  KEY idx_practical_assignment_scope (branch, process_name, lob_name, status),
  CONSTRAINT fk_practical_assignment_template FOREIGN KEY (template_id)
    REFERENCES practical_assessment_template(template_id) ON DELETE RESTRICT,
  CONSTRAINT fk_practical_assignment_ilt FOREIGN KEY (ilt_session_id)
    REFERENCES ilt_session(session_id) ON DELETE SET NULL,
  CONSTRAINT chk_practical_assignment_attempt CHECK (attempt_no BETWEEN 1 AND 20),
  CONSTRAINT chk_practical_assignment_status CHECK (status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','EVALUATING','MODERATION_REQUIRED','PASSED','FAILED','CANCELLED')),
  CONSTRAINT chk_practical_assignment_percentage CHECK (final_percentage IS NULL OR final_percentage BETWEEN 0 AND 100),
  CONSTRAINT chk_practical_assignment_result CHECK (final_result IS NULL OR final_result IN ('PASS','FAIL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_assessment_submission (
  submission_id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  learner_statement LONGTEXT NULL,
  submitted_by VARCHAR(120) NOT NULL,
  submitted_at DATETIME(3) NULL,
  withdrawn_at DATETIME(3) NULL,
  withdrawal_reason LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (submission_id),
  UNIQUE KEY uq_practical_submission_assignment (assignment_id),
  KEY idx_practical_submission_status (status, submitted_at),
  CONSTRAINT fk_practical_submission_assignment FOREIGN KEY (assignment_id)
    REFERENCES practical_assessment_assignment(assignment_id) ON DELETE CASCADE,
  CONSTRAINT chk_practical_submission_status CHECK (status IN ('DRAFT','SUBMITTED','WITHDRAWN'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_submission_evidence (
  evidence_id CHAR(36) NOT NULL,
  submission_id CHAR(36) NOT NULL,
  evidence_type VARCHAR(30) NOT NULL,
  evidence_title VARCHAR(220) NOT NULL,
  reference_id VARCHAR(240) NULL,
  reference_url TEXT NULL,
  notes LONGTEXT NULL,
  submitted_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  KEY idx_practical_evidence_submission (submission_id, created_at),
  CONSTRAINT fk_practical_evidence_submission FOREIGN KEY (submission_id)
    REFERENCES practical_assessment_submission(submission_id) ON DELETE CASCADE,
  CONSTRAINT chk_practical_evidence_type CHECK (evidence_type IN ('FILE_REFERENCE','URL','OBSERVATION','NOTE','RECORDING_REFERENCE')),
  CONSTRAINT chk_practical_evidence_reference CHECK (reference_id IS NOT NULL OR reference_url IS NOT NULL OR notes IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_evaluation (
  evaluation_id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  submission_id CHAR(36) NOT NULL,
  evaluator_id VARCHAR(120) NOT NULL,
  evaluator_type VARCHAR(30) NOT NULL,
  evaluator_slot TINYINT UNSIGNED NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  total_score DECIMAL(10,2) NULL,
  percentage DECIMAL(6,2) NULL,
  result VARCHAR(20) NULL,
  critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  summary LONGTEXT NULL,
  strengths LONGTEXT NULL,
  development_notes LONGTEXT NULL,
  submitted_at DATETIME(3) NULL,
  locked_at DATETIME(3) NULL,
  voided_by VARCHAR(120) NULL,
  voided_at DATETIME(3) NULL,
  void_reason LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evaluation_id),
  UNIQUE KEY uq_practical_evaluator_slot (assignment_id, evaluator_slot),
  UNIQUE KEY uq_practical_evaluator_identity (assignment_id, evaluator_id, evaluator_type),
  KEY idx_practical_evaluation_evaluator (evaluator_id, status, created_at),
  KEY idx_practical_evaluation_assignment (assignment_id, status),
  CONSTRAINT fk_practical_evaluation_assignment FOREIGN KEY (assignment_id)
    REFERENCES practical_assessment_assignment(assignment_id) ON DELETE CASCADE,
  CONSTRAINT fk_practical_evaluation_submission FOREIGN KEY (submission_id)
    REFERENCES practical_assessment_submission(submission_id) ON DELETE CASCADE,
  CONSTRAINT chk_practical_evaluation_slot CHECK (evaluator_slot IN (1,2)),
  CONSTRAINT chk_practical_evaluation_type CHECK (evaluator_type IN ('coordinator','admin','management')),
  CONSTRAINT chk_practical_evaluation_status CHECK (status IN ('DRAFT','SUBMITTED','VOID')),
  CONSTRAINT chk_practical_evaluation_percentage CHECK (percentage IS NULL OR percentage BETWEEN 0 AND 100),
  CONSTRAINT chk_practical_evaluation_result CHECK (result IS NULL OR result IN ('PASS','FAIL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_criterion_score (
  score_id CHAR(36) NOT NULL,
  evaluation_id CHAR(36) NOT NULL,
  criterion_id CHAR(36) NOT NULL,
  raw_score DECIMAL(8,2) NOT NULL,
  weighted_score DECIMAL(10,4) NOT NULL,
  rating_label VARCHAR(120) NULL,
  observation_notes LONGTEXT NULL,
  evidence_reference VARCHAR(500) NULL,
  critical_fail TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (score_id),
  UNIQUE KEY uq_practical_criterion_score (evaluation_id, criterion_id),
  KEY idx_practical_score_criterion (criterion_id),
  CONSTRAINT fk_practical_score_evaluation FOREIGN KEY (evaluation_id)
    REFERENCES practical_evaluation(evaluation_id) ON DELETE CASCADE,
  CONSTRAINT fk_practical_score_criterion FOREIGN KEY (criterion_id)
    REFERENCES practical_rubric_criterion(criterion_id) ON DELETE RESTRICT,
  CONSTRAINT chk_practical_raw_score CHECK (raw_score >= 0),
  CONSTRAINT chk_practical_weighted_score CHECK (weighted_score >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_moderation_case (
  case_id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  reason_code VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  score_variance_pct DECIMAL(6,2) NULL,
  critical_disagreement TINYINT(1) NOT NULL DEFAULT 0,
  opened_by VARCHAR(120) NOT NULL,
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  moderator_id VARCHAR(120) NULL,
  resolution_summary LONGTEXT NULL,
  final_percentage DECIMAL(6,2) NULL,
  final_result VARCHAR(20) NULL,
  resolved_at DATETIME(3) NULL,
  waived_by VARCHAR(120) NULL,
  waived_at DATETIME(3) NULL,
  waiver_reason LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (case_id),
  UNIQUE KEY uq_practical_moderation_assignment (assignment_id),
  KEY idx_practical_moderation_status (status, opened_at),
  CONSTRAINT fk_practical_moderation_assignment FOREIGN KEY (assignment_id)
    REFERENCES practical_assessment_assignment(assignment_id) ON DELETE CASCADE,
  CONSTRAINT chk_practical_moderation_reason CHECK (reason_code IN ('SCORE_VARIANCE','CRITICAL_DISAGREEMENT','MANUAL_REVIEW')),
  CONSTRAINT chk_practical_moderation_status CHECK (status IN ('OPEN','RESOLVED','WAIVED')),
  CONSTRAINT chk_practical_moderation_percentage CHECK (final_percentage IS NULL OR final_percentage BETWEEN 0 AND 100),
  CONSTRAINT chk_practical_moderation_result CHECK (final_result IS NULL OR final_result IN ('PASS','FAIL'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS practical_assessment_event (
  event_id CHAR(36) NOT NULL,
  assignment_id CHAR(36) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  from_status VARCHAR(40) NULL,
  to_status VARCHAR(40) NULL,
  actor_id VARCHAR(120) NULL,
  actor_type VARCHAR(30) NULL,
  details_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY idx_practical_event_assignment (assignment_id, created_at),
  KEY idx_practical_event_type (event_type, created_at),
  CONSTRAINT fk_practical_event_assignment FOREIGN KEY (assignment_id)
    REFERENCES practical_assessment_assignment(assignment_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('practical.view_self', 'Practical Assessment', 'View own practical assessments', 'View assigned practical assessments, rubric expectations and finalized feedback.', 'STANDARD'),
  ('practical.submit_self', 'Practical Assessment', 'Submit own practical evidence', 'Create and submit practical assessment evidence for personal assignments.', 'STANDARD'),
  ('practical.evaluate_owned', 'Practical Assessment', 'Evaluate owned-batch practicals', 'Claim and evaluate practical submissions for owned batches.', 'SENSITIVE'),
  ('practical.manage_scope', 'Practical Assessment', 'Manage practical assignments', 'Assign and manage practical assessments in the authorized data scope.', 'SENSITIVE'),
  ('practical.configure', 'Practical Assessment', 'Configure rubric templates', 'Create, version, publish and retire practical assessment rubrics.', 'CRITICAL'),
  ('practical.moderate', 'Practical Assessment', 'Moderate practical evaluations', 'Resolve evaluator variance and critical-criterion disagreements.', 'CRITICAL'),
  ('practical.report', 'Practical Assessment', 'View practical assessment reports', 'View practical assessment completion, quality and evaluator analytics.', 'SENSITIVE');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'trainee', '*', 'practical.view_self', 1, 'self', 'migration'),
  (UUID(), 'trainee', '*', 'practical.submit_self', 1, 'self', 'migration'),
  (UUID(), 'coordinator', '*', 'practical.evaluate_owned', 1, 'own_batch', 'migration'),
  (UUID(), 'coordinator', '*', 'practical.manage_scope', 1, 'own_batch', 'migration'),
  (UUID(), 'coordinator', '*', 'practical.report', 1, 'own_batch', 'migration'),
  (UUID(), 'admin', '*', 'practical.manage_scope', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'practical.configure', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'practical.moderate', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'practical.report', 1, 'branch', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'practical.manage_scope', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'practical.manage_scope', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'practical.configure', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'practical.configure', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'practical.moderate', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'practical.moderate', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'practical.report', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'practical.report', 1, 'company', 'migration');
