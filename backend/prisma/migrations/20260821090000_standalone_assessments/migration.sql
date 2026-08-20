-- AlterTable: assessment_master
-- Standalone assessments: an admin can now create an AssessmentMaster row with
-- no classroom at all (e.g. from the Broadcast tab's "Assign a specific
-- Assessment" flow, or as a reusable PKT built ahead of any classroom). The
-- existing FK to classroom_master(classroom_id) is untouched — MySQL simply
-- does not enforce it for NULL values — so a later
-- PUT /admin/assessments/:assessmentId/attach-classroom can still set it.
ALTER TABLE `assessment_master` MODIFY `classroom_id` VARCHAR(191) NULL;
