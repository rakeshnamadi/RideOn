import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { Alert, Button, Card, DataTable, PageHeader, QueryState, Select, StatusBadge, Textarea, Input } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { api } from '@/services/api';
import { dateTime, humanize } from '@/utils/format';

interface Complaint {
  id: string;
  reference: string;
  kind: string;
  category: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  community: { name: string };
  booking: { reference: string } | null;
}
interface Ticket {
  id: string;
  reference: string;
  subject: string;
  status: string;
  priority: string;
  resolutionNote: string | null;
  createdAt: string;
}

const TicketSchema = z.object({
  subject: z.string().trim().min(3, 'Add a short subject'),
  description: z.string().trim().min(10, 'Describe the issue (at least 10 characters)'),
  kind: z.enum(['SUPPORT', 'INCIDENT', 'SAFETY']),
});

const AppealSchema = z.object({
  communityId: z.string().min(1, 'Choose the community'),
  description: z.string().trim().min(10, 'Explain why the decision should be reviewed'),
});

/** Help centre for passengers and drivers: complaints, appeals (drivers) and support tickets. */
export default function SupportPage() {
  const { me } = useAuth();
  const complaints = useApi<Complaint[]>(['complaints', 'mine'], '/complaints/mine');
  const tickets = useApi<Ticket[]>(['tickets', 'mine'], '/support-tickets/mine');
  const memberships = useApi<{ memberships: { communityId: string; status: string; community: { name: string } }[] }>(['driver', 'me'], me?.driver ? '/drivers/me' : null);

  const ticketForm = useForm<z.infer<typeof TicketSchema>>({ resolver: zodResolver(TicketSchema), defaultValues: { kind: 'SUPPORT' } });
  const createTicket = useAction((v: z.infer<typeof TicketSchema>) => api.post<{ reference: string }>('/support-tickets', v), {
    invalidate: [['tickets']],
    success: (r) => `Ticket ${r.reference} created`,
    onSuccess: () => ticketForm.reset({ kind: 'SUPPORT', subject: '', description: '' }),
  });
  const appealForm = useForm<z.infer<typeof AppealSchema>>({ resolver: zodResolver(AppealSchema) });
  const appeal = useAction((v: z.infer<typeof AppealSchema>) => api.post<{ reference: string }>('/complaints', { ...v, kind: 'APPEAL', category: 'SUSPENSION' }), {
    invalidate: [['complaints']],
    success: (r) => `Appeal ${r.reference} submitted`,
    onSuccess: () => appealForm.reset(),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Help & support" subtitle="Complaints about a trip are raised from the trip page and go to the community that runs it." />
      <Alert tone="warn">
        In an emergency, call <a href="tel:112" className="font-semibold underline">112</a>. During a trip, use the Emergency button on the trip page.
      </Alert>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Contact support">
          <form className="space-y-3" onSubmit={ticketForm.handleSubmit((v) => createTicket.mutate(v))} noValidate>
            <Select label="Type" {...ticketForm.register('kind')} options={[{ value: 'SUPPORT', label: 'General question' }, { value: 'INCIDENT', label: 'Incident report' }, { value: 'SAFETY', label: 'Safety concern' }]} />
            <Input label="Subject" {...ticketForm.register('subject')} error={ticketForm.formState.errors.subject?.message} />
            <Textarea label="Details" rows={4} {...ticketForm.register('description')} error={ticketForm.formState.errors.description?.message} />
            <Button type="submit" loading={createTicket.isPending}>
              Submit
            </Button>
          </form>
        </Card>
        {me?.driver && (
          <Card title="Appeal a community decision">
            <p className="mb-3 text-sm text-stone-600">If your membership was suspended or you disagree with a decision, appeal here. Appeals can be escalated to the platform.</p>
            <form className="space-y-3" onSubmit={appealForm.handleSubmit((v) => appeal.mutate(v))} noValidate>
              <Select
                label="Community"
                {...appealForm.register('communityId')}
                error={appealForm.formState.errors.communityId?.message}
                options={[{ value: '', label: 'Select…' }, ...(memberships.data?.memberships ?? []).map((m) => ({ value: m.communityId, label: `${m.community.name} (${humanize(m.status)})` }))]}
              />
              <Textarea label="Your appeal" rows={4} {...appealForm.register('description')} error={appealForm.formState.errors.description?.message} />
              <Button type="submit" loading={appeal.isPending}>
                Submit appeal
              </Button>
            </form>
          </Card>
        )}
      </div>
      <Card title="My complaints & appeals">
        <QueryState query={complaints}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No complaints"
              columns={[
                { header: 'Reference', cell: (r) => r.reference },
                { header: 'Type', cell: (r) => `${humanize(r.kind)} · ${humanize(r.category)}` },
                { header: 'Community', cell: (r) => r.community.name },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Resolution', cell: (r) => r.resolution ?? '—' },
                { header: 'Raised', cell: (r) => dateTime(r.createdAt) },
              ]}
            />
          )}
        </QueryState>
      </Card>
      <Card title="My support tickets">
        <QueryState query={tickets}>
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              empty="No tickets"
              columns={[
                { header: 'Reference', cell: (r) => r.reference },
                { header: 'Subject', cell: (r) => r.subject },
                { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
                { header: 'Note', cell: (r) => r.resolutionNote ?? '—' },
                { header: 'Created', cell: (r) => dateTime(r.createdAt) },
              ]}
            />
          )}
        </QueryState>
      </Card>
    </div>
  );
}
