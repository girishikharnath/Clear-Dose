export type MealPreference = 'before_meal' | 'after_meal';
export type ScheduleType = 'daily' | 'weekdays' | 'weekends';
export type LogStatus = 'pending' | 'taken' | 'skipped' | 'snoozed';
export type ReminderResponse = 'yes' | 'no' | 'later';
export type MessagingChannel = 'telegram' | 'whatsapp';

export interface Profile {
  id: number;
  uid: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  telegramChatId: string | null;
  preferredChannel: MessagingChannel;
  timezoneOffsetMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Medicine {
  id: number;
  userUid: string;
  name: string;
  dosage: string;
  reminderTime: string;
  mealPreference: MealPreference;
  scheduleType: ScheduleType;
  notes: string | null;
  reminderEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MedicationLog {
  id: number;
  userUid: string;
  medicineId: number;
  logDate: string;
  scheduledTime: string;
  status: LogStatus;
  takenAt: string | null;
  snoozedUntil: string | null;
  snoozeCount: number;
  lastReminderSentAt: string | null;
  lastUserResponse: ReminderResponse | null;
  lastBotReply: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyScheduleItem {
  medicine: Medicine;
  log: MedicationLog;
}

export interface DailyDashboardData {
  date: string;
  dayName: string;
  items: DailyScheduleItem[];
  summary: {
    scheduled: number;
    taken: number;
    skipped: number;
    snoozed: number;
    remaining: number;
    adherencePercent: number;
  };
}

export interface MessagingStatus {
  telegramBotConfigured: boolean;
  telegramBotValid: boolean;
  telegramBotUsername: string | null;
  telegramWebhookSecretConfigured: boolean;
  whatsappConfigured: boolean;
  webhookUrl: string;
}

export interface DetectedTelegramChat {
  chatId: string;
  username?: string;
  firstName?: string;
  lastText?: string;
  seenAt: string;
}

export interface SentReminderPayload {
  log: MedicationLog;
  medicine: Medicine;
  delivery: {
    deliveredLive: boolean;
    channel: 'telegram' | 'whatsapp' | 'preview';
    messageText: string;
    detail: string;
  };
}

export interface ReminderResponsePayload {
  log: MedicationLog;
  replyText: string;
  nextFollowUpAt: string | null;
}

export interface HistoryItem {
  log: MedicationLog;
  medicine: Medicine;
}
