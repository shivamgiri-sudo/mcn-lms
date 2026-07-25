-- Phase 9 supplement: notify governance reviewers when an evaluator supplies requested appeal information.

INSERT IGNORE INTO notification_template
  (template_id, template_code, event_type, channel, locale,
   subject_template, body_text_template, body_html_template,
   action_url_template, mandatory, version_no, active, created_by)
VALUES
  (UUID(), 'CAL_APPEAL_INFO_PROVIDED_INAPP_V1', 'CALIBRATION_APPEAL_INFORMATION_PROVIDED', 'IN_APP', 'en-IN',
   'Appeal information received', '{{evaluatorName}} supplied additional information for appeal {{appealCode}}.', NULL,
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration'),
  (UUID(), 'CAL_APPEAL_INFO_PROVIDED_EMAIL_V1', 'CALIBRATION_APPEAL_INFORMATION_PROVIDED', 'EMAIL', 'en-IN',
   'Additional information received · {{appealCode}}', '{{evaluatorName}} supplied additional information for calibration appeal {{appealCode}}. Continue the governance review in MCN LMS.',
   '<p><b>{{evaluatorName}}</b> supplied additional information for appeal <b>{{appealCode}}</b>.</p><p>Continue the governance review in MCN LMS.</p>',
   '/evaluator-quality?role=admin', 1, 1, 1, 'migration');
