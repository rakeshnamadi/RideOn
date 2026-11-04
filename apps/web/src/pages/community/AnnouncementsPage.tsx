import { useState } from 'react';
import { Badge, Button, Card, Input, PageHeader, QueryState, Select, Textarea } from '@/components/ui';
import { useAction, useApi } from '@/hooks/api';
import { useCommunity } from '@/layouts/CommunityLayout';
import { api } from '@/services/api';
import { dateTime, humanize } from '@/utils/format';

interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: string;
  createdAt: string;
}

export default function AnnouncementsPage() {
  const { id, can } = useCommunity();
  const q = useApi<Announcement[]>(['community', id, 'announcements'], `/communities/${id}/announcements`);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('ALL');
  const publish = useAction(() => api.post(`/communities/${id}/announcements`, { title, body, audience }), {
    invalidate: [['community', id, 'announcements']],
    success: 'Announcement published',
    onSuccess: () => {
      setTitle('');
      setBody('');
    },
  });
  const remove = useAction((a: Announcement) => api.del(`/communities/${id}/announcements/${a.id}`), { invalidate: [['community', id, 'announcements'], ['public-community']], success: 'Announcement deleted' });
  return (
    <div className="space-y-5">
      <PageHeader title="Announcements" subtitle="Driver announcements are also sent as notifications. Passenger announcements appear on the public fares page." />
      {can('announcements.manage') && (
        <Card title="New announcement">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); publish.mutate(); }}>
            <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea label="Message" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            <Select label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)} options={[{ value: 'ALL', label: 'Everyone' }, { value: 'DRIVERS', label: 'Drivers only' }, { value: 'PASSENGERS', label: 'Passengers only' }]} />
            <Button type="submit" disabled={title.trim().length < 3 || body.trim().length < 3} loading={publish.isPending}>Publish</Button>
          </form>
        </Card>
      )}
      <QueryState query={q}>
        {(list) => (
          <div className="space-y-3">
            {list.map((a) => (
              <Card key={a.id}>
                <p className="flex items-center gap-2 font-medium">{a.title} <Badge>{humanize(a.audience)}</Badge></p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{a.body}</p>
                <div className="mt-1 flex items-center gap-2"><p className="text-xs text-stone-500">{dateTime(a.createdAt)}</p>{can('announcements.manage') && <Button size="sm" variant="ghost" onClick={() => remove.mutate(a)}>Delete</Button>}</div>
              </Card>
            ))}
            {list.length === 0 && <p className="text-sm text-stone-500">No announcements yet.</p>}
          </div>
        )}
      </QueryState>
    </div>
  );
}
