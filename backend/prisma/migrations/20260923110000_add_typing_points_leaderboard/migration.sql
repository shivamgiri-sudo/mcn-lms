-- Migration: add typing_points column to trainee_leaderboard_score
ALTER TABLE `trainee_leaderboard_score` ADD COLUMN `typing_points` INT NOT NULL DEFAULT 0;
