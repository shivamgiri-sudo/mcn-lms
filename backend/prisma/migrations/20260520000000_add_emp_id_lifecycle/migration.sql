-- AlterTable: add emp_id_lifecycle fields to trainee_master
ALTER TABLE "trainee_master" ADD COLUMN "emp_id_type" TEXT NOT NULL DEFAULT 'PERMANENT';
ALTER TABLE "trainee_master" ADD COLUMN "permanent_emp_id" TEXT;
ALTER TABLE "trainee_master" ADD COLUMN "emp_id_mapped_at" TIMESTAMP(3);

-- CreateIndex: unique constraint on permanent_emp_id
CREATE UNIQUE INDEX "trainee_master_permanent_emp_id_key" ON "trainee_master"("permanent_emp_id");

-- CreateTable: sequence_counter
CREATE TABLE "sequence_counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequence_counter_pkey" PRIMARY KEY ("key")
);
