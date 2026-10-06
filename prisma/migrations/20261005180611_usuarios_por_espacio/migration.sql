-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sites" "Site"[] DEFAULT ARRAY['HOGAR', 'EMPRESAS']::"Site"[];
