-- Financials → Document Printing.
--
-- document_output_statuses holds SAP's "Printed" / "E-Mailed" flags for every
-- printable document type in one place. A document with no row has never been
-- printed or e-mailed, which is what the selection window's "Only Documents
-- Still to Be Printed / E-Mailed" filters test for.

-- CreateTable
CREATE TABLE "document_output_statuses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "lastPrintedAt" TIMESTAMP(3),
    "lastPrintedById" TEXT,
    "emailCount" INTEGER NOT NULL DEFAULT 0,
    "lastEmailedAt" TIMESTAMP(3),
    "lastEmailedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_output_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_output_statuses_companyId_documentType_documentId_key" ON "document_output_statuses"("companyId", "documentType", "documentId");

-- AddForeignKey
ALTER TABLE "document_output_statuses" ADD CONSTRAINT "document_output_statuses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
