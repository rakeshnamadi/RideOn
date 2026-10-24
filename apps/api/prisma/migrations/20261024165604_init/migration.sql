-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(20) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'ACTIVE',
    `suspensionReason` VARCHAR(500) NULL,
    `preferredLanguage` VARCHAR(10) NOT NULL DEFAULT 'en',
    `trustedContactName` VARCHAR(120) NULL,
    `trustedContactPhone` VARCHAR(20) NULL,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(191) NOT NULL,
    `permissionId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `familyId` VARCHAR(30) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ipAddress` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` VARCHAR(50) NULL,
    `rotatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_tokenHash_key`(`tokenHash`),
    INDEX `sessions_userId_idx`(`userId`),
    INDEX `sessions_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_consents` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `consentType` ENUM('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'LOCATION_SHARING') NOT NULL,
    `version` VARCHAR(20) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(64) NULL,

    INDEX `user_consents_userId_consentType_idx`(`userId`, `consentType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_tokenHash_key`(`tokenHash`),
    INDEX `password_reset_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cities` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `state` VARCHAR(100) NOT NULL,
    `timezone` VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    `centerLat` DOUBLE NOT NULL,
    `centerLng` DOUBLE NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cities_name_state_key`(`name`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `communities` (
    `id` VARCHAR(191) NOT NULL,
    `cityId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `registrationNumber` VARCHAR(100) NULL,
    `description` TEXT NULL,
    `contactPhone` VARCHAR(20) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `centerLat` DOUBLE NOT NULL,
    `centerLng` DOUBLE NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED') NOT NULL DEFAULT 'PENDING',
    `statusReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `communities_slug_key`(`slug`),
    INDEX `communities_cityId_status_idx`(`cityId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_admins` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` ENUM('HEAD', 'ADMIN', 'APPROVER', 'OPERATOR') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `assignedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_admins_userId_idx`(`userId`),
    UNIQUE INDEX `community_admins_communityId_userId_key`(`communityId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_memberships` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `status` ENUM('APPLIED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'LEFT') NOT NULL DEFAULT 'APPLIED',
    `applicationNote` VARCHAR(1000) NULL,
    `decisionNote` VARCHAR(1000) NULL,
    `decidedById` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_memberships_communityId_status_idx`(`communityId`, `status`),
    UNIQUE INDEX `community_memberships_communityId_driverId_key`(`communityId`, `driverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_service_areas` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `polygon` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `community_service_areas_communityId_active_idx`(`communityId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_policies` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `fareApprovalMode` ENUM('SINGLE_APPROVER', 'MULTI_APPROVER', 'PLATFORM_REVIEW') NOT NULL DEFAULT 'SINGLE_APPROVER',
    `requiredApprovals` INTEGER NOT NULL DEFAULT 1,
    `allowSelfApproval` BOOLEAN NOT NULL DEFAULT false,
    `maxFareIncreasePercent` INTEGER NOT NULL DEFAULT 25,
    `minNoticeHours` INTEGER NOT NULL DEFAULT 0,
    `allowDistanceFares` BOOLEAN NOT NULL DEFAULT true,
    `communityFeeBps` INTEGER NOT NULL DEFAULT 0,
    `cancellationFreeWindowSec` INTEGER NOT NULL DEFAULT 120,
    `cancellationFeePaise` INTEGER NOT NULL DEFAULT 2000,
    `driverOfferTimeoutSec` INTEGER NOT NULL DEFAULT 30,
    `bookingRequestTimeoutSec` INTEGER NOT NULL DEFAULT 300,
    `seatHoldMinutes` INTEGER NOT NULL DEFAULT 5,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `community_policies_communityId_key`(`communityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `governance_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `type` ENUM('FARE_CHANGE', 'POLICY_CHANGE') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `rationale` TEXT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `proposedById` VARCHAR(191) NOT NULL,
    `requiredApprovals` INTEGER NOT NULL,
    `requiresPlatformReview` BOOLEAN NOT NULL DEFAULT false,
    `platformDecision` VARCHAR(20) NULL,
    `platformReviewerId` VARCHAR(191) NULL,
    `platformReviewNote` VARCHAR(1000) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `governance_proposals_communityId_status_idx`(`communityId`, `status`),
    INDEX `governance_proposals_status_requiresPlatformReview_idx`(`status`, `requiresPlatformReview`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `governance_votes` (
    `id` VARCHAR(191) NOT NULL,
    `proposalId` VARCHAR(191) NOT NULL,
    `voterId` VARCHAR(191) NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `governance_votes_proposalId_voterId_key`(`proposalId`, `voterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `drivers` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `licenseNumber` VARCHAR(40) NOT NULL,
    `licenseExpiry` DATETIME(3) NOT NULL,
    `verificationStatus` ENUM('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `verificationNote` VARCHAR(1000) NULL,
    `verifiedById` VARCHAR(191) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    `suspensionReason` VARCHAR(500) NULL,
    `ratingSum` INTEGER NOT NULL DEFAULT 0,
    `ratingCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `drivers_userId_key`(`userId`),
    UNIQUE INDEX `drivers_licenseNumber_key`(`licenseNumber`),
    INDEX `drivers_verificationStatus_idx`(`verificationStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_documents` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `type` ENUM('DRIVING_LICENSE', 'VEHICLE_RC', 'PERMIT', 'INSURANCE', 'ID_PROOF', 'PHOTO') NOT NULL,
    `storageKey` VARCHAR(100) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewNote` VARCHAR(500) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `driver_documents_storageKey_key`(`storageKey`),
    INDEX `driver_documents_driverId_type_idx`(`driverId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicles` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `registrationNumber` VARCHAR(20) NOT NULL,
    `make` VARCHAR(60) NOT NULL,
    `model` VARCHAR(60) NOT NULL,
    `color` VARCHAR(30) NULL,
    `year` INTEGER NULL,
    `fuelType` VARCHAR(20) NULL,
    `seatCapacity` INTEGER NOT NULL DEFAULT 3,
    `permitNumber` VARCHAR(60) NULL,
    `permitExpiry` DATETIME(3) NULL,
    `insuranceExpiry` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'INACTIVE') NOT NULL DEFAULT 'PENDING',
    `reviewNote` VARCHAR(500) NULL,
    `approvedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicles_registrationNumber_key`(`registrationNumber`),
    INDEX `vehicles_communityId_status_idx`(`communityId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_vehicle_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `unassignedAt` DATETIME(3) NULL,

    INDEX `driver_vehicle_assignments_driverId_active_idx`(`driverId`, `active`),
    INDEX `driver_vehicle_assignments_vehicleId_active_idx`(`vehicleId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_availability` (
    `id` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NULL,
    `status` ENUM('OFFLINE', 'ONLINE', 'ON_TRIP') NOT NULL DEFAULT 'OFFLINE',
    `standId` VARCHAR(191) NULL,
    `queuedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `driver_availability_driverId_key`(`driverId`),
    INDEX `driver_availability_communityId_status_idx`(`communityId`, `status`),
    INDEX `driver_availability_standId_queuedAt_idx`(`standId`, `queuedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `driver_locations` (
    `driverId` VARCHAR(191) NOT NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `heading` DOUBLE NULL,
    `accuracyM` DOUBLE NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `driver_locations_updatedAt_idx`(`updatedAt`),
    PRIMARY KEY (`driverId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pickup_points` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(500) NULL,
    `lat` DOUBLE NOT NULL,
    `lng` DOUBLE NOT NULL,
    `isStand` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `pickup_points_communityId_active_idx`(`communityId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shared_routes` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` VARCHAR(1000) NULL,
    `status` ENUM('DRAFT', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'DRAFT',
    `maxSeats` INTEGER NOT NULL,
    `bookingCutoffMinutes` INTEGER NOT NULL DEFAULT 5,
    `cancellationCutoffMinutes` INTEGER NOT NULL DEFAULT 15,
    `boardingRules` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shared_routes_communityId_status_idx`(`communityId`, `status`),
    UNIQUE INDEX `shared_routes_communityId_code_key`(`communityId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `route_stops` (
    `id` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `pickupPointId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `offsetMinutes` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `route_stops_routeId_sequence_key`(`routeId`, `sequence`),
    UNIQUE INDEX `route_stops_routeId_pickupPointId_key`(`routeId`, `pickupPointId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `route_schedules` (
    `id` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `departureTime` CHAR(5) NOT NULL,
    `daysOfWeek` INTEGER NOT NULL DEFAULT 127,
    `seatCapacity` INTEGER NOT NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validTo` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `route_schedules_routeId_active_idx`(`routeId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shared_trip_instances` (
    `id` VARCHAR(191) NOT NULL,
    `routeId` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `departureAt` DATETIME(3) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `seatsBooked` INTEGER NOT NULL DEFAULT 0,
    `driverId` VARCHAR(191) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `status` ENUM('SCHEDULED', 'BOARDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `cancelReason` VARCHAR(500) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `shared_trip_instances_routeId_departureAt_idx`(`routeId`, `departureAt`),
    INDEX `shared_trip_instances_driverId_departureAt_idx`(`driverId`, `departureAt`),
    UNIQUE INDEX `shared_trip_instances_scheduleId_departureAt_key`(`scheduleId`, `departureAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seat_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `tripInstanceId` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `seatNumber` INTEGER NOT NULL,
    `status` ENUM('HELD', 'CONFIRMED', 'BOARDED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW') NOT NULL DEFAULT 'HELD',
    `holdExpiresAt` DATETIME(3) NULL,
    `activeSeatKey` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `seat_reservations_activeSeatKey_key`(`activeSeatKey`),
    INDEX `seat_reservations_tripInstanceId_status_idx`(`tripInstanceId`, `status`),
    INDEX `seat_reservations_bookingId_idx`(`bookingId`),
    INDEX `seat_reservations_status_holdExpiresAt_idx`(`status`, `holdExpiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fare_rules` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `sharedRouteId` VARCHAR(191) NULL,
    `version` INTEGER NOT NULL,
    `baseFarePaise` INTEGER NOT NULL DEFAULT 0,
    `baseDistanceMeters` INTEGER NOT NULL DEFAULT 0,
    `perKmPaise` INTEGER NOT NULL DEFAULT 0,
    `minimumFarePaise` INTEGER NOT NULL DEFAULT 0,
    `waitingPerMinutePaise` INTEGER NOT NULL DEFAULT 0,
    `freeWaitingMinutes` INTEGER NOT NULL DEFAULT 3,
    `perSeatPaise` INTEGER NOT NULL DEFAULT 0,
    `perStopPaise` INTEGER NOT NULL DEFAULT 0,
    `nightSurchargeBps` INTEGER NOT NULL DEFAULT 0,
    `nightStartHour` INTEGER NOT NULL DEFAULT 22,
    `nightEndHour` INTEGER NOT NULL DEFAULT 5,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `proposalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fare_rules_communityId_serviceType_effectiveFrom_idx`(`communityId`, `serviceType`, `effectiveFrom`),
    INDEX `fare_rules_sharedRouteId_effectiveFrom_idx`(`sharedRouteId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fare_proposals` (
    `id` VARCHAR(191) NOT NULL,
    `proposalId` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `sharedRouteId` VARCHAR(191) NULL,
    `previousFareRuleId` VARCHAR(191) NULL,
    `baseFarePaise` INTEGER NOT NULL DEFAULT 0,
    `baseDistanceMeters` INTEGER NOT NULL DEFAULT 0,
    `perKmPaise` INTEGER NOT NULL DEFAULT 0,
    `minimumFarePaise` INTEGER NOT NULL DEFAULT 0,
    `waitingPerMinutePaise` INTEGER NOT NULL DEFAULT 0,
    `freeWaitingMinutes` INTEGER NOT NULL DEFAULT 3,
    `perSeatPaise` INTEGER NOT NULL DEFAULT 0,
    `perStopPaise` INTEGER NOT NULL DEFAULT 0,
    `nightSurchargeBps` INTEGER NOT NULL DEFAULT 0,
    `nightStartHour` INTEGER NOT NULL DEFAULT 22,
    `nightEndHour` INTEGER NOT NULL DEFAULT 5,
    `appliedFareRuleId` VARCHAR(191) NULL,

    UNIQUE INDEX `fare_proposals_proposalId_key`(`proposalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fare_history` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `sharedRouteId` VARCHAR(191) NULL,
    `fareRuleId` VARCHAR(191) NOT NULL,
    `previousFareRuleId` VARCHAR(191) NULL,
    `proposalId` VARCHAR(191) NULL,
    `changedById` VARCHAR(191) NULL,
    `summary` JSON NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fare_history_communityId_createdAt_idx`(`communityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fare_quotes` (
    `id` VARCHAR(191) NOT NULL,
    `passengerId` VARCHAR(191) NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `fareRuleId` VARCHAR(191) NOT NULL,
    `pickupLat` DOUBLE NOT NULL,
    `pickupLng` DOUBLE NOT NULL,
    `dropLat` DOUBLE NOT NULL,
    `dropLng` DOUBLE NOT NULL,
    `distanceMeters` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `distanceSource` VARCHAR(20) NOT NULL,
    `seatCount` INTEGER NOT NULL DEFAULT 1,
    `tripInstanceId` VARCHAR(191) NULL,
    `pickupStopId` VARCHAR(191) NULL,
    `dropStopId` VARCHAR(191) NULL,
    `farePaise` INTEGER NOT NULL,
    `breakdown` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `fare_quotes_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bookings` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(16) NOT NULL,
    `type` ENUM('REGULAR', 'SHARED') NOT NULL,
    `status` ENUM('REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW') NOT NULL DEFAULT 'REQUESTED',
    `passengerId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NULL,
    `vehicleId` VARCHAR(191) NULL,
    `fareRuleId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(64) NOT NULL,
    `pickupLat` DOUBLE NOT NULL,
    `pickupLng` DOUBLE NOT NULL,
    `pickupAddress` VARCHAR(300) NULL,
    `dropLat` DOUBLE NOT NULL,
    `dropLng` DOUBLE NOT NULL,
    `dropAddress` VARCHAR(300) NULL,
    `tripInstanceId` VARCHAR(191) NULL,
    `pickupStopId` VARCHAR(191) NULL,
    `dropStopId` VARCHAR(191) NULL,
    `seatCount` INTEGER NOT NULL DEFAULT 1,
    `distanceMeters` INTEGER NOT NULL,
    `durationSeconds` INTEGER NOT NULL,
    `quotedFarePaise` INTEGER NOT NULL,
    `waitingChargePaise` INTEGER NOT NULL DEFAULT 0,
    `cancellationFeePaise` INTEGER NOT NULL DEFAULT 0,
    `finalFarePaise` INTEGER NULL,
    `platformFeePaise` INTEGER NULL,
    `communityFeePaise` INTEGER NULL,
    `driverEarningsPaise` INTEGER NULL,
    `paymentMethod` ENUM('CASH', 'MOCK_ONLINE', 'ONLINE') NOT NULL DEFAULT 'CASH',
    `paymentStatus` ENUM('NOT_DUE', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'WAIVED') NOT NULL DEFAULT 'NOT_DUE',
    `startPin` CHAR(4) NOT NULL,
    `shareToken` VARCHAR(64) NULL,
    `shareExpiresAt` DATETIME(3) NULL,
    `offerRound` INTEGER NOT NULL DEFAULT 0,
    `requestExpiresAt` DATETIME(3) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `arrivedAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelledById` VARCHAR(191) NULL,
    `cancelReason` VARCHAR(500) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bookings_reference_key`(`reference`),
    UNIQUE INDEX `bookings_quoteId_key`(`quoteId`),
    UNIQUE INDEX `bookings_shareToken_key`(`shareToken`),
    INDEX `bookings_communityId_status_createdAt_idx`(`communityId`, `status`, `createdAt`),
    INDEX `bookings_driverId_status_idx`(`driverId`, `status`),
    INDEX `bookings_passengerId_createdAt_idx`(`passengerId`, `createdAt`),
    INDEX `bookings_status_requestExpiresAt_idx`(`status`, `requestExpiresAt`),
    INDEX `bookings_tripInstanceId_idx`(`tripInstanceId`),
    UNIQUE INDEX `bookings_passengerId_idempotencyKey_key`(`passengerId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `round` INTEGER NOT NULL,
    `status` ENUM('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN') NOT NULL DEFAULT 'OFFERED',
    `distanceMeters` INTEGER NULL,
    `offeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `respondedAt` DATETIME(3) NULL,

    INDEX `booking_assignments_driverId_status_idx`(`driverId`, `status`),
    INDEX `booking_assignments_status_expiresAt_idx`(`status`, `expiresAt`),
    UNIQUE INDEX `booking_assignments_bookingId_driverId_key`(`bookingId`, `driverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `booking_status_history` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW') NULL,
    `toStatus` ENUM('REQUESTED', 'CONFIRMED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorType` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `booking_status_history_bookingId_createdAt_idx`(`bookingId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trip_events` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `tripInstanceId` VARCHAR(191) NULL,
    `type` VARCHAR(40) NOT NULL,
    `note` VARCHAR(1000) NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `actorId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `trip_events_bookingId_idx`(`bookingId`),
    INDEX `trip_events_tripInstanceId_idx`(`tripInstanceId`),
    INDEX `trip_events_type_createdAt_idx`(`type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ratings` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `raterId` VARCHAR(191) NOT NULL,
    `driverId` VARCHAR(191) NOT NULL,
    `score` INTEGER NOT NULL,
    `comment` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ratings_driverId_idx`(`driverId`),
    UNIQUE INDEX `ratings_bookingId_raterId_key`(`bookingId`, `raterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `complaints` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(16) NOT NULL,
    `kind` ENUM('COMPLAINT', 'DISPUTE', 'APPEAL') NOT NULL DEFAULT 'COMPLAINT',
    `communityId` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `raisedById` VARCHAR(191) NOT NULL,
    `againstDriverId` VARCHAR(191) NULL,
    `category` VARCHAR(50) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED') NOT NULL DEFAULT 'OPEN',
    `resolution` TEXT NULL,
    `handledById` VARCHAR(191) NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `complaints_reference_key`(`reference`),
    INDEX `complaints_communityId_status_idx`(`communityId`, `status`),
    INDEX `complaints_raisedById_idx`(`raisedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `amountPaise` INTEGER NOT NULL,
    `method` ENUM('CASH', 'MOCK_ONLINE', 'ONLINE') NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `providerRef` VARCHAR(100) NULL,
    `status` ENUM('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'CREATED',
    `successKey` VARCHAR(64) NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `processingFeePaise` INTEGER NOT NULL DEFAULT 0,
    `verifiedVia` VARCHAR(30) NULL,
    `failureReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payments_providerRef_key`(`providerRef`),
    UNIQUE INDEX `payments_successKey_key`(`successKey`),
    UNIQUE INDEX `payments_idempotencyKey_key`(`idempotencyKey`),
    INDEX `payments_bookingId_idx`(`bookingId`),
    INDEX `payments_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `amountPaise` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `refunds_paymentId_idx`(`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_fee_configs` (
    `id` VARCHAR(191) NOT NULL,
    `serviceType` ENUM('REGULAR', 'SHARED') NOT NULL,
    `feeBps` INTEGER NOT NULL,
    `flatFeePaise` INTEGER NOT NULL DEFAULT 0,
    `maxFeePaise` INTEGER NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `platform_fee_configs_serviceType_effectiveFrom_idx`(`serviceType`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_fee_records` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `farePaise` INTEGER NOT NULL,
    `platformFeePaise` INTEGER NOT NULL,
    `communityFeePaise` INTEGER NOT NULL,
    `processingFeePaise` INTEGER NOT NULL DEFAULT 0,
    `driverNetPaise` INTEGER NOT NULL,
    `platformFeeBps` INTEGER NOT NULL,
    `communityFeeBps` INTEGER NOT NULL,
    `settlementStatus` ENUM('UNSETTLED', 'STATEMENTED', 'SETTLED') NOT NULL DEFAULT 'UNSETTLED',
    `statementId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `platform_fee_records_bookingId_key`(`bookingId`),
    INDEX `platform_fee_records_communityId_createdAt_idx`(`communityId`, `createdAt`),
    INDEX `platform_fee_records_statementId_idx`(`statementId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `community_statements` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `periodStart` DATETIME(3) NOT NULL,
    `periodEnd` DATETIME(3) NOT NULL,
    `tripCount` INTEGER NOT NULL,
    `totalFarePaise` INTEGER NOT NULL,
    `platformFeePaise` INTEGER NOT NULL,
    `communityFeePaise` INTEGER NOT NULL,
    `driverNetPaise` INTEGER NOT NULL,
    `status` ENUM('ISSUED', 'SETTLED') NOT NULL DEFAULT 'ISSUED',
    `generatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `community_statements_communityId_periodStart_periodEnd_key`(`communityId`, `periodStart`, `periodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `link` VARCHAR(255) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` TEXT NOT NULL,
    `audience` VARCHAR(20) NOT NULL DEFAULT 'ALL',
    `publishedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `announcements_communityId_createdAt_idx`(`communityId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `support_tickets` (
    `id` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'SUPPORT',
    `userId` VARCHAR(191) NOT NULL,
    `communityId` VARCHAR(191) NULL,
    `bookingId` VARCHAR(191) NULL,
    `subject` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT') NOT NULL DEFAULT 'MEDIUM',
    `assignedToId` VARCHAR(191) NULL,
    `resolutionNote` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `support_tickets_reference_key`(`reference`),
    INDEX `support_tickets_status_priority_idx`(`status`, `priority`),
    INDEX `support_tickets_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `feature_flags` (
    `key` VARCHAR(60) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `description` VARCHAR(255) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `platform_settings` (
    `key` VARCHAR(60) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorRole` VARCHAR(40) NULL,
    `communityId` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(50) NOT NULL,
    `entityId` VARCHAR(40) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `requestId` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_communityId_createdAt_idx`(`communityId`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geocode_cache` (
    `queryHash` CHAR(64) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `query` VARCHAR(300) NOT NULL,
    `response` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `geocode_cache_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`queryHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_consents` ADD CONSTRAINT `user_consents_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `communities` ADD CONSTRAINT `communities_cityId_fkey` FOREIGN KEY (`cityId`) REFERENCES `cities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_admins` ADD CONSTRAINT `community_admins_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_admins` ADD CONSTRAINT `community_admins_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_memberships` ADD CONSTRAINT `community_memberships_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_memberships` ADD CONSTRAINT `community_memberships_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_service_areas` ADD CONSTRAINT `community_service_areas_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_policies` ADD CONSTRAINT `community_policies_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `governance_proposals` ADD CONSTRAINT `governance_proposals_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `governance_proposals` ADD CONSTRAINT `governance_proposals_proposedById_fkey` FOREIGN KEY (`proposedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `governance_votes` ADD CONSTRAINT `governance_votes_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `governance_proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `governance_votes` ADD CONSTRAINT `governance_votes_voterId_fkey` FOREIGN KEY (`voterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `drivers` ADD CONSTRAINT `drivers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_documents` ADD CONSTRAINT `driver_documents_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_vehicle_assignments` ADD CONSTRAINT `driver_vehicle_assignments_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_vehicle_assignments` ADD CONSTRAINT `driver_vehicle_assignments_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_availability` ADD CONSTRAINT `driver_availability_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_availability` ADD CONSTRAINT `driver_availability_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_availability` ADD CONSTRAINT `driver_availability_standId_fkey` FOREIGN KEY (`standId`) REFERENCES `pickup_points`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `driver_locations` ADD CONSTRAINT `driver_locations_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pickup_points` ADD CONSTRAINT `pickup_points_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_routes` ADD CONSTRAINT `shared_routes_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `shared_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_stops` ADD CONSTRAINT `route_stops_pickupPointId_fkey` FOREIGN KEY (`pickupPointId`) REFERENCES `pickup_points`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `route_schedules` ADD CONSTRAINT `route_schedules_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `shared_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_trip_instances` ADD CONSTRAINT `shared_trip_instances_routeId_fkey` FOREIGN KEY (`routeId`) REFERENCES `shared_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_trip_instances` ADD CONSTRAINT `shared_trip_instances_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `route_schedules`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_trip_instances` ADD CONSTRAINT `shared_trip_instances_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_trip_instances` ADD CONSTRAINT `shared_trip_instances_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shared_trip_instances` ADD CONSTRAINT `shared_trip_instances_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_reservations` ADD CONSTRAINT `seat_reservations_tripInstanceId_fkey` FOREIGN KEY (`tripInstanceId`) REFERENCES `shared_trip_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seat_reservations` ADD CONSTRAINT `seat_reservations_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_rules` ADD CONSTRAINT `fare_rules_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_rules` ADD CONSTRAINT `fare_rules_sharedRouteId_fkey` FOREIGN KEY (`sharedRouteId`) REFERENCES `shared_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_proposals` ADD CONSTRAINT `fare_proposals_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `governance_proposals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_history` ADD CONSTRAINT `fare_history_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_quotes` ADD CONSTRAINT `fare_quotes_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fare_quotes` ADD CONSTRAINT `fare_quotes_fareRuleId_fkey` FOREIGN KEY (`fareRuleId`) REFERENCES `fare_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_passengerId_fkey` FOREIGN KEY (`passengerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_fareRuleId_fkey` FOREIGN KEY (`fareRuleId`) REFERENCES `fare_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_tripInstanceId_fkey` FOREIGN KEY (`tripInstanceId`) REFERENCES `shared_trip_instances`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_pickupStopId_fkey` FOREIGN KEY (`pickupStopId`) REFERENCES `route_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_dropStopId_fkey` FOREIGN KEY (`dropStopId`) REFERENCES `route_stops`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_assignments` ADD CONSTRAINT `booking_assignments_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_assignments` ADD CONSTRAINT `booking_assignments_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `booking_status_history` ADD CONSTRAINT `booking_status_history_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trip_events` ADD CONSTRAINT `trip_events_tripInstanceId_fkey` FOREIGN KEY (`tripInstanceId`) REFERENCES `shared_trip_instances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_raterId_fkey` FOREIGN KEY (`raterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ratings` ADD CONSTRAINT `ratings_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `drivers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_raisedById_fkey` FOREIGN KEY (`raisedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_againstDriverId_fkey` FOREIGN KEY (`againstDriverId`) REFERENCES `drivers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_fee_records` ADD CONSTRAINT `platform_fee_records_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_fee_records` ADD CONSTRAINT `platform_fee_records_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `platform_fee_records` ADD CONSTRAINT `platform_fee_records_statementId_fkey` FOREIGN KEY (`statementId`) REFERENCES `community_statements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `community_statements` ADD CONSTRAINT `community_statements_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_communityId_fkey` FOREIGN KEY (`communityId`) REFERENCES `communities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
