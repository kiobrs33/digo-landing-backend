-- AlterTable
ALTER TABLE "ContactInquiry" ADD COLUMN     "attendedAt" TIMESTAMP(3),
ADD COLUMN     "attendedById" UUID;

-- AddForeignKey
ALTER TABLE "ContactInquiry" ADD CONSTRAINT "ContactInquiry_attendedById_fkey" FOREIGN KEY ("attendedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
