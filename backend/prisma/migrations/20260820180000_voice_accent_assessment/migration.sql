-- CreateTable: voice_accent_prompt
-- Voice & Accent Assessment v1: a BPO-specific speaking assessment. A prompt
-- is either a script/passage to read aloud (SCRIPT_READING) or a scenario
-- description to role-play (SCENARIO_ROLEPLAY). category/level are free-text
-- and nullable (e.g. "Voice Process" / "Beginner") — kept simple for v1, no
-- separate lookup table.
CREATE TABLE `voice_accent_prompt` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `prompt_text` TEXT NOT NULL,
    `prompt_type` VARCHAR(191) NOT NULL DEFAULT 'SCRIPT_READING',
    `category` VARCHAR(191) NULL,
    `level` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `voice_accent_prompt_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: voice_accent_submission
-- One trainee recording against one prompt. prompt_id is a loosely-coupled
-- string ref to voice_accent_prompt.id (no FK, same convention as
-- mentor_pairing/trainee_leaderboard_score on this branch). audio_file_path
-- is server-relative (never a public URL) and is only ever served through the
-- protected /api/voice-accent/audio/:id route, which checks ownership (the
-- trainee who recorded it) or reviewer scope (batch/branch/process,
-- denormalized here at submission time so review-queue queries never need a
-- join). rubric_scores is a flexible JSON map of dimension -> score so v1
-- does not lock in a fixed rubric shape.
CREATE TABLE `voice_accent_submission` (
    `id` VARCHAR(191) NOT NULL,
    `prompt_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `employee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `audio_file_path` VARCHAR(500) NOT NULL,
    `original_filename` VARCHAR(255) NULL,
    `mime_type` VARCHAR(100) NULL,
    `file_size` INTEGER NULL,
    `duration_seconds` INTEGER NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'SUBMITTED',
    `scored_by` VARCHAR(191) NULL,
    `scored_at` DATETIME(3) NULL,
    `overall_score` INTEGER NULL,
    `rubric_scores` JSON NULL,
    `feedback_notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `voice_accent_submission_employee_id_status_idx`(`employee_id`, `status`),
    INDEX `voice_accent_submission_prompt_id_idx`(`prompt_id`),
    INDEX `voice_accent_submission_batch_no_idx`(`batch_no`),
    INDEX `voice_accent_submission_branch_idx`(`branch`),
    INDEX `voice_accent_submission_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
