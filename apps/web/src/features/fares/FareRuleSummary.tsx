import { DefinitionList } from '@/components/ui';
import type { FareRule } from '@/types';
import { date, inr } from '@/utils/format';

/** Human-readable fare table for a regular-auto rule. */
export function FareRuleSummary({ rule }: { rule: FareRule }) {
  if (rule.serviceType === 'SHARED') {
    return (
      <DefinitionList
        items={[
          ['Per seat', `${inr(rule.perSeatPaise)} (first stop)`],
          ['Each extra stop', inr(rule.perStopPaise)],
          ['Minimum per seat', inr(rule.minimumFarePaise)],
          ['Version', `v${rule.version} since ${date(rule.effectiveFrom)}`],
        ]}
      />
    );
  }
  return (
    <DefinitionList
      items={[
        ['Base fare', `${inr(rule.baseFarePaise)} for the first ${(rule.baseDistanceMeters / 1000).toFixed(1)} km`],
        ['After that', rule.perKmPaise ? `${inr(rule.perKmPaise)} per km` : 'No distance charge'],
        ['Minimum fare', inr(rule.minimumFarePaise)],
        ['Waiting', rule.waitingPerMinutePaise ? `${inr(rule.waitingPerMinutePaise)}/min after ${rule.freeWaitingMinutes} free minutes` : 'Not charged'],
        ['Night charge', rule.nightSurchargeBps ? `+${rule.nightSurchargeBps / 100}% from ${rule.nightStartHour}:00 to ${rule.nightEndHour}:00` : 'None'],
        ['Version', `v${rule.version} since ${date(rule.effectiveFrom)}`],
      ]}
    />
  );
}
