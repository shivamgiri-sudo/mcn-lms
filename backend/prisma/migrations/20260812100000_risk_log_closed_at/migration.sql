-- AddColumn: TrainingRiskLog.closedAt
-- Fixes: riskEngine.js writes closedAt but field was missing from schema (live runtime error)

ALTER TABLE `training_risk_log`
  ADD COLUMN `closed_at` DATETIME(3) NULL AFTER `closure_remarks`;
