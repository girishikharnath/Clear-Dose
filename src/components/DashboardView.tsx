import { useState } from 'react';
import {
  Bell,
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DailyDashboardData,
  LogStatus,
  Medicine,
} from '../types.ts';
import {
  formatMealPreference,
  formatScheduleType,
  formatTime12h,
  formatTimestampTime,
  getLocalTodayIso,
  shiftIsoDate,
} from '../lib/format.ts';

interface DashboardViewProps {
  dashboard: DailyDashboardData | null;
  loading: boolean;
  error: string | null;
  selectedDate: string;
  onChangeDate: (nextDate: string) => void;
  onUpdateStatus: (medicineId: number, status: LogStatus) => Promise<void>;
  onToggleReminder: (medicine: Medicine) => Promise<void>;
  onOpenAddMedicine: () => void;
  onEditMedicine: (medicine: Medicine) => void;
  onDeleteMedicine: (id: number) => Promise<void>;
}

type FilterTab = 'all' | 'pending' | 'taken' | 'snoozed' | 'skipped';

export function DashboardView({
  dashboard,
  loading,
  error,
  selectedDate,
  onChangeDate,
  onUpdateStatus,
  onToggleReminder,
  onOpenAddMedicine,
  onEditMedicine,
  onDeleteMedicine,
}: DashboardViewProps) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const todayIso = getLocalTodayIso();
  const isToday = selectedDate === todayIso;

  const handleAction = async (medicineId: number, status: LogStatus) => {
    setBusyId(medicineId);
    try {
      await onUpdateStatus(medicineId, status);
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleRemind = async (medicine: Medicine) => {
    setBusyId(medicine.id);
    try {
      await onToggleReminder(medicine);
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async (medicineId: number) => {
    setBusyId(medicineId);
    try {
      await onDeleteMedicine(medicineId);
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  const items = dashboard?.items ?? [];
  const filteredItems = items.filter((item) => {
    if (filter === 'all') return true;
    return item.log.status === filter;
  });

  const summary = dashboard?.summary ?? {
    scheduled: 0,
    taken: 0,
    skipped: 0,
    snoozed: 0,
    remaining: 0,
    adherencePercent: 0,
  };

  return (
    <div className="space-y-6">
      {/* Date Strip & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
            {isToday ? "Today's schedule" : dashboard?.dayName || selectedDate}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {dashboard?.dayName || selectedDate}
            <span className="mx-2 text-slate-300">·</span>
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {selectedDate}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => onChangeDate(shiftIsoDate(selectedDate, -1))}
            aria-label="Previous day"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onChangeDate(todayIso)}
            disabled={isToday}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onChangeDate(shiftIsoDate(selectedDate, 1))}
            aria-label="Next day"
            className="p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4-Column Metric Strip — single elevation, hairline dividers, tabular-nums */}
      <section
        aria-label="Daily medication summary"
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-200"
      >
        <div className="p-5 sm:p-6">
          <p className="text-xs font-medium text-slate-500">Scheduled</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-slate-900 tabular-nums">
            {summary.scheduled}
          </p>
          <p className="mt-1 text-xs text-slate-500">Total doses for day</p>
        </div>

        <div className="p-5 sm:p-6">
          <p className="text-xs font-medium text-slate-500">Taken</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-emerald-700 tabular-nums">
            {summary.taken}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.skipped > 0
              ? `${summary.skipped} skipped`
              : 'Logged on schedule'}
          </p>
        </div>

        <div className="p-5 sm:p-6">
          <p className="text-xs font-medium text-slate-500">Remaining</p>
          <p className="mt-2 font-mono text-3xl font-semibold text-slate-900 tabular-nums">
            {summary.remaining}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary.snoozed > 0
              ? `${summary.snoozed} snoozed (1h follow-up)`
              : 'Awaiting confirmation'}
          </p>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-slate-500">Daily progress</p>
            <span className="font-mono text-xs font-medium text-teal-700 tabular-nums">
              {summary.adherencePercent}%
            </span>
          </div>
          <p className="mt-2 font-mono text-3xl font-semibold text-slate-900 tabular-nums">
            {summary.taken}/{summary.scheduled}
          </p>
          <div
            className="mt-2.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={summary.adherencePercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-teal-700 transition-all duration-200"
              style={{ width: `${summary.adherencePercent}%` }}
            />
          </div>
        </div>
      </section>

      {/* Filter Tabs + Schedule Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
            {(
              [
                { id: 'all', label: `All (${items.length})` },
                {
                  id: 'pending',
                  label: `Scheduled (${items.filter((i) => i.log.status === 'pending').length})`,
                },
                { id: 'taken', label: `Taken (${summary.taken})` },
                { id: 'snoozed', label: `Snoozed (${summary.snoozed})` },
                { id: 'skipped', label: `Skipped (${summary.skipped})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-slate-500 whitespace-nowrap">
            Click Remind to enable automatic daily Telegram alerts at the
            scheduled time
          </p>
        </div>

        {error && (
          <div className="p-6 text-sm text-rose-700 bg-rose-50 border-b border-rose-200">
            {error}
          </div>
        )}

        {loading && !dashboard ? (
          <div className="divide-y divide-slate-200">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="px-6 py-5 flex items-center justify-between gap-4 animate-pulse"
              >
                <div className="space-y-2">
                  <div className="h-4 w-40 bg-slate-200 rounded" />
                  <div className="h-3 w-56 bg-slate-100 rounded" />
                </div>
                <div className="h-8 w-28 bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <h3 className="font-display text-base font-semibold text-slate-900">
              No medications scheduled for this day
            </h3>
            <p className="mt-1.5 text-sm text-slate-600 max-w-md mx-auto">
              Add your daily, weekday, or weekend medicines with meal timing to
              start tracking adherence and scheduling Telegram reminders.
            </p>
            <button
              type="button"
              onClick={onOpenAddMedicine}
              className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add first medicine</span>
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">
            No doses match the selected filter.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredItems.map((item) => {
              const { medicine, log } = item;
              const isBusy = busyId === medicine.id;
              const isCompleted =
                log.status === 'taken' || log.status === 'skipped';
              const isConfirmingDelete = confirmDeleteId === medicine.id;

              return (
                <div
                  key={medicine.id}
                  className="px-5 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  {/* Left: Timing + Medicine details */}
                  <div className="flex items-start sm:items-center gap-4 min-w-0">
                    <div className="w-24 shrink-0">
                      <button
                        type="button"
                        onClick={() => onEditMedicine(medicine)}
                        title="Edit medicine timing"
                        className="font-mono text-sm font-semibold text-slate-900 hover:text-teal-700 tabular-nums whitespace-nowrap cursor-pointer transition-colors"
                      >
                        {formatTime12h(medicine.reminderTime)}
                      </button>
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={`text-sm font-semibold ${
                            log.status === 'skipped'
                              ? 'text-slate-500 line-through'
                              : 'text-slate-900'
                          }`}
                        >
                          {medicine.name}
                        </span>
                        <span className="text-sm text-slate-600">
                          {medicine.dosage}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                        <span>{formatMealPreference(medicine.mealPreference)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatScheduleType(medicine.scheduleType)}</span>
                        {medicine.reminderEnabled && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-teal-700 font-medium">
                              Auto-remind at {formatTime12h(medicine.reminderTime)}
                            </span>
                          </>
                        )}
                        {medicine.notes && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-xs">
                              {medicine.notes}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Explicit State + Tracking, Scheduled Remind Toggle & Edit/Delete */}
                  <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                    {/* Semantic Status */}
                    <div className="text-xs font-medium whitespace-nowrap">
                      {log.status === 'taken' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                          <Check className="w-3.5 h-3.5" />
                          <span>
                            Taken
                            {log.takenAt
                              ? ` at ${formatTimestampTime(log.takenAt)}`
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
                          <span className="tabular-nums">
                            Snoozed · follow-up{' '}
                            {log.snoozedUntil
                              ? formatTimestampTime(log.snoozedUntil)
                              : '+1h'}
                          </span>
                        </span>
                      )}
                      {log.status === 'pending' && (
                        <span className="inline-flex items-center gap-1.5 text-slate-500">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Scheduled</span>
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-rose-700 whitespace-nowrap">
                          Delete medicine?
                        </span>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleConfirmDelete(medicine.id)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          {isBusy ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {!isCompleted ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleAction(medicine.id, 'taken')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Take</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                handleAction(medicine.id, 'skipped')
                              }
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              <span>Skip</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleAction(medicine.id, 'pending')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Undo</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleToggleRemind(medicine)}
                          aria-pressed={medicine.reminderEnabled}
                          title={
                            medicine.reminderEnabled
                              ? `Scheduled Telegram reminder is active for ${formatTime12h(medicine.reminderTime)}. Click to turn off.`
                              : `Schedule automatic Telegram reminder at ${formatTime12h(medicine.reminderTime)} (${formatScheduleType(medicine.scheduleType)})`
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap ${
                            medicine.reminderEnabled
                              ? 'border-teal-700/40 bg-teal-50 text-teal-800 hover:bg-teal-100/70'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {medicine.reminderEnabled ? (
                            <>
                              <BellRing className="w-3.5 h-3.5 text-teal-700" />
                              <span>Reminder on</span>
                            </>
                          ) : (
                            <>
                              <Bell className="w-3.5 h-3.5 text-slate-500" />
                              <span>Remind</span>
                            </>
                          )}
                        </button>

                        <span
                          aria-hidden="true"
                          className="h-4 w-px bg-slate-200 mx-0.5"
                        />

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onEditMedicine(medicine)}
                          aria-label={`Edit ${medicine.name} timing`}
                          title="Edit medicine & timing"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(medicine.id)}
                          aria-label={`Delete ${medicine.name}`}
                          title="Delete medicine"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
