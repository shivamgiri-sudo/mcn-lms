-- World-class LMS Phase 4: instructor-led training, capacity, waitlists and attendance
-- MySQL 8.x; forward-only and idempotent for controlled deployments.

CREATE TABLE IF NOT EXISTS ilt_policy (
  policy_id CHAR(36) NOT NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  default_capacity INT UNSIGNED NOT NULL DEFAULT 25,
  waitlist_enabled TINYINT(1) NOT NULL DEFAULT 1,
  auto_promote_waitlist TINYINT(1) NOT NULL DEFAULT 1,
  self_enrollment_enabled TINYINT(1) NOT NULL DEFAULT 1,
  minimum_attendance_pct DECIMAL(6,2) NOT NULL DEFAULT 80,
  checkin_open_before_mins INT UNSIGNED NOT NULL DEFAULT 30,
  checkin_close_after_mins INT UNSIGNED NOT NULL DEFAULT 30,
  cancellation_cutoff_mins INT UNSIGNED NOT NULL DEFAULT 120,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (policy_id),
  UNIQUE KEY uq_ilt_policy_scope (branch, process_name, lob_name),
  KEY idx_ilt_policy_active (active),
  CONSTRAINT chk_ilt_policy_capacity CHECK (default_capacity BETWEEN 1 AND 10000),
  CONSTRAINT chk_ilt_policy_attendance CHECK (minimum_attendance_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_venue (
  venue_id CHAR(36) NOT NULL,
  venue_code VARCHAR(60) NOT NULL,
  venue_name VARCHAR(180) NOT NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  venue_type VARCHAR(30) NOT NULL DEFAULT 'CLASSROOM',
  room_location VARCHAR(500) NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  capacity INT UNSIGNED NOT NULL DEFAULT 25,
  virtual_join_url TEXT NULL,
  accessibility_notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (venue_id),
  UNIQUE KEY uq_ilt_venue_code (venue_code),
  KEY idx_ilt_venue_scope (branch, active),
  CONSTRAINT chk_ilt_venue_capacity CHECK (capacity BETWEEN 1 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_instructor (
  instructor_id CHAR(36) NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  user_type VARCHAR(30) NOT NULL DEFAULT 'coordinator',
  instructor_name VARCHAR(180) NOT NULL,
  email VARCHAR(240) NULL,
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  max_daily_minutes INT UNSIGNED NOT NULL DEFAULT 480,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instructor_id),
  UNIQUE KEY uq_ilt_instructor_user (user_id, user_type),
  KEY idx_ilt_instructor_scope (branch, process_name, lob_name, active),
  CONSTRAINT chk_ilt_instructor_minutes CHECK (max_daily_minutes BETWEEN 30 AND 1440)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session (
  session_id CHAR(36) NOT NULL,
  session_code VARCHAR(80) NOT NULL,
  series_id CHAR(36) NULL,
  occurrence_no INT UNSIGNED NOT NULL DEFAULT 1,
  classroom_id VARCHAR(191) NULL,
  module_id VARCHAR(191) NULL,
  batch_no VARCHAR(191) NULL,
  title VARCHAR(220) NOT NULL,
  description TEXT NULL,
  session_type VARCHAR(40) NOT NULL DEFAULT 'ILT',
  delivery_mode VARCHAR(30) NOT NULL DEFAULT 'IN_PERSON',
  branch VARCHAR(120) NOT NULL DEFAULT '',
  process_name VARCHAR(120) NOT NULL DEFAULT '',
  lob_name VARCHAR(120) NOT NULL DEFAULT '',
  venue_id CHAR(36) NULL,
  virtual_join_url TEXT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
  start_at DATETIME(3) NOT NULL,
  end_at DATETIME(3) NOT NULL,
  registration_open_at DATETIME(3) NULL,
  registration_close_at DATETIME(3) NULL,
  capacity INT UNSIGNED NOT NULL,
  minimum_attendees INT UNSIGNED NOT NULL DEFAULT 1,
  waitlist_enabled TINYINT(1) NOT NULL DEFAULT 1,
  self_enrollment_enabled TINYINT(1) NOT NULL DEFAULT 1,
  minimum_attendance_pct DECIMAL(6,2) NOT NULL DEFAULT 80,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  checkin_code_hash CHAR(64) NULL,
  checkin_open_at DATETIME(3) NULL,
  checkin_close_at DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  started_at DATETIME(3) NULL,
  completed_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  cancellation_reason TEXT NULL,
  created_by VARCHAR(120) NOT NULL,
  updated_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id),
  UNIQUE KEY uq_ilt_session_code (session_code),
  KEY idx_ilt_session_calendar (start_at, end_at, status),
  KEY idx_ilt_session_scope (branch, process_name, lob_name, status),
  KEY idx_ilt_session_batch (batch_no, start_at),
  KEY idx_ilt_session_venue (venue_id, start_at, end_at),
  KEY idx_ilt_session_series (series_id, occurrence_no),
  CONSTRAINT fk_ilt_session_venue FOREIGN KEY (venue_id)
    REFERENCES ilt_venue(venue_id) ON DELETE SET NULL,
  CONSTRAINT chk_ilt_session_time CHECK (end_at > start_at),
  CONSTRAINT chk_ilt_session_capacity CHECK (capacity BETWEEN 1 AND 10000),
  CONSTRAINT chk_ilt_session_attendance CHECK (minimum_attendance_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_instructor (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  instructor_id CHAR(36) NOT NULL,
  instructor_role VARCHAR(30) NOT NULL DEFAULT 'LEAD',
  confirmation_status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
  confirmed_at DATETIME(3) NULL,
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ilt_session_instructor (session_id, instructor_id),
  KEY idx_ilt_instructor_calendar (instructor_id, confirmation_status),
  CONSTRAINT fk_ilt_session_instructor_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE,
  CONSTRAINT fk_ilt_session_instructor_person FOREIGN KEY (instructor_id)
    REFERENCES ilt_instructor(instructor_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_prerequisite (
  prerequisite_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  prerequisite_type VARCHAR(30) NOT NULL,
  reference_id VARCHAR(160) NOT NULL,
  minimum_score DECIMAL(6,2) NULL,
  minimum_level DECIMAL(5,2) NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (prerequisite_id),
  UNIQUE KEY uq_ilt_session_prerequisite (session_id, prerequisite_type, reference_id),
  KEY idx_ilt_prerequisite_reference (prerequisite_type, reference_id),
  CONSTRAINT fk_ilt_prerequisite_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_skill_map (
  id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  skill_id CHAR(36) NOT NULL,
  level_awarded DECIMAL(5,2) NOT NULL DEFAULT 1,
  minimum_attendance_pct DECIMAL(6,2) NOT NULL DEFAULT 80,
  active TINYINT(1) NOT NULL DEFAULT 1,
  mapped_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ilt_session_skill (session_id, skill_id),
  KEY idx_ilt_session_skill_skill (skill_id, active),
  CONSTRAINT fk_ilt_session_skill_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE,
  CONSTRAINT fk_ilt_session_skill_skill FOREIGN KEY (skill_id)
    REFERENCES skill_master(skill_id) ON DELETE CASCADE,
  CONSTRAINT chk_ilt_session_skill_level CHECK (level_awarded BETWEEN 0 AND 10),
  CONSTRAINT chk_ilt_session_skill_attendance CHECK (minimum_attendance_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_enrollment (
  enrollment_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  batch_no VARCHAR(191) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED',
  waitlist_position INT UNSIGNED NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'SELF',
  enrolled_by VARCHAR(120) NULL,
  enrolled_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  confirmed_at DATETIME(3) NULL,
  promoted_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  cancellation_reason TEXT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (enrollment_id),
  UNIQUE KEY uq_ilt_session_employee (session_id, employee_id),
  KEY idx_ilt_enrollment_capacity (session_id, status, enrolled_at),
  KEY idx_ilt_enrollment_employee (employee_id, status),
  KEY idx_ilt_enrollment_waitlist (session_id, status, waitlist_position),
  CONSTRAINT fk_ilt_enrollment_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_enrollment_event (
  event_id CHAR(36) NOT NULL,
  enrollment_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NULL,
  reason TEXT NULL,
  actor_id VARCHAR(120) NULL,
  actor_type VARCHAR(30) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY idx_ilt_event_session (session_id, created_at),
  KEY idx_ilt_event_employee (employee_id, created_at),
  CONSTRAINT fk_ilt_event_enrollment FOREIGN KEY (enrollment_id)
    REFERENCES ilt_session_enrollment(enrollment_id) ON DELETE CASCADE,
  CONSTRAINT fk_ilt_event_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_attendance (
  attendance_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  attendance_status VARCHAR(30) NOT NULL DEFAULT 'ABSENT',
  checkin_at DATETIME(3) NULL,
  checkout_at DATETIME(3) NULL,
  attended_minutes INT UNSIGNED NOT NULL DEFAULT 0,
  attendance_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  source VARCHAR(40) NOT NULL DEFAULT 'INSTRUCTOR',
  evidence_reference VARCHAR(200) NULL,
  verified_by VARCHAR(120) NULL,
  verified_at DATETIME(3) NULL,
  notes TEXT NULL,
  locked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (attendance_id),
  UNIQUE KEY uq_ilt_attendance_session_employee (session_id, employee_id),
  KEY idx_ilt_attendance_employee (employee_id, attendance_status),
  KEY idx_ilt_attendance_session (session_id, attendance_status),
  CONSTRAINT fk_ilt_attendance_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE,
  CONSTRAINT chk_ilt_attendance_pct CHECK (attendance_pct BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_resource (
  resource_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  resource_type VARCHAR(30) NOT NULL DEFAULT 'CONTENT',
  reference_id VARCHAR(160) NULL,
  resource_title VARCHAR(220) NOT NULL,
  resource_url TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (resource_id),
  KEY idx_ilt_resource_session (session_id, sort_order),
  CONSTRAINT fk_ilt_resource_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ilt_session_feedback (
  feedback_id CHAR(36) NOT NULL,
  session_id CHAR(36) NOT NULL,
  employee_id VARCHAR(120) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  confidence_before TINYINT UNSIGNED NULL,
  confidence_after TINYINT UNSIGNED NULL,
  comments TEXT NULL,
  submitted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (feedback_id),
  UNIQUE KEY uq_ilt_feedback_session_employee (session_id, employee_id),
  KEY idx_ilt_feedback_session (session_id, rating),
  CONSTRAINT fk_ilt_feedback_session FOREIGN KEY (session_id)
    REFERENCES ilt_session(session_id) ON DELETE CASCADE,
  CONSTRAINT chk_ilt_feedback_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT chk_ilt_feedback_before CHECK (confidence_before IS NULL OR confidence_before BETWEEN 1 AND 5),
  CONSTRAINT chk_ilt_feedback_after CHECK (confidence_after IS NULL OR confidence_after BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permission_master
  (permission_key, module_name, action_name, description, risk_level, active)
VALUES
  ('ilt.view_self', 'Instructor-led Training', 'View own calendar', 'View eligible, enrolled and completed live sessions.', 'STANDARD', 1),
  ('ilt.enroll_self', 'Instructor-led Training', 'Self-enrol', 'Register, waitlist or cancel own live-session enrolment.', 'STANDARD', 1),
  ('ilt.manage_owned', 'Instructor-led Training', 'Manage owned batches', 'Create and manage sessions and enrolments for owned batches.', 'ELEVATED', 1),
  ('ilt.attendance_owned', 'Instructor-led Training', 'Manage owned attendance', 'Record, verify and finalize attendance for owned-batch sessions.', 'ELEVATED', 1),
  ('ilt.view_scope', 'Instructor-led Training', 'View scoped calendar', 'View instructor-led training within assigned data scope.', 'STANDARD', 1),
  ('ilt.manage_scope', 'Instructor-led Training', 'Manage scoped calendar', 'Create venues, instructors, sessions and enrolments within assigned scope.', 'ELEVATED', 1),
  ('ilt.configure', 'Instructor-led Training', 'Configure policies', 'Configure capacity, waitlist, attendance and check-in policy.', 'HIGH', 1),
  ('ilt.report', 'Instructor-led Training', 'View reports', 'View capacity, attendance, no-show and feedback reporting.', 'STANDARD', 1)
ON DUPLICATE KEY UPDATE
  module_name = VALUES(module_name),
  action_name = VALUES(action_name),
  description = VALUES(description),
  risk_level = VALUES(risk_level),
  active = VALUES(active);

INSERT INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'trainee', '*', 'ilt.view_self', 1, 'self', 'phase4-migration'),
  (UUID(), 'trainee', '*', 'ilt.enroll_self', 1, 'self', 'phase4-migration'),
  (UUID(), 'coordinator', '*', 'ilt.manage_owned', 1, 'own_batch', 'phase4-migration'),
  (UUID(), 'coordinator', '*', 'ilt.attendance_owned', 1, 'own_batch', 'phase4-migration'),
  (UUID(), 'coordinator', '*', 'ilt.view_scope', 1, 'own_batch', 'phase4-migration'),
  (UUID(), 'coordinator', '*', 'ilt.report', 1, 'own_batch', 'phase4-migration'),
  (UUID(), 'admin', '*', 'ilt.view_scope', 1, 'branch', 'phase4-migration'),
  (UUID(), 'admin', '*', 'ilt.report', 1, 'branch', 'phase4-migration'),
  (UUID(), 'admin', 'Admin', 'ilt.manage_scope', 1, 'branch', 'phase4-migration'),
  (UUID(), 'admin', 'Admin', 'ilt.configure', 1, 'branch', 'phase4-migration'),
  (UUID(), 'admin', 'Super Admin', 'ilt.manage_scope', 1, 'company', 'phase4-migration'),
  (UUID(), 'admin', 'Super Admin', 'ilt.configure', 1, 'company', 'phase4-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'ilt.manage_scope', 1, 'company', 'phase4-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'ilt.configure', 1, 'company', 'phase4-migration'),
  (UUID(), 'admin', 'CEO', 'ilt.manage_scope', 1, 'company', 'phase4-migration'),
  (UUID(), 'admin', 'CEO', 'ilt.configure', 1, 'company', 'phase4-migration')
ON DUPLICATE KEY UPDATE
  allowed = VALUES(allowed),
  data_scope = VALUES(data_scope),
  created_by = VALUES(created_by);
