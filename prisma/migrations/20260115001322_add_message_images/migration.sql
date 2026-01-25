-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "photoPublicId" VARCHAR(255),
ADD COLUMN     "photoUrl" VARCHAR(255),
ALTER COLUMN "content" DROP NOT NULL;
