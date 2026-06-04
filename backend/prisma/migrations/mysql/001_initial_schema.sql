-- ============================================================
-- LMS 2.0 — MySQL 8.x Migration Script
-- Run once on a fresh database to create all tables.
--
-- Usage:
--   mysql -u <user> -p <database_name> < 001_initial_schema.sql
-- Or inside MySQL shell:
--   USE lms_db;
--   SOURCE /path/to/001_initial_schema.sql;
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ─── ROLE & ACCESS ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `role_access_matrix` (
  `id`                           VARCHAR(36)  NOT NULL,
  `login_id`                     VARCHAR(191) NOT NULL,
  `pin`                          VARCHAR(191) NOT NULL,
  `name`                         VARCHAR(191) NULL,
  `role`                         VARCHAR(191) NOT NULL DEFAULT 'Coordinator',
  `portal_access`                VARCHAR(191) NOT NULL DEFAULT 'Coordinator',
  `branch`                       VARCHAR(191) NULL,
  `process`                      VARCHAR(191) NULL,
  `lob`                          VARCHAR(191) NULL,
  `designation`                  VARCHAR(191) NULL,
  `department`                   VARCHAR(191) NULL,
  `employee_code`                VARCHAR(191) NULL,
  `active`                       TINYINT(1)   NOT NULL DEFAULT 1,
  `can_create_batch`             TINYINT(1)   NOT NULL DEFAULT 0,
  `can_onboard_trainee`          TINYINT(1)   NOT NULL DEFAULT 0,
  `can_upload_lms_report`        TINYINT(1)   NOT NULL DEFAULT 0,
  `can_override_attendance`      TINYINT(1)   NOT NULL DEFAULT 0,
  `can_close_batch`              TINYINT(1)   NOT NULL DEFAULT 0,
  `can_view_management_dashboard` TINYINT(1)  NOT NULL DEFAULT 0,
  `failed_attempts`              INT          NOT NULL DEFAULT 0,
  `locked`                       TINYINT(1)   NOT NULL DEFAULT 0,
  `last_login`                   DATETIME(3)  NULL,
  `created_at`                   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`                   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `role_access_matrix_login_id_key` (`login_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `branch_master` (
  `id`          VARCHAR(36)  NOT NULL,
  `branch_name` VARCHAR(191) NOT NULL,
  `branch_code` VARCHAR(191) NULL,
  `city`        VARCHAR(191) NULL,
  `state`       VARCHAR(191) NULL,
  `active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `branch_master_branch_name_key` (`branch_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `designation_master` (
  `id`         VARCHAR(36)  NOT NULL,
  `title`      VARCHAR(191) NOT NULL,
  `department` VARCHAR(191) NULL,
  `active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `designation_master_title_key` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `department_master` (
  `id`         VARCHAR(36)  NOT NULL,
  `name`       VARCHAR(191) NOT NULL,
  `active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `department_master_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `portal_sessions` (
  `id`         VARCHAR(36)  NOT NULL,
  `token`      VARCHAR(191) NOT NULL,
  `user_id`    VARCHAR(191) NOT NULL,
  `user_type`  VARCHAR(191) NOT NULL,
  `expires_at` DATETIME(3)  NOT NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `portal_sessions_token_key` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── PROCESS & LOB ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `process_lob_master` (
  `id`      VARCHAR(36)  NOT NULL,
  `process` VARCHAR(191) NOT NULL,
  `lob`     VARCHAR(191) NOT NULL,
  `active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `notes`   TEXT         NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `process_lob_master_process_lob_key` (`process`, `lob`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── BATCH ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `batch_master` (
  `id`                    VARCHAR(36)  NOT NULL,
  `batch_no`              VARCHAR(191) NOT NULL,
  `batch_name`            VARCHAR(191) NOT NULL,
  `batch_type`            VARCHAR(191) NOT NULL DEFAULT 'NHT',
  `branch`                VARCHAR(191) NULL,
  `process`               VARCHAR(191) NULL,
  `lob`                   VARCHAR(191) NULL,
  `classroom_id`          VARCHAR(191) NULL,
  `classroom_name`        VARCHAR(191) NULL,
  `classroom_assigned_at` DATETIME(3)  NULL,
  `classroom_assigned_by` VARCHAR(191) NULL,
  `coordinator_name`      VARCHAR(191) NULL,
  `coordinator_login_id`  VARCHAR(191) NULL,
  `batch_status`          VARCHAR(191) NOT NULL DEFAULT 'Active',
  `start_date`            DATETIME(3)  NULL,
  `end_date`              DATETIME(3)  NULL,
  `expected_trainees`     INT          NOT NULL DEFAULT 0,
  `total_trainees`        INT          NOT NULL DEFAULT 0,
  `ojt_ready`             INT          NOT NULL DEFAULT 0,
  `certified`             INT          NOT NULL DEFAULT 0,
  `handover_to_ops`       INT          NOT NULL DEFAULT 0,
  `created_at`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`            VARCHAR(191) NULL,
  `last_updated_at`       DATETIME(3)  NOT NULL,
  `remarks`               TEXT         NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `batch_master_batch_no_key` (`batch_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `batch_classroom_map` (
  `id`            VARCHAR(36)  NOT NULL,
  `batch_no`      VARCHAR(191) NOT NULL,
  `batch_name`    VARCHAR(191) NOT NULL,
  `branch`        VARCHAR(191) NULL,
  `process`       VARCHAR(191) NULL,
  `lob`           VARCHAR(191) NULL,
  `classroom_id`  VARCHAR(191) NOT NULL,
  `classroom_name` VARCHAR(191) NOT NULL,
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `assigned_by`   VARCHAR(191) NULL,
  `assigned_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL,
  `remarks`       TEXT         NULL,
  PRIMARY KEY (`id`),
  KEY `batch_classroom_map_batch_no_fkey` (`batch_no`),
  CONSTRAINT `batch_classroom_map_batch_no_fkey`
    FOREIGN KEY (`batch_no`) REFERENCES `batch_master` (`batch_no`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── TRAINEE ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `trainee_master` (
  `id`                    VARCHAR(36)  NOT NULL,
  `employee_id`           VARCHAR(191) NOT NULL,
  `lms_id`                VARCHAR(191) NULL,
  `trainee_name`          VARCHAR(191) NULL,
  `email`                 VARCHAR(191) NULL,
  `mobile`                VARCHAR(191) NULL,
  `batch_no`              VARCHAR(191) NULL,
  `branch`                VARCHAR(191) NULL,
  `process`               VARCHAR(191) NULL,
  `lob`                   VARCHAR(191) NULL,
  `classroom_id`          VARCHAR(191) NULL,
  `classroom_name`        VARCHAR(191) NULL,
  `status`                VARCHAR(191) NOT NULL DEFAULT 'Active',
  `doj`                   DATETIME(3)  NULL,
  `onboarding_date`       DATETIME(3)  NULL,
  `onboarding_status`     VARCHAR(191) NOT NULL DEFAULT 'Pending',
  `course_completion_pct` DOUBLE       NOT NULL DEFAULT 0,
  `assessment_attempt_pct` DOUBLE      NOT NULL DEFAULT 0,
  `assessment_pass_pct`   DOUBLE       NOT NULL DEFAULT 0,
  `attendance_pct`        DOUBLE       NOT NULL DEFAULT 0,
  `risk_status`           VARCHAR(191) NOT NULL DEFAULT 'HEALTHY',
  `risk_reason`           TEXT         NULL,
  `ojt_ready`             TINYINT(1)   NOT NULL DEFAULT 0,
  `nesting_status`        VARCHAR(191) NULL,
  `certification_status`  VARCHAR(191) NOT NULL DEFAULT 'Not Certified',
  `handover_to_ops`       TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_by`            VARCHAR(191) NULL,
  `last_updated_at`       DATETIME(3)  NOT NULL,
  `source`                VARCHAR(191) NOT NULL DEFAULT 'Manual',
  `emp_id_type`           VARCHAR(191) NOT NULL DEFAULT 'PERMANENT',
  `permanent_emp_id`      VARCHAR(191) NULL,
  `emp_id_mapped_at`      DATETIME(3)  NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trainee_master_employee_id_key` (`employee_id`),
  UNIQUE KEY `trainee_master_lms_id_key` (`lms_id`),
  UNIQUE KEY `trainee_master_permanent_emp_id_key` (`permanent_emp_id`),
  KEY `trainee_master_batch_no_fkey` (`batch_no`),
  CONSTRAINT `trainee_master_batch_no_fkey`
    FOREIGN KEY (`batch_no`) REFERENCES `batch_master` (`batch_no`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AUTH ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `admin_user_master` (
  `id`              VARCHAR(36)  NOT NULL,
  `admin_id`        VARCHAR(191) NOT NULL,
  `password_hash`   VARCHAR(191) NOT NULL,
  `salt`            VARCHAR(191) NOT NULL,
  `admin_name`      VARCHAR(191) NULL,
  `role`            VARCHAR(191) NOT NULL DEFAULT 'Admin',
  `active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `failed_attempts` INT          NOT NULL DEFAULT 0,
  `locked`          TINYINT(1)   NOT NULL DEFAULT 0,
  `last_login`      DATETIME(3)  NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_user_master_admin_id_key` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_master` (
  `id`                   VARCHAR(36)  NOT NULL,
  `employee_id`          VARCHAR(191) NOT NULL,
  `password_hash`        VARCHAR(191) NOT NULL,
  `salt`                 VARCHAR(191) NOT NULL,
  `trainee_name`         VARCHAR(191) NULL,
  `email`                VARCHAR(191) NULL,
  `mobile`               VARCHAR(191) NULL,
  `branch`               VARCHAR(191) NULL,
  `process`              VARCHAR(191) NULL,
  `lob`                  VARCHAR(191) NULL,
  `batch_no`             VARCHAR(191) NULL,
  `classroom_id`         VARCHAR(191) NULL,
  `active`               TINYINT(1)   NOT NULL DEFAULT 1,
  `force_password_reset` TINYINT(1)   NOT NULL DEFAULT 1,
  `failed_attempts`      INT          NOT NULL DEFAULT 0,
  `locked`               TINYINT(1)   NOT NULL DEFAULT 0,
  `last_login`           DATETIME(3)  NULL,
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`           DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_master_employee_id_key` (`employee_id`),
  CONSTRAINT `user_master_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `trainee_master` (`employee_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CLASSROOM & CURRICULUM ───────────────────────────────────

CREATE TABLE IF NOT EXISTS `classroom_master` (
  `id`               VARCHAR(36)  NOT NULL,
  `classroom_id`     VARCHAR(191) NOT NULL,
  `classroom_name`   VARCHAR(191) NOT NULL,
  `process`          VARCHAR(191) NULL,
  `lob`              VARCHAR(191) NULL,
  `active`           TINYINT(1)   NOT NULL DEFAULT 1,
  `description`      TEXT         NULL,
  `drive_folder_id`  VARCHAR(191) NULL,
  `drive_folder_url` TEXT         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `classroom_master_classroom_id_key` (`classroom_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `module_master` (
  `id`           VARCHAR(36)  NOT NULL,
  `module_id`    VARCHAR(191) NOT NULL,
  `classroom_id` VARCHAR(191) NOT NULL,
  `day_no`       INT          NOT NULL,
  `module_title` VARCHAR(191) NOT NULL,
  `module_order` INT          NOT NULL DEFAULT 0,
  `required`     TINYINT(1)   NOT NULL DEFAULT 1,
  `active`       TINYINT(1)   NOT NULL DEFAULT 1,
  `description`  TEXT         NULL,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `module_master_module_id_key` (`module_id`),
  KEY `module_master_classroom_id_fkey` (`classroom_id`),
  CONSTRAINT `module_master_classroom_id_fkey`
    FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master` (`classroom_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `content_master` (
  `id`                 VARCHAR(36)  NOT NULL,
  `content_id`         VARCHAR(191) NOT NULL,
  `module_id`          VARCHAR(191) NOT NULL,
  `content_type`       VARCHAR(191) NOT NULL,
  `content_title`      VARCHAR(191) NOT NULL,
  `drive_file_id`      VARCHAR(191) NULL,
  `drive_url`          TEXT         NULL,
  `direct_media_url`   TEXT         NULL,
  `local_file_path`    TEXT         NULL,
  `player_mode`        VARCHAR(191) NOT NULL DEFAULT 'Auto',
  `content_order`      INT          NOT NULL DEFAULT 0,
  `required`           TINYINT(1)   NOT NULL DEFAULT 1,
  `active`             TINYINT(1)   NOT NULL DEFAULT 1,
  `locked`             TINYINT(1)   NOT NULL DEFAULT 0,
  `estimated_mins`     INT          NOT NULL DEFAULT 0,
  `completion_rule_pct` DOUBLE      NOT NULL DEFAULT 80,
  `description`        TEXT         NULL,
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `content_master_content_id_key` (`content_id`),
  KEY `content_master_module_id_fkey` (`module_id`),
  CONSTRAINT `content_master_module_id_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `module_master` (`module_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `faq_master` (
  `id`         VARCHAR(36)  NOT NULL,
  `faq_id`     VARCHAR(191) NOT NULL,
  `module_id`  VARCHAR(191) NOT NULL,
  `question`   TEXT         NOT NULL,
  `answer`     LONGTEXT     NOT NULL,
  `active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `faq_master_faq_id_key` (`faq_id`),
  KEY `faq_master_module_id_fkey` (`module_id`),
  CONSTRAINT `faq_master_module_id_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `module_master` (`module_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `trainee_classroom_map` (
  `id`            VARCHAR(36)  NOT NULL,
  `employee_id`   VARCHAR(191) NOT NULL,
  `classroom_id`  VARCHAR(191) NOT NULL,
  `batch_no`      VARCHAR(191) NULL,
  `assigned_date` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `assigned_by`   VARCHAR(191) NULL,
  `remarks`       TEXT         NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trainee_classroom_map_employee_id_classroom_id_key` (`employee_id`, `classroom_id`),
  KEY `trainee_classroom_map_classroom_id_fkey` (`classroom_id`),
  CONSTRAINT `trainee_classroom_map_classroom_id_fkey`
    FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master` (`classroom_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ASSESSMENTS ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `assessment_master` (
  `id`              VARCHAR(36)  NOT NULL,
  `assessment_id`   VARCHAR(191) NOT NULL,
  `classroom_id`    VARCHAR(191) NOT NULL,
  `day_no`          INT          NULL,
  `module_id`       VARCHAR(191) NULL,
  `assessment_name` VARCHAR(191) NOT NULL,
  `sort_order`      INT          NOT NULL DEFAULT 0,
  `passing_pct`     DOUBLE       NOT NULL DEFAULT 60,
  `attempt_limit`   INT          NOT NULL DEFAULT 3,
  `time_limit_mins` INT          NOT NULL DEFAULT 30,
  `active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `instructions`    TEXT         NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `assessment_master_assessment_id_key` (`assessment_id`),
  KEY `assessment_master_classroom_id_fkey` (`classroom_id`),
  KEY `assessment_master_module_id_fkey` (`module_id`),
  CONSTRAINT `assessment_master_classroom_id_fkey`
    FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master` (`classroom_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `assessment_master_module_id_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `module_master` (`module_id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `question_bank` (
  `id`             VARCHAR(36)  NOT NULL,
  `question_id`    VARCHAR(191) NOT NULL,
  `assessment_id`  VARCHAR(191) NOT NULL,
  `question_text`  TEXT         NOT NULL,
  `option_a`       TEXT         NOT NULL,
  `option_b`       TEXT         NOT NULL,
  `option_c`       TEXT         NULL,
  `option_d`       TEXT         NULL,
  `correct_option` VARCHAR(191) NOT NULL,
  `marks`          DOUBLE       NOT NULL DEFAULT 1,
  `negative_marks` DOUBLE       NOT NULL DEFAULT 0,
  `difficulty`     VARCHAR(191) NOT NULL DEFAULT 'Medium',
  `active`         TINYINT(1)   NOT NULL DEFAULT 1,
  `explanation`    TEXT         NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `question_bank_question_id_key` (`question_id`),
  KEY `question_bank_assessment_id_fkey` (`assessment_id`),
  CONSTRAINT `question_bank_assessment_id_fkey`
    FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master` (`assessment_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assessment_attempts` (
  `id`                VARCHAR(36)  NOT NULL,
  `attempt_id`        VARCHAR(191) NOT NULL,
  `employee_id`       VARCHAR(191) NOT NULL,
  `assessment_id`     VARCHAR(191) NOT NULL,
  `attempt_no`        INT          NOT NULL,
  `started_at`        DATETIME(3)  NOT NULL,
  `submitted_at`      DATETIME(3)  NULL,
  `time_taken_seconds` INT         NOT NULL DEFAULT 0,
  `total_questions`   INT          NOT NULL DEFAULT 0,
  `correct_answers`   INT          NOT NULL DEFAULT 0,
  `wrong_answers`     INT          NOT NULL DEFAULT 0,
  `blank_answers`     INT          NOT NULL DEFAULT 0,
  `score`             DOUBLE       NOT NULL DEFAULT 0,
  `percentage`        DOUBLE       NOT NULL DEFAULT 0,
  `result`            VARCHAR(191) NOT NULL DEFAULT 'Fail',
  `answer_json`       JSON         NULL,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `assessment_attempts_attempt_id_key` (`attempt_id`),
  KEY `assessment_attempts_assessment_id_fkey` (`assessment_id`),
  CONSTRAINT `assessment_attempts_assessment_id_fkey`
    FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master` (`assessment_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assessment_results` (
  `id`             VARCHAR(36)  NOT NULL,
  `employee_id`    VARCHAR(191) NOT NULL,
  `batch_no`       VARCHAR(191) NULL,
  `classroom_id`   VARCHAR(191) NOT NULL,
  `assessment_id`  VARCHAR(191) NOT NULL,
  `best_score`     DOUBLE       NOT NULL DEFAULT 0,
  `best_percentage` DOUBLE      NOT NULL DEFAULT 0,
  `result`         VARCHAR(191) NOT NULL DEFAULT 'Fail',
  `total_attempts` INT          NOT NULL DEFAULT 0,
  `last_attempt_at` DATETIME(3) NULL,
  `updated_at`     DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `assessment_results_employee_id_assessment_id_key` (`employee_id`, `assessment_id`),
  KEY `assessment_results_assessment_id_fkey` (`assessment_id`),
  CONSTRAINT `assessment_results_assessment_id_fkey`
    FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master` (`assessment_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CONTENT TRACKING ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `content_progress` (
  `id`                    VARCHAR(36)  NOT NULL,
  `employee_id`           VARCHAR(191) NOT NULL,
  `classroom_id`          VARCHAR(191) NOT NULL,
  `day_no`                INT          NOT NULL,
  `module_id`             VARCHAR(191) NOT NULL,
  `content_id`            VARCHAR(191) NOT NULL,
  `opened`                TINYINT(1)   NOT NULL DEFAULT 0,
  `open_count`            INT          NOT NULL DEFAULT 0,
  `first_opened_at`       DATETIME(3)  NULL,
  `last_opened_at`        DATETIME(3)  NULL,
  `total_seconds_spent`   INT          NOT NULL DEFAULT 0,
  `last_position_seconds` INT          NOT NULL DEFAULT 0,
  `media_duration_seconds` INT         NOT NULL DEFAULT 0,
  `required_seconds`      INT          NOT NULL DEFAULT 0,
  `completion_pct`        DOUBLE       NOT NULL DEFAULT 0,
  `completion_status`     VARCHAR(191) NOT NULL DEFAULT 'Not Started',
  `completed_at`          DATETIME(3)  NULL,
  `player_mode`           VARCHAR(191) NOT NULL DEFAULT 'Auto',
  `updated_at`            DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `content_progress_employee_id_content_id_key` (`employee_id`, `content_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `video_watch_log` (
  `id`               VARCHAR(36)  NOT NULL,
  `employee_id`      VARCHAR(191) NOT NULL,
  `batch_no`         VARCHAR(191) NULL,
  `classroom_id`     VARCHAR(191) NOT NULL,
  `day_no`           INT          NOT NULL,
  `module_id`        VARCHAR(191) NOT NULL,
  `content_id`       VARCHAR(191) NOT NULL,
  `event`            VARCHAR(191) NOT NULL,
  `seconds_delta`    INT          NOT NULL DEFAULT 0,
  `position_seconds` INT          NOT NULL DEFAULT 0,
  `duration_seconds` INT          NOT NULL DEFAULT 0,
  `completion_pct`   DOUBLE       NOT NULL DEFAULT 0,
  `player_mode`      VARCHAR(191) NOT NULL DEFAULT 'Auto',
  `details`          TEXT         NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Q&A ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `trainee_query_log` (
  `id`                  VARCHAR(36)  NOT NULL,
  `query_id`            VARCHAR(191) NOT NULL,
  `employee_id`         VARCHAR(191) NOT NULL,
  `trainee_name`        VARCHAR(191) NULL,
  `batch_no`            VARCHAR(191) NULL,
  `classroom_id`        VARCHAR(191) NULL,
  `day_no`              INT          NULL,
  `module_id`           VARCHAR(191) NULL,
  `category`            VARCHAR(191) NOT NULL DEFAULT 'Process Doubt',
  `question`            TEXT         NOT NULL,
  `status`              VARCHAR(191) NOT NULL DEFAULT 'Open',
  `priority`            VARCHAR(191) NOT NULL DEFAULT 'Normal',
  `coordinator_answer`  LONGTEXT     NULL,
  `answered_by`         VARCHAR(191) NULL,
  `answered_at`         DATETIME(3)  NULL,
  `closed_at`           DATETIME(3)  NULL,
  `resolution_tat_hours` DOUBLE      NULL,
  `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`          DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trainee_query_log_query_id_key` (`query_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ATTENDANCE ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `attendance_inference` (
  `id`                VARCHAR(36)  NOT NULL,
  `date`              DATETIME(3)  NOT NULL,
  `batch_no`          VARCHAR(191) NOT NULL,
  `employee_id`       VARCHAR(191) NOT NULL,
  `trainee_name`      VARCHAR(191) NULL,
  `branch`            VARCHAR(191) NULL,
  `process`           VARCHAR(191) NULL,
  `lob`               VARCHAR(191) NULL,
  `course_activity`   TINYINT(1)   NOT NULL DEFAULT 0,
  `mcq_activity`      TINYINT(1)   NOT NULL DEFAULT 0,
  `final_attendance`  VARCHAR(191) NOT NULL DEFAULT 'Absent',
  `attendance_source` VARCHAR(191) NOT NULL DEFAULT 'Inferred',
  `remarks`           TEXT         NULL,
  `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendance_inference_date_batch_no_employee_id_key` (`date`, `batch_no`, `employee_id`),
  KEY `attendance_inference_batch_no_fkey` (`batch_no`),
  CONSTRAINT `attendance_inference_batch_no_fkey`
    FOREIGN KEY (`batch_no`) REFERENCES `batch_master` (`batch_no`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── RISK & PENDING ACTIVITIES ───────────────────────────────

CREATE TABLE IF NOT EXISTS `training_risk_log` (
  `id`              VARCHAR(36)  NOT NULL,
  `risk_key`        VARCHAR(191) NOT NULL,
  `employee_id`     VARCHAR(191) NOT NULL,
  `trainee_name`    VARCHAR(191) NULL,
  `batch_no`        VARCHAR(191) NULL,
  `branch`          VARCHAR(191) NULL,
  `process`         VARCHAR(191) NULL,
  `lob`             VARCHAR(191) NULL,
  `classroom_id`    VARCHAR(191) NULL,
  `risk_type`       VARCHAR(191) NOT NULL,
  `risk_title`      VARCHAR(191) NOT NULL,
  `severity`        VARCHAR(191) NOT NULL DEFAULT 'WATCH',
  `current_value`   DOUBLE       NULL,
  `expected_value`  DOUBLE       NULL,
  `reference_id`    VARCHAR(191) NULL,
  `source`          VARCHAR(191) NOT NULL DEFAULT 'Auto',
  `details`         TEXT         NULL,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'Open',
  `action_taken`    TEXT         NULL,
  `action_by`       VARCHAR(191) NULL,
  `action_at`       DATETIME(3)  NULL,
  `follow_up_date`  DATETIME(3)  NULL,
  `closure_remarks` TEXT         NULL,
  `last_seen_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_updated_at` DATETIME(3)  NOT NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `training_risk_log_risk_key_key` (`risk_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pending_activity_log` (
  `id`              VARCHAR(36)  NOT NULL,
  `activity_key`    VARCHAR(191) NOT NULL,
  `activity_type`   VARCHAR(191) NOT NULL,
  `activity_title`  VARCHAR(191) NOT NULL,
  `severity`        VARCHAR(191) NOT NULL DEFAULT 'WATCH',
  `due_date`        DATETIME(3)  NULL,
  `employee_id`     VARCHAR(191) NULL,
  `trainee_name`    VARCHAR(191) NULL,
  `batch_no`        VARCHAR(191) NULL,
  `branch`          VARCHAR(191) NULL,
  `process`         VARCHAR(191) NULL,
  `lob`             VARCHAR(191) NULL,
  `reference_id`    VARCHAR(191) NULL,
  `source`          VARCHAR(191) NOT NULL DEFAULT 'Auto',
  `details`         TEXT         NULL,
  `status`          VARCHAR(191) NOT NULL DEFAULT 'Open',
  `action_taken`    TEXT         NULL,
  `action_by`       VARCHAR(191) NULL,
  `action_at`       DATETIME(3)  NULL,
  `follow_up_date`  DATETIME(3)  NULL,
  `closure_remarks` TEXT         NULL,
  `closed_at`       DATETIME(3)  NULL,
  `last_seen_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_updated_at` DATETIME(3)  NOT NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `pending_activity_log_activity_key_key` (`activity_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── CERTIFICATION ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `certification_rule_master` (
  `id`                    VARCHAR(36)  NOT NULL,
  `rule_id`               VARCHAR(191) NOT NULL,
  `process`               VARCHAR(191) NOT NULL,
  `lob`                   VARCHAR(191) NOT NULL,
  `course_completion_min` DOUBLE       NOT NULL DEFAULT 80,
  `mcq_pass_pct_min`      DOUBLE       NOT NULL DEFAULT 60,
  `attendance_pct_min`    DOUBLE       NOT NULL DEFAULT 70,
  `mock_call_required`    TINYINT(1)   NOT NULL DEFAULT 0,
  `mock_call_pass_pct`    DOUBLE       NOT NULL DEFAULT 60,
  `internal_cert_required` TINYINT(1)  NOT NULL DEFAULT 0,
  `internal_cert_pass_pct` DOUBLE      NOT NULL DEFAULT 60,
  `external_cert_required` TINYINT(1)  NOT NULL DEFAULT 0,
  `external_cert_pass_pct` DOUBLE      NOT NULL DEFAULT 60,
  `active`                TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`            DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `certification_rule_master_rule_id_key` (`rule_id`),
  UNIQUE KEY `certification_rule_master_process_lob_key` (`process`, `lob`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `certification_evidence` (
  `id`            VARCHAR(36)  NOT NULL,
  `employee_id`   VARCHAR(191) NOT NULL,
  `batch_no`      VARCHAR(191) NULL,
  `evidence_type` VARCHAR(191) NOT NULL,
  `result`        VARCHAR(191) NOT NULL,
  `score_pct`     DOUBLE       NOT NULL DEFAULT 0,
  `conducted_by`  VARCHAR(191) NULL,
  `conducted_at`  DATETIME(3)  NULL,
  `remarks`       TEXT         NULL,
  `created_by`    VARCHAR(191) NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ONBOARDING LOG ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `onboarding_log` (
  `id`                   VARCHAR(36)  NOT NULL,
  `batch_no`             VARCHAR(191) NOT NULL,
  `employee_id`          VARCHAR(191) NOT NULL,
  `lms_id`               VARCHAR(191) NULL,
  `trainee_name`         VARCHAR(191) NULL,
  `mobile`               VARCHAR(191) NULL,
  `email`                VARCHAR(191) NULL,
  `coordinator_login_id` VARCHAR(191) NULL,
  `coordinator_name`     VARCHAR(191) NULL,
  `status`               VARCHAR(191) NOT NULL DEFAULT 'Success',
  `remarks`              TEXT         NULL,
  `created_at`           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `onboarding_log_batch_no_fkey` (`batch_no`),
  CONSTRAINT `onboarding_log_batch_no_fkey`
    FOREIGN KEY (`batch_no`) REFERENCES `batch_master` (`batch_no`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── ASSIGNED MODULES ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `assigned_modules` (
  `id`              VARCHAR(36)  NOT NULL,
  `module_id`       VARCHAR(191) NOT NULL,
  `module_name`     VARCHAR(191) NOT NULL,
  `broadcast_title` VARCHAR(191) NULL,
  `assigned_to`     VARCHAR(191) NOT NULL,
  `assigned_to_type` VARCHAR(191) NOT NULL,
  `assignment_type` VARCHAR(191) NOT NULL DEFAULT 'Optional',
  `message`         TEXT         NULL,
  `assigned_by`     VARCHAR(191) NULL,
  `due_date`        DATETIME(3)  NULL,
  `active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── AUDIT & LOGS ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `audit_log` (
  `id`            VARCHAR(36)  NOT NULL,
  `user_identity` VARCHAR(191) NOT NULL,
  `user_role`     VARCHAR(191) NOT NULL,
  `action`        VARCHAR(191) NOT NULL,
  `module`        VARCHAR(191) NULL,
  `reference_id`  VARCHAR(191) NULL,
  `old_value`     LONGTEXT     NULL,
  `new_value`     LONGTEXT     NULL,
  `status`        VARCHAR(191) NOT NULL DEFAULT 'Success',
  `error_details` TEXT         NULL,
  `source`        VARCHAR(191) NOT NULL DEFAULT 'Portal',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_session_log` (
  `id`         VARCHAR(36)  NOT NULL,
  `user_type`  VARCHAR(191) NOT NULL,
  `user_id`    VARCHAR(191) NOT NULL,
  `action`     VARCHAR(191) NOT NULL,
  `status`     VARCHAR(191) NOT NULL DEFAULT 'Success',
  `message`    TEXT         NULL,
  `ip_address` VARCHAR(191) NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `course_completion_report` (
  `id`                  VARCHAR(36)  NOT NULL,
  `employee_id`         VARCHAR(191) NOT NULL,
  `batch_no`            VARCHAR(191) NULL,
  `classroom_id`        VARCHAR(191) NOT NULL,
  `total_contents`      INT          NOT NULL DEFAULT 0,
  `opened_contents`     INT          NOT NULL DEFAULT 0,
  `completion_pct`      DOUBLE       NOT NULL DEFAULT 0,
  `total_seconds_spent` INT          NOT NULL DEFAULT 0,
  `status`              VARCHAR(191) NOT NULL DEFAULT 'In Progress',
  `updated_at`          DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `course_completion_report_employee_id_classroom_id_key` (`employee_id`, `classroom_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── HISTORICAL METRICS ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS `historical_training_kpi` (
  `id`               VARCHAR(36)  NOT NULL,
  `period`           VARCHAR(191) NOT NULL,
  `branch`           VARCHAR(191) NULL,
  `process`          VARCHAR(191) NULL,
  `lob`              VARCHAR(191) NULL,
  `active_batches`   INT          NOT NULL DEFAULT 0,
  `total_trainees`   INT          NOT NULL DEFAULT 0,
  `avg_course_pct`   DOUBLE       NOT NULL DEFAULT 0,
  `avg_mcq_pct`      DOUBLE       NOT NULL DEFAULT 0,
  `avg_attendance_pct` DOUBLE     NOT NULL DEFAULT 0,
  `certified_count`  INT          NOT NULL DEFAULT 0,
  `certification_pct` DOUBLE      NOT NULL DEFAULT 0,
  `critical_risks`   INT          NOT NULL DEFAULT 0,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `historical_training_kpi_period_branch_process_lob_key` (`period`, `branch`, `process`, `lob`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `drive_files` (
  `id`             VARCHAR(36)  NOT NULL,
  `drive_file_id`  VARCHAR(191) NOT NULL,
  `drive_folder_id` VARCHAR(191) NULL,
  `file_name`      VARCHAR(191) NOT NULL,
  `mime_type`      VARCHAR(191) NOT NULL,
  `drive_url`      TEXT         NOT NULL,
  `thumbnail_url`  TEXT         NULL,
  `size`           BIGINT       NULL,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `synced_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `drive_files_drive_file_id_key` (`drive_file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sequence_counter` (
  `key`   VARCHAR(191) NOT NULL,
  `value` INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─── Initial sequence counter seed ───────────────────────────
INSERT IGNORE INTO `sequence_counter` (`key`, `value`) VALUES ('batch_seq', 0);

CREATE TABLE IF NOT EXISTS `communication_config` (
  `id`                                VARCHAR(36)   NOT NULL DEFAULT 'default',
  `smtp_host`                         VARCHAR(191)  NOT NULL DEFAULT 'smtp.gmail.com',
  `smtp_port`                         INT           NOT NULL DEFAULT 587,
  `smtp_user`                         VARCHAR(191)  NOT NULL DEFAULT '',
  `smtp_pass`                         VARCHAR(500)  NOT NULL DEFAULT '',
  `email_from`                        VARCHAR(191)  NOT NULL DEFAULT '',
  `smtp_enabled`                      TINYINT(1)    NOT NULL DEFAULT 0,
  `msg91_auth_key`                    VARCHAR(500)  NOT NULL DEFAULT '',
  `msg91_sender_id`                   VARCHAR(191)  NOT NULL DEFAULT 'MCNLMS',
  `msg91_template_id`                 VARCHAR(191)  NOT NULL DEFAULT '',
  `sms_enabled`                       TINYINT(1)    NOT NULL DEFAULT 0,
  `msg91_whatsapp_token`              VARCHAR(500)  NOT NULL DEFAULT '',
  `msg91_whatsapp_integrated_number`  VARCHAR(191)  NOT NULL DEFAULT '',
  `whatsapp_enabled`                  TINYINT(1)    NOT NULL DEFAULT 0,
  `updated_at`                        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by`                        VARCHAR(191)  NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `communication_config` (`id`) VALUES ('default');

-- ─── SCORM ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `scorm_packages` (
  `id`           VARCHAR(36)   NOT NULL,
  `package_id`   VARCHAR(191)  NOT NULL,
  `content_id`   VARCHAR(191)  NOT NULL,
  `module_id`    VARCHAR(191)  NOT NULL,
  `title`        VARCHAR(500)  NOT NULL,
  `scorm_version` VARCHAR(20)  NOT NULL DEFAULT '1.2',
  `entry_point`  VARCHAR(1000) NOT NULL,
  `package_path` VARCHAR(1000) NOT NULL,
  `package_url`  VARCHAR(1000) NOT NULL,
  `mastery`      INT           NOT NULL DEFAULT 80,
  `active`       TINYINT(1)    NOT NULL DEFAULT 1,
  `uploaded_by`  VARCHAR(191)  NULL,
  `created_at`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `scorm_packages_package_id_key` (`package_id`),
  UNIQUE KEY `scorm_packages_content_id_key` (`content_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `scorm_sessions` (
  `id`                VARCHAR(36)   NOT NULL,
  `package_id`        VARCHAR(191)  NOT NULL,
  `employee_id`       VARCHAR(191)  NOT NULL,
  `completion_status` VARCHAR(50)   NOT NULL DEFAULT 'not attempted',
  `success_status`    VARCHAR(50)   NOT NULL DEFAULT 'unknown',
  `score_raw`         FLOAT         NULL,
  `score_max`         FLOAT         NULL,
  `score_min`         FLOAT         NULL,
  `score_scaled`      FLOAT         NULL,
  `total_time`        VARCHAR(50)   NULL,
  `suspend_data`      TEXT          NULL,
  `location`          VARCHAR(500)  NULL,
  `exit_status`       VARCHAR(50)   NULL,
  `launch_data`       TEXT          NULL,
  `attempts`          INT           NOT NULL DEFAULT 0,
  `last_accessed_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `scorm_sessions_package_employee_key` (`package_id`, `employee_id`),
  INDEX `scorm_sessions_employee_id_idx` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ─── Done ─────────────────────────────────────────────────────
-- All 33 tables created. Run `npx prisma generate` to regenerate the Prisma client.
