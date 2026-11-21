export interface ReminderDispatchInput {
  logId: number;
  medicineName: string;
  dosage: string;
  reminderTime: string;
  mealPreference: string;
  chatId?: string | null;
  phoneNumber?: string | null;
  preferredChannel?: string | null;
  isFollowUp?: boolean;
}

export interface ReminderDispatchResult {
  deliveredLive: boolean;
  channel: 'telegram' | 'whatsapp' | 'preview';
  messageText: string;
  detail: string;
}

export interface DetectedTelegramChat {
  chatId: string;
  username?: string;
  firstName?: string;
  lastText?: string;
  seenAt: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: {
      id?: number | string;
      username?: string;
      first_name?: string;
    };
    text?: string;
  };
  callback_query?: {
    id?: string;
    data?: string;
    from?: {
      id?: number | string;
      username?: string;
      first_name?: string;
    };
    message?: {
      chat?: {
        id?: number | string;
        username?: string;
        first_name?: string;
      };
    };
  };
}

const activeSnoozeTimers = new Map<number, ReturnType<typeof setTimeout>>();
const activeDoseTimers = new Map<string, ReturnType<typeof setTimeout>>();
const recentTelegramChats = new Map<string, DetectedTelegramChat>();

let cachedBotInfo: {
  token: string;
  valid: boolean;
  username: string | null;
  firstName: string | null;
  checkedAt: number;
} | null = null;

let pollerRunning = false;
let lastUpdateOffset = 0;

export function formatTime12h(time24: string): string {
  const [hStr, mStr] = time24.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return time24;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatMealLabel(mealPreference: string): string {
  return mealPreference === 'before_meal' ? 'Before Meal' : 'After Meal';
}

export function getTelegramBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_FROM_BOTFATHER') {
    return null;
  }
  return token;
}

export function getWhatsAppConfig(): {
  token: string;
  phoneNumberId: string;
} | null {
  const token = process.env.WHATSAPP_API_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (
    !token ||
    !phoneNumberId ||
    token === 'YOUR_WHATSAPP_CLOUD_API_TOKEN' ||
    phoneNumberId === 'YOUR_WHATSAPP_PHONE_NUMBER_ID'
  ) {
    return null;
  }
  return { token, phoneNumberId };
}

export function recordDetectedChat(chat: {
  chatId: string;
  username?: string;
  firstName?: string;
  lastText?: string;
}) {
  recentTelegramChats.set(chat.chatId, {
    chatId: chat.chatId,
    username: chat.username,
    firstName: chat.firstName,
    lastText: chat.lastText,
    seenAt: new Date().toISOString(),
  });
}

export async function getTelegramBotInfo(): Promise<{
  valid: boolean;
  username: string | null;
  firstName: string | null;
}> {
  const token = getTelegramBotToken();
  if (!token) {
    return { valid: false, username: null, firstName: null };
  }

  const now = Date.now();
  if (
    cachedBotInfo &&
    cachedBotInfo.token === token &&
    now - cachedBotInfo.checkedAt < 60_000
  ) {
    return {
      valid: cachedBotInfo.valid,
      username: cachedBotInfo.username,
      firstName: cachedBotInfo.firstName,
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as {
      ok?: boolean;
      result?: { username?: string; first_name?: string };
    };
    const info = {
      token,
      valid: Boolean(res.ok && data.ok),
      username: data.result?.username || null,
      firstName: data.result?.first_name || null,
      checkedAt: now,
    };
    cachedBotInfo = info;
    return {
      valid: info.valid,
      username: info.username,
      firstName: info.firstName,
    };
  } catch (error) {
    console.error('Telegram getMe error:', error);
    return { valid: false, username: null, firstName: null };
  }
}

export async function getMessagingStatus(originHint?: string) {
  const appUrl = (
    process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL'
      ? process.env.APP_URL
      : originHint || ''
  ).replace(/\/$/, '');

  const botInfo = await getTelegramBotInfo();

  return {
    telegramBotConfigured: Boolean(getTelegramBotToken()),
    telegramBotValid: botInfo.valid,
    telegramBotUsername: botInfo.username,
    telegramWebhookSecretConfigured: Boolean(
      process.env.TELEGRAM_WEBHOOK_SECRET &&
        process.env.TELEGRAM_WEBHOOK_SECRET !==
          'YOUR_OPTIONAL_TELEGRAM_WEBHOOK_SECRET'
    ),
    whatsappConfigured: Boolean(getWhatsAppConfig()),
    webhookUrl: appUrl
      ? `${appUrl}/api/telegram/webhook`
      : '/api/telegram/webhook',
  };
}

export async function detectRecentTelegramChats(): Promise<{
  chats: DetectedTelegramChat[];
  botUsername: string | null;
  note?: string;
}> {
  const token = getTelegramBotToken();
  const botInfo = await getTelegramBotInfo();
  if (!token) {
    return {
      chats: [],
      botUsername: null,
      note: 'TELEGRAM_BOT_TOKEN is not configured in Secrets yet.',
    };
  }

  // Also pull any pending updates directly if poller hasn't consumed them yet
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?limit=20&timeout=0`
    );
    const data = (await res.json()) as {
      ok?: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };

    if (res.ok && data.ok && Array.isArray(data.result)) {
      for (const upd of data.result) {
        const msgChat = upd.message?.chat;
        if (msgChat?.id) {
          recordDetectedChat({
            chatId: String(msgChat.id),
            username: msgChat.username,
            firstName: msgChat.first_name,
            lastText: upd.message?.text,
          });
        }
        const cbChat = upd.callback_query?.message?.chat;
        if (cbChat?.id) {
          recordDetectedChat({
            chatId: String(cbChat.id),
            username: cbChat.username,
            firstName: cbChat.first_name,
            lastText: upd.callback_query?.data,
          });
        }
      }
    } else if (data.description?.toLowerCase().includes('webhook')) {
      return {
        chats: Array.from(recentTelegramChats.values()),
        botUsername: botInfo.username,
        note: 'A webhook is currently active on this bot. Send /start to your bot and check its reply for your Chat ID.',
      };
    }
  } catch (error) {
    console.error('Telegram detectRecentTelegramChats error:', error);
  }

  const chats = Array.from(recentTelegramChats.values()).sort((a, b) =>
    b.seenAt.localeCompare(a.seenAt)
  );

  return {
    chats,
    botUsername: botInfo.username,
    note:
      chats.length === 0
        ? `No messages found yet. Open ${botInfo.username ? `@${botInfo.username}` : 'your bot'} in Telegram, tap Start (or send /start), then click Detect again.`
        : undefined,
  };
}

export function buildReminderPrompt(input: ReminderDispatchInput): string {
  const prefix = input.isFollowUp
    ? '1-Hour Follow-Up Reminder\n'
    : 'Medication Reminder\n';
  return `${prefix}Have you taken your medicine?\n\n${input.medicineName} (${input.dosage})\nTiming: ${formatTime12h(input.reminderTime)} · ${formatMealLabel(input.mealPreference)}`;
}

export const THANK_YOU_MESSAGE =
  'Have a good day ahead. Thank you for taking the medicine in time.';

export function buildSnoozeReply(
  nextTime: Date,
  tzOffsetMinutes?: number
): string {
  if (tzOffsetMinutes !== undefined && !Number.isNaN(tzOffsetMinutes)) {
    const localMs = nextTime.getTime() - tzOffsetMinutes * 60_000;
    const localDt = new Date(localMs);
    const h = localDt.getUTCHours();
    const m = localDt.getUTCMinutes();
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const formatted = `${String(hour12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
    return `No problem. We will message you again in 1 hour (around ${formatted}) to check on your dose.`;
  }
  const formatted = nextTime.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `No problem. We will message you again in 1 hour (around ${formatted}) to check on your dose.`;
}

export async function sendMedicationReminder(
  input: ReminderDispatchInput
): Promise<ReminderDispatchResult> {
  const messageText = buildReminderPrompt(input);
  const telegramToken = getTelegramBotToken();
  const whatsappConfig = getWhatsAppConfig();

  if (
    (input.preferredChannel !== 'whatsapp' || !whatsappConfig) &&
    telegramToken &&
    input.chatId
  ) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: messageText,
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Yes', callback_data: `med:yes:${input.logId}` },
                  { text: 'No', callback_data: `med:no:${input.logId}` },
                ],
                [
                  {
                    text: 'Will take later',
                    callback_data: `med:later:${input.logId}`,
                  },
                ],
              ],
            },
          }),
        }
      );

      const data = (await response.json()) as {
        ok?: boolean;
        description?: string;
      };
      if (response.ok && data.ok) {
        return {
          deliveredLive: true,
          channel: 'telegram',
          messageText,
          detail: `Delivered via Telegram Bot API to chat ${input.chatId}.`,
        };
      }
      return {
        deliveredLive: false,
        channel: 'preview',
        messageText,
        detail: `Telegram API error: ${data.description || response.statusText}. Make sure you opened your bot and sent /start first.`,
      };
    } catch (error) {
      console.error('Telegram sendMessage error:', error);
      return {
        deliveredLive: false,
        channel: 'preview',
        messageText,
        detail:
          'Could not reach Telegram API right now. Interactive reminder is ready below.',
      };
    }
  }

  if (
    input.preferredChannel === 'whatsapp' &&
    whatsappConfig &&
    input.phoneNumber
  ) {
    const cleanPhone = input.phoneNumber.replace(/[^\d]/g, '');
    try {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${whatsappConfig.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${whatsappConfig.token}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'interactive',
            interactive: {
              type: 'button',
              body: { text: messageText },
              action: {
                buttons: [
                  {
                    type: 'reply',
                    reply: { id: `med:yes:${input.logId}`, title: 'Yes' },
                  },
                  {
                    type: 'reply',
                    reply: { id: `med:no:${input.logId}`, title: 'No' },
                  },
                  {
                    type: 'reply',
                    reply: {
                      id: `med:later:${input.logId}`,
                      title: 'Will take later',
                    },
                  },
                ],
              },
            },
          }),
        }
      );

      if (response.ok) {
        return {
          deliveredLive: true,
          channel: 'whatsapp',
          messageText,
          detail: `Delivered via WhatsApp Cloud API to ${input.phoneNumber}.`,
        };
      }
    } catch (error) {
      console.error('WhatsApp Cloud API error:', error);
    }
  }

  const missingHint = !telegramToken
    ? 'Telegram Bot token missing: add TELEGRAM_BOT_TOKEN (from @BotFather) in AI Studio Secrets to send real Telegram messages.'
    : !input.chatId
      ? 'Telegram Chat ID missing: Telegram bots cannot message a phone number directly. Open your bot, tap /start, and save your numeric Chat ID under Telegram Reminders.'
      : 'Interactive reminder recorded in ClearDose.';

  return {
    deliveredLive: false,
    channel: 'preview',
    messageText,
    detail: missingHint,
  };
}

export async function sendTestTelegramMessage(
  chatId: string
): Promise<{ ok: boolean; description: string }> {
  const token = getTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      description:
        'TELEGRAM_BOT_TOKEN is not set. Add your @BotFather token in the AI Studio Secrets panel and restart/refresh.',
    };
  }
  if (!chatId.trim()) {
    return {
      ok: false,
      description:
        'Save your numeric Telegram Chat ID first (Telegram Bot API requires a Chat ID, not a phone number).',
    };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: 'ClearDose test message: Your Telegram medication reminders are connected and ready.',
        }),
      }
    );
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (res.ok && data.ok) {
      return {
        ok: true,
        description: `Test message delivered to Telegram chat ${chatId.trim()}.`,
      };
    }
    return {
      ok: false,
      description: `Telegram rejected the message: ${data.description || res.statusText}. Open your bot in Telegram and send /start first.`,
    };
  } catch (error) {
    console.error('Telegram test message error:', error);
    return {
      ok: false,
      description: 'Network error while contacting Telegram Bot API.',
    };
  }
}

export async function sendTelegramTextMessage(
  chatId: string,
  text: string,
  callbackQueryId?: string
): Promise<boolean> {
  const token = getTelegramBotToken();
  if (!token) return false;

  try {
    if (callbackQueryId) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId }),
      });
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      }
    );
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(res.ok && data.ok);
  } catch (error) {
    console.error('Telegram reply error:', error);
    return false;
  }
}

export async function registerTelegramWebhook(
  webhookUrl: string
): Promise<{ ok: boolean; description: string }> {
  const token = getTelegramBotToken();
  if (!token) {
    return {
      ok: false,
      description:
        'TELEGRAM_BOT_TOKEN is not configured yet. Add your @BotFather token in the Secrets panel first.',
    };
  }

  const secret =
    process.env.TELEGRAM_WEBHOOK_SECRET &&
    process.env.TELEGRAM_WEBHOOK_SECRET !==
      'YOUR_OPTIONAL_TELEGRAM_WEBHOOK_SECRET'
      ? process.env.TELEGRAM_WEBHOOK_SECRET
      : undefined;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        ...(secret ? { secret_token: secret } : {}),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    return {
      ok: Boolean(res.ok && data.ok),
      description:
        data.description ||
        (res.ok
          ? 'Webhook registered successfully.'
          : 'Failed to register webhook.'),
    };
  } catch (error) {
    console.error('setWebhook error:', error);
    return {
      ok: false,
      description: 'Network error contacting Telegram Bot API.',
    };
  }
}

// Long-polling listener for Telegram Bot API so /start and Yes/No/Later taps work
// immediately in both dev preview and production without needing public webhook access.
// Note: This talks ONLY to api.telegram.org and only invokes onUpdate when a real user taps Telegram.
export function startTelegramUpdatePoller(
  onUpdate: (update: TelegramUpdate) => Promise<void>
): void {
  const token = getTelegramBotToken();
  if (!token || pollerRunning) return;
  pollerRunning = true;

  const pollOnce = async () => {
    const currentToken = getTelegramBotToken();
    if (!currentToken) {
      pollerRunning = false;
      return;
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${currentToken}/getUpdates?offset=${lastUpdateOffset}&timeout=20`
      );
      const data = (await res.json()) as {
        ok?: boolean;
        result?: TelegramUpdate[];
        error_code?: number;
      };

      if (res.ok && data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateOffset = Math.max(lastUpdateOffset, update.update_id + 1);
          await onUpdate(update);
        }
        const next = setTimeout(pollOnce, 500);
        if (typeof next.unref === 'function') next.unref();
        return;
      }

      // 409 means a webhook is active on this bot.
      // In dev preview (ais-dev), external Telegram POSTs cannot pass preview auth,
      // so clear any stale ais-dev webhook automatically to restore live long-polling.
      if (data.error_code === 409 && process.env.NODE_ENV !== 'production') {
        try {
          const infoRes = await fetch(
            `https://api.telegram.org/bot${currentToken}/getWebhookInfo`
          );
          const info = (await infoRes.json()) as {
            result?: { url?: string };
          };
          if (info.result?.url?.includes('ais-dev-')) {
            await fetch(
              `https://api.telegram.org/bot${currentToken}/deleteWebhook?drop_pending_updates=false`
            );
            const retrySoon = setTimeout(pollOnce, 1000);
            if (typeof retrySoon.unref === 'function') retrySoon.unref();
            return;
          }
        } catch {
          // Fall through to standard backoff
        }
      }

      const backoffMs = data.error_code === 409 ? 60_000 : 10_000;
      const next = setTimeout(pollOnce, backoffMs);
      if (typeof next.unref === 'function') next.unref();
    } catch {
      const next = setTimeout(pollOnce, 10_000);
      if (typeof next.unref === 'function') next.unref();
    }
  };

  const initial = setTimeout(pollOnce, 1500);
  if (typeof initial.unref === 'function') initial.unref();
}

export function clearSnoozeTimer(logId: number): void {
  const existing = activeSnoozeTimers.get(logId);
  if (existing) {
    clearTimeout(existing);
    activeSnoozeTimers.delete(logId);
  }
}

export function scheduleOneHourFollowUp(
  logId: number,
  delayMs: number,
  onDue: () => Promise<void>
): void {
  clearSnoozeTimer(logId);
  const timer = setTimeout(async () => {
    activeSnoozeTimers.delete(logId);
    try {
      await onDue();
    } catch (error) {
      console.error(`Follow-up reminder failed for log ${logId}:`, error);
    }
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  activeSnoozeTimers.set(logId, timer);
}

export function computeNextScheduledOccurrence(
  reminderTime: string,
  scheduleType: string,
  tzOffsetMinutes: number,
  nowMs: number = Date.now()
): { targetUtcMs: number; localDateStr: string; isToday: boolean } | null {
  const [hh, mm] = reminderTime.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  // Represent user's local clock in UTC getters by shifting by -tzOffsetMinutes
  const localNow = new Date(nowMs - tzOffsetMinutes * 60_000);
  const baseYear = localNow.getUTCFullYear();
  const baseMonth = localNow.getUTCMonth();
  const baseDay = localNow.getUTCDate();

  for (let addDays = 0; addDays <= 7; addDays++) {
    const candidateLocal = new Date(
      Date.UTC(baseYear, baseMonth, baseDay + addDays, hh, mm, 0, 0)
    );
    const dayOfWeek = candidateLocal.getUTCDay(); // 0 = Sun, 6 = Sat
    const matchesSchedule =
      scheduleType === 'weekdays'
        ? dayOfWeek >= 1 && dayOfWeek <= 5
        : scheduleType === 'weekends'
          ? dayOfWeek === 0 || dayOfWeek === 6
          : true;

    if (!matchesSchedule) continue;

    const targetUtcMs = candidateLocal.getTime() + tzOffsetMinutes * 60_000;
    if (targetUtcMs > nowMs + 1000) {
      const y = candidateLocal.getUTCFullYear();
      const m = String(candidateLocal.getUTCMonth() + 1).padStart(2, '0');
      const d = String(candidateLocal.getUTCDate()).padStart(2, '0');
      return {
        targetUtcMs,
        localDateStr: `${y}-${m}-${d}`,
        isToday: addDays === 0,
      };
    }
  }

  return null;
}

export function scheduleDoseReminderTimer(
  key: string,
  delayMs: number,
  onDue: () => Promise<void>
): void {
  const existing = activeDoseTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    activeDoseTimers.delete(key);
  }
  // Support recurring reminders up to 7 days out (e.g. weekdays/weekends schedules)
  if (delayMs < 0 || delayMs > 8 * 24 * 60 * 60 * 1000) return;

  const timer = setTimeout(async () => {
    activeDoseTimers.delete(key);
    try {
      await onDue();
    } catch (error) {
      console.error(`Scheduled dose reminder failed for ${key}:`, error);
    }
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  activeDoseTimers.set(key, timer);
}

export function clearDoseReminderTimer(key: string): void {
  const existing = activeDoseTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    activeDoseTimers.delete(key);
  }
}
