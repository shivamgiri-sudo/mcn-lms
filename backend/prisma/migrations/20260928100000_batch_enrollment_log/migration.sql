-- CreateTable: batch_enrollment_log
-- One append-only row per trainee successfully enrolled via "Search & Enroll
-- Existing Trainee" -- the per-enrollment details (enrollment date, training
-- start date, trainer/facilitator, batch code, training mode, remarks) that
-- neither trainee_master nor batch_master has room to hold on their own.
CREATE TABLE `batch_enrollment_log` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NOT NULL,
    `previous_batch_no` VARCHAR(191) NULL,
    `enrollment_date` DATETIME(3) NULL,
    `training_start_date` DATETIME(3) NULL,
    `trainer_name` VARCHAR(191) NULL,
    `batch_code` VARCHAR(191) NULL,
    `training_mode` VARCHAR(191) NULL,
    `remarks` TEXT NULL,
    `enrolled_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `batch_enrollment_log_batch_no_idx`(`batch_no`),
    INDEX `batch_enrollment_log_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
