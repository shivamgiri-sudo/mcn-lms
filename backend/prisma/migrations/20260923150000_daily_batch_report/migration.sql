-- AlterTable: admin_user_master
-- Daily Batch Report resolves "Branch Head" as the branch-scoped Admin(s) for a
-- batch's branch (the only scoping dimension admins actually have -- there is no
-- per-process admin concept). admin_user_master never had an email column at
-- all, so that resolution had no address to send to until now.
ALTER TABLE `admin_user_master` ADD COLUMN `email` VARCHAR(191) NULL;

-- CreateTable: daily_batch_activity_config
-- Per (process, lob): which activities are POSSIBLE for this process. Defines
-- what CAN appear in a report; actual daily detection (via the activity
-- providers, keyed off real assignment/attempt data for that date) decides what
-- DOES appear on any given day.
CREATE TABLE `daily_batch_activity_config` (
    `id` VARCHAR(191) NOT NULL,
    `process` VARCHAR(191) NOT NULL,
    `lob` VARCHAR(191) NOT NULL,
    `typing_test` BOOLEAN NOT NULL DEFAULT false,
    `classroom_curriculum` BOOLEAN NOT NULL DEFAULT false,
    `video_course` BOOLEAN NOT NULL DEFAULT false,
    `assessment` BOOLEAN NOT NULL DEFAULT false,
    `learning_nugget` BOOLEAN NOT NULL DEFAULT false,
    `pkt` BOOLEAN NOT NULL DEFAULT false,
    `calibration` BOOLEAN NOT NULL DEFAULT false,
    `certification` BOOLEAN NOT NULL DEFAULT false,
    `e_learning` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(191) NULL,

    UNIQUE INDEX `daily_batch_activity_config_process_lob_key`(`process`, `lob`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: daily_batch_report_settings
-- Singleton (id is always "default"), same convention as
-- typing_test_settings/notification_config/communication_config.
CREATE TABLE `daily_batch_report_settings` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `send_time` VARCHAR(191) NOT NULL DEFAULT '19:00',
    `typing_wpm_target` INTEGER NOT NULL DEFAULT 25,
    `typing_accuracy_target` DOUBLE NOT NULL DEFAULT 97,
    `tni_min_trainee_count` INTEGER NOT NULL DEFAULT 3,
    `tni_min_pct` DOUBLE NOT NULL DEFAULT 30,
    `require_preview_approval` BOOLEAN NOT NULL DEFAULT false,
    `super_admin_emails` TEXT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `daily_batch_report_settings`
  (`id`, `enabled`, `send_time`, `typing_wpm_target`, `typing_accuracy_target`, `tni_min_trainee_count`, `tni_min_pct`, `require_preview_approval`, `updated_at`, `updated_by`)
VALUES
  ('default', false, '19:00', 25, 97, 3, 30, false, CURRENT_TIMESTAMP(3), 'system');

-- CreateTable: daily_batch_report_log
-- One row per batch per date a report was generated (previewed, sent, or
-- blocked). Unique on (batch_no, report_date) gives natural idempotency against
-- duplicate automatic sends and is the "was this already sent today" check the
-- scheduler needs.
CREATE TABLE `daily_batch_report_log` (
    `id` VARCHAR(191) NOT NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `report_date` DATETIME(3) NOT NULL,
    `process` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `coordinator_login_id` VARCHAR(191) NULL,
    `activities_included` JSON NOT NULL,
    `total_trainees` INTEGER NOT NULL DEFAULT 0,
    `present_count` INTEGER NOT NULL DEFAULT 0,
    `subject` VARCHAR(500) NULL,
    `recipient_to` VARCHAR(500) NULL,
    `recipient_cc` TEXT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'Pending',
    `sent_at` DATETIME(3) NULL,
    `trigger_type` VARCHAR(20) NOT NULL DEFAULT 'Automatic',
    `sent_by` VARCHAR(191) NULL,
    `delivery_error` TEXT NULL,
    `body_html` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `daily_batch_report_log_batch_no_report_date_key`(`batch_no`, `report_date`),
    INDEX `daily_batch_report_log_report_date_idx`(`report_date`),
    INDEX `daily_batch_report_log_batch_no_idx`(`batch_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
