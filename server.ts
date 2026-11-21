import 'dotenv/config';
import express, { type Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  createMedicine,
  deleteMedicine,
  ensureLogForMedicineDate,
  getDailyDashboard,
  getDueSnoozedLogsForUser,
  getLogDetailsById,
  getMedicationHistory,
  getMedicineWithProfileById,
  getProfileByUid,
  listMedicines,
  markReminderSent,
  updateLogStatus,
  updateMedicine,
  updateProfile,
  type LogStatus,
  type MealPreference,
  type ReminderResponse,
  type ScheduleType,
} from './src/db/repository.ts';
import {
  buildSnoozeReply,
  clearDoseReminderTimer,
  clearSnoozeTimer,
  computeNextScheduledOccurrence,
  detectRecentTelegramChats,
  formatTime12h,
  getMessagingStatus,
  recordDetectedChat,
  registerTelegramWebhook,
  scheduleDoseReminderTimer,
  scheduleOneHourFollowUp,
  sendMedicationReminder,
  sendTelegramTextMessage,
  sendTestTelegramMessage,
  startTelegramUpdatePoller,
  THANK_YOU_MESSAGE,
  type TelegramUpdate,
} from './src/services/telegram.ts';

const ONE_HOUR_MS = 60 * 60 * 1000;

// Real-time Server-Sent Events clients keyed by Firebase user UID
const sseClientsByUid = new Map<string, Set<Response>>();
const userTzOffsets = new Map<string, number>();

function emitUserEvent(uid: string, event: Record<string, unknown>) {
  const clients = sseClientsByUid.get(uid);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function dispatchFollowUpIfStillSnoozed(logId: number): Promise<void> {
  const details = await getLogDetailsById(logId);
  if (!details || details.log.status !== 'snoozed') {
    return;
  }

  await sendMedicationReminder({
    logId: details.log.id,
    medicineName: details.medicine.name,
    dosage: details.medicine.dosage,
    reminderTime: details.medicine.reminderTime,
    mealPreference: details.medicine.mealPreference,
    chatId: details.profile.telegramChatId,
    phoneNumber: details.profile.phoneNumber,
    preferredChannel: details.profile.preferredChannel,
    isFollowUp: true,
  });

  await markReminderSent(details.log.id, details.profile.uid);
  emitUserEvent(details.profile.uid, {
    type: 'reminder_sent',
    medicineName: details.medicine.name,
    isFollowUp: true,
  });
}

async function armRecurringReminderForMedicine(
  medicineId: number,
  tzOffsetOverride?: number | null
): Promise<{
  armed: boolean;
  nextLabel: string | null;
}> {
  const key = `med:${medicineId}`;
  clearDoseReminderTimer(key);

  const details = await getMedicineWithProfileById(medicineId);
  if (!details || !details.medicine.isActive || !details.medicine.reminderEnabled) {
    return { armed: false, nextLabel: null };
  }

  const tzOffset =
    tzOffsetOverride ??
    userTzOffsets.get(details.profile.uid) ??
    details.profile.timezoneOffsetMinutes ??
    0;

  const next = computeNextScheduledOccurrence(
    details.medicine.reminderTime,
    details.medicine.scheduleType,
    tzOffset
  );

  if (!next) {
    return { armed: false, nextLabel: null };
  }

  const delayMs = Math.max(1000, next.targetUtcMs - Date.now());
  const targetDateStr = next.localDateStr;
  const expectedTime = details.medicine.reminderTime;

  scheduleDoseReminderTimer(key, delayMs, async () => {
    const fresh = await getMedicineWithProfileById(medicineId);
    if (
      !fresh ||
      !fresh.medicine.isActive ||
      !fresh.medicine.reminderEnabled ||
      fresh.medicine.reminderTime !== expectedTime
    ) {
      return;
    }

    const log = await ensureLogForMedicineDate(
      fresh.profile.uid,
      fresh.medicine,
      targetDateStr
    );

    if (log.status === 'pending' && !log.lastReminderSentAt) {
      await sendMedicationReminder({
        logId: log.id,
        medicineName: fresh.medicine.name,
        dosage: fresh.medicine.dosage,
        reminderTime: fresh.medicine.reminderTime,
        mealPreference: fresh.medicine.mealPreference,
        chatId: fresh.profile.telegramChatId,
        phoneNumber: fresh.profile.phoneNumber,
        preferredChannel: fresh.profile.preferredChannel,
        isFollowUp: false,
      });

      await markReminderSent(log.id, fresh.profile.uid);
      emitUserEvent(fresh.profile.uid, {
        type: 'reminder_sent',
        medicineName: fresh.medicine.name,
        isFollowUp: false,
      });
    }

    // Re-arm automatically for the next scheduled day (everyday / weekdays / weekends)
    const rearmTimer = setTimeout(() => {
      armRecurringReminderForMedicine(medicineId, tzOffset).catch((err) => {
        console.error(`Failed to re-arm reminder for med ${medicineId}:`, err);
      });
    }, 2000);
    if (typeof rearmTimer.unref === 'function') rearmTimer.unref();
  });

  const time12 = formatTime12h(details.medicine.reminderTime);
  const whenText = next.isToday
    ? `today at ${time12}`
    : `${next.localDateStr} at ${time12}`;

  return { armed: true, nextLabel: whenText };
}

async function armAllEnabledRemindersForUser(
  uid: string,
  tzOffsetMinutes: number
) {
  const allMeds = await listMedicines(uid);
  for (const med of allMeds) {
    if (med.isActive && med.reminderEnabled) {
      await armRecurringReminderForMedicine(med.id, tzOffsetMinutes);
    } else {
      clearDoseReminderTimer(`med:${med.id}`);
    }
  }
}

async function handleReminderResponse(
  logId: number,
  choice: ReminderResponse,
  options?: {
    uidCheck?: string;
    callbackQueryId?: string;
    source?: 'telegram' | 'web';
  }
) {
  const details = await getLogDetailsById(logId);
  if (!details) {
    throw new Error('Medication reminder record not found.');
  }
  if (options?.uidCheck && details.profile.uid !== options.uidCheck) {
    throw new Error('Unauthorized access to medication log.');
  }

  if (choice === 'yes') {
    clearSnoozeTimer(logId);
    const updatedLog = await updateLogStatus(
      details.profile.uid,
      details.medicine.id,
      details.log.logDate,
      'taken',
      {
        lastUserResponse: 'yes',
        lastBotReply: THANK_YOU_MESSAGE,
      }
    );

    if (details.profile.telegramChatId) {
      await sendTelegramTextMessage(
        details.profile.telegramChatId,
        THANK_YOU_MESSAGE,
        options?.callbackQueryId
      );
    }

    emitUserEvent(details.profile.uid, {
      type: 'log_updated',
      source: options?.source || 'web',
      logId: updatedLog.id,
      medicineId: details.medicine.id,
      medicineName: details.medicine.name,
      status: 'taken',
      choice: 'yes',
      replyText: THANK_YOU_MESSAGE,
    });

    return {
      log: updatedLog,
      replyText: THANK_YOU_MESSAGE,
      nextFollowUpAt: null,
    };
  }

  // 'no' or 'later' -> Snooze and message again after 1 hour
  const nextFollowUpAt = new Date(Date.now() + ONE_HOUR_MS);
  const tzOffset = userTzOffsets.get(details.profile.uid);
  const replyText = buildSnoozeReply(nextFollowUpAt, tzOffset);

  const updatedLog = await updateLogStatus(
    details.profile.uid,
    details.medicine.id,
    details.log.logDate,
    'snoozed',
    {
      lastUserResponse: choice,
      lastBotReply: replyText,
      snoozedUntil: nextFollowUpAt,
      incrementSnooze: true,
    }
  );

  if (details.profile.telegramChatId) {
    await sendTelegramTextMessage(
      details.profile.telegramChatId,
      replyText,
      options?.callbackQueryId
    );
  }

  scheduleOneHourFollowUp(updatedLog.id, ONE_HOUR_MS, () =>
    dispatchFollowUpIfStillSnoozed(updatedLog.id)
  );

  emitUserEvent(details.profile.uid, {
    type: 'log_updated',
    source: options?.source || 'web',
    logId: updatedLog.id,
    medicineId: details.medicine.id,
    medicineName: details.medicine.name,
    status: 'snoozed',
    choice,
    replyText,
    nextFollowUpAt: nextFollowUpAt.toISOString(),
  });

  return {
    log: updatedLog,
    replyText,
    nextFollowUpAt: nextFollowUpAt.toISOString(),
  };
}

async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.message?.chat?.id) {
    const chatId = String(update.message.chat.id);
    recordDetectedChat({
      chatId,
      username: update.message.chat.username,
      firstName: update.message.chat.first_name,
      lastText: update.message.text,
    });

    if (update.message.text?.startsWith('/start')) {
      await sendTelegramTextMessage(
        chatId,
        `Welcome to ClearDose Medication Reminders.\n\nYour Telegram Chat ID is: ${chatId}\n\nPaste this Chat ID in ClearDose (or click "Detect ID") under Telegram Reminders to receive interactive dose check-ins.`
      );
      return;
    }
  }

  if (update.callback_query?.data) {
    const cbChat = update.callback_query.message?.chat;
    if (cbChat?.id) {
      recordDetectedChat({
        chatId: String(cbChat.id),
        username: cbChat.username,
        firstName: cbChat.first_name,
        lastText: update.callback_query.data,
      });
    }

    const parts = update.callback_query.data.split(':');
    if (parts.length === 3 && parts[0] === 'med') {
      const choice = parts[1] as ReminderResponse;
      const logId = Number(parts[2]);
      if (['yes', 'no', 'later'].includes(choice) && !Number.isNaN(logId)) {
        await handleReminderResponse(logId, choice, {
          callbackQueryId: update.callback_query.id,
          source: 'telegram',
        });
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Start Telegram Bot API long-polling listener when TELEGRAM_BOT_TOKEN is configured
  startTelegramUpdatePoller(processTelegramUpdate);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --------------------------------------------------------------------------
  // Real-Time Server-Sent Events (instant sync when user taps Telegram buttons)
  // --------------------------------------------------------------------------
  app.get('/api/events', async (req, res) => {
    const token =
      typeof req.query.token === 'string'
        ? req.query.token
        : req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    let uid: string;
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid;
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let clients = sseClientsByUid.get(uid);
    if (!clients) {
      clients = new Set();
      sseClientsByUid.set(uid, clients);
    }
    clients.add(res);

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25_000);
    if (typeof keepAlive.unref === 'function') keepAlive.unref();

    req.on('close', () => {
      clearInterval(keepAlive);
      const set = sseClientsByUid.get(uid);
      if (set) {
        set.delete(res);
        if (set.size === 0) {
          sseClientsByUid.delete(uid);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // Profile Endpoints
  // --------------------------------------------------------------------------
  app.get('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const profile = await getProfileByUid(req.user!.uid);
      res.json({ profile });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to load profile';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { fullName, phoneNumber, telegramChatId, preferredChannel } =
        req.body as {
          fullName?: string;
          phoneNumber?: string;
          telegramChatId?: string;
          preferredChannel?: string;
        };

      const channel =
        preferredChannel === 'whatsapp' ? 'whatsapp' : 'telegram';

      const profile = await updateProfile(req.user!.uid, {
        fullName: fullName?.trim() || null,
        phoneNumber: phoneNumber?.trim() || null,
        telegramChatId: telegramChatId?.trim() || null,
        preferredChannel: channel,
      });
      res.json({ profile });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to update profile';
      res.status(500).json({ error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Medicines Management Endpoints
  // --------------------------------------------------------------------------
  app.get('/api/medicines', requireAuth, async (req: AuthRequest, res) => {
    try {
      const items = await listMedicines(req.user!.uid);
      res.json({ medicines: items });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to load medicines';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/medicines', requireAuth, async (req: AuthRequest, res) => {
    try {
      const {
        name,
        dosage,
        reminderTime,
        mealPreference,
        scheduleType,
        notes,
        reminderEnabled,
        tzOffset,
      } = req.body as {
        name?: string;
        dosage?: string;
        reminderTime?: string;
        mealPreference?: MealPreference;
        scheduleType?: ScheduleType;
        notes?: string;
        reminderEnabled?: boolean;
        tzOffset?: number;
      };

      if (!name?.trim() || !dosage?.trim() || !reminderTime?.trim()) {
        return res.status(400).json({
          error: 'Medicine name, dosage, and reminder time are required.',
        });
      }

      if (typeof tzOffset === 'number' && !Number.isNaN(tzOffset)) {
        userTzOffsets.set(req.user!.uid, tzOffset);
        await updateProfile(req.user!.uid, {
          timezoneOffsetMinutes: tzOffset,
        });
      }

      const validMeal: MealPreference =
        mealPreference === 'before_meal' ? 'before_meal' : 'after_meal';
      const validSchedule: ScheduleType =
        scheduleType === 'weekdays' || scheduleType === 'weekends'
          ? scheduleType
          : 'daily';

      const created = await createMedicine(req.user!.uid, {
        name,
        dosage,
        reminderTime,
        mealPreference: validMeal,
        scheduleType: validSchedule,
        notes,
        reminderEnabled: Boolean(reminderEnabled),
      });

      const scheduleInfo = created.reminderEnabled
        ? await armRecurringReminderForMedicine(created.id, tzOffset)
        : { armed: false, nextLabel: null };

      res.status(201).json({
        medicine: created,
        nextScheduledLabel: scheduleInfo.nextLabel,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to add medicine';
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/medicines/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid medicine ID.' });
      }

      const {
        name,
        dosage,
        reminderTime,
        mealPreference,
        scheduleType,
        notes,
        reminderEnabled,
        isActive,
        tzOffset,
      } = req.body as {
        name?: string;
        dosage?: string;
        reminderTime?: string;
        mealPreference?: MealPreference;
        scheduleType?: ScheduleType;
        notes?: string | null;
        reminderEnabled?: boolean;
        isActive?: boolean;
        tzOffset?: number;
      };

      if (typeof tzOffset === 'number' && !Number.isNaN(tzOffset)) {
        userTzOffsets.set(req.user!.uid, tzOffset);
        await updateProfile(req.user!.uid, {
          timezoneOffsetMinutes: tzOffset,
        });
      }

      const updated = await updateMedicine(req.user!.uid, id, {
        name,
        dosage,
        reminderTime,
        mealPreference,
        scheduleType,
        notes,
        reminderEnabled,
        isActive,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Medicine not found.' });
      }

      const scheduleInfo = updated.reminderEnabled
        ? await armRecurringReminderForMedicine(updated.id, tzOffset)
        : (clearDoseReminderTimer(`med:${updated.id}`),
          { armed: false, nextLabel: null });

      res.json({
        medicine: updated,
        nextScheduledLabel: scheduleInfo.nextLabel,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to update medicine';
      res.status(500).json({ error: message });
    }
  });

  app.delete(
    '/api/medicines/:id',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
          return res.status(400).json({ error: 'Invalid medicine ID.' });
        }

        clearDoseReminderTimer(`med:${id}`);
        const ok = await deleteMedicine(req.user!.uid, id);
        if (!ok) {
          return res.status(404).json({ error: 'Medicine not found.' });
        }
        res.json({ deleted: true });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to delete medicine';
        res.status(500).json({ error: message });
      }
    }
  );

  // --------------------------------------------------------------------------
  // Daily Dashboard & Tracking Endpoints
  // --------------------------------------------------------------------------
  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const dateStr =
        typeof req.query.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
          ? req.query.date
          : todayIsoDate();

      const tzOffset =
        typeof req.query.tzOffset === 'string' &&
        !Number.isNaN(Number(req.query.tzOffset))
          ? Number(req.query.tzOffset)
          : null;

      if (tzOffset !== null) {
        const prev = userTzOffsets.get(req.user!.uid);
        userTzOffsets.set(req.user!.uid, tzOffset);
        if (prev !== tzOffset) {
          await updateProfile(req.user!.uid, {
            timezoneOffsetMinutes: tzOffset,
          });
        }
      }

      const dueFollowUps = await getDueSnoozedLogsForUser(req.user!.uid);
      const sentFollowUpIds: number[] = [];
      for (const item of dueFollowUps) {
        const alreadySentAfterDue =
          item.log.lastReminderSentAt &&
          item.log.snoozedUntil &&
          new Date(item.log.lastReminderSentAt).getTime() >=
            new Date(item.log.snoozedUntil).getTime();

        if (!alreadySentAfterDue) {
          await dispatchFollowUpIfStillSnoozed(item.log.id);
          sentFollowUpIds.push(item.log.id);
        }
      }

      const dashboard = await getDailyDashboard(req.user!.uid, dateStr);

      if (tzOffset !== null) {
        await armAllEnabledRemindersForUser(req.user!.uid, tzOffset);
      }

      res.json({ dashboard, dispatchedFollowUpIds: sentFollowUpIds });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to load daily schedule';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/logs/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { medicineId, logDate, status } = req.body as {
        medicineId?: number;
        logDate?: string;
        status?: LogStatus;
      };

      if (!medicineId || !logDate || !status) {
        return res
          .status(400)
          .json({ error: 'medicineId, logDate, and status are required.' });
      }

      if (!['pending', 'taken', 'skipped', 'snoozed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }

      const updatedLog = await updateLogStatus(
        req.user!.uid,
        Number(medicineId),
        logDate,
        status
      );

      if (status !== 'snoozed') {
        clearSnoozeTimer(updatedLog.id);
      }
      if (status !== 'pending') {
        clearDoseReminderTimer(`dose:${updatedLog.id}`);
      }

      res.json({ log: updatedLog });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to update dose status';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/history', requireAuth, async (req: AuthRequest, res) => {
    try {
      const history = await getMedicationHistory(req.user!.uid, 80);
      res.json({ history });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to load history';
      res.status(500).json({ error: message });
    }
  });

  // --------------------------------------------------------------------------
  // Telegram & WhatsApp Reminder Endpoints
  // --------------------------------------------------------------------------
  app.get(
    '/api/messaging/status',
    requireAuth,
    async (req: AuthRequest, res) => {
      const origin = `${req.protocol}://${req.get('host')}`;
      const status = await getMessagingStatus(origin);
      res.json(status);
    }
  );

  app.get(
    '/api/telegram/detect-chat',
    requireAuth,
    async (_req: AuthRequest, res) => {
      try {
        const result = await detectRecentTelegramChats();
        res.json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to detect Telegram chats';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/telegram/test',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const profile = await getProfileByUid(req.user!.uid);
        const requestedChatId =
          typeof req.body?.chatId === 'string' && req.body.chatId.trim()
            ? req.body.chatId.trim()
            : profile?.telegramChatId || '';

        const result = await sendTestTelegramMessage(requestedChatId);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to send test Telegram message';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/reminders/send',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const { medicineId, logDate, isFollowUp } = req.body as {
          medicineId?: number;
          logDate?: string;
          isFollowUp?: boolean;
        };

        if (!medicineId) {
          return res.status(400).json({ error: 'medicineId is required.' });
        }

        const dateStr = logDate || todayIsoDate();
        const meds = await listMedicines(req.user!.uid);
        const medicine = meds.find((m) => m.id === Number(medicineId));
        if (!medicine) {
          return res.status(404).json({ error: 'Medicine not found.' });
        }

        const profile = await getProfileByUid(req.user!.uid);
        const log = await ensureLogForMedicineDate(
          req.user!.uid,
          medicine,
          dateStr
        );

        const delivery = await sendMedicationReminder({
          logId: log.id,
          medicineName: medicine.name,
          dosage: medicine.dosage,
          reminderTime: medicine.reminderTime,
          mealPreference: medicine.mealPreference,
          chatId: profile?.telegramChatId,
          phoneNumber: profile?.phoneNumber,
          preferredChannel: profile?.preferredChannel,
          isFollowUp: Boolean(isFollowUp),
        });

        const updatedLog = await markReminderSent(log.id, req.user!.uid);

        res.json({
          log: updatedLog ?? log,
          medicine,
          delivery,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Failed to send reminder';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/reminders/respond',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const { logId, choice } = req.body as {
          logId?: number;
          choice?: ReminderResponse;
        };

        if (!logId || !choice || !['yes', 'no', 'later'].includes(choice)) {
          return res.status(400).json({
            error: 'logId and valid choice (yes, no, later) are required.',
          });
        }

        const result = await handleReminderResponse(Number(logId), choice, {
          uidCheck: req.user!.uid,
          source: 'web',
        });
        res.json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to process reminder response';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/reminders/trigger-followup/:logId',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const logId = Number(req.params.logId);
        if (Number.isNaN(logId)) {
          return res.status(400).json({ error: 'Invalid log ID.' });
        }

        const details = await getLogDetailsById(logId);
        if (!details || details.profile.uid !== req.user!.uid) {
          return res.status(404).json({ error: 'Reminder log not found.' });
        }

        const delivery = await sendMedicationReminder({
          logId: details.log.id,
          medicineName: details.medicine.name,
          dosage: details.medicine.dosage,
          reminderTime: details.medicine.reminderTime,
          mealPreference: details.medicine.mealPreference,
          chatId: details.profile.telegramChatId,
          phoneNumber: details.profile.phoneNumber,
          preferredChannel: details.profile.preferredChannel,
          isFollowUp: true,
        });

        const updatedLog = await markReminderSent(
          details.log.id,
          details.profile.uid
        );

        res.json({
          log: updatedLog ?? details.log,
          medicine: details.medicine,
          delivery,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to send follow-up reminder';
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    '/api/telegram/register-webhook',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const origin = `${req.protocol}://${req.get('host')}`;
        const status = await getMessagingStatus(origin);
        const result = await registerTelegramWebhook(status.webhookUrl);
        res.status(result.ok ? 200 : 400).json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to register Telegram webhook';
        res.status(500).json({ error: message });
      }
    }
  );

  // Public Telegram Bot API Webhook
  app.post('/api/telegram/webhook', async (req, res) => {
    try {
      const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (
        configuredSecret &&
        configuredSecret !== 'YOUR_OPTIONAL_TELEGRAM_WEBHOOK_SECRET'
      ) {
        const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (incomingSecret !== configuredSecret) {
          return res.status(403).json({ error: 'Invalid webhook secret' });
        }
      }

      await processTelegramUpdate(req.body as TelegramUpdate);
      res.json({ ok: true });
    } catch (error) {
      console.error('Telegram webhook handling error:', error);
      res.status(200).json({ ok: false });
    }
  });

  // --------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Assets (Prod)
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`ClearDose server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
