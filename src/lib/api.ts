import { auth } from './firebase.ts';
import type {
  DailyDashboardData,
  HistoryItem,
  LogStatus,
  MealPreference,
  MedicationLog,
  Medicine,
  MessagingChannel,
  MessagingStatus,
  Profile,
  ReminderResponse,
  ReminderResponsePayload,
  ScheduleType,
  SentReminderPayload,
} from '../types.ts';

async function authFetch<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to perform this action.');
  }

  const token = await user.getIdToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

export const api = {
  getProfile: () => authFetch<{ profile: Profile }>('/api/profile'),

  updateProfile: (payload: {
    fullName?: string;
    phoneNumber?: string;
    telegramChatId?: string;
    preferredChannel?: MessagingChannel;
  }) =>
    authFetch<{ profile: Profile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getDashboard: (date: string, tzOffset?: number) =>
    authFetch<{
      dashboard: DailyDashboardData;
      dispatchedFollowUpIds: number[];
    }>(
      `/api/dashboard?date=${encodeURIComponent(date)}${
        tzOffset !== undefined ? `&tzOffset=${encodeURIComponent(tzOffset)}` : ''
      }`
    ),

  getMedicines: () => authFetch<{ medicines: Medicine[] }>('/api/medicines'),

  createMedicine: (payload: {
    name: string;
    dosage: string;
    reminderTime: string;
    mealPreference: MealPreference;
    scheduleType: ScheduleType;
    notes?: string;
    reminderEnabled?: boolean;
    tzOffset?: number;
  }) =>
    authFetch<{ medicine: Medicine; nextScheduledLabel: string | null }>(
      '/api/medicines',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateMedicine: (
    id: number,
    payload: {
      name?: string;
      dosage?: string;
      reminderTime?: string;
      mealPreference?: MealPreference;
      scheduleType?: ScheduleType;
      notes?: string | null;
      reminderEnabled?: boolean;
      isActive?: boolean;
      tzOffset?: number;
    }
  ) =>
    authFetch<{ medicine: Medicine; nextScheduledLabel: string | null }>(
      `/api/medicines/${id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),

  deleteMedicine: (id: number) =>
    authFetch<{ deleted: boolean }>(`/api/medicines/${id}`, {
      method: 'DELETE',
    }),

  updateLogStatus: (payload: {
    medicineId: number;
    logDate: string;
    status: LogStatus;
  }) =>
    authFetch<{ log: MedicationLog }>('/api/logs/status', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getHistory: () => authFetch<{ history: HistoryItem[] }>('/api/history'),

  getMessagingStatus: () =>
    authFetch<MessagingStatus>('/api/messaging/status'),

  detectTelegramChats: () =>
    authFetch<{
      chats: Array<{
        chatId: string;
        username?: string;
        firstName?: string;
        lastText?: string;
        seenAt: string;
      }>;
      botUsername: string | null;
      note?: string;
    }>('/api/telegram/detect-chat'),

  sendTestTelegramMessage: (chatId?: string) =>
    authFetch<{ ok: boolean; description: string }>('/api/telegram/test', {
      method: 'POST',
      body: JSON.stringify({ chatId }),
    }),

  sendReminder: (payload: {
    medicineId: number;
    logDate: string;
    isFollowUp?: boolean;
  }) =>
    authFetch<SentReminderPayload>('/api/reminders/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  respondToReminder: (payload: {
    logId: number;
    choice: ReminderResponse;
  }) =>
    authFetch<ReminderResponsePayload>('/api/reminders/respond', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  triggerFollowUpNow: (logId: number) =>
    authFetch<SentReminderPayload>(`/api/reminders/trigger-followup/${logId}`, {
      method: 'POST',
    }),

  registerTelegramWebhook: () =>
    authFetch<{ ok: boolean; description: string }>(
      '/api/telegram/register-webhook',
      { method: 'POST' }
    ),
};
