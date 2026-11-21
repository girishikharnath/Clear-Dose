import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { MealPreference, Medicine, ScheduleType } from '../types.ts';

interface MedicineModalProps {
  open: boolean;
  editingMedicine: Medicine | null;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    dosage: string;
    reminderTime: string;
    mealPreference: MealPreference;
    scheduleType: ScheduleType;
    notes: string;
    reminderEnabled: boolean;
  }) => Promise<void>;
}

export function MedicineModal({
  open,
  editingMedicine,
  onClose,
  onSubmit,
}: MedicineModalProps) {
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [reminderTime, setReminderTime] = useState('08:00');
  const [mealPreference, setMealPreference] =
    useState<MealPreference>('after_meal');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [notes, setNotes] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingMedicine) {
      setName(editingMedicine.name);
      setDosage(editingMedicine.dosage);
      setReminderTime(editingMedicine.reminderTime);
      setMealPreference(editingMedicine.mealPreference);
      setScheduleType(editingMedicine.scheduleType);
      setNotes(editingMedicine.notes || '');
      setReminderEnabled(Boolean(editingMedicine.reminderEnabled));
    } else {
      setName('');
      setDosage('');
      setReminderTime('08:00');
      setMealPreference('after_meal');
      setScheduleType('daily');
      setNotes('');
      setReminderEnabled(true);
    }
  }, [open, editingMedicine]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !dosage.trim() || !reminderTime) {
      setError('Please complete medicine name, dosage, and reminder time.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        dosage: dosage.trim(),
        reminderTime,
        mealPreference,
        scheduleType,
        notes: notes.trim(),
        reminderEnabled,
      });
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Unable to save medicine.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="medicine-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2
            id="medicine-modal-title"
            className="font-display text-lg font-semibold text-slate-900"
          >
            {editingMedicine ? 'Edit medicine' : 'Add new medicine'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="med-name"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Medicine name
              </label>
              <input
                id="med-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Metformin"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>

            <div>
              <label
                htmlFor="med-dosage"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Dosage
              </label>
              <input
                id="med-dosage"
                type="text"
                required
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 500 mg · 1 tablet"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="med-time"
                className="block text-sm font-medium text-slate-800 mb-1.5"
              >
                Reminder time
              </label>
              <input
                id="med-time"
                type="time"
                required
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-slate-800 mb-1.5">
                Meal timing
              </span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMealPreference('before_meal')}
                  className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    mealPreference === 'before_meal'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Before meal
                </button>
                <button
                  type="button"
                  onClick={() => setMealPreference('after_meal')}
                  className={`py-2 px-2.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    mealPreference === 'after_meal'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  After meal
                </button>
              </div>
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-800 mb-1.5">
              Schedule frequency
            </span>
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'daily', label: 'Daily' },
                  { id: 'weekdays', label: 'Weekdays' },
                  { id: 'weekends', label: 'Weekends' },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setScheduleType(option.id)}
                  className={`py-2 px-3 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    scheduleType === option.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="med-notes"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Instructions{' '}
              <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="med-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Take with a full glass of water"
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={reminderEnabled}
              onChange={(e) => setReminderEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            <span className="text-xs leading-relaxed text-slate-700">
              <strong className="font-medium text-slate-900 block">
                Send Telegram reminder automatically at scheduled time
              </strong>
              Messages you on Telegram every scheduled day at the reminder time
              above (does not send immediately when saved).
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5"
            >
              {error}
            </p>
          )}

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              {saving
                ? 'Saving...'
                : editingMedicine
                  ? 'Save changes'
                  : 'Add medicine'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
