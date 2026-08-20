-- CreateTable: mentor_pairing
-- Buddy/Mentor Pairing v1: pairs a new hire (trainee) with a senior trainee or
-- coordinator during onboarding. mentor_id is a loosely-coupled string matched
-- against either trainee_master.employee_id (mentor_type TRAINEE) or
-- role_access_matrix.login_id (mentor_type COORDINATOR) — no FK, same pattern
-- as assigned_modules/trainee_leaderboard_score. mentor_name/batch_no/branch/
-- process are denormalized at pairing time so list queries never need a join.
CREATE TABLE `mentor_pairing` (
    `id` VARCHAR(191) NOT NULL,
    `mentee_employee_id` VARCHAR(191) NOT NULL,
    `mentee_name` VARCHAR(191) NULL,
    `mentor_id` VARCHAR(191) NOT NULL,
    `mentor_type` VARCHAR(191) NOT NULL DEFAULT 'TRAINEE',
    `mentor_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
    `paired_by` VARCHAR(191) NULL,
    `paired_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `target_end_date` DATETIME(3) NULL,
    `ended_at` DATETIME(3) NULL,
    `ended_reason` TEXT NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `mentor_pairing_mentee_employee_id_status_idx`(`mentee_employee_id`, `status`),
    INDEX `mentor_pairing_mentor_id_status_idx`(`mentor_id`, `status`),
    INDEX `mentor_pairing_batch_no_idx`(`batch_no`),
    INDEX `mentor_pairing_branch_idx`(`branch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: mentor_pairing_checkin
-- Lightweight check-in log — not a full 1:1-notes app. One row per touchpoint,
-- loosely referencing mentor_pairing.id (no FK, matches learning-path/
-- leaderboard convention of string refs for this branch's trainee-adjacent
-- tables).
CREATE TABLE `mentor_pairing_checkin` (
    `id` VARCHAR(191) NOT NULL,
    `pairing_id` VARCHAR(191) NOT NULL,
    `checkin_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `logged_by` VARCHAR(191) NULL,
    `logged_by_type` VARCHAR(191) NULL,
    `rating` VARCHAR(191) NOT NULL DEFAULT 'GOOD',
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `mentor_pairing_checkin_pairing_id_idx`(`pairing_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
