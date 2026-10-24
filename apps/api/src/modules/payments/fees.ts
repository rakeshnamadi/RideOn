/** Pure revenue-split calculation. Integer paise throughout; the driver absorbs rounding. */
export interface FeeConfig {
  platformFeeBps: number;
  platformFlatFeePaise: number;
  platformMaxFeePaise: number | null;
  communityFeeBps: number;
  processingFeePaise?: number;
}

export interface FeeSplit {
  farePaise: number;
  platformFeePaise: number;
  communityFeePaise: number;
  processingFeePaise: number;
  driverNetPaise: number;
}

export function calculateFeeSplit(farePaise: number, cfg: FeeConfig): FeeSplit {
  if (!Number.isInteger(farePaise) || farePaise < 0) throw new Error('Fare must be a non-negative integer (paise)');
  for (const bps of [cfg.platformFeeBps, cfg.communityFeeBps]) {
    if (bps < 0 || bps > 10_000) throw new Error('Fee basis points must be between 0 and 10000');
  }
  if (farePaise === 0) {
    return { farePaise: 0, platformFeePaise: 0, communityFeePaise: 0, processingFeePaise: 0, driverNetPaise: 0 };
  }
  let platformFee = Math.round((farePaise * cfg.platformFeeBps) / 10_000) + cfg.platformFlatFeePaise;
  if (cfg.platformMaxFeePaise !== null) platformFee = Math.min(platformFee, cfg.platformMaxFeePaise);
  const communityFee = Math.round((farePaise * cfg.communityFeeBps) / 10_000);
  const processingFee = cfg.processingFeePaise ?? 0;
  // Fees can never exceed the fare; cap in priority order processing → platform → community.
  const cappedProcessing = Math.min(processingFee, farePaise);
  const cappedPlatform = Math.min(platformFee, farePaise - cappedProcessing);
  const cappedCommunity = Math.min(communityFee, farePaise - cappedProcessing - cappedPlatform);
  return {
    farePaise,
    platformFeePaise: cappedPlatform,
    communityFeePaise: cappedCommunity,
    processingFeePaise: cappedProcessing,
    driverNetPaise: farePaise - cappedProcessing - cappedPlatform - cappedCommunity,
  };
}
