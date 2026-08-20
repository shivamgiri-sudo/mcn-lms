-- CreateTable: trainee_leaderboard_score
-- Denormalized per-trainee leaderboard summary (v1 gamification). One row per
-- employeeId, recomputed from trainee_leaderboard_event whenever a point-earning
-- action fires (content completion, assessment pass, attendance streak,
-- certification). Scoping columns (batch_no/branch/process/lob) are duplicated
-- from trainee_master at recompute time so ranked queries never need a join.
CREATE TABLE `trainee_leaderboard_score` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `total_points` INTEGER NOT NULL DEFAULT 0,
    `course_points` INTEGER NOT NULL DEFAULT 0,
    `assessment_points` INTEGER NOT NULL DEFAULT 0,
    `attendance_points` INTEGER NOT NULL DEFAULT 0,
    `certification_points` INTEGER NOT NULL DEFAULT 0,
    `badges_json` JSON NULL,
    `last_updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trainee_leaderboard_score_employee_id_key`(`employee_id`),
    INDEX `trainee_leaderboard_score_batch_no_total_points_idx`(`batch_no`, `total_points`),
    INDEX `trainee_leaderboard_score_branch_total_points_idx`(`branch`, `total_points`),
    INDEX `trainee_leaderboard_score_process_total_points_idx`(`process`, `total_points`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: trainee_leaderboard_event
-- Idempotent point ledger. The unique key on (employee_id, event_type, ref_id)
-- lets every award call safely upsert instead of double-counting a retried
-- heartbeat or a re-submitted assessment attempt; totals on
-- trainee_leaderboard_score are always re-derived by summing this table.
CREATE TABLE `trainee_leaderboard_event` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `event_type` VARCHAR(191) NOT NULL,
    `ref_id` VARCHAR(191) NOT NULL,
    `points` INTEGER NOT NULL,
    `meta` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `trainee_leaderboard_event_employee_id_event_type_ref_id_key`(`employee_id`, `event_type`, `ref_id`),
    INDEX `trainee_leaderboard_event_employee_id_idx`(`employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
