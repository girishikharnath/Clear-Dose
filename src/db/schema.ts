import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. profiles: User profile, phone numbers, and Telegram chat_id
export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  fullName: text('full_name'),
  phoneNumber: text('phone_number'),
  telegramChatId: text('telegram_chat_id'),
  preferredChannel: text('preferred_channel').default('telegram').notNull(), // 'telegram' | 'whatsapp'
  timezoneOffsetMinutes: integer('timezone_offset_minutes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 2. medicines: Medicine names, dosages, reminder times, meal preferences, and schedules
export const medicines = pgTable('medicines', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid')
    .notNull()
    .references(() => profiles.uid, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dosage: text('dosage').notNull(),
  reminderTime: text('reminder_time').notNull(), // 24h HH:MM
  mealPreference: text('meal_preference').notNull(), // 'before_meal' | 'after_meal'
  scheduleType: text('schedule_type').notNull(), // 'daily' | 'weekdays' | 'weekends'
  notes: text('notes'),
  reminderEnabled: boolean('reminder_enabled').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// 3. medication_logs: Daily tracking records (pending, taken, skipped, snoozed) and timestamps
export const medicationLogs = pgTable(
  'medication_logs',
  {
    id: serial('id').primaryKey(),
    userUid: text('user_uid')
      .notNull()
      .references(() => profiles.uid, { onDelete: 'cascade' }),
    medicineId: integer('medicine_id')
      .notNull()
      .references(() => medicines.id, { onDelete: 'cascade' }),
    logDate: text('log_date').notNull(), // YYYY-MM-DD
    scheduledTime: text('scheduled_time').notNull(), // HH:MM
    status: text('status').default('pending').notNull(), // 'pending' | 'taken' | 'skipped' | 'snoozed'
    takenAt: timestamp('taken_at'),
    snoozedUntil: timestamp('snoozed_until'),
    snoozeCount: integer('snooze_count').default(0).notNull(),
    lastReminderSentAt: timestamp('last_reminder_sent_at'),
    lastUserResponse: text('last_user_response'), // 'yes' | 'no' | 'later'
    lastBotReply: text('last_bot_reply'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('medication_logs_user_med_date_idx').on(
      table.userUid,
      table.medicineId,
      table.logDate
    ),
  ]
);

export const profilesRelations = relations(profiles, ({ many }) => ({
  medicines: many(medicines),
  medicationLogs: many(medicationLogs),
}));

export const medicinesRelations = relations(medicines, ({ one, many }) => ({
  profile: one(profiles, {
    fields: [medicines.userUid],
    references: [profiles.uid],
  }),
  logs: many(medicationLogs),
}));

export const medicationLogsRelations = relations(medicationLogs, ({ one }) => ({
  profile: one(profiles, {
    fields: [medicationLogs.userUid],
    references: [profiles.uid],
  }),
  medicine: one(medicines, {
    fields: [medicationLogs.medicineId],
    references: [medicines.id],
  }),
}));

export type Profile = typeof profiles.$inferSelect;
export type Medicine = typeof medicines.$inferSelect;
export type MedicationLog = typeof medicationLogs.$inferSelect;
