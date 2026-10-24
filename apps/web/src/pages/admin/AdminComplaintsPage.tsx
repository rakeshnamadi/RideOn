import { PageHeader } from '@/components/ui';
import { ComplaintsBoard } from '@/features/complaints/ComplaintsBoard';

export default function AdminComplaintsPage() {
  return (
    <div>
      <PageHeader title="Complaints & appeals" subtitle="All communities. Escalated appeals are decided here." />
      <ComplaintsBoard platform />
    </div>
  );
}
