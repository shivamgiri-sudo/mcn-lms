-- CreateTable: internal_job_posting
-- Internal Job Posting (IJP) / Promotion Tracker v1: lets Admin/Coordinator
-- post an open internal role (a process/branch/level opening) and lets it
-- be reviewed and closed out. target_branch/target_process/target_lob are
-- nullable = open to all; minTenureMonths is a simple, optional eligibility
-- rule evaluated against TraineeMaster.doj at listing time (no FK — same
-- loosely-coupled string-ref convention as trainee_leaderboard_score/
-- mentor_pairing). filled_by/filled_at are only set when status -> FILLED.
CREATE TABLE `internal_job_posting` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `target_branch` VARCHAR(191) NULL,
    `target_process` VARCHAR(191) NULL,
    `target_lob` VARCHAR(191) NULL,
    `target_designation` VARCHAR(191) NULL,
    `min_tenure_months` INTEGER NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `posted_by` VARCHAR(191) NULL,
    `posted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closes_at` DATETIME(3) NULL,
    `filled_by` VARCHAR(191) NULL,
    `filled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `internal_job_posting_status_idx`(`status`),
    INDEX `internal_job_posting_target_branch_idx`(`target_branch`),
    INDEX `internal_job_posting_target_process_idx`(`target_process`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: internal_job_application
-- One application per (posting_id, applicant_employee_id) — enforced by a
-- unique index so re-applying is impossible. posting_id is a loosely-coupled
-- string ref to internal_job_posting.id (no FK, same convention as
-- mentor_pairing_checkin -> mentor_pairing). current_designation/branch/
-- process are denormalized off TraineeMaster at apply time so review lists
-- never need a join and keep the applicant's state at the moment they applied
-- even if their live profile later changes.
CREATE TABLE `internal_job_application` (
    `id` VARCHAR(191) NOT NULL,
    `posting_id` VARCHAR(191) NOT NULL,
    `applicant_employee_id` VARCHAR(191) NOT NULL,
    `applicant_name` VARCHAR(191) NULL,
    `current_designation` VARCHAR(191) NULL,
    `current_branch` VARCHAR(191) NULL,
    `current_process` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'APPLIED',
    `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_by` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `review_notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `internal_job_application_posting_id_applicant_employee_id_key`(`posting_id`, `applicant_employee_id`),
    INDEX `internal_job_application_applicant_employee_id_idx`(`applicant_employee_id`),
    INDEX `internal_job_application_posting_id_status_idx`(`posting_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
