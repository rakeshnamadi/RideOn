import { PageHeader } from '@/components/ui';
import { ComplaintsBoard } from '@/features/complaints/ComplaintsBoard';
import { useCommunity } from '@/layouts/CommunityLayout';

export default function CommunityComplaintsPage() {
  const { id } = useCommunity();
  return (
    <div>
      <PageHeader title="Complaints, disputes & appeals" subtitle="Passenger complaints about this community's trips, and driver appeals." />
      <ComplaintsBoard communityId={id} />
    </div>
  );
}
