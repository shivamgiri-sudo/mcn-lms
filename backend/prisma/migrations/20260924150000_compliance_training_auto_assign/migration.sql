-- CreateTable: compliance_training_settings
-- Singleton (id is always "default"), same convention as
-- daily_batch_report_settings/typing_test_settings/notification_config.
CREATE TABLE `compliance_training_settings` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `module_id` VARCHAR(191) NULL,
    `module_name` VARCHAR(191) NULL,
    `assessment_id` VARCHAR(191) NULL,
    `assessment_name` VARCHAR(191) NULL,
    `assignment_type` VARCHAR(191) NOT NULL DEFAULT 'Mandatory',
    `due_days` INTEGER NOT NULL DEFAULT 0,
    `eligible_processes` TEXT NULL,
    `eligible_lobs` TEXT NULL,
    `eligible_branches` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `compliance_training_settings`
  (`id`, `enabled`, `assignment_type`, `due_days`, `updated_at`, `updated_by`)
VALUES
  ('default', false, 'Mandatory', 0, CURRENT_TIMESTAMP(3), 'system');

-- CreateTable: compliance_assignment_log
-- Append-only audit trail of every auto-assignment decision (assigned,
-- skipped as duplicate, skipped as ineligible, or skipped because compliance
-- training isn't configured) for a new trainee.
CREATE TABLE `compliance_assignment_log` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `module_id` VARCHAR(191) NULL,
    `assessment_id` VARCHAR(191) NULL,
    `trigger_source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `compliance_assignment_log_employee_id_idx`(`employee_id`),
    INDEX `compliance_assignment_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
