-- CreateTable: isms_quarterly_assignment
-- One row per employee per financial-year quarter the existing "ISMS Test -
-- Quarterly" assessment was assigned to them. The unique constraint on
-- (employee_id, quarter_key) is the de-dupe guarantee; rows are never
-- updated or deleted so each quarter's record stays available for audit.
CREATE TABLE `isms_quarterly_assignment` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `designation` VARCHAR(191) NULL,
    `department` VARCHAR(191) NULL,
    `fy_label` VARCHAR(191) NOT NULL,
    `quarter` INTEGER NOT NULL,
    `quarter_key` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NOT NULL,
    `assigned_module_id` VARCHAR(191) NOT NULL,
    `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `assigned_by` VARCHAR(191) NULL,
    `trigger_source` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `isms_quarterly_assignment_employee_id_quarter_key_key`(`employee_id`, `quarter_key`),
    INDEX `isms_quarterly_assignment_quarter_key_idx`(`quarter_key`),
    INDEX `isms_quarterly_assignment_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: isms_quarterly_run_log
-- Idempotency + history for the quarterly scheduler.
CREATE TABLE `isms_quarterly_run_log` (
    `id` VARCHAR(191) NOT NULL,
    `quarter_key` VARCHAR(191) NOT NULL,
    `run_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `trigger_type` VARCHAR(191) NOT NULL DEFAULT 'Automatic',
    `total_employees` INTEGER NOT NULL DEFAULT 0,
    `assigned_count` INTEGER NOT NULL DEFAULT 0,
    `skipped_summary` JSON NULL,
    `triggered_by` VARCHAR(191) NULL,

    UNIQUE INDEX `isms_quarterly_run_log_quarter_key_key`(`quarter_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
