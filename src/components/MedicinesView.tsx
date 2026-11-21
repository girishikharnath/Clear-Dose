import { useState } from 'react';
import { Bell, BellRing, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Medicine, ScheduleType } from '../types.ts';
import {
  formatMealPreference,
  formatScheduleType,
  formatTime12h,
} from '../lib/format.ts';

interface MedicinesViewProps {
  medicines: Medicine[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (medicine: Medicine) => void;
  onDelete: (id: number) => Promise<void>;
  onToggleReminder: (medicine: Medicine) => Promise<void>;
}

export function MedicinesView({
  medicines,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onToggleReminder,
}: MedicinesViewProps) {
  const [search, setSearch] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState<'all' | ScheduleType>(
    'all'
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const filtered = medicines.filter((med) => {
    const matchesSearch =
      !search.trim() ||
      med.name.toLowerCase().includes(search.toLowerCase()) ||
      med.dosage.toLowerCase().includes(search.toLowerCase());
    const matchesSchedule =
      scheduleFilter === 'all' || med.scheduleType === scheduleFilter;
    return matchesSearch && matchesSchedule;
  });

  const handleConfirmDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggle = async (med: Medicine) => {
    setTogglingId(med.id);
    try {
      await onToggleReminder(med);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
            Medicine catalog
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Configure reminder times, meal preferences, scheduled Telegram
            alerts, and daily, weekday, or weekend schedules.
          </p>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by medicine name or dosage..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-teal-700 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start md:self-auto">
            {(
              [
                { id: 'all', label: 'All schedules' },
                { id: 'daily', label: 'Daily' },
                { id: 'weekdays', label: 'Weekdays' },
                { id: 'weekends', label: 'Weekends' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setScheduleFilter(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  scheduleFilter === opt.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {loading && medicines.length === 0 ? (
          <div className="p-8 text-sm text-slate-500">Loading medicines...</div>
        ) : medicines.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <h3 className="font-display text-base font-semibold text-slate-900">
              No medicines added yet
            </h3>
            <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
              Add your prescriptions or supplements once and ClearDose will
              automatically populate your daily dashboard and reminders.
            </p>
            <button
              type="button"
              onClick={onAdd}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add medicine</span>
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No medicines match your current search or schedule filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                  <th className="py-3 px-5">Medicine</th>
                  <th className="py-3 px-4">Dosage</th>
                  <th className="py-3 px-4">Reminder time</th>
                  <th className="py-3 px-4">Meal timing</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4">Auto-remind</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filtered.map((med) => (
                  <tr
                    key={med.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-3.5 px-5">
                      <p className="font-medium text-slate-900">{med.name}</p>
                      {med.notes && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">
                          {med.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                      {med.dosage}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                      {formatTime12h(med.reminderTime)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                      {formatMealPreference(med.mealPreference)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 whitespace-nowrap">
                      {formatScheduleType(med.scheduleType)}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={togglingId === med.id}
                        onClick={() => handleToggle(med)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          med.reminderEnabled
                            ? 'border-teal-700/40 bg-teal-50 text-teal-800 hover:bg-teal-100/70'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {med.reminderEnabled ? (
                          <>
                            <BellRing className="w-3.5 h-3.5 text-teal-700" />
                            <span>On</span>
                          </>
                        ) : (
                          <>
                            <Bell className="w-3.5 h-3.5 text-slate-400" />
                            <span>Off</span>
                          </>
                        )}
                      </button>
                    </td>
                    <td className="py-3.5 px-5 text-right whitespace-nowrap">
                      {confirmDeleteId === med.id ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-rose-700 font-medium">
                            Delete?
                          </span>
                          <button
                            type="button"
                            disabled={deletingId === med.id}
                            onClick={() => handleConfirmDelete(med.id)}
                            className="px-2.5 py-1 rounded-md bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 cursor-pointer"
                          >
                            {deletingId === med.id ? 'Deleting...' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onEdit(med)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(med.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
