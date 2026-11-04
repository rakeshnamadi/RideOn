-- Union roles: HEAD and ADMIN become LOCAL_ADMIN; REPORTER is new.
-- Widen the enum first so existing rows can be converted, then narrow it.
ALTER TABLE `community_admins` MODIFY `role` ENUM('HEAD', 'ADMIN', 'LOCAL_ADMIN', 'REPORTER', 'APPROVER', 'OPERATOR') NOT NULL;
UPDATE `community_admins` SET `role` = 'LOCAL_ADMIN' WHERE `role` IN ('HEAD', 'ADMIN');
ALTER TABLE `community_admins` MODIFY `role` ENUM('LOCAL_ADMIN', 'REPORTER', 'APPROVER', 'OPERATOR') NOT NULL;

-- Per-delegate custom permissions (null = role defaults).
ALTER TABLE `community_admins` ADD COLUMN `permissions` JSON NULL;

-- AlterTable
ALTER TABLE `communities` ADD COLUMN `address` VARCHAR(300) NULL,
    ADD COLUMN `brandColor` VARCHAR(7) NULL,
    ADD COLUMN `foundedYear` INTEGER NULL,
    ADD COLUMN `logoKey` VARCHAR(100) NULL,
    ADD COLUMN `logoMime` VARCHAR(50) NULL,
    ADD COLUMN `logoUpdatedAt` DATETIME(3) NULL,
    ADD COLUMN `pincode` VARCHAR(10) NULL,
    ADD COLUMN `shortName` VARCHAR(40) NULL,
    ADD COLUMN `tagline` VARCHAR(200) NULL;


-- CreateTable
CREATE TABLE `fare_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `sharedRouteId` VARCHAR(191) NULL,
    `fareRuleId` VARCHAR(191) NULL,
    `sentiment` ENUM('TOO_LOW', 'FAIR', 'TOO_HIGH') NOT NULL,
    `suggestedBaseFarePaise` INTEGER NULL,
    `suggestedPerKmPaise` INTEGER NULL,
    `suggestedPerSeatPaise` INTEGER NULL,
    `comment` VARCHAR(1000) NOT NULL,
    `status` ENUM('OPEN', 'ACKNOWLEDGED', 'ADOPTED', 'DECLINED') NOT NULL DEFAULT 'OPEN',
    `response` VARCHAR(1000) NULL,
    `respondedById` VARCHAR(191) NULL,
    `respondedAt` DATETIME(3) NULL,
    `proposalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fare_feedback_communityId_status_createdAt_idx`(`communityId`, `status`, `createdAt`),
    INDEX `fare_feedback_driverId_createdAt_idx`(`driverId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_reports` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `metrics` JSON NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_reports_communityId_createdAt_idx`(`communityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `activity_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(30) NULL,
    `method` VARCHAR(10) NOT NULL,
    `path` VARCHAR(300) NOT NULL,
    `statusCode` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `communityId` VARCHAR(30) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `activity_logs_createdAt_idx`(`createdAt`),
    INDEX `activity_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `activity_logs_statusCode_createdAt_idx`(`statusCode`, `createdAt`),
    INDEX `activity_logs_communityId_createdAt_idx`(`communityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fare_feedback` ADD CONSTRAINT `fare_feedback_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_feedback` ADD CONSTRAINT `fare_feedback_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_reports` ADD CONSTRAINT `community_reports_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

