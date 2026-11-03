import { History, RotateCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ProtocolVersionEntry } from '../../../shared/types';
import { Button, Card, inputCls, Modal, Notice, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useEditor } from '../../store/editor';

export function HistoryTab() {
  const bundle = useEditor((s) => s.bundle!);
  const flush = useEditor((s) => s.flush);
  const load = useEditor((s) => s.load);
  const [versions, setVersions] = useState<ProtocolVersionEntry[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ProtocolVersionEntry | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const id = bundle.protocol.id;

  const refresh = useCallback(() => api.versions(id).then(setVersions), [id]);
  useEffect(() => void refresh(), [refresh]);

  const snapshot = async () => {
    setBusy(true);
    await flush();
    await api.createVersion(id, note || 'Manual snapshot');
    setNote('');
    await refresh();
    setBusy(false);
    setMessage('Snapshot saved.');
  };
  const restore = async (v: ProtocolVersionEntry) => {
    setBusy(true);
    await flush();
    await api.restoreVersion(id, v.id);
    await load(id, true);
    await refresh();
    setBusy(false);
    setConfirm(null);
    setMessage(`Restored revision ${v.revision}. The previous state was saved as a snapshot first.`);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-8 py-6">
      <Card className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
        <Stat label="Protocol version" value={bundle.protocol.version || '—'} />
        <Stat label="Revision" value={`#${bundle.protocol.revision}`} />
        <Stat label="Last modified" value={formatDateTime(bundle.protocol.updatedAt)} />
        <Stat label="Template" value={`${bundle.protocol.templateId} v${bundle.protocol.templateVersion}`} />
      </Card>
      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Create version snapshot</h3>
        <p className="mb-3 text-sm text-slate-500">Every save increments the revision number. Snapshots keep a restorable copy of the full protocol, for example before circulation or an amendment. A snapshot is also taken automatically when a protocol is marked Final.</p>
        <div className="flex gap-2">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Snapshot note, e.g. 'Draft 0.3 sent to medical review'" />
          <Button variant="primary" onClick={snapshot} loading={busy}>
            <Save className="h-4 w-4" /> Save snapshot
          </Button>
        </div>
        {message && <Notice tone="success" className="mt-3">{message}</Notice>}
      </Card>
      <Card>
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
          <History className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">Snapshots</h3>
        </div>
        {versions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No snapshots yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2">Saved</th>
                <th className="px-2 py-2">Revision</th>
                <th className="px-2 py-2">Version</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="px-5 py-2 text-slate-600">{formatDateTime(v.createdAt)}</td>
                  <td className="px-2 tabular-nums">#{v.revision}</td>
                  <td className="px-2">{v.versionLabel || '—'}</td>
                  <td className="px-2">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-2 text-slate-600">{v.note}</td>
                  <td className="px-3 text-right">
                    <a className="mr-2 text-xs text-brand-700 hover:underline" href={`/api/protocols/${id}/versions/${v.id}`} target="_blank" rel="noreferrer">
                      JSON
                    </a>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(v)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Restore snapshot"
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => confirm && restore(confirm)}>
              Restore
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">Replace the current content with revision #{confirm?.revision}? The current state is saved as a snapshot first, so this can be undone.</p>
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-medium text-slate-800">{value}</div>
    </div>
  );
}
