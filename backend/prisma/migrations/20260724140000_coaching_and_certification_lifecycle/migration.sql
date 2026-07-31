-- World-class LMS Phase 3: coaching, development goals and certification renewal.
-- Trigger-free and compatible with Prisma Migrate on MySQL 8.

CREATE TABLE IF NOT EXISTS coaching_plan (
  plan_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  batch_no VARCHAR(120) NULL,
  branch VARCHAR(120) NULL,
  process_name VARCHAR(120) NULL,
  lob_name VARCHAR(120) NULL,
  title VARCHAR(200) NOT NULL,
  reason_code VARCHAR(60) NOT NULL DEFAULT 'DEVELOPMENT',
  source VARCHAR(60) NOT NULL DEFAULT 'MANUAL',
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  start_at DATETIME(3) NULL,
  due_at DATETIME(3) NULL,
  success_criteria TEXT NULL,
  owner_id VARCHAR(120) NOT NULL,
  owner_type VARCHAR(30) NOT NULL DEFAULT 'coordinator',
  created_by VARCHAR(120) NOT NULL,
  activated_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  closed_by VARCHAR(120) NULL,
  closure_summary TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (plan_id),
  KEY idx_coaching_employee (employee_id, status, due_at),
  KEY idx_coaching_owner (owner_id, status, due_at),
  KEY idx_coaching_batch (batch_no, status),
  KEY idx_coaching_branch (branch, status),
  CONSTRAINT chk_coaching_plan_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT chk_coaching_plan_status CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coaching_goal (
  goal_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  skill_id CHAR(36) NULL,
  goal_title VARCHAR(220) NOT NULL,
  metric_type VARCHAR(40) NOT NULL DEFAULT 'PERCENT',
  baseline_value DECIMAL(10,2) NULL,
  target_value DECIMAL(10,2) NULL,
  current_value DECIMAL(10,2) NULL,
  progress_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
  due_at DATETIME(3) NULL,
  evidence_required TINYINT(1) NOT NULL DEFAULT 1,
  completion_notes TEXT NULL,
  completed_at DATETIME(3) NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (goal_id),
  KEY idx_coaching_goal_plan (plan_id, status, due_at),
  KEY idx_coaching_goal_skill (skill_id, status),
  CONSTRAINT fk_coaching_goal_plan FOREIGN KEY (plan_id)
    REFERENCES coaching_plan(plan_id) ON DELETE CASCADE,
  CONSTRAINT fk_coaching_goal_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE SET NULL,
  CONSTRAINT chk_coaching_goal_status CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','BLOCKED','CANCELLED')),
  CONSTRAINT chk_coaching_goal_progress CHECK (progress_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coaching_session (
  session_id CHAR(36) NOT NULL,
  plan_id CHAR(36) NOT NULL,
  session_type VARCHAR(40) NOT NULL DEFAULT 'COACHING',
  status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
  scheduled_at DATETIME(3) NOT NULL,
  conducted_at DATETIME(3) NULL,
  duration_minutes INT UNSIGNED NULL,
  coach_id VARCHAR(120) NOT NULL,
  coach_role VARCHAR(60) NULL,
  agenda TEXT NULL,
  observation_notes LONGTEXT NULL,
  learner_commitment LONGTEXT NULL,
  coach_feedback LONGTEXT NULL,
  learner_feedback LONGTEXT NULL,
  effectiveness_rating DECIMAL(4,2) NULL,
  next_follow_up_at DATETIME(3) NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id),
  KEY idx_coaching_session_plan (plan_id, status, scheduled_at),
  KEY idx_coaching_session_coach (coach_id, status, scheduled_at),
  CONSTRAINT fk_coaching_session_plan FOREIGN KEY (plan_id)
    REFERENCES coaching_plan(plan_id) ON DELETE CASCADE,
  CONSTRAINT chk_coaching_session_status CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED','MISSED')),
  CONSTRAINT chk_coaching_effectiveness CHECK (effectiveness_rating IS NULL OR effectiveness_rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coaching_goal_evidence (
  evidence_id CHAR(36) NOT NULL,
  goal_id CHAR(36) NOT NULL,
  evidence_type VARCHAR(40) NOT NULL,
  reference_id VARCHAR(200) NOT NULL,
  evidence_value DECIMAL(10,2) NULL,
  notes TEXT NULL,
  recorded_by VARCHAR(120) NOT NULL,
  evidence_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (evidence_id),
  UNIQUE KEY uq_coaching_goal_evidence (goal_id, evidence_type, reference_id),
  KEY idx_coaching_evidence_goal (goal_id, evidence_at),
  CONSTRAINT fk_coaching_evidence_goal FOREIGN KEY (goal_id)
    REFERENCES coaching_goal(goal_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certification_renewal_rule (
  renewal_rule_id CHAR(36) NOT NULL,
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  certification_type VARCHAR(100) NOT NULL DEFAULT 'PROCESS_CERTIFICATION',
  validity_days INT UNSIGNED NOT NULL DEFAULT 365,
  renewal_window_days INT UNSIGNED NOT NULL DEFAULT 45,
  grace_days INT UNSIGNED NOT NULL DEFAULT 0,
  learning_path_id CHAR(36) NULL,
  assessment_id VARCHAR(120) NULL,
  min_score DECIMAL(6,2) NULL,
  require_no_critical_risk TINYINT(1) NOT NULL DEFAULT 1,
  require_manager_signoff TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (renewal_rule_id),
  UNIQUE KEY uq_cert_renewal_rule (process_name, lob_name, certification_type),
  KEY idx_cert_rule_active (active, process_name, lob_name),
  CONSTRAINT fk_cert_rule_path FOREIGN KEY (learning_path_id)
    REFERENCES learning_path_master(path_id) ON DELETE SET NULL,
  CONSTRAINT chk_cert_validity_days CHECK (validity_days > 0),
  CONSTRAINT chk_cert_renewal_window CHECK (renewal_window_days <= validity_days)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_certification (
  certification_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  batch_no VARCHAR(120) NULL,
  branch VARCHAR(120) NULL,
  process_name VARCHAR(120) NULL,
  lob_name VARCHAR(120) NULL,
  certification_type VARCHAR(100) NOT NULL DEFAULT 'PROCESS_CERTIFICATION',
  credential_number VARCHAR(120) NOT NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NULL,
  score_pct DECIMAL(6,2) NULL,
  issued_by VARCHAR(120) NOT NULL,
  rule_id VARCHAR(120) NULL,
  renewal_rule_id CHAR(36) NULL,
  previous_certification_id CHAR(36) NULL,
  initial_issuance_key VARCHAR(260)
    GENERATED ALWAYS AS (
      CASE
        WHEN previous_certification_id IS NULL
        THEN CONCAT(employee_id, '|', certification_type)
        ELSE NULL
      END
    ) STORED,
  evidence_snapshot_json JSON NULL,
  certificate_url TEXT NULL,
  revoked_at DATETIME(3) NULL,
  revoked_by VARCHAR(120) NULL,
  revocation_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (certification_id),
  UNIQUE KEY uq_cert_credential (credential_number),
  UNIQUE KEY uq_cert_employee_type_version (employee_id, certification_type, version_no),
  UNIQUE KEY uq_cert_initial_issuance (initial_issuance_key),
  KEY idx_cert_employee (employee_id, status, expires_at),
  KEY idx_cert_expiry (status, expires_at),
  KEY idx_cert_branch (branch, status, expires_at),
  CONSTRAINT fk_employee_cert_rule FOREIGN KEY (renewal_rule_id)
    REFERENCES certification_renewal_rule(renewal_rule_id) ON DELETE SET NULL,
  CONSTRAINT fk_employee_cert_previous FOREIGN KEY (previous_certification_id)
    REFERENCES employee_certification(certification_id) ON DELETE RESTRICT,
  CONSTRAINT chk_employee_cert_status CHECK (status IN ('ACTIVE','EXPIRING','EXPIRED','REVOKED','SUPERSEDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certification_renewal_case (
  case_id CHAR(36) NOT NULL,
  certification_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  renewal_rule_id CHAR(36) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  opened_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NOT NULL,
  grace_until DATETIME(3) NULL,
  owner_id VARCHAR(120) NULL,
  learning_path_enrollment_id CHAR(36) NULL,
  assessment_id VARCHAR(120) NULL,
  assessment_score DECIMAL(6,2) NULL,
  manager_signoff_by VARCHAR(120) NULL,
  manager_signoff_at DATETIME(3) NULL,
  blocker_reason TEXT NULL,
  waiver_reason TEXT NULL,
  waived_by VARCHAR(120) NULL,
  waived_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  renewed_certification_id CHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (case_id),
  UNIQUE KEY uq_cert_renewal_case_cert (certification_id),
  KEY idx_cert_case_employee (employee_id, status, due_at),
  KEY idx_cert_case_owner (owner_id, status, due_at),
  KEY idx_cert_case_due (status, due_at),
  CONSTRAINT fk_cert_case_certification FOREIGN KEY (certification_id)
    REFERENCES employee_certification(certification_id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_case_rule FOREIGN KEY (renewal_rule_id)
    REFERENCES certification_renewal_rule(renewal_rule_id) ON DELETE SET NULL,
  CONSTRAINT fk_cert_case_path_enrollment FOREIGN KEY (learning_path_enrollment_id)
    REFERENCES learning_path_enrollment(enrollment_id) ON DELETE SET NULL,
  CONSTRAINT fk_cert_case_renewed_cert FOREIGN KEY (renewed_certification_id)
    REFERENCES employee_certification(certification_id) ON DELETE SET NULL,
  CONSTRAINT chk_cert_case_status CHECK (status IN ('OPEN','IN_PROGRESS','READY','COMPLETED','OVERDUE','WAIVED','CANCELLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('development.coaching.view_self', 'Development', 'View own coaching', 'View personal coaching plans, goals and sessions.', 'STANDARD'),
  ('development.coaching.manage_batch', 'Development', 'Manage batch coaching', 'Create and manage coaching for owned batches.', 'SENSITIVE'),
  ('development.coaching.manage', 'Development', 'Manage coaching', 'Manage coaching within the administrator data scope.', 'SENSITIVE'),
  ('development.certification.view_self', 'Development', 'View own certifications', 'View active credentials and renewal cases.', 'STANDARD'),
  ('development.certification.manage_batch', 'Development', 'Manage batch renewals', 'Manage renewal activity for owned batches.', 'SENSITIVE'),
  ('development.certification.manage', 'Development', 'Manage certification lifecycle', 'Manage renewal rules, credentials, waivers and revocation.', 'CRITICAL');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'trainee', '*', 'development.coaching.view_self', 1, 'self', 'migration'),
  (UUID(), 'trainee', '*', 'development.certification.view_self', 1, 'self', 'migration'),
  (UUID(), 'coordinator', '*', 'development.coaching.manage_batch', 1, 'own_batch', 'migration'),
  (UUID(), 'coordinator', '*', 'development.certification.manage_batch', 1, 'own_batch', 'migration'),
  (UUID(), 'admin', '*', 'development.coaching.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'development.certification.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'development.coaching.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'development.coaching.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'development.certification.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'development.certification.manage', 1, 'company', 'migration');
