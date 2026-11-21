import { useState } from 'react';
import { Bell, Check, Clock, RotateCcw, X } from 'lucide-react';
import type { HistoryItem, LogStatus } from '../types.ts';
import {
  formatMealPreference,
  formatTime12h,
  formatTimestampTime,
} from '../lib/format.ts';

interface HistoryViewProps {
  history: HistoryItem[];
  loading: boolean;
  onUndo: (medicineId: number, logDate: string) => Promise<void>;
}

export function HistoryView({ history, loading, onUndo }: HistoryViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | LogStatus>('all');
  const [busyId, setBusyId] = useState<number | null>(null);

  const filtered = history.filter(
    (entry) => statusFilter === 'all' || entry.log.status === statusFilter
  );

  const handleUndo = async (entry: HistoryItem) => {
    setBusyId(entry.log.id);
    try {
      await onUndo(entry.medicine.id, entry.log.logDate);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
          Medication history
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Review daily tracking records and undo incorrect entries at any time.
        </p>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: 'All records' },
                { id: 'taken', label: 'Taken' },
                { id: 'snoozed', label: 'Snoozed' },
                { id: 'skipped', label: 'Skipped' },
                { id: 'pending', label: 'Scheduled' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {filtered.length} entries
          </span>
        </div>

        {loading && history.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">Loading history...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No medication log entries recorded for this filter yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Date</th>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Medicine</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Response / Note</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((entry) => {
                  const { log, medicine } = entry;
                  const canUndo =
                    log.status === 'taken' ||
                    log.status === 'skipped' ||
                    log.status === 'snoozed';

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="py-3.5 px-5 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {log.logDate}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-900 tabular-nums whitespace-nowrap">
                        {formatTime12h(log.scheduledTime)}
                      </td>
                      <td className="py-3.5 px-4">
                        <p className="font-medium text-slate-900">
                          {medicine.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {medicine.dosage} ·{' '}
                          {formatMealPreference(medicine.mealPreference)}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium whitespace-nowrap">
                        {log.status === 'taken' && (
                          <span className="inline-flex items-center gap-1.5 text-emerald-700">
                            <Check className="w-3.5 h-3.5" />
                            <span>
                              Taken
                              {log.takenAt
                                ? ` · ${formatTimestampTime(log.takenAt)}`
                                : ''}
                            </span>
                          </span>
                        )}
                        {log.status === 'skipped' && (
                          <span className="inline-flex items-center gap-1.5 text-rose-700">
                            <X className="w-3.5 h-3.5" />
                            <span>Skipped</span>
                          </span>
                        )}
                        {log.status === 'snoozed' && (
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <Bell className="w-3.5 h-3.5" />
                            <span>Snoozed (1h)</span>
                          </span>
                        )}
                        {log.status === 'pending' && (
                          <span className="inline-flex items-center gap-1.5 text-slate-500">
                            <Clock className="w-3.5 h-3.5" />
                            <span>Scheduled</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600 max-w-xs truncate">
                        {log.lastBotReply || '—'}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        {canUndo ? (
                          <button
                            type="button"
                            disabled={busyId === log.id}
                            onClick={() => handleUndo(entry)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Undo</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
