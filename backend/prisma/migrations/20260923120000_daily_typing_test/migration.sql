-- CreateTable: typing_paragraph
-- Daily Typing Test v1: admin-managed paragraph bank. word_count is stored (not
-- recomputed on every read) so the admin's configured min/max word-length filter
-- can be validated at create/edit time and reported on cheaply from the list view.
CREATE TABLE `typing_paragraph` (
    `id` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `word_count` INTEGER NOT NULL,
    `category` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `typing_paragraph_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: typing_test_settings
-- Single-row config table (id is always the literal string "default"), same
-- singleton convention as communication_config/notification_config. wpm_target/
-- accuracy_target are the Pass/Fail thresholds; duration_seconds/attempts_per_day/
-- min_words/max_words/allow_retest are read once per attempt-start and baked into
-- that attempt row, so changing settings mid-test never retroactively changes an
-- in-flight attempt's rules.
CREATE TABLE `typing_test_settings` (
    `id` VARCHAR(191) NOT NULL,
    `duration_seconds` INTEGER NOT NULL DEFAULT 300,
    `attempts_per_day` INTEGER NOT NULL DEFAULT 1,
    `wpm_target` INTEGER NOT NULL DEFAULT 35,
    `accuracy_target` DOUBLE NOT NULL DEFAULT 95,
    `min_words` INTEGER NOT NULL DEFAULT 150,
    `max_words` INTEGER NOT NULL DEFAULT 250,
    `allow_retest` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: typing_test_attempt
-- One row per attempt (started or completed). started_at is set by the server when
-- the attempt is created, never by the client; submitted_at/time_taken_seconds are
-- filled in by the server at submit time from the server's own clock, exactly like
-- assessment_attempt elsewhere in this schema -- the client's reported timing is
-- never trusted for scoring. attempt_date is IST-midnight-normalized (see
-- istDayBounds() in the controller) so the daily attempt cap can be enforced with a
-- simple date-range count instead of re-deriving "today" from submitted_at/
-- started_at (which may straddle midnight for a test started at 11:58pm).
CREATE TABLE `typing_test_attempt` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `trainee_name` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `paragraph_id` VARCHAR(191) NOT NULL,
    `original_text` TEXT NOT NULL,
    `typed_text` TEXT NULL,
    `attempt_date` DATETIME(3) NOT NULL,
    `attempt_number` INTEGER NOT NULL DEFAULT 1,
    `started_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `duration_seconds` INTEGER NOT NULL,
    `time_taken_seconds` INTEGER NULL,
    `total_chars` INTEGER NULL,
    `correct_chars` INTEGER NULL,
    `incorrect_chars` INTEGER NULL,
    `error_count` INTEGER NULL,
    `total_words` INTEGER NULL,
    `gross_wpm` DOUBLE NULL,
    `net_wpm` DOUBLE NULL,
    `accuracy_pct` DOUBLE NULL,
    `status` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `typing_test_attempt_employee_id_attempt_date_idx`(`employee_id`, `attempt_date`),
    INDEX `typing_test_attempt_attempt_date_idx`(`attempt_date`),
    INDEX `typing_test_attempt_employee_id_status_idx`(`employee_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed default settings row (5 min duration, 1 attempt/day, 35 WPM / 95% accuracy
-- targets, 150-250 word paragraphs, no retest) so the feature works immediately
-- without requiring an admin to configure it first.
INSERT INTO `typing_test_settings` (`id`, `duration_seconds`, `attempts_per_day`, `wpm_target`, `accuracy_target`, `min_words`, `max_words`, `allow_retest`, `updated_at`, `updated_by`)
VALUES ('default', 300, 1, 35, 95, 150, 250, false, CURRENT_TIMESTAMP(3), 'system');

-- Seed a starter paragraph bank (8 paragraphs, 150-250 words each, general
-- professional English with normal punctuation) so a random paragraph is
-- available for the first test immediately after this migration runs. Admins can
-- add/edit/activate/deactivate paragraphs afterward from the Typing Test admin tab.
INSERT INTO `typing_paragraph` (`id`, `text`, `word_count`, `category`, `active`, `created_by`, `created_at`, `updated_at`) VALUES
(UUID(), 'Effective communication is the foundation of a successful workplace. When employees share information clearly and listen carefully to one another, misunderstandings are reduced and projects move forward smoothly. Good communication is not only about speaking well; it also involves paying attention to tone, body language, and timing. A manager who communicates expectations clearly helps the team stay focused and motivated. Likewise, an employee who asks questions when something is unclear demonstrates initiative and a genuine desire to do quality work. In today''s fast paced environment, teams often rely on emails, chat messages, and video calls to stay connected. While these tools are convenient, they can sometimes lead to confusion if messages are too brief or lack context. Taking a few extra moments to write a clear, complete message can save hours of back and forth clarification later. Organizations that invest in communication training often see improvements in employee satisfaction, customer relationships, and overall productivity. Strong communication skills benefit everyone, from new hires to senior leaders, and they remain one of the most valuable skills a professional can develop.', 178, 'Workplace Communication', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Providing excellent customer service requires patience, empathy, and a genuine willingness to help. Every customer interaction is an opportunity to build trust and strengthen the relationship between a company and the people it serves. When a customer calls with a problem, the first step is to listen carefully without interrupting, so they feel heard and understood. Once the issue is clear, the representative should explain the solution in simple language, avoiding technical jargon that might confuse the customer further. Staying calm and polite, even when a customer is frustrated, often turns a negative experience into a positive one. Companies that consistently deliver great service tend to earn repeat business and positive word of mouth referrals, which are far more valuable than any advertising campaign. Training programs that focus on active listening, clear speaking, and problem solving can make a significant difference in how customers perceive a brand. In the end, the goal of every service interaction should be simple: leave the customer feeling valued, respected, and confident that their concerns were addressed properly and promptly.', 175, 'Customer Service', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Managing time effectively is one of the most important skills a professional can develop. With so many tasks competing for attention each day, it is easy to feel overwhelmed without a clear plan. Successful people often begin their day by identifying the two or three most important tasks that must be completed, rather than trying to do everything at once. Breaking large projects into smaller, manageable steps makes progress feel achievable and helps maintain motivation over time. Avoiding distractions, such as unnecessary meetings or constant notifications, allows for deeper focus and higher quality work. Many experts also recommend taking short breaks throughout the day to recharge, since sustained concentration without rest can lead to fatigue and mistakes. Learning to say no to low priority requests, while still being a helpful team member, is another valuable skill. Ultimately, good time management is not about doing more things, but about doing the right things well, consistently, and with enough energy left to maintain a healthy balance between work and personal life.', 169, 'Time Management', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Strong teamwork transforms a group of individuals into a powerful, unified force capable of achieving far more than any single person could accomplish alone. When team members trust one another, they are more willing to share ideas openly, admit mistakes honestly, and ask for help when needed. A healthy team culture encourages diverse perspectives, recognizing that different backgrounds and experiences often lead to more creative and effective solutions. Clear roles and responsibilities help avoid confusion about who is accountable for each task, while regular check ins keep everyone aligned on shared goals. Celebrating small wins along the way keeps morale high, especially during long or challenging projects. Conflict is a natural part of working together, but teams that address disagreements respectfully and constructively often emerge stronger and more united. Leaders play a critical role by modeling collaboration, giving credit generously, and creating an environment where every voice feels valued. In the end, the most successful organizations are built not on individual brilliance alone, but on the collective strength of well functioning teams.', 172, 'Teamwork', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Continuous learning is essential for anyone who wants to grow professionally in today''s rapidly changing world. Industries evolve quickly, new technologies emerge constantly, and the skills that were valuable a few years ago may no longer be sufficient for future success. Employees who take ownership of their own development, seeking out training opportunities, reading industry publications, and asking mentors for feedback, tend to advance more quickly than those who wait for growth to happen automatically. Setting specific, measurable goals for skill development helps turn vague ambitions into concrete progress. Feedback, even when it is difficult to hear, is one of the most valuable tools for improvement, since it reveals blind spots that are hard to see on our own. Building a strong professional network also opens doors to new opportunities and fresh perspectives that might not otherwise be available. Ultimately, professional growth is a long term journey rather than a single destination, and those who remain curious, adaptable, and committed to learning will be best prepared for whatever changes lie ahead in their careers.', 174, 'Professional Growth', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Attention to detail separates good work from truly excellent work, and it is a quality that customers and colleagues notice immediately. Small errors, whether a typo in an email or a miscalculation in a report, can undermine confidence in an otherwise strong piece of work. Developing a habit of reviewing work carefully before submitting it, rather than rushing to finish quickly, pays significant dividends over time. Checklists and standardized processes can help reduce the chance of overlooking important steps, especially in complex or repetitive tasks. It is also helpful to take a short break before reviewing your own work, since fresh eyes are more likely to catch mistakes that were missed the first time around. Asking a colleague to review important documents adds another layer of quality assurance, since a second perspective often notices things the original author cannot see. While speed is important in most workplaces, accuracy should never be sacrificed entirely for the sake of finishing faster, because the cost of correcting mistakes later is almost always higher than the time saved initially.', 175, 'Quality and Attention to Detail', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'Change is an unavoidable part of professional life, whether it comes in the form of new leadership, updated processes, or shifting market conditions. How employees respond to change often determines whether an organization thrives or struggles during periods of transition. Those who approach change with curiosity rather than resistance tend to adapt more quickly and find new opportunities within the disruption. Clear, honest communication from leadership during times of change helps reduce anxiety and builds trust, even when the news is not entirely positive. Employees who understand the reasons behind a change are far more likely to support it, rather than simply comply out of obligation. Providing training and support during transitions also makes a significant difference, since people need time and resources to develop new skills and habits. Celebrating early successes during a transition can build momentum and demonstrate that the change is working. While uncertainty can be uncomfortable, organizations that manage change thoughtfully and transparently often emerge more resilient, agile, and better prepared for whatever comes next.', 169, 'Handling Change', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
(UUID(), 'A strong organizational culture shapes how employees behave, make decisions, and treat one another, often more powerfully than any written policy ever could. Culture is built through countless small moments: how a manager responds to a mistake, whether achievements are recognized publicly, and how disagreements are handled within a team. Organizations with a positive culture tend to attract and retain talented people, since employees value environments where they feel respected, trusted, and supported. Leaders play an outsized role in shaping culture, since their actions are watched closely and often set the tone for everyone else. Consistency matters as well; a culture that claims to value honesty but punishes employees for raising concerns quickly loses credibility. Regularly gathering employee feedback and acting on it demonstrates that leadership genuinely cares about the workplace experience, not just the results it produces. While culture cannot be changed overnight, deliberate and sustained effort, combined with visible leadership commitment, can gradually transform even a struggling workplace into one where people are proud to contribute their best work every single day.', 174, 'Organizational Culture', true, 'system', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
