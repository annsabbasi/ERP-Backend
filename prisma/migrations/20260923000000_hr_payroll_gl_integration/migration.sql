-- AlterEnum
ALTER TYPE "AccountDeterminationArea" ADD VALUE 'PAYROLL';

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "journalEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_journalEntryId_key" ON "payroll_runs"("journalEntryId");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
