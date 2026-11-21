import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  Clock,
  Copy,
  Link2,
  Phone,
  RefreshCw,
  Send,
} from 'lucide-react';
import type {
  DailyScheduleItem,
  DetectedTelegramChat,
  Medicine,
  MessagingChannel,
  MessagingStatus,
  Profile,
  ReminderResponse,
  SentReminderPayload,
} from '../types.ts';
import {
  formatMealPreference,
  formatTime12h,
  formatTimestampTime,
} from '../lib/format.ts';

interface RemindersViewProps {
  profile: Profile;
  medicines: Medicine[];
  todayItems: DailyScheduleItem[];
  messagingStatus: MessagingStatus | null;
  onSaveProfile: (payload: {
    fullName: string;
    phoneNumber: string;
    telegramChatId: string;
    preferredChannel: MessagingChannel;
  }) => Promise<void>;
  onSendReminder: (medicineId: number) => Promise<SentReminderPayload>;
  onRespondReminder: (
    logId: number,
    choice: ReminderResponse
  ) => Promise<{ replyText: string; nextFollowUpAt: string | null }>;
  onTriggerFollowUpNow: (logId: number) => Promise<SentReminderPayload>;
  onRegisterWebhook: () => Promise<{ ok: boolean; description: string }>;
  onDetectChats: () => Promise<{
    chats: DetectedTelegramChat[];
    botUsername: string | null;
    note?: string;
  }>;
  onSendTestTelegram: (
    chatId?: string
  ) => Promise<{ ok: boolean; description: string }>;
}

interface ThreadMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  timestamp: string;
  logId?: number;
  awaitingChoice?: boolean;
  meta?: string;
}

export function RemindersView({
  profile,
  medicines,
  todayItems,
  messagingStatus,
  onSaveProfile,
  onSendReminder,
  onRespondReminder,
  onTriggerFollowUpNow,
  onRegisterWebhook,
  onDetectChats,
  onSendTestTelegram,
}: RemindersViewProps) {
  const [fullName, setFullName] = useState(profile.fullName || '');
  const [phoneNumber, setPhoneNumber] = useState(profile.phoneNumber || '');
  const [telegramChatId, setTelegramChatId] = useState(
    profile.telegramChatId || ''
  );
  const [preferredChannel, setPreferredChannel] = useState<MessagingChannel>(
    profile.preferredChannel || 'telegram'
  );
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [detectedChats, setDetectedChats] = useState<DetectedTelegramChat[]>(
    []
  );
  const [detectNote, setDetectNote] = useState<string | null>(null);

  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    description: string;
  } | null>(null);

  const [selectedMedId, setSelectedMedId] = useState<number>(
    medicines[0]?.id ?? 0
  );
  const [sending, setSending] = useState(false);
  const [respondingLogId, setRespondingLogId] = useState<number | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);

  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookResult, setWebhookResult] = useState<{
    ok: boolean;
    description: string;
  } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  useEffect(() => {
    setFullName(profile.fullName || '');
    setPhoneNumber(profile.phoneNumber || '');
    setTelegramChatId(profile.telegramChatId || '');
    setPreferredChannel(profile.preferredChannel || 'telegram');
  }, [profile]);

  useEffect(() => {
    if (
      medicines.length > 0 &&
      !medicines.some((m) => m.id === selectedMedId)
    ) {
      setSelectedMedId(medicines[0].id);
    }
  }, [medicines, selectedMedId]);

  const snoozedItems = todayItems.filter(
    (item) => item.log.status === 'snoozed'
  );

  const tokenReady = Boolean(messagingStatus?.telegramBotValid);
  const chatIdReady = Boolean(profile.telegramChatId?.trim());
  const needsSetup = !tokenReady || !chatIdReady;

  const handleSaveContact = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNotice(null);
    try {
      await onSaveProfile({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        telegramChatId: telegramChatId.trim(),
        preferredChannel,
      });
      setProfileNotice('Reminder contact details saved.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDetectChats = async () => {
    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await onDetectChats();
      setDetectedChats(res.chats);
      if (res.note) {
        setDetectNote(res.note);
      } else if (res.chats.length === 1) {
        const found = res.chats[0];
        setTelegramChatId(found.chatId);
        await onSaveProfile({
          fullName: fullName.trim(),
          phoneNumber: phoneNumber.trim(),
          telegramChatId: found.chatId,
          preferredChannel,
        });
        setProfileNotice(`Connected Telegram Chat ID ${found.chatId}.`);
      }
    } catch (err: unknown) {
      setDetectNote(
        err instanceof Error
          ? err.message
          : 'Unable to check Telegram messages.'
      );
    } finally {
      setDetecting(false);
    }
  };

  const handlePickDetectedChat = async (chatId: string) => {
    setTelegramChatId(chatId);
    setSavingProfile(true);
    try {
      await onSaveProfile({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        telegramChatId: chatId,
        preferredChannel,
      });
      setProfileNotice(`Connected Telegram Chat ID ${chatId}.`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSendTest = async () => {
    setTestingTelegram(true);
    setTestResult(null);
    try {
      const res = await onSendTestTelegram(telegramChatId.trim() || undefined);
      setTestResult(res);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        description:
          err instanceof Error ? err.message : 'Unable to send test message.',
      });
    } finally {
      setTestingTelegram(false);
    }
  };

  const appendSentReminderToThread = (payload: SentReminderPayload) => {
    const nowLabel = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setThread((prev) => [
      ...prev.map((m) => ({ ...m, awaitingChoice: false })),
      {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: payload.delivery.messageText,
        timestamp: nowLabel,
        logId: payload.log.id,
        awaitingChoice: true,
        meta: payload.delivery.detail,
      },
    ]);
  };

  const handleDispatchReminder = async () => {
    if (!selectedMedId) return;
    setSending(true);
    try {
      const payload = await onSendReminder(selectedMedId);
      appendSentReminderToThread(payload);
    } finally {
      setSending(false);
    }
  };

  const handleChoice = async (logId: number, choice: ReminderResponse) => {
    setRespondingLogId(logId);
    const choiceLabel =
      choice === 'yes' ? 'Yes' : choice === 'no' ? 'No' : 'Will take later';
    const nowLabel = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    try {
      const res = await onRespondReminder(logId, choice);
      setThread((prev) => [
        ...prev.map((m) =>
          m.logId === logId ? { ...m, awaitingChoice: false } : m
        ),
        {
          id: `user-${Date.now()}`,
          sender: 'user',
          text: choiceLabel,
          timestamp: nowLabel,
        },
        {
          id: `reply-${Date.now() + 1}`,
          sender: 'bot',
          text: res.replyText,
          timestamp: nowLabel,
          meta:
            choice === 'yes'
              ? 'Dose marked as Taken in medication_logs.'
              : res.nextFollowUpAt
                ? `Dose snoozed · 1-hour follow-up scheduled for ${formatTimestampTime(res.nextFollowUpAt)}.`
                : undefined,
        },
      ]);
    } finally {
      setRespondingLogId(null);
    }
  };

  const handleTriggerFollowUp = async (logId: number) => {
    setSending(true);
    try {
      const payload = await onTriggerFollowUpNow(logId);
      appendSentReminderToThread(payload);
    } finally {
      setSending(false);
    }
  };

  const handleCopyWebhook = async () => {
    if (!messagingStatus?.webhookUrl) return;
    try {
      await navigator.clipboard.writeText(messagingStatus.webhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      // Clipboard may be restricted in some iframe policies
    }
  };

  const handleRegisterWebhook = async () => {
    setWebhookBusy(true);
    setWebhookResult(null);
    try {
      const res = await onRegisterWebhook();
      setWebhookResult(res);
    } catch (err: unknown) {
      setWebhookResult({
        ok: false,
        description:
          err instanceof Error ? err.message : 'Unable to register webhook.',
      });
    } finally {
      setWebhookBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">
          Telegram &amp; WhatsApp reminders
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Send automatic scheduled reminders and interactive &ldquo;Have you
          taken your medicine?&rdquo; prompts with Yes, No, and Will take later
          options.
        </p>
      </div>

      {/* Live Delivery Readiness Banner when Telegram is not yet fully connected */}
      {needsSetup && (
        <section
          aria-label="Telegram setup checklist"
          className="bg-white border border-amber-300/80 rounded-xl p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Complete 2 steps to receive live messages on Telegram
                </h3>
                <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                  Telegram Bot API cannot send messages using a phone number
                  alone—it requires a{' '}
                  <code className="font-mono text-slate-800">
                    TELEGRAM_BOT_TOKEN
                  </code>{' '}
                  from <strong>@BotFather</strong> and your numeric{' '}
                  <strong>Telegram Chat ID</strong> after tapping{' '}
                  <code className="font-mono text-slate-800">/start</code> in
                  your bot.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-start gap-2.5">
                  {tokenReady ? (
                    <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-medium text-slate-900">
                      1. Bot Token in Secrets
                    </p>
                    <p className="mt-0.5 text-slate-600">
                      {tokenReady
                        ? `Connected to @${messagingStatus?.telegramBotUsername}`
                        : 'Open @BotFather in Telegram, run /newbot, and add TELEGRAM_BOT_TOKEN in AI Studio Secrets.'}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-start gap-2.5">
                  {chatIdReady ? (
                    <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-medium text-slate-900">
                      2. Numeric Telegram Chat ID
                    </p>
                    <p className="mt-0.5 text-slate-600">
                      {chatIdReady
                        ? `Saved Chat ID: ${profile.telegramChatId}`
                        : 'Message /start to your bot in Telegram, then click "Detect Chat ID" below.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Recipient Profile + Interactive Reminder Dispatch + 1h Snooze Queue */}
        <div className="xl:col-span-7 space-y-6">
          {/* Recipient Contact Form */}
          <section className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Recipient contact details
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Stored in your <code className="font-mono">profiles</code>{' '}
                  record for Telegram Bot API or WhatsApp reminders.
                </p>
              </div>
              <button
                type="button"
                disabled={testingTelegram}
                onClick={handleSendTest}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap self-start sm:self-auto"
              >
                <Send className="w-3.5 h-3.5 text-teal-700" />
                <span>
                  {testingTelegram ? 'Sending test...' : 'Send test message'}
                </span>
              </button>
            </div>

            {testResult && (
              <p
                className={`mt-4 text-xs rounded-lg px-3.5 py-2.5 border ${
                  testResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                }`}
              >
                {testResult.description}
              </p>
            )}

            <form onSubmit={handleSaveContact} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="rem-phone"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Phone number
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="rem-phone"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+91 70865 24798"
                      className="w-full rounded-lg border border-slate-300 pl-9 pr-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="rem-chat-id"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Telegram Chat ID (required for Telegram)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="rem-chat-id"
                      type="text"
                      value={telegramChatId}
                      onChange={(e) => setTelegramChatId(e.target.value)}
                      placeholder="e.g. 582910442"
                      className="flex-1 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono tabular-nums text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={detecting}
                      onClick={handleDetectChats}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-teal-700 ${
                          detecting ? 'animate-spin' : ''
                        }`}
                      />
                      <span>{detecting ? 'Checking...' : 'Detect ID'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {detectNote && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5">
                  {detectNote}
                </p>
              )}

              {detectedChats.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-700">
                    Detected Telegram chats from your bot:
                  </p>
                  <div className="space-y-1.5">
                    {detectedChats.map((chat) => (
                      <div
                        key={chat.chatId}
                        className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-md px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900">
                            {chat.firstName || 'Telegram User'}
                          </span>
                          {chat.username && (
                            <span className="text-slate-500 ml-1.5">
                              @{chat.username}
                            </span>
                          )}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <code className="font-mono text-slate-700">
                            {chat.chatId}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePickDetectedChat(chat.chatId)}
                          className="px-2.5 py-1 rounded bg-teal-700 text-white font-medium hover:bg-teal-800 cursor-pointer whitespace-nowrap"
                        >
                          Use this ID
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                  <button
                    type="button"
                    onClick={() => setPreferredChannel('telegram')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
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
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      preferredChannel === 'whatsapp'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    WhatsApp
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {profileNotice && (
                    <span className="text-xs font-medium text-emerald-700">
                      {profileNotice}
                    </span>
                  )}
                  <button
                    type="submit"
                    disabled={savingProfile}
                    className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    {savingProfile ? 'Saving...' : 'Save contact'}
                  </button>
                </div>
              </div>
            </form>
          </section>

          {/* Interactive Reminder Check-In Sender */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Send dose check-in reminder
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Dispatches via Telegram Bot API when configured (and also fires
                automatically at each medicine&apos;s reminder time).
              </p>

              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <select
                  aria-label="Select medicine for reminder"
                  value={selectedMedId}
                  onChange={(e) => setSelectedMedId(Number(e.target.value))}
                  disabled={medicines.length === 0}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none disabled:bg-slate-50"
                >
                  {medicines.length === 0 ? (
                    <option value={0}>Add a medicine first</option>
                  ) : (
                    medicines.map((med) => (
                      <option key={med.id} value={med.id}>
                        {med.name} ({med.dosage}) —{' '}
                        {formatTime12h(med.reminderTime)} ·{' '}
                        {formatMealPreference(med.mealPreference)}
                      </option>
                    ))
                  )}
                </select>

                <button
                  type="button"
                  disabled={sending || medicines.length === 0}
                  onClick={handleDispatchReminder}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Send className="w-4 h-4" />
                  <span>{sending ? 'Sending...' : 'Send reminder'}</span>
                </button>
              </div>
            </div>

            {/* Interactive Message Thread */}
            <div className="p-6 bg-slate-50/70 min-h-[220px] space-y-4">
              {thread.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-500">
                  Select a medicine above and click{' '}
                  <span className="font-medium text-slate-700">
                    Send reminder
                  </span>{' '}
                  to send the &ldquo;Have you taken your medicine?&rdquo;
                  prompt.
                </div>
              ) : (
                thread.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-md rounded-xl px-4 py-3 text-sm whitespace-pre-line ${
                        msg.sender === 'user'
                          ? 'bg-teal-700 text-white'
                          : 'bg-white border border-slate-200 text-slate-800'
                      }`}
                    >
                      <p>{msg.text}</p>

                      {msg.awaitingChoice && msg.logId && (
                        <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={respondingLogId === msg.logId}
                            onClick={() => handleChoice(msg.logId!, 'yes')}
                            className="px-3.5 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            disabled={respondingLogId === msg.logId}
                            onClick={() => handleChoice(msg.logId!, 'no')}
                            className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            No
                          </button>
                          <button
                            type="button"
                            disabled={respondingLogId === msg.logId}
                            onClick={() => handleChoice(msg.logId!, 'later')}
                            className="px-3.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-medium hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Will take later
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono tabular-nums">
                        {msg.timestamp}
                      </span>
                      {msg.meta && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{msg.meta}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Active 1-Hour Snooze Follow-Up Queue */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  1-hour follow-up queue
                </h3>
                <p className="text-xs text-slate-500">
                  Doses marked No or Will take later are automatically scheduled
                  for a follow-up message 1 hour later.
                </p>
              </div>
              <span className="font-mono text-xs font-medium text-slate-600 tabular-nums">
                {snoozedItems.length} queued
              </span>
            </div>

            {snoozedItems.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-500">
                No doses are currently snoozed. Selecting &ldquo;No&rdquo; or
                &ldquo;Will take later&rdquo; queues an automatic 1-hour
                follow-up here.
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {snoozedItems.map(({ medicine, log }) => (
                  <div
                    key={log.id}
                    className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {medicine.name}{' '}
                        <span className="font-normal text-slate-600">
                          · {medicine.dosage}
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-amber-700 inline-flex items-center gap-1.5 tabular-nums">
                        <Bell className="w-3.5 h-3.5" />
                        <span>
                          Follow-up scheduled for{' '}
                          {log.snoozedUntil
                            ? formatTimestampTime(log.snoozedUntil)
                            : '+1 hour'}
                          {log.snoozeCount > 1
                            ? ` (snoozed ${log.snoozeCount} times)`
                            : ''}
                        </span>
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => handleTriggerFollowUp(log.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
                    >
                      <Clock className="w-3.5 h-3.5 text-teal-700" />
                      <span>Send 1h follow-up now</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: @BotFather & API Environment Reference */}
        <div className="xl:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                Telegram Bot API &amp; @BotFather setup
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                ClearDose automatically polls Telegram for{' '}
                <code className="font-mono">/start</code> and Yes/No/Later
                button taps as soon as{' '}
                <code className="font-mono">TELEGRAM_BOT_TOKEN</code> is added
                in AI Studio Secrets (no webhook required in dev preview).
              </p>
            </div>

            <div className="divide-y divide-slate-200 border-y border-slate-200 text-xs">
              <div className="py-3 flex items-center justify-between gap-3">
                <code className="font-mono text-slate-800">
                  TELEGRAM_BOT_TOKEN
                </code>
                <span
                  className={
                    messagingStatus?.telegramBotValid
                      ? 'font-medium text-emerald-700 inline-flex items-center gap-1'
                      : messagingStatus?.telegramBotConfigured
                        ? 'font-medium text-rose-700'
                        : 'text-amber-700 font-medium'
                  }
                >
                  {messagingStatus?.telegramBotValid ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        @{messagingStatus.telegramBotUsername || 'Connected'}
                      </span>
                    </>
                  ) : messagingStatus?.telegramBotConfigured ? (
                    'Invalid token'
                  ) : (
                    'Not set in Secrets'
                  )}
                </span>
              </div>

              <div className="py-3 flex items-center justify-between gap-3">
                <code className="font-mono text-slate-800">
                  TELEGRAM_WEBHOOK_SECRET
                </code>
                <span className="text-slate-500">
                  {messagingStatus?.telegramWebhookSecretConfigured
                    ? 'Configured'
                    : 'Optional'}
                </span>
              </div>

              <div className="py-3 flex items-center justify-between gap-3">
                <code className="font-mono text-slate-800">
                  WHATSAPP_API_TOKEN
                </code>
                <span className="text-slate-500">
                  {messagingStatus?.whatsappConfigured
                    ? 'Configured'
                    : 'Optional'}
                </span>
              </div>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <p className="font-medium text-slate-900">
                How to receive messages in 60 seconds
              </p>
              <ol className="list-decimal pl-4 space-y-1.5 leading-relaxed">
                <li>
                  Open Telegram, search{' '}
                  <strong className="text-slate-900">@BotFather</strong>, send{' '}
                  <code className="font-mono">/newbot</code>, and copy the HTTP
                  API token.
                </li>
                <li>
                  In AI Studio, open the{' '}
                  <strong className="text-slate-900">Secrets</strong> panel
                  (Settings / Secrets) and add{' '}
                  <code className="font-mono">TELEGRAM_BOT_TOKEN</code> with
                  that token.
                </li>
                <li>
                  Open your new bot in Telegram and tap{' '}
                  <strong className="text-slate-900">Start</strong> (sends{' '}
                  <code className="font-mono">/start</code>).
                </li>
                <li>
                  Click{' '}
                  <strong className="text-slate-900">Detect ID</strong> on the
                  left to auto-fill and save your numeric Chat ID, then click{' '}
                  <strong className="text-slate-900">Send test message</strong>.
                </li>
              </ol>
            </div>

            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-700 mb-1.5">
                Optional Production Webhook URL
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800">
                  {messagingStatus?.webhookUrl || '/api/telegram/webhook'}
                </code>
                <button
                  type="button"
                  onClick={handleCopyWebhook}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <button
                type="button"
                disabled={webhookBusy}
                onClick={handleRegisterWebhook}
                className="mt-2.5 w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5 text-teal-700" />
                <span>
                  {webhookBusy
                    ? 'Registering webhook...'
                    : 'Register production webhook'}
                </span>
              </button>

              {webhookResult && (
                <p
                  className={`mt-2.5 text-xs rounded-lg px-3 py-2 border ${
                    webhookResult.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-amber-50 border-amber-200 text-amber-800'
                  }`}
                >
                  {webhookResult.description}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
