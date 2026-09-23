-- CreateTable: typing_prompts
-- Built-in passage library for Typing Practice module. No admin UI — seeded via seed.js.
-- mode PASSAGE: trainee types the full body text until completion.
-- mode TIMED_DRILL: trainee types continuously for durationSeconds.
-- difficulty/tags help the UI group passage cards.
CREATE TABLE `typing_prompts` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'PASSAGE',
    `duration_seconds` INTEGER NULL,
    `difficulty` VARCHAR(191) NOT NULL DEFAULT 'EASY',
    `tags` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `typing_prompts_is_active_mode_idx`(`is_active`, `mode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: typing_sessions
-- One row per completed typing session. All scope fields (batch_no/branch/process/lob)
-- are denormalized from TraineeMaster at save time — same pattern as voice_accent_submission
-- so analytics queries require zero joins.
-- keystroke_log is a JSON array of {t: ms_offset, k: char, correct: bool}.
-- is_voided=true when cheat thresholds are exceeded; voided sessions are stored
-- but excluded from all averages, points, and streak updates.
CREATE TABLE `typing_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `trainee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `batch_no` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `lob` VARCHAR(191) NULL,
    `prompt_id` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(191) NOT NULL,
    `wpm` INTEGER NOT NULL,
    `raw_wpm` INTEGER NOT NULL,
    `accuracy` DOUBLE NOT NULL,
    `error_count` INTEGER NOT NULL,
    `duration_seconds` INTEGER NOT NULL,
    `paste_event_count` INTEGER NOT NULL DEFAULT 0,
    `focus_lost_count` INTEGER NOT NULL DEFAULT 0,
    `is_voided` BOOLEAN NOT NULL DEFAULT false,
    `void_reason` VARCHAR(191) NULL,
    `keystroke_log` JSON NOT NULL,
    `leaderboard_pts` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `typing_sessions_trainee_id_idx`(`trainee_id`),
    INDEX `typing_sessions_batch_no_idx`(`batch_no`),
    INDEX `typing_sessions_branch_idx`(`branch`),
    INDEX `typing_sessions_process_idx`(`process`),
    INDEX `typing_sessions_created_at_idx`(`created_at`),
    INDEX `typing_sessions_is_voided_idx`(`is_voided`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: typing_streaks
-- Per-trainee streak state. Updated only on valid (non-voided) sessions.
-- last_practiced_date stored as YYYY-MM-DD string for timezone-independent date comparison.
CREATE TABLE `typing_streaks` (
    `id` VARCHAR(191) NOT NULL,
    `trainee_id` VARCHAR(191) NOT NULL,
    `current_streak` INTEGER NOT NULL DEFAULT 0,
    `longest_streak` INTEGER NOT NULL DEFAULT 0,
    `last_practiced_date` VARCHAR(191) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `typing_streaks_trainee_id_key`(`trainee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
