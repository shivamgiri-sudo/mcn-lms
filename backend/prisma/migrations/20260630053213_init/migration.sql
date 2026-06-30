-- CreateTable
CREATE TABLE `role_access_matrix` (
    `id` VARCHAR(191) NOT NULL,
    `login_id` VARCHAR(191) NOT NULL,
    `pin` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'Coordinator',
    `portal_access` VARCHAR(191) NOT NULL DEFAULT 'Coordinator',
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `designation` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `employee_code` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `can_create_batch` BOOLEAN NOT NULL DEFAULT false,
    `can_onboard_trainee` BOOLEAN NOT NULL DEFAULT false,
    `can_upload_lms_report` BOOLEAN NOT NULL DEFAULT false,
    `can_override_attendance` BOOLEAN NOT NULL DEFAULT false,
    `can_close_batch` BOOLEAN NOT NULL DEFAULT false,
    `can_view_management_dashboard` BOOLEAN NOT NULL DEFAULT false,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `last_login` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `role_access_matrix_login_id_key`(`login_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `branch_master` (
    `id` VARCHAR(191) NOT NULL,
    `branch_name` VARCHAR(191) NOT NULL,
    `branch_code` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `branch_master_branch_name_key`(`branch_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `designation_master` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `designation_master_title_key`(`title`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_master` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `department_master_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `portal_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `user_type` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `portal_sessions_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `process_lob_master` (
    `id` VARCHAR(191) NOT NULL,
    `process` VARCHAR(191) NOT NULL,
    `lob` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,

    UNIQUE INDEX `process_lob_master_process_lob_key`(`process`, `lob`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `batch_master` (
    `id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `batch_name` VARCHAR(191) NOT NULL,
    `batch_type` VARCHAR(191) NOT NULL DEFAULT 'NHT',
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `classroom_name` VARCHAR(191) NULL,
    `classroom_assigned_at` DATETIME(3) NULL,
    `classroom_assigned_by` VARCHAR(191) NULL,
    `coordinator_name` VARCHAR(191) NULL,
    `coordinator_login_id` VARCHAR(191) NULL,
    `batch_status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `start_date` DATETIME(3) NULL,
    `end_date` DATETIME(3) NULL,
    `expected_trainees` INTEGER NOT NULL DEFAULT 0,
    `total_trainees` INTEGER NOT NULL DEFAULT 0,
    `ojt_ready` INTEGER NOT NULL DEFAULT 0,
    `certified` INTEGER NOT NULL DEFAULT 0,
    `handover_to_ops` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `last_updated_at` DATETIME(3) NOT NULL,
    `remarks` TEXT NULL,

    UNIQUE INDEX `batch_master_batch_no_key`(`batch_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `batch_classroom_map` (
    `id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `batch_name` VARCHAR(191) NOT NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `classroom_name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `assigned_by` VARCHAR(191) NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `remarks` TEXT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainee_master` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `lms_id` VARCHAR(191) NULL,
    `trainee_name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `classroom_name` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `doj` DATETIME(3) NULL,
    `onboarding_date` DATETIME(3) NULL,
    `onboarding_status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `course_completion_pct` DOUBLE NOT NULL DEFAULT 0,
    `assessment_attempt_pct` DOUBLE NOT NULL DEFAULT 0,
    `assessment_pass_pct` DOUBLE NOT NULL DEFAULT 0,
    `attendance_pct` DOUBLE NOT NULL DEFAULT 0,
    `risk_status` VARCHAR(191) NOT NULL DEFAULT 'HEALTHY',
    `risk_reason` TEXT NULL,
    `ojt_ready` BOOLEAN NOT NULL DEFAULT false,
    `nesting_status` VARCHAR(191) NULL,
    `certification_status` VARCHAR(191) NOT NULL DEFAULT 'Not Certified',
    `handover_to_ops` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` VARCHAR(191) NULL,
    `last_updated_at` DATETIME(3) NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'Manual',
    `emp_id_type` VARCHAR(191) NOT NULL DEFAULT 'PERMANENT',
    `permanent_emp_id` VARCHAR(191) NULL,
    `emp_id_mapped_at` DATETIME(3) NULL,

    UNIQUE INDEX `trainee_master_employee_id_key`(`employee_id`),
    UNIQUE INDEX `trainee_master_lms_id_key`(`lms_id`),
    UNIQUE INDEX `trainee_master_permanent_emp_id_key`(`permanent_emp_id`),
    INDEX `trainee_master_batch_no_idx`(`batch_no`),
    INDEX `trainee_master_branch_idx`(`branch`),
    INDEX `trainee_master_process_lob_idx`(`process`, `lob`),
    INDEX `trainee_master_certification_status_idx`(`certification_status`),
    INDEX `trainee_master_risk_status_idx`(`risk_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `admin_user_master` (
    `id` VARCHAR(191) NOT NULL,
    `admin_id` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `salt` VARCHAR(191) NOT NULL,
    `admin_name` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'Admin',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `last_login` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `admin_user_master_admin_id_key`(`admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_master` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `salt` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `force_password_reset` BOOLEAN NOT NULL DEFAULT true,
    `failed_attempts` INTEGER NOT NULL DEFAULT 0,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `last_login` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_master_employee_id_key`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classroom_master` (
    `id` VARCHAR(191) NOT NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `classroom_name` VARCHAR(191) NOT NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `drive_folder_id` VARCHAR(191) NULL,
    `drive_folder_url` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `classroom_master_classroom_id_key`(`classroom_id`),
    INDEX `classroom_master_branch_idx`(`branch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `module_master` (
    `id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `day_no` INTEGER NOT NULL,
    `module_title` VARCHAR(191) NOT NULL,
    `module_order` INTEGER NOT NULL DEFAULT 0,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `module_master_module_id_key`(`module_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_master` (
    `id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `content_type` VARCHAR(191) NOT NULL,
    `content_title` VARCHAR(191) NOT NULL,
    `drive_file_id` VARCHAR(191) NULL,
    `drive_url` TEXT NULL,
    `direct_media_url` TEXT NULL,
    `local_file_path` TEXT NULL,
    `player_mode` VARCHAR(191) NOT NULL DEFAULT 'Auto',
    `content_order` INTEGER NOT NULL DEFAULT 0,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `estimated_mins` INTEGER NOT NULL DEFAULT 0,
    `completion_rule_pct` DOUBLE NOT NULL DEFAULT 80,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `content_master_content_id_key`(`content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `faq_master` (
    `id` VARCHAR(191) NOT NULL,
    `faq_id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `answer` LONGTEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `faq_master_faq_id_key`(`faq_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainee_classroom_map` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `assigned_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `active` BOOLEAN NOT NULL DEFAULT true,
    `assigned_by` VARCHAR(191) NULL,
    `remarks` TEXT NULL,

    UNIQUE INDEX `trainee_classroom_map_employee_id_classroom_id_key`(`employee_id`, `classroom_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_master` (
    `id` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `day_no` INTEGER NULL,
    `module_id` VARCHAR(191) NULL,
    `assessment_name` VARCHAR(191) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `passing_pct` DOUBLE NOT NULL DEFAULT 60,
    `attempt_limit` INTEGER NOT NULL DEFAULT 3,
    `time_limit_mins` INTEGER NOT NULL DEFAULT 30,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `instructions` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assessment_master_assessment_id_key`(`assessment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_bank` (
    `id` VARCHAR(191) NOT NULL,
    `question_id` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `question_text` TEXT NOT NULL,
    `option_a` TEXT NOT NULL,
    `option_b` TEXT NOT NULL,
    `option_c` TEXT NULL,
    `option_d` TEXT NULL,
    `correct_option` VARCHAR(191) NOT NULL,
    `marks` DOUBLE NOT NULL DEFAULT 1,
    `negative_marks` DOUBLE NOT NULL DEFAULT 0,
    `difficulty` VARCHAR(191) NOT NULL DEFAULT 'Medium',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `explanation` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `question_bank_question_id_key`(`question_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_attempts` (
    `id` VARCHAR(191) NOT NULL,
    `attempt_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `attempt_no` INTEGER NOT NULL,
    `started_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `time_taken_seconds` INTEGER NOT NULL DEFAULT 0,
    `total_questions` INTEGER NOT NULL DEFAULT 0,
    `correct_answers` INTEGER NOT NULL DEFAULT 0,
    `wrong_answers` INTEGER NOT NULL DEFAULT 0,
    `blank_answers` INTEGER NOT NULL DEFAULT 0,
    `score` DOUBLE NOT NULL DEFAULT 0,
    `percentage` DOUBLE NOT NULL DEFAULT 0,
    `result` VARCHAR(191) NOT NULL DEFAULT 'Fail',
    `answer_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assessment_attempts_attempt_id_key`(`attempt_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_results` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `best_score` DOUBLE NOT NULL DEFAULT 0,
    `best_percentage` DOUBLE NOT NULL DEFAULT 0,
    `result` VARCHAR(191) NOT NULL DEFAULT 'Fail',
    `total_attempts` INTEGER NOT NULL DEFAULT 0,
    `last_attempt_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assessment_results_employee_id_classroom_id_idx`(`employee_id`, `classroom_id`),
    INDEX `assessment_results_classroom_id_idx`(`classroom_id`),
    UNIQUE INDEX `assessment_results_employee_id_assessment_id_key`(`employee_id`, `assessment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `content_progress` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `day_no` INTEGER NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `opened` BOOLEAN NOT NULL DEFAULT false,
    `open_count` INTEGER NOT NULL DEFAULT 0,
    `first_opened_at` DATETIME(3) NULL,
    `last_opened_at` DATETIME(3) NULL,
    `total_seconds_spent` INTEGER NOT NULL DEFAULT 0,
    `last_position_seconds` INTEGER NOT NULL DEFAULT 0,
    `media_duration_seconds` INTEGER NOT NULL DEFAULT 0,
    `required_seconds` INTEGER NOT NULL DEFAULT 0,
    `completion_pct` DOUBLE NOT NULL DEFAULT 0,
    `completion_status` VARCHAR(191) NOT NULL DEFAULT 'Not Started',
    `completed_at` DATETIME(3) NULL,
    `player_mode` VARCHAR(191) NOT NULL DEFAULT 'Auto',
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `content_progress_employee_id_classroom_id_idx`(`employee_id`, `classroom_id`),
    INDEX `content_progress_classroom_id_idx`(`classroom_id`),
    UNIQUE INDEX `content_progress_employee_id_content_id_key`(`employee_id`, `content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `video_watch_log` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `day_no` INTEGER NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `seconds_delta` INTEGER NOT NULL DEFAULT 0,
    `position_seconds` INTEGER NOT NULL DEFAULT 0,
    `duration_seconds` INTEGER NOT NULL DEFAULT 0,
    `completion_pct` DOUBLE NOT NULL DEFAULT 0,
    `player_mode` VARCHAR(191) NOT NULL DEFAULT 'Auto',
    `details` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `video_watch_log_employee_id_classroom_id_idx`(`employee_id`, `classroom_id`),
    INDEX `video_watch_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trainee_query_log` (
    `id` VARCHAR(191) NOT NULL,
    `query_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `day_no` INTEGER NULL,
    `module_id` VARCHAR(191) NULL,
    `category` VARCHAR(191) NOT NULL DEFAULT 'Process Doubt',
    `question` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Open',
    `priority` VARCHAR(191) NOT NULL DEFAULT 'Normal',
    `coordinator_answer` LONGTEXT NULL,
    `answered_by` VARCHAR(191) NULL,
    `answered_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `resolution_tat_hours` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trainee_query_log_query_id_key`(`query_id`),
    INDEX `trainee_query_log_employee_id_idx`(`employee_id`),
    INDEX `trainee_query_log_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_inference` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `course_activity` BOOLEAN NOT NULL DEFAULT false,
    `mcq_activity` BOOLEAN NOT NULL DEFAULT false,
    `final_attendance` VARCHAR(191) NOT NULL DEFAULT 'Absent',
    `attendance_source` VARCHAR(191) NOT NULL DEFAULT 'Inferred',
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendance_inference_date_batch_no_employee_id_key`(`date`, `batch_no`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_risk_log` (
    `id` VARCHAR(191) NOT NULL,
    `risk_key` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `risk_type` VARCHAR(191) NOT NULL,
    `risk_title` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'WATCH',
    `current_value` DOUBLE NULL,
    `expected_value` DOUBLE NULL,
    `reference_id` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'Auto',
    `details` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Open',
    `action_taken` TEXT NULL,
    `action_by` VARCHAR(191) NULL,
    `action_at` DATETIME(3) NULL,
    `follow_up_date` DATETIME(3) NULL,
    `closure_remarks` TEXT NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `training_risk_log_risk_key_key`(`risk_key`),
    INDEX `training_risk_log_employee_id_idx`(`employee_id`),
    INDEX `training_risk_log_status_severity_idx`(`status`, `severity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pending_activity_log` (
    `id` VARCHAR(191) NOT NULL,
    `activity_key` VARCHAR(191) NOT NULL,
    `activity_type` VARCHAR(191) NOT NULL,
    `activity_title` VARCHAR(191) NOT NULL,
    `severity` VARCHAR(191) NOT NULL DEFAULT 'WATCH',
    `due_date` DATETIME(3) NULL,
    `employee_id` VARCHAR(191) NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'Auto',
    `details` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Open',
    `action_taken` TEXT NULL,
    `action_by` VARCHAR(191) NULL,
    `action_at` DATETIME(3) NULL,
    `follow_up_date` DATETIME(3) NULL,
    `closure_remarks` TEXT NULL,
    `closed_at` DATETIME(3) NULL,
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `pending_activity_log_activity_key_key`(`activity_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certification_rule_master` (
    `id` VARCHAR(191) NOT NULL,
    `rule_id` VARCHAR(191) NOT NULL,
    `process` VARCHAR(191) NOT NULL,
    `lob` VARCHAR(191) NOT NULL,
    `course_completion_min` DOUBLE NOT NULL DEFAULT 80,
    `mcq_pass_pct_min` DOUBLE NOT NULL DEFAULT 60,
    `attendance_pct_min` DOUBLE NOT NULL DEFAULT 70,
    `mock_call_required` BOOLEAN NOT NULL DEFAULT false,
    `mock_call_pass_pct` DOUBLE NOT NULL DEFAULT 60,
    `internal_cert_required` BOOLEAN NOT NULL DEFAULT false,
    `internal_cert_pass_pct` DOUBLE NOT NULL DEFAULT 60,
    `external_cert_required` BOOLEAN NOT NULL DEFAULT false,
    `external_cert_pass_pct` DOUBLE NOT NULL DEFAULT 60,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `certification_rule_master_rule_id_key`(`rule_id`),
    UNIQUE INDEX `certification_rule_master_process_lob_key`(`process`, `lob`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certification_evidence` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `evidence_type` VARCHAR(191) NOT NULL,
    `result` VARCHAR(191) NOT NULL,
    `score_pct` DOUBLE NOT NULL DEFAULT 0,
    `conducted_by` VARCHAR(191) NULL,
    `conducted_at` DATETIME(3) NULL,
    `remarks` TEXT NULL,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `onboarding_log` (
    `id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `lms_id` VARCHAR(191) NULL,
    `trainee_name` VARCHAR(191) NULL,
    `mobile` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `coordinator_login_id` VARCHAR(191) NULL,
    `coordinator_name` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Success',
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assigned_modules` (
    `id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `module_name` VARCHAR(191) NOT NULL,
    `broadcast_title` VARCHAR(191) NULL,
    `assigned_to` VARCHAR(191) NOT NULL,
    `assigned_to_type` VARCHAR(191) NOT NULL,
    `assignment_type` VARCHAR(191) NOT NULL DEFAULT 'Optional',
    `message` TEXT NULL,
    `assigned_by` VARCHAR(191) NULL,
    `due_date` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `user_identity` VARCHAR(191) NOT NULL,
    `user_role` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NULL,
    `reference_id` VARCHAR(191) NULL,
    `old_value` LONGTEXT NULL,
    `new_value` LONGTEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Success',
    `error_details` TEXT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'Portal',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_action_idx`(`action`),
    INDEX `audit_log_user_identity_idx`(`user_identity`),
    INDEX `audit_log_created_at_idx`(`created_at`),
    INDEX `audit_log_module_idx`(`module`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_session_log` (
    `id` VARCHAR(191) NOT NULL,
    `user_type` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Success',
    `message` TEXT NULL,
    `ip_address` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_completion_report` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NOT NULL,
    `total_contents` INTEGER NOT NULL DEFAULT 0,
    `opened_contents` INTEGER NOT NULL DEFAULT 0,
    `completion_pct` DOUBLE NOT NULL DEFAULT 0,
    `total_seconds_spent` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'In Progress',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_completion_report_employee_id_classroom_id_key`(`employee_id`, `classroom_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `historical_training_kpi` (
    `id` VARCHAR(191) NOT NULL,
    `period` VARCHAR(191) NOT NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `active_batches` INTEGER NOT NULL DEFAULT 0,
    `total_trainees` INTEGER NOT NULL DEFAULT 0,
    `avg_course_pct` DOUBLE NOT NULL DEFAULT 0,
    `avg_mcq_pct` DOUBLE NOT NULL DEFAULT 0,
    `avg_attendance_pct` DOUBLE NOT NULL DEFAULT 0,
    `certified_count` INTEGER NOT NULL DEFAULT 0,
    `certification_pct` DOUBLE NOT NULL DEFAULT 0,
    `critical_risks` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `historical_training_kpi_period_branch_process_lob_key`(`period`, `branch`, `process`, `lob`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drive_files` (
    `id` VARCHAR(191) NOT NULL,
    `drive_file_id` VARCHAR(191) NOT NULL,
    `drive_folder_id` VARCHAR(191) NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `drive_url` TEXT NOT NULL,
    `thumbnail_url` TEXT NULL,
    `size` BIGINT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `drive_files_drive_file_id_key`(`drive_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sequence_counter` (
    `key` VARCHAR(191) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communication_config` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `smtp_host` VARCHAR(191) NOT NULL DEFAULT 'smtp.gmail.com',
    `smtp_port` INTEGER NOT NULL DEFAULT 587,
    `smtp_user` VARCHAR(191) NOT NULL DEFAULT '',
    `smtp_pass` VARCHAR(500) NOT NULL DEFAULT '',
    `email_from` VARCHAR(191) NOT NULL DEFAULT '',
    `smtp_enabled` BOOLEAN NOT NULL DEFAULT false,
    `msg91_auth_key` VARCHAR(500) NOT NULL DEFAULT '',
    `msg91_sender_id` VARCHAR(191) NOT NULL DEFAULT 'MCNLMS',
    `msg91_template_id` VARCHAR(191) NOT NULL DEFAULT '',
    `sms_enabled` BOOLEAN NOT NULL DEFAULT false,
    `msg91_whatsapp_token` VARCHAR(500) NOT NULL DEFAULT '',
    `msg91_whatsapp_integrated_number` VARCHAR(191) NOT NULL DEFAULT '',
    `whatsapp_enabled` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_config` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `notify_onboard` BOOLEAN NOT NULL DEFAULT true,
    `notify_password_reset` BOOLEAN NOT NULL DEFAULT true,
    `notify_certification` BOOLEAN NOT NULL DEFAULT true,
    `notify_batch_assignment` BOOLEAN NOT NULL DEFAULT true,
    `notify_module_assigned` BOOLEAN NOT NULL DEFAULT true,
    `deadline_reminder_days` INTEGER NOT NULL DEFAULT 1,
    `deadline_reminder_enabled` BOOLEAN NOT NULL DEFAULT true,
    `deadline_reminder_time` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `completion_reminder_enabled` BOOLEAN NOT NULL DEFAULT true,
    `completion_reminder_days` INTEGER NOT NULL DEFAULT 2,
    `completion_reminder_time` VARCHAR(191) NOT NULL DEFAULT '10:00',
    `daily_coverage_enabled` BOOLEAN NOT NULL DEFAULT true,
    `daily_coverage_time` VARCHAR(191) NOT NULL DEFAULT '08:00',
    `daily_coverage_recipients` VARCHAR(2000) NOT NULL DEFAULT '',
    `coordinator_alert_enabled` BOOLEAN NOT NULL DEFAULT true,
    `coordinator_alert_time` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `coordinator_alert_min_risk` VARCHAR(191) NOT NULL DEFAULT 'HIGH',
    `pending_activity_alert_enabled` BOOLEAN NOT NULL DEFAULT true,
    `pending_activity_alert_time` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `pending_activity_alert_days` INTEGER NOT NULL DEFAULT 1,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scorm_packages` (
    `id` VARCHAR(191) NOT NULL,
    `package_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `scorm_version` VARCHAR(191) NOT NULL,
    `entry_point` VARCHAR(191) NOT NULL,
    `package_path` VARCHAR(191) NOT NULL,
    `package_url` VARCHAR(191) NOT NULL,
    `mastery` INTEGER NOT NULL DEFAULT 80,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `uploaded_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scorm_packages_package_id_key`(`package_id`),
    UNIQUE INDEX `scorm_packages_content_id_key`(`content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scorm_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `package_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `completion_status` VARCHAR(191) NOT NULL DEFAULT 'not attempted',
    `success_status` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `score_raw` DOUBLE NULL,
    `score_max` DOUBLE NULL,
    `score_min` DOUBLE NULL,
    `score_scaled` DOUBLE NULL,
    `total_time` VARCHAR(191) NULL,
    `suspend_data` TEXT NULL,
    `location` VARCHAR(191) NULL,
    `exit_status` VARCHAR(191) NULL,
    `launch_data` TEXT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_accessed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `scorm_sessions_package_id_employee_id_key`(`package_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `batch_classroom_map` ADD CONSTRAINT `batch_classroom_map_batch_no_fkey` FOREIGN KEY (`batch_no`) REFERENCES `batch_master`(`batch_no`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trainee_master` ADD CONSTRAINT `trainee_master_batch_no_fkey` FOREIGN KEY (`batch_no`) REFERENCES `batch_master`(`batch_no`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_master` ADD CONSTRAINT `user_master_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `trainee_master`(`employee_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `module_master` ADD CONSTRAINT `module_master_classroom_id_fkey` FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master`(`classroom_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `content_master` ADD CONSTRAINT `content_master_module_id_fkey` FOREIGN KEY (`module_id`) REFERENCES `module_master`(`module_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `faq_master` ADD CONSTRAINT `faq_master_module_id_fkey` FOREIGN KEY (`module_id`) REFERENCES `module_master`(`module_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trainee_classroom_map` ADD CONSTRAINT `trainee_classroom_map_classroom_id_fkey` FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master`(`classroom_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_master` ADD CONSTRAINT `assessment_master_classroom_id_fkey` FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master`(`classroom_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_master` ADD CONSTRAINT `assessment_master_module_id_fkey` FOREIGN KEY (`module_id`) REFERENCES `module_master`(`module_id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_bank` ADD CONSTRAINT `question_bank_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master`(`assessment_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_attempts` ADD CONSTRAINT `assessment_attempts_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master`(`assessment_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_results` ADD CONSTRAINT `assessment_results_assessment_id_fkey` FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master`(`assessment_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_inference` ADD CONSTRAINT `attendance_inference_batch_no_fkey` FOREIGN KEY (`batch_no`) REFERENCES `batch_master`(`batch_no`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `onboarding_log` ADD CONSTRAINT `onboarding_log_batch_no_fkey` FOREIGN KEY (`batch_no`) REFERENCES `batch_master`(`batch_no`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorm_sessions` ADD CONSTRAINT `scorm_sessions_package_id_fkey` FOREIGN KEY (`package_id`) REFERENCES `scorm_packages`(`package_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
