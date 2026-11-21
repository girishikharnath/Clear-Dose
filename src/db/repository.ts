import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { db } from './index.ts';
import {
  medicationLogs,
  medicines,
  profiles,
  type MedicationLog,
  type Medicine,
  type Profile,
} from './schema.ts';

export type MealPreference = 'before_meal' | 'after_meal';
export type ScheduleType = 'daily' | 'weekdays' | 'weekends';
export type LogStatus = 'pending' | 'taken' | 'skipped' | 'snoozed';
export type ReminderResponse = 'yes' | 'no' | 'later';

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

export function isMedicineScheduledForDate(
  scheduleType: string,
  dateStr: string
): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = dt.getUTCDay(); // 0 = Sun, 6 = Sat
  if (scheduleType === 'weekdays') {
    return day >= 1 && day <= 5;
  }
  if (scheduleType === 'weekends') {
    return day === 0 || day === 6;
  }
  return true; // 'daily'
}

export function formatDayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function getOrCreateProfile(
  uid: string,
  email: string,
  fullName?: string | null
): Promise<Profile> {
  try {
    const existing = await db
      .select()
      .from(profiles)
      .where(eq(profiles.uid, uid))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].email !== email) {
        const updated = await db
          .update(profiles)
          .set({ email, updatedAt: new Date() })
          .where(eq(profiles.uid, uid))
          .returning();
        return updated[0];
      }
      return existing[0];
    }

    const result = await db
      .insert(profiles)
      .values({
        uid,
        email,
        fullName: fullName || null,
        preferredChannel: 'telegram',
      })
      .onConflictDoUpdate({
        target: profiles.uid,
        set: {
          email,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateProfile:', error);
    throw new Error('Unable to synchronize user profile.', { cause: error });
  }
}

export async function getProfileByUid(uid: string): Promise<Profile | null> {
  try {
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.uid, uid))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getProfileByUid:', error);
    throw new Error('Unable to load user profile.', { cause: error });
  }
}

export async function updateProfile(
  uid: string,
  input: {
    fullName?: string | null;
    phoneNumber?: string | null;
    telegramChatId?: string | null;
    preferredChannel?: string;
    timezoneOffsetMinutes?: number;
  }
): Promise<Profile> {
  try {
    const updated = await db
      .update(profiles)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.phoneNumber !== undefined
          ? { phoneNumber: input.phoneNumber }
          : {}),
        ...(input.telegramChatId !== undefined
          ? { telegramChatId: input.telegramChatId }
          : {}),
        ...(input.preferredChannel !== undefined
          ? { preferredChannel: input.preferredChannel }
          : {}),
        ...(input.timezoneOffsetMinutes !== undefined
          ? { timezoneOffsetMinutes: input.timezoneOffsetMinutes }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(profiles.uid, uid))
      .returning();

    if (!updated[0]) {
      throw new Error('Profile not found.');
    }
    return updated[0];
  } catch (error) {
    console.error('Database query failed in updateProfile:', error);
    throw new Error('Unable to save profile settings.', { cause: error });
  }
}

export async function listMedicines(uid: string): Promise<Medicine[]> {
  try {
    return await db
      .select()
      .from(medicines)
      .where(eq(medicines.userUid, uid))
      .orderBy(asc(medicines.reminderTime), asc(medicines.name));
  } catch (error) {
    console.error('Database query failed in listMedicines:', error);
    throw new Error('Unable to load medicines.', { cause: error });
  }
}

export async function createMedicine(
  uid: string,
  input: {
    name: string;
    dosage: string;
    reminderTime: string;
    mealPreference: MealPreference;
    scheduleType: ScheduleType;
    notes?: string | null;
    reminderEnabled?: boolean;
  }
): Promise<Medicine> {
  try {
    const inserted = await db
      .insert(medicines)
      .values({
        userUid: uid,
        name: input.name.trim(),
        dosage: input.dosage.trim(),
        reminderTime: input.reminderTime,
        mealPreference: input.mealPreference,
        scheduleType: input.scheduleType,
        notes: input.notes?.trim() || null,
        reminderEnabled: Boolean(input.reminderEnabled),
        isActive: true,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database query failed in createMedicine:', error);
    throw new Error('Unable to add medicine.', { cause: error });
  }
}

export async function updateMedicine(
  uid: string,
  id: number,
  input: {
    name?: string;
    dosage?: string;
    reminderTime?: string;
    mealPreference?: MealPreference;
    scheduleType?: ScheduleType;
    notes?: string | null;
    reminderEnabled?: boolean;
    isActive?: boolean;
  }
): Promise<Medicine | null> {
  try {
    const existingRows = await db
      .select()
      .from(medicines)
      .where(and(eq(medicines.id, id), eq(medicines.userUid, uid)))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      return null;
    }

    const timingChanged =
      input.reminderTime !== undefined &&
      input.reminderTime !== existing.reminderTime;

    const updated = await db
      .update(medicines)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.dosage !== undefined ? { dosage: input.dosage.trim() } : {}),
        ...(input.reminderTime !== undefined
          ? { reminderTime: input.reminderTime }
          : {}),
        ...(input.mealPreference !== undefined
          ? { mealPreference: input.mealPreference }
          : {}),
        ...(input.scheduleType !== undefined
          ? { scheduleType: input.scheduleType }
          : {}),
        ...(input.notes !== undefined
          ? { notes: input.notes?.trim() || null }
          : {}),
        ...(input.reminderEnabled !== undefined
          ? { reminderEnabled: input.reminderEnabled }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(medicines.id, id), eq(medicines.userUid, uid)))
      .returning();

    const med = updated[0] ?? null;
    if (med && timingChanged && input.reminderTime) {
      await db
        .update(medicationLogs)
        .set({
          scheduledTime: input.reminderTime,
          lastReminderSentAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(medicationLogs.userUid, uid),
            eq(medicationLogs.medicineId, id),
            eq(medicationLogs.status, 'pending')
          )
        );
    }
    return med;
  } catch (error) {
    console.error('Database query failed in updateMedicine:', error);
    throw new Error('Unable to update medicine.', { cause: error });
  }
}

export async function getMedicineWithProfileById(medicineId: number): Promise<{
  medicine: Medicine;
  profile: Profile;
} | null> {
  try {
    const rows = await db
      .select({
        medicine: medicines,
        profile: profiles,
      })
      .from(medicines)
      .innerJoin(profiles, eq(medicines.userUid, profiles.uid))
      .where(eq(medicines.id, medicineId))
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getMedicineWithProfileById:', error);
    throw new Error('Unable to retrieve medicine details.', { cause: error });
  }
}

export async function deleteMedicine(uid: string, id: number): Promise<boolean> {
  try {
    const deleted = await db
      .delete(medicines)
      .where(and(eq(medicines.id, id), eq(medicines.userUid, uid)))
      .returning();
    return deleted.length > 0;
  } catch (error) {
    console.error('Database query failed in deleteMedicine:', error);
    throw new Error('Unable to delete medicine.', { cause: error });
  }
}

export async function ensureLogForMedicineDate(
  uid: string,
  medicine: Medicine,
  logDate: string
): Promise<MedicationLog> {
  try {
    const existing = await db
      .select()
      .from(medicationLogs)
      .where(
        and(
          eq(medicationLogs.userUid, uid),
          eq(medicationLogs.medicineId, medicine.id),
          eq(medicationLogs.logDate, logDate)
        )
      )
      .limit(1);

    if (existing[0]) {
      return existing[0];
    }

    const inserted = await db
      .insert(medicationLogs)
      .values({
        userUid: uid,
        medicineId: medicine.id,
        logDate,
        scheduledTime: medicine.reminderTime,
        status: 'pending',
        snoozeCount: 0,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) {
      return inserted[0];
    }

    const refetched = await db
      .select()
      .from(medicationLogs)
      .where(
        and(
          eq(medicationLogs.userUid, uid),
          eq(medicationLogs.medicineId, medicine.id),
          eq(medicationLogs.logDate, logDate)
        )
      )
      .limit(1);

    return refetched[0];
  } catch (error) {
    console.error('Database query failed in ensureLogForMedicineDate:', error);
    throw new Error('Unable to prepare daily medication log.', { cause: error });
  }
}

export async function getDailyDashboard(
  uid: string,
  dateStr: string
): Promise<DailyDashboardData> {
  try {
    const allMeds = await db
      .select()
      .from(medicines)
      .where(and(eq(medicines.userUid, uid), eq(medicines.isActive, true)))
      .orderBy(asc(medicines.reminderTime), asc(medicines.name));

    const scheduledMeds = allMeds.filter((m) =>
      isMedicineScheduledForDate(m.scheduleType, dateStr)
    );

    const items: DailyScheduleItem[] = [];
    for (const medicine of scheduledMeds) {
      const log = await ensureLogForMedicineDate(uid, medicine, dateStr);
      items.push({ medicine, log });
    }

    const scheduled = items.length;
    const taken = items.filter((i) => i.log.status === 'taken').length;
    const skipped = items.filter((i) => i.log.status === 'skipped').length;
    const snoozed = items.filter((i) => i.log.status === 'snoozed').length;
    const remaining = items.filter(
      (i) => i.log.status === 'pending' || i.log.status === 'snoozed'
    ).length;
    const adherencePercent =
      scheduled > 0 ? Math.round((taken / scheduled) * 100) : 0;

    return {
      date: dateStr,
      dayName: formatDayName(dateStr),
      items,
      summary: {
        scheduled,
        taken,
        skipped,
        snoozed,
        remaining,
        adherencePercent,
      },
    };
  } catch (error) {
    console.error('Database query failed in getDailyDashboard:', error);
    throw new Error('Unable to load daily medication schedule.', {
      cause: error,
    });
  }
}

export async function updateLogStatus(
  uid: string,
  medicineId: number,
  logDate: string,
  status: LogStatus,
  extra?: {
    lastUserResponse?: ReminderResponse | null;
    lastBotReply?: string | null;
    snoozedUntil?: Date | null;
    incrementSnooze?: boolean;
    lastReminderSentAt?: Date | null;
  }
): Promise<MedicationLog> {
  try {
    const medRows = await db
      .select()
      .from(medicines)
      .where(and(eq(medicines.id, medicineId), eq(medicines.userUid, uid)))
      .limit(1);

    if (!medRows[0]) {
      throw new Error('Medicine not found.');
    }

    const existing = await ensureLogForMedicineDate(uid, medRows[0], logDate);
    const now = new Date();

    const nextSnoozeCount = extra?.incrementSnooze
      ? existing.snoozeCount + 1
      : status === 'pending'
        ? 0
        : existing.snoozeCount;

    const updated = await db
      .update(medicationLogs)
      .set({
        status,
        takenAt: status === 'taken' ? now : null,
        snoozedUntil:
          status === 'snoozed'
            ? (extra?.snoozedUntil ?? new Date(now.getTime() + 60 * 60 * 1000))
            : null,
        snoozeCount: nextSnoozeCount,
        ...(extra?.lastUserResponse !== undefined
          ? { lastUserResponse: extra.lastUserResponse }
          : status === 'pending'
            ? { lastUserResponse: null }
            : {}),
        ...(extra?.lastBotReply !== undefined
          ? { lastBotReply: extra.lastBotReply }
          : status === 'pending'
            ? { lastBotReply: null }
            : {}),
        ...(extra?.lastReminderSentAt !== undefined
          ? { lastReminderSentAt: extra.lastReminderSentAt }
          : {}),
        updatedAt: now,
      })
      .where(eq(medicationLogs.id, existing.id))
      .returning();

    return updated[0];
  } catch (error) {
    console.error('Database query failed in updateLogStatus:', error);
    throw new Error('Unable to update medication tracking status.', {
      cause: error,
    });
  }
}

export async function markReminderSent(
  logId: number,
  uid?: string
): Promise<MedicationLog | null> {
  try {
    const condition = uid
      ? and(eq(medicationLogs.id, logId), eq(medicationLogs.userUid, uid))
      : eq(medicationLogs.id, logId);
    const updated = await db
      .update(medicationLogs)
      .set({
        lastReminderSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(condition)
      .returning();
    return updated[0] ?? null;
  } catch (error) {
    console.error('Database query failed in markReminderSent:', error);
    throw new Error('Unable to record sent reminder.', { cause: error });
  }
}

export async function getLogDetailsById(logId: number): Promise<{
  log: MedicationLog;
  medicine: Medicine;
  profile: Profile;
} | null> {
  try {
    const rows = await db
      .select({
        log: medicationLogs,
        medicine: medicines,
        profile: profiles,
      })
      .from(medicationLogs)
      .innerJoin(medicines, eq(medicationLogs.medicineId, medicines.id))
      .innerJoin(profiles, eq(medicationLogs.userUid, profiles.uid))
      .where(eq(medicationLogs.id, logId))
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in getLogDetailsById:', error);
    throw new Error('Unable to retrieve reminder record.', { cause: error });
  }
}

export async function getDueSnoozedLogsForUser(uid: string): Promise<
  Array<{
    log: MedicationLog;
    medicine: Medicine;
    profile: Profile;
  }>
> {
  try {
    const now = new Date();
    return await db
      .select({
        log: medicationLogs,
        medicine: medicines,
        profile: profiles,
      })
      .from(medicationLogs)
      .innerJoin(medicines, eq(medicationLogs.medicineId, medicines.id))
      .innerJoin(profiles, eq(medicationLogs.userUid, profiles.uid))
      .where(
        and(
          eq(medicationLogs.userUid, uid),
          eq(medicationLogs.status, 'snoozed'),
          lte(medicationLogs.snoozedUntil, now)
        )
      );
  } catch (error) {
    console.error('Database query failed in getDueSnoozedLogsForUser:', error);
    throw new Error('Unable to check due follow-up reminders.', {
      cause: error,
    });
  }
}

export async function getMedicationHistory(
  uid: string,
  limitCount = 60
): Promise<Array<{ log: MedicationLog; medicine: Medicine }>> {
  try {
    return await db
      .select({
        log: medicationLogs,
        medicine: medicines,
      })
      .from(medicationLogs)
      .innerJoin(medicines, eq(medicationLogs.medicineId, medicines.id))
      .where(eq(medicationLogs.userUid, uid))
      .orderBy(desc(medicationLogs.logDate), asc(medicationLogs.scheduledTime))
      .limit(limitCount);
  } catch (error) {
    console.error('Database query failed in getMedicationHistory:', error);
    throw new Error('Unable to load medication history.', { cause: error });
  }
}
