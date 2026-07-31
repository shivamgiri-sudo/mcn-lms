-- World-class LMS Phase 2: granular permissions, skills, competency and learning paths
-- MySQL 8.x; forward-only and idempotent for controlled deployments.

CREATE TABLE IF NOT EXISTS permission_master (
  permission_key VARCHAR(120) NOT NULL,
  module_name VARCHAR(80) NOT NULL,
  action_name VARCHAR(80) NOT NULL,
  description VARCHAR(500) NULL,
  risk_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (permission_key),
  KEY idx_permission_module (module_name, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permission (
  id CHAR(36) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  role_key VARCHAR(100) NOT NULL DEFAULT '*',
  permission_key VARCHAR(120) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 1,
  data_scope VARCHAR(30) NOT NULL DEFAULT 'self',
  conditions_json JSON NULL,
  created_by VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_permission (user_type, role_key, permission_key),
  KEY idx_role_permission_lookup (user_type, role_key, allowed),
  CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_key)
    REFERENCES permission_master(permission_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_permission_override (
  id CHAR(36) NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  permission_key VARCHAR(120) NOT NULL,
  allowed TINYINT(1) NOT NULL,
  data_scope VARCHAR(30) NOT NULL DEFAULT 'self',
  expires_at DATETIME(3) NULL,
  reason VARCHAR(500) NULL,
  granted_by VARCHAR(120) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_permission (user_id, user_type, permission_key),
  KEY idx_user_permission_expiry (expires_at),
  CONSTRAINT fk_user_permission_permission FOREIGN KEY (permission_key)
    REFERENCES permission_master(permission_key) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS skill_master (
  skill_id CHAR(36) NOT NULL,
  skill_code VARCHAR(60) NOT NULL,
  skill_name VARCHAR(160) NOT NULL,
  category VARCHAR(100) NOT NULL,
  description TEXT NULL,
  level_scale TINYINT UNSIGNED NOT NULL DEFAULT 5,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (skill_id),
  UNIQUE KEY uq_skill_code (skill_code),
  KEY idx_skill_category (category, active),
  CONSTRAINT chk_skill_level_scale CHECK (level_scale BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_skill_requirement (
  id CHAR(36) NOT NULL,
  department VARCHAR(120) NOT NULL DEFAULT '',
  designation VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  skill_id CHAR(36) NOT NULL,
  required_level TINYINT UNSIGNED NOT NULL,
  critical TINYINT(1) NOT NULL DEFAULT 0,
  weight DECIMAL(6,2) NOT NULL DEFAULT 1.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_role_skill_requirement (department, designation, process_name, lob_name, skill_id),
  KEY idx_role_skill_scope (process_name, lob_name, active),
  CONSTRAINT fk_role_skill_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE,
  CONSTRAINT chk_role_skill_level CHECK (required_level BETWEEN 1 AND 10),
  CONSTRAINT chk_role_skill_weight CHECK (weight > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_skill_map (
  id CHAR(36) NOT NULL,
  content_id VARCHAR(120) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  target_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  weight DECIMAL(6,2) NOT NULL DEFAULT 1.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  mapped_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_content_skill (content_id, skill_id),
  KEY idx_content_skill_skill (skill_id, active),
  CONSTRAINT fk_content_skill_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE,
  CONSTRAINT chk_content_skill_level CHECK (target_level BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_skill_map (
  id CHAR(36) NOT NULL,
  assessment_id VARCHAR(120) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  target_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  weight DECIMAL(6,2) NOT NULL DEFAULT 1.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  mapped_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_assessment_skill (assessment_id, skill_id),
  KEY idx_assessment_skill_skill (skill_id, active),
  CONSTRAINT fk_assessment_skill_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE,
  CONSTRAINT chk_assessment_skill_level CHECK (target_level BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_skill_profile (
  id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  current_level DECIMAL(5,2) NOT NULL DEFAULT 0,
  target_level DECIMAL(5,2) NOT NULL DEFAULT 0,
  confidence_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'GAP',
  source VARCHAR(40) NOT NULL DEFAULT 'LMS_EVIDENCE',
  last_evidence_at DATETIME(3) NULL,
  verified_by VARCHAR(120) NULL,
  verified_at DATETIME(3) NULL,
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_employee_skill (employee_id, skill_id),
  KEY idx_employee_skill_status (employee_id, status),
  KEY idx_skill_profile_skill (skill_id, current_level),
  CONSTRAINT fk_employee_skill_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS skill_evidence (
  id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  evidence_type VARCHAR(40) NOT NULL,
  reference_id VARCHAR(160) NOT NULL,
  score_pct DECIMAL(6,2) NULL,
  level_awarded DECIMAL(5,2) NOT NULL DEFAULT 0,
  evidence_status VARCHAR(30) NOT NULL DEFAULT 'VALID',
  notes TEXT NULL,
  recorded_by VARCHAR(120) NULL,
  evidence_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_skill_evidence_source (employee_id, skill_id, evidence_type, reference_id),
  KEY idx_skill_evidence_employee (employee_id, evidence_status, evidence_at),
  CONSTRAINT fk_skill_evidence_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learning_path_master (
  path_id CHAR(36) NOT NULL,
  path_code VARCHAR(60) NOT NULL,
  path_name VARCHAR(180) NOT NULL,
  description TEXT NULL,
  audience_branch VARCHAR(120) NOT NULL DEFAULT '',
  audience_department VARCHAR(120) NOT NULL DEFAULT '',
  audience_designation VARCHAR(120) NOT NULL DEFAULT '',
  audience_process VARCHAR(120) NOT NULL DEFAULT '',
  audience_lob VARCHAR(120) NOT NULL DEFAULT '',
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  mandatory TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  published_by VARCHAR(120) NULL,
  published_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (path_id),
  UNIQUE KEY uq_learning_path_code_version (path_code, version_no),
  KEY idx_learning_path_audience (audience_process, audience_lob, status, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learning_path_step (
  step_id CHAR(36) NOT NULL,
  path_id CHAR(36) NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  step_type VARCHAR(30) NOT NULL,
  reference_id VARCHAR(160) NOT NULL,
  step_title VARCHAR(200) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  min_score DECIMAL(6,2) NULL,
  min_level DECIMAL(5,2) NULL,
  prerequisite_step_id CHAR(36) NULL,
  due_days INT UNSIGNED NULL,
  completion_rule_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (step_id),
  UNIQUE KEY uq_learning_path_step_order (path_id, step_order),
  KEY idx_learning_path_step_reference (step_type, reference_id),
  CONSTRAINT fk_learning_path_step_path FOREIGN KEY (path_id)
    REFERENCES learning_path_master(path_id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_path_step_prerequisite FOREIGN KEY (prerequisite_step_id)
    REFERENCES learning_path_step(step_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learning_path_enrollment (
  enrollment_id CHAR(36) NOT NULL,
  path_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
  progress_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  due_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  assigned_by VARCHAR(120) NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'ADMIN',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (enrollment_id),
  UNIQUE KEY uq_learning_path_enrollment (path_id, employee_id),
  KEY idx_learning_path_employee (employee_id, status, due_at),
  CONSTRAINT fk_learning_path_enrollment_path FOREIGN KEY (path_id)
    REFERENCES learning_path_master(path_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS learning_path_step_progress (
  id CHAR(36) NOT NULL,
  enrollment_id CHAR(36) NOT NULL,
  step_id CHAR(36) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'LOCKED',
  score DECIMAL(6,2) NULL,
  evidence_reference VARCHAR(200) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_path_step_progress (enrollment_id, step_id),
  KEY idx_learning_path_step_status (enrollment_id, status),
  CONSTRAINT fk_learning_path_progress_enrollment FOREIGN KEY (enrollment_id)
    REFERENCES learning_path_enrollment(enrollment_id) ON DELETE CASCADE,
  CONSTRAINT fk_learning_path_progress_step FOREIGN KEY (step_id)
    REFERENCES learning_path_step(step_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('access.permissions.manage', 'Access', 'Manage permissions', 'Manage role grants and user overrides.', 'CRITICAL'),
  ('talent.skills.view', 'Talent', 'View skills', 'View personal or scoped competency data.', 'STANDARD'),
  ('talent.skills.view_batch', 'Talent', 'View batch skills', 'View competency gaps for owned batches.', 'SENSITIVE'),
  ('talent.skills.manage', 'Talent', 'Manage skills', 'Create skills, requirements and evidence mappings.', 'SENSITIVE'),
  ('talent.paths.view', 'Talent', 'View learning paths', 'View assigned learning paths.', 'STANDARD'),
  ('talent.paths.manage', 'Talent', 'Manage learning paths', 'Create, edit and publish learning paths.', 'SENSITIVE'),
  ('talent.paths.assign', 'Talent', 'Assign learning paths', 'Assign published paths to learners.', 'SENSITIVE');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'admin', 'Super Admin', 'access.permissions.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'access.permissions.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'talent.skills.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'talent.skills.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', '*', 'talent.skills.view', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'talent.paths.view', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'talent.paths.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'talent.paths.assign', 1, 'branch', 'migration'),
  (UUID(), 'coordinator', '*', 'talent.skills.view', 1, 'own_batch', 'migration'),
  (UUID(), 'coordinator', '*', 'talent.skills.view_batch', 1, 'own_batch', 'migration'),
  (UUID(), 'coordinator', '*', 'talent.paths.view', 1, 'own_batch', 'migration'),
  (UUID(), 'trainee', '*', 'talent.skills.view', 1, 'self', 'migration'),
  (UUID(), 'trainee', '*', 'talent.paths.view', 1, 'self', 'migration');
