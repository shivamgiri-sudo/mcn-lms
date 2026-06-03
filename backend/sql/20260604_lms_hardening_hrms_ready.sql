-- MCN LMS hardening + HRMS-ready schema additions
-- Local Express + MySQL deployment safe script
-- IMPORTANT: Review database name and take backup before running.
-- This script does NOT integrate Call Master.

-- 1) Generic audit-safe soft-delete columns for critical master tables
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

ALTER TABLE trainee_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

ALTER TABLE classroom_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

ALTER TABLE module_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

ALTER TABLE content_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

ALTER TABLE assessment_master
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT NULL;

-- 2) Management target engine
CREATE TABLE IF NOT EXISTS management_targets (
  id VARCHAR(64) PRIMARY KEY,
  target_level VARCHAR(50) NOT NULL DEFAULT 'Company',
  branch VARCHAR(150) NULL,
  process VARCHAR(150) NULL,
  lob VARCHAR(150) NULL,
  batch_type VARCHAR(50) NULL,
  period_type VARCHAR(20) NOT NULL DEFAULT 'Monthly',
  period_start DATE NULL,
  period_end DATE NULL,
  throughput_target_pct DECIMAL(6,2) NULL,
  certification_target_pct DECIMAL(6,2) NULL,
  course_completion_target_pct DECIMAL(6,2) NULL,
  mcq_pass_target_pct DECIMAL(6,2) NULL,
  attendance_target_pct DECIMAL(6,2) NULL,
  training_attrition_max_pct DECIMAL(6,2) NULL,
  qna_sla_hours DECIMAL(6,2) NULL DEFAULT 24,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_management_targets_scope (target_level, branch, process, lob, batch_type, active),
  INDEX idx_management_targets_period (period_type, period_start, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Notification center, in-app first; email/SMS optional later
CREATE TABLE IF NOT EXISTS notification_log (
  id VARCHAR(64) PRIMARY KEY,
  recipient_type VARCHAR(50) NOT NULL,
  recipient_id VARCHAR(100) NOT NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'in_app',
  title VARCHAR(255) NOT NULL,
  message TEXT NULL,
  payload_json JSON NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Unread',
  priority VARCHAR(30) NOT NULL DEFAULT 'Normal',
  related_module VARCHAR(100) NULL,
  related_id VARCHAR(100) NULL,
  sent_at DATETIME NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notification_recipient (recipient_type, recipient_id, status),
  INDEX idx_notification_related (related_module, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Trainer cockpit tables
CREATE TABLE IF NOT EXISTS trainer_daily_log (
  id VARCHAR(64) PRIMARY KEY,
  trainer_login_id VARCHAR(100) NOT NULL,
  batch_no VARCHAR(100) NOT NULL,
  classroom_id VARCHAR(100) NULL,
  training_date DATE NOT NULL,
  day_no INT NULL,
  module_id VARCHAR(100) NULL,
  delivery_status VARCHAR(50) NOT NULL DEFAULT 'Planned',
  topics_covered TEXT NULL,
  pending_topics TEXT NULL,
  trainer_remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_trainer_daily_log_batch (batch_no, training_date),
  INDEX idx_trainer_daily_log_trainer (trainer_login_id, training_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trainee_coaching_log (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  batch_no VARCHAR(100) NULL,
  coach_login_id VARCHAR(100) NOT NULL,
  coaching_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  coaching_type VARCHAR(100) NOT NULL DEFAULT 'Learning Intervention',
  trigger_source VARCHAR(100) NULL,
  issue_observed TEXT NULL,
  action_taken TEXT NULL,
  next_action TEXT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Open',
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_coaching_employee (employee_id, status),
  INDEX idx_coaching_batch (batch_no, status),
  INDEX idx_coaching_coach (coach_login_id, coaching_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Certification command center / approval layer
CREATE TABLE IF NOT EXISTS certification_workflow (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(100) NOT NULL,
  batch_no VARCHAR(100) NULL,
  process VARCHAR(150) NULL,
  lob VARCHAR(150) NULL,
  current_stage VARCHAR(80) NOT NULL DEFAULT 'Not Ready',
  course_ready TINYINT(1) NOT NULL DEFAULT 0,
  mcq_ready TINYINT(1) NOT NULL DEFAULT 0,
  attendance_ready TINYINT(1) NOT NULL DEFAULT 0,
  mock_ready TINYINT(1) NOT NULL DEFAULT 0,
  internal_cert_ready TINYINT(1) NOT NULL DEFAULT 0,
  external_cert_ready TINYINT(1) NOT NULL DEFAULT 0,
  trainer_recommended TINYINT(1) NOT NULL DEFAULT 0,
  coordinator_approved TINYINT(1) NOT NULL DEFAULT 0,
  ops_handover_approved TINYINT(1) NOT NULL DEFAULT 0,
  blocked_reason TEXT NULL,
  last_evaluated_at DATETIME NULL,
  updated_by VARCHAR(100) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cert_workflow_employee (employee_id),
  INDEX idx_cert_workflow_batch (batch_no, current_stage),
  INDEX idx_cert_workflow_process (process, lob, current_stage)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) HRMS bridge staging only; no Call Master integration
CREATE TABLE IF NOT EXISTS hrms_employee_sync_staging (
  id VARCHAR(64) PRIMARY KEY,
  source_system VARCHAR(50) NOT NULL DEFAULT 'HRMS',
  source_employee_id VARCHAR(100) NOT NULL,
  employee_code VARCHAR(100) NULL,
  employee_name VARCHAR(200) NULL,
  official_email VARCHAR(200) NULL,
  mobile VARCHAR(30) NULL,
  branch VARCHAR(150) NULL,
  department VARCHAR(150) NULL,
  designation VARCHAR(150) NULL,
  process VARCHAR(150) NULL,
  lob VARCHAR(150) NULL,
  reporting_manager_id VARCHAR(100) NULL,
  reporting_manager_name VARCHAR(200) NULL,
  employment_status VARCHAR(80) NULL,
  date_of_joining DATE NULL,
  raw_payload JSON NULL,
  sync_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
  sync_message TEXT NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  UNIQUE KEY uq_hrms_employee_source (source_system, source_employee_id),
  INDEX idx_hrms_sync_status (sync_status, received_at),
  INDEX idx_hrms_employee_code (employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hrms_lms_employee_map (
  id VARCHAR(64) PRIMARY KEY,
  hrms_employee_id VARCHAR(100) NOT NULL,
  lms_employee_id VARCHAR(100) NOT NULL,
  lms_id VARCHAR(100) NULL,
  mobile VARCHAR(30) NULL,
  official_email VARCHAR(200) NULL,
  branch VARCHAR(150) NULL,
  process VARCHAR(150) NULL,
  lob VARCHAR(150) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  mapped_by VARCHAR(100) NULL,
  mapped_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_sync_at DATETIME NULL,
  UNIQUE KEY uq_hrms_lms_employee (hrms_employee_id, lms_employee_id),
  INDEX idx_hrms_lms_lms_emp (lms_employee_id),
  INDEX idx_hrms_lms_hrms_emp (hrms_employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7) Batch lifecycle history
CREATE TABLE IF NOT EXISTS batch_lifecycle_log (
  id VARCHAR(64) PRIMARY KEY,
  batch_no VARCHAR(100) NOT NULL,
  from_status VARCHAR(80) NULL,
  to_status VARCHAR(80) NOT NULL,
  changed_by VARCHAR(100) NULL,
  change_reason TEXT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_batch_lifecycle_batch (batch_no, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8) Basic indexes for local MySQL performance
CREATE INDEX IF NOT EXISTS idx_trainee_master_batch_status ON trainee_master (batch_no, status);
CREATE INDEX IF NOT EXISTS idx_trainee_master_scope ON trainee_master (branch, process, lob, status);
CREATE INDEX IF NOT EXISTS idx_content_progress_emp_classroom ON content_progress (employee_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_assessment_result_emp_classroom ON assessment_results (employee_id, classroom_id);
CREATE INDEX IF NOT EXISTS idx_query_log_batch_status ON trainee_query_log (batch_no, status, created_at);
