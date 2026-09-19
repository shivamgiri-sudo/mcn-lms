-- AlterTable: assessment_result
-- Mirrors 20260821090000_standalone_assessments: a trainee can take a
-- standalone/broadcast-only assessment (assessment_master.classroom_id NULL)
-- via broadcast access with no classroom membership at all. Submitting such an
-- assessment upserts an assessment_result row carrying that same NULL
-- classroom_id, which the NOT NULL column previously rejected at the database
-- level ("Column 'classroom_id' cannot be null"), surfacing as a bare 500 on
-- submit right after the read-side null-classroom crash was fixed.
ALTER TABLE `assessment_result` MODIFY `classroom_id` VARCHAR(191) NULL;
