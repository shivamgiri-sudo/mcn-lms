-- AddColumn: AssignedModule.assessmentId
-- Lets a broadcast/refresher assignment carry an attached PKT/MCQ (AssessmentMaster.assessmentId).
-- Nullable, no FK — matches the existing loosely-coupled moduleId/assignedTo pattern on this table.
ALTER TABLE `assigned_modules`
  ADD COLUMN `assessment_id` VARCHAR(191) NULL AFTER `created_at`;

-- Index: TraineeMaster.designation
-- The `designation` column already exists in production (added out-of-band, ahead of
-- this schema.prisma change) but has no index yet. Needed so designation-based
-- "specific analysts" targeting in Broadcast can filter efficiently.
ALTER TABLE `trainee_master`
  ADD INDEX `trainee_master_designation_idx` (`designation`);
