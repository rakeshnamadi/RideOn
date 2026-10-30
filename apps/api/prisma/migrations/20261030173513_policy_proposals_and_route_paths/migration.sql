-- AlterTable
ALTER TABLE `governance_proposals` ADD COLUMN `policyBefore` JSON NULL,
    ADD COLUMN `policyChanges` JSON NULL;

-- AlterTable
ALTER TABLE `shared_routes` ADD COLUMN `pathDistanceMeters` INTEGER NULL,
    ADD COLUMN `pathGeometry` JSON NULL;
