-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "mediaType" "MediaType";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "mediaType" "MediaType",
ADD COLUMN     "photoPublicId" VARCHAR(255);
