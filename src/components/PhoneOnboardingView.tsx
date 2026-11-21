import { useState, type FormEvent } from 'react';
import { ArrowRight, Phone, Send } from 'lucide-react';
import type { MessagingChannel, Profile } from '../types.ts';

interface PhoneOnboardingViewProps {
  profile: Profile;
  onSave: (data: {
    fullName: string;
    phoneNumber: string;
    telegramChatId: string;
    preferredChannel: MessagingChannel;
  }) => Promise<void>;
  onSkip: () => void;
}

export function PhoneOnboardingView({
  profile,
  onSave,
  onSkip,
}: PhoneOnboardingViewProps) {
  const [fullName, setFullName] = useState(profile.fullName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber || '');
  const [telegramChatId, setTelegramChatId] = useState(
    profile.telegramChatId || ''
  );
  const [preferredChannel, setPreferredChannel] = useState<MessagingChannel>(
    profile.preferredChannel || 'telegram'
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!phoneNumber.trim()) {
      setError('Please enter your phone number to receive medication reminders.');
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        telegramChatId: telegramChatId.trim(),
        preferredChannel,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Unable to save contact details.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-6 py-12">
      <div className="max-w-xl w-full mx-auto bg-white border border-slate-200 rounded-xl p-8 sm:p-10">
        <div className="flex items-center justify-between pb-6 border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900">
            ClearDose
          </span>
          <span className="text-xs text-slate-500">{profile.email}</span>
        </div>

        <div className="mt-6">
          <h1 className="font-display text-2xl font-semibold text-slate-900 text-balance">
            Set up your reminder contact
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Enter your phone number so ClearDose can send interactive
            &ldquo;Have you taken your medicine?&rdquo; messages with Yes, No,
            and Will take later options.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="onboarding-name"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Your name
            </label>
            <input
              id="onboarding-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Alex Rivera"
              className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>

          <div>
            <label
              htmlFor="onboarding-phone"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Phone number (with country code)
            </label>
            <div className="relative">
              <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="onboarding-phone"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 555 019 2834"
                className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>
          </div>

          <div>
            <span className="block text-sm font-medium text-slate-800 mb-1.5">
              Preferred messaging channel
            </span>
            <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setPreferredChannel('telegram')}
                className={`py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  preferredChannel === 'telegram'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Telegram Bot API
              </button>
              <button
                type="button"
                onClick={() => setPreferredChannel('whatsapp')}
                className={`py-2 px-3 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  preferredChannel === 'whatsapp'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                WhatsApp
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="onboarding-chat-id"
              className="block text-sm font-medium text-slate-800 mb-1.5"
            >
              Telegram Chat ID{' '}
              <span className="font-normal text-slate-500">(optional now)</span>
            </label>
            <div className="relative">
              <Send className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="onboarding-chat-id"
                type="text"
                value={telegramChatId}
                onChange={(e) => setTelegramChatId(e.target.value)}
                placeholder="e.g. 582910442"
                className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Message your @BotFather bot with <code className="font-mono">/start</code> to get your Chat ID anytime, or add it later under Telegram Reminders.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5"
            >
              {error}
            </p>
          )}

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 cursor-pointer whitespace-nowrap"
            >
              Add phone number later
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <span>{submitting ? 'Saving...' : 'Save and continue'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
