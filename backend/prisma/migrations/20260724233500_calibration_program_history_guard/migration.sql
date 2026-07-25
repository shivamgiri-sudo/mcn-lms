-- Phase 7 correction: permit multiple historical calibration programs while
-- allowing only one active draft/published program per rubric version.
--
-- The original composite unique index is also the only template_id-prefixed
-- index available to the foreign key. MySQL will not drop an index required by
-- a foreign key, so create a dedicated support index before replacing it.

ALTER TABLE evaluator_calibration_program
  ADD KEY idx_calibration_program_template (template_id);

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
