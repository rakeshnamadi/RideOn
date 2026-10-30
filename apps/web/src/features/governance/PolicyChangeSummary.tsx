import { humanize, inr } from '@/utils/format';

export const POLICY_LABELS: Record<string, string> = {
  fareApprovalMode: 'Fare approval',
  requiredApprovals: 'Approvals required',
  allowSelfApproval: 'Proposer may approve own proposal',
  minNoticeHours: 'Notice before fare changes',
  cancellationFreeWindowSec: 'Free cancellation after acceptance',
  cancellationFeePaise: 'Cancellation fee',
};

export function formatPolicyValue(field: string, value: unknown): string {
  if (value === undefined || value === null) return '—';
  switch (field) {
    case 'cancellationFeePaise':
      return inr(Number(value));
    case 'cancellationFreeWindowSec':
      return `${Math.round(Number(value) / 60)} min`;
    case 'minNoticeHours':
      return `${value} h`;
    case 'allowSelfApproval':
      return value ? 'Yes' : 'No';
    case 'fareApprovalMode':
      return humanize(String(value));
    default:
      return String(value);
  }
}

/** "Field: before → after" lines for a POLICY_CHANGE proposal. */
export function PolicyChangeSummary({ changes, before }: { changes: Record<string, unknown> | null; before: Record<string, unknown> | null }) {
  if (!changes) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm text-ink/85">
      {Object.entries(changes).map(([field, value]) => (
        <li key={field}>
          {POLICY_LABELS[field] ?? humanize(field)}: <span className="text-muted line-through">{formatPolicyValue(field, before?.[field])}</span> → <strong>{formatPolicyValue(field, value)}</strong>
        </li>
      ))}
    </ul>
  );
}
