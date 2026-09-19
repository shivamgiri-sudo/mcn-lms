-- classroom_branch_map: allows a single classroom to be visible in multiple branches.
-- Super Admins manage this via the curriculum UI; branch admins see classrooms
-- where classroom_master.branch OR classroom_branch_map.branch matches their branch.
CREATE TABLE `classroom_branch_map` (
  `id` VARCHAR(191) NOT NULL,
  `classroom_id` VARCHAR(191) NOT NULL,
  `branch` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE (`classroom_id`, `branch`),
  INDEX (`classroom_id`),
  INDEX (`branch`),
  CONSTRAINT `classroom_branch_map_classroom_id_fkey`
    FOREIGN KEY (`classroom_id`) REFERENCES `classroom_master`(`classroom_id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);
