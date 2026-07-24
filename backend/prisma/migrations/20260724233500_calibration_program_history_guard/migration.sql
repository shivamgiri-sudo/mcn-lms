-- Phase 7 correction: permit multiple historical calibration programs while
-- allowing only one active draft/published program per rubric version.

ALTER TABLE evaluator_calibration_program
  DROP INDEX uq_calibration_program_template_active,
  ADD COLUMN active_template_key CHAR(36)
    GENERATED ALWAYS AS (
      CASE
        WHEN active = 1 AND status IN ('DRAFT','PUBLISHED') THEN template_id
        ELSE NULL
      END
    ) STORED,
  ADD UNIQUE KEY uq_calibration_program_template_active (active_template_key);
