import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  Calendar,
  History,
  LogOut,
  Menu,
  Pill,
  Plus,
  Send,
  X,
} from 'lucide-react';
import { auth } from './lib/firebase.ts';
import { api } from './lib/api.ts';
import { getLocalTodayIso } from './lib/format.ts';
import type {
  DailyDashboardData,
  HistoryItem,
  LogStatus,
  MealPreference,
  Medicine,
  MessagingChannel,
  MessagingStatus,
  Profile,
  ReminderResponse,
  ScheduleType,
} from './types.ts';
import { SignInView } from './components/SignInView.tsx';
import { PhoneOnboardingView } from './components/PhoneOnboardingView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { MedicinesView } from './components/MedicinesView.tsx';
import { RemindersView } from './components/RemindersView.tsx';
import { HistoryView } from './components/HistoryView.tsx';
import { MedicineModal } from './components/MedicineModal.tsx';

type NavTab = 'schedule' | 'medicines' | 'reminders' | 'history';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [skippedOnboarding, setSkippedOnboarding] = useState(false);

  const [activeTab, setActiveTab] = useState<NavTab>('schedule');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>(getLocalTodayIso);
  const [dashboard, setDashboard] = useState<DailyDashboardData | null>(null);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [messagingStatus, setMessagingStatus] =
    useState<MessagingStatus | null>(null);

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 3500);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setProfileLoaded(false);
        setSkippedOnboarding(false);
        setDashboard(null);
        setMedicines([]);
        setHistory([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const refreshWorkspaceData = useCallback(
    async (dateStr: string) => {
      setLoadingData(true);
      setDataError(null);
      try {
        const tzOffset = new Date().getTimezoneOffset();
        const [dashRes, medsRes, histRes, msgRes] = await Promise.all([
          api.getDashboard(dateStr, tzOffset),
          api.getMedicines(),
          api.getHistory(),
          api.getMessagingStatus(),
        ]);
        setDashboard(dashRes.dashboard);
        setMedicines(medsRes.medicines);
        setHistory(histRes.history);
        setMessagingStatus(msgRes);

        if (dashRes.dispatchedFollowUpIds.length > 0) {
          showToast(
            `Sent ${dashRes.dispatchedFollowUpIds.length} due 1-hour follow-up reminder(s).`
          );
        }
      } catch (err: unknown) {
        setDataError(
          err instanceof Error ? err.message : 'Unable to load schedule data.'
        );
      } finally {
        setLoadingData(false);
      }
    },
    [showToast]
  );

  // Load user profile right after Firebase sign-in
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const { profile: loadedProfile } = await api.getProfile();
        if (!active) return;
        setProfile(loadedProfile);
        setProfileLoaded(true);
      } catch (err: unknown) {
        if (!active) return;
        setDataError(
          err instanceof Error ? err.message : 'Unable to load your profile.'
        );
        setProfileLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Load workspace data once signed in & profile loaded
  useEffect(() => {
    if (!user || !profileLoaded) return;
    refreshWorkspaceData(selectedDate);
  }, [user, profileLoaded, selectedDate, refreshWorkspaceData]);

  // Refresh dashboard when user switches back from Telegram so Yes/No/Later taps sync immediately
  useEffect(() => {
    if (!user || !profileLoaded) return;
    const handleFocus = () => {
      refreshWorkspaceData(selectedDate);
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [user, profileLoaded, selectedDate, refreshWorkspaceData]);

  // Real-time Server-Sent Events stream: updates website instantly when user clicks Yes/No/Later on Telegram
  useEffect(() => {
    if (!user || !profileLoaded) return;

    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      try {
        const token = await user.getIdToken();
        if (cancelled) return;

        source = new EventSource(
          `/api/events?token=${encodeURIComponent(token)}`
        );

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as {
              type?: string;
              source?: string;
              medicineName?: string;
              status?: string;
            };

            if (payload.type === 'log_updated') {
              refreshWorkspaceData(selectedDate);
              if (payload.source === 'telegram') {
                const statusLabel =
                  payload.status === 'taken'
                    ? 'marked as taken'
                    : payload.status === 'snoozed'
                      ? 'snoozed for 1 hour'
                      : `updated (${payload.status})`;
                showToast(
                  `Telegram update: ${payload.medicineName || 'Medicine'} ${statusLabel}.`
                );
              }
            } else if (payload.type === 'reminder_sent') {
              refreshWorkspaceData(selectedDate);
            }
          } catch {
            // Ignore malformed keepalive frames
          }
        };

        source.onerror = () => {
          source?.close();
          source = null;
          if (!cancelled) {
            reconnectTimer = setTimeout(connect, 5000);
          }
        };
      } catch {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [user, profileLoaded, selectedDate, refreshWorkspaceData, showToast]);

  // Automatically trigger today's scheduled reminders ONLY when reminderEnabled is true
  // and local clock hits the exact scheduled reminderTime (0–1 min window)
  useEffect(() => {
    if (!user || !dashboard) return;
    const todayIso = getLocalTodayIso();
    if (dashboard.date !== todayIso) return;

    const triggeredKeys = new Set<string>();

    const checkDueReminders = async () => {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();

      for (const item of dashboard.items) {
        const { medicine, log } = item;
        if (
          !medicine.reminderEnabled ||
          log.status !== 'pending' ||
          log.lastReminderSentAt
        ) {
          continue;
        }

        const [hh, mm] = medicine.reminderTime.split(':').map(Number);
        if (Number.isNaN(hh) || Number.isNaN(mm)) continue;
        const targetMinutes = hh * 60 + mm;
        const key = `${log.id}:${todayIso}:${medicine.reminderTime}`;

        // Only fire when the exact scheduled minute arrives (never retroactively)
        if (
          nowMinutes >= targetMinutes &&
          nowMinutes - targetMinutes <= 1 &&
          !triggeredKeys.has(key)
        ) {
          triggeredKeys.add(key);
          try {
            const res = await api.sendReminder({
              medicineId: medicine.id,
              logDate: todayIso,
            });
            showToast(
              res.delivery.deliveredLive
                ? `Sent scheduled Telegram reminder for ${medicine.name}.`
                : `Reminder due for ${medicine.name} — ${res.delivery.detail}`
            );
            refreshWorkspaceData(selectedDate);
          } catch {
            // Avoid interrupting UI on background send error
          }
        }
      }
    };

    checkDueReminders();
    const timer = setInterval(checkDueReminders, 20_000);
    return () => clearInterval(timer);
  }, [user, dashboard, selectedDate, refreshWorkspaceData, showToast]);

  const handleSaveProfile = async (payload: {
    fullName: string;
    phoneNumber: string;
    telegramChatId: string;
    preferredChannel: MessagingChannel;
  }) => {
    const { profile: updated } = await api.updateProfile(payload);
    setProfile(updated);
    setSkippedOnboarding(true);
    showToast('Contact profile saved.');
  };

  const handleSaveMedicine = async (payload: {
    name: string;
    dosage: string;
    reminderTime: string;
    mealPreference: MealPreference;
    scheduleType: ScheduleType;
    notes: string;
    reminderEnabled: boolean;
  }) => {
    const tzOffset = new Date().getTimezoneOffset();
    if (editingMedicine) {
      const res = await api.updateMedicine(editingMedicine.id, {
        ...payload,
        tzOffset,
      });
      showToast(
        res.nextScheduledLabel
          ? `Updated ${payload.name} — next Telegram reminder ${res.nextScheduledLabel}.`
          : `Updated ${payload.name}.`
      );
    } else {
      const res = await api.createMedicine({
        ...payload,
        tzOffset,
      });
      showToast(
        res.nextScheduledLabel
          ? `Added ${payload.name} — next Telegram reminder ${res.nextScheduledLabel}.`
          : `Added ${payload.name} to your schedule.`
      );
    }
    await refreshWorkspaceData(selectedDate);
  };

  const handleToggleReminder = async (medicine: Medicine) => {
    const nextEnabled = !medicine.reminderEnabled;
    const tzOffset = new Date().getTimezoneOffset();
    const res = await api.updateMedicine(medicine.id, {
      reminderEnabled: nextEnabled,
      tzOffset,
    });
    if (nextEnabled) {
      showToast(
        res.nextScheduledLabel
          ? `Scheduled reminder enabled for ${medicine.name} — next message ${res.nextScheduledLabel}.`
          : `Scheduled reminder enabled for ${medicine.name}.`
      );
    } else {
      showToast(`Scheduled reminder turned off for ${medicine.name}.`);
    }
    await refreshWorkspaceData(selectedDate);
  };

  const handleDeleteMedicine = async (id: number) => {
    await api.deleteMedicine(id);
    showToast('Medicine removed.');
    await refreshWorkspaceData(selectedDate);
  };

  const handleUpdateLogStatus = async (
    medicineId: number,
    status: LogStatus,
    dateOverride?: string
  ) => {
    const targetDate = dateOverride || selectedDate;
    await api.updateLogStatus({
      medicineId,
      logDate: targetDate,
      status,
    });
    if (status === 'taken') showToast('Marked dose as taken.');
    if (status === 'skipped') showToast('Marked dose as skipped.');
    if (status === 'pending') showToast('Entry undone and reset to scheduled.');
    await refreshWorkspaceData(selectedDate);
  };

  const handleSendReminder = async (medicineId: number) => {
    const res = await api.sendReminder({
      medicineId,
      logDate: selectedDate,
    });
    await refreshWorkspaceData(selectedDate);
    return res;
  };

  const handleRespondReminder = async (
    logId: number,
    choice: ReminderResponse
  ) => {
    const res = await api.respondToReminder({ logId, choice });
    await refreshWorkspaceData(selectedDate);
    if (choice === 'yes') {
      showToast(res.replyText);
    } else {
      showToast('Reminder snoozed — will message again in 1 hour.');
    }
    return res;
  };

  const handleTriggerFollowUpNow = async (logId: number) => {
    const res = await api.triggerFollowUpNow(logId);
    await refreshWorkspaceData(selectedDate);
    showToast('1-hour follow-up reminder dispatched.');
    return res;
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">Loading ClearDose...</p>
      </div>
    );
  }

  if (!user) {
    return <SignInView />;
  }

  if (!profileLoaded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm text-slate-500">Preparing your schedule...</p>
      </div>
    );
  }

  // Ask phone number right after user logs in if not yet saved
  if (profile && !profile.phoneNumber && !skippedOnboarding) {
    return (
      <PhoneOnboardingView
        profile={profile}
        onSave={handleSaveProfile}
        onSkip={() => setSkippedOnboarding(true)}
      />
    );
  }

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Calendar;
  }> = [
    { id: 'schedule', label: "Today's Schedule", icon: Calendar },
    { id: 'medicines', label: 'Medicines', icon: Pill },
    { id: 'reminders', label: 'Telegram Reminders', icon: Send },
    { id: 'history', label: 'History', icon: History },
  ];

  const pageTitleMap: Record<NavTab, string> = {
    schedule: 'Daily Medication Dashboard',
    medicines: 'Medicine Management',
    reminders: 'Telegram & WhatsApp Reminders',
    history: 'Adherence History',
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            ClearDose
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 text-teal-800'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-teal-700' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium text-slate-900 truncate">
              {profile?.fullName || user.displayName || 'Account'}
            </p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            <button
              type="button"
              onClick={() => setActiveTab('reminders')}
              className="mt-1.5 text-xs font-mono tabular-nums text-teal-700 hover:text-teal-800 cursor-pointer block truncate"
            >
              {profile?.phoneNumber || 'Add phone number'}
            </button>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-2 w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative w-64 max-w-full bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display text-lg font-bold tracking-tight text-slate-900">
                ClearDose
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                      active
                        ? 'bg-teal-50 text-teal-800'
                        : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb/title on left, single primary CTA on right */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-slate-900 truncate">
              {pageTitleMap[activeTab]}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingMedicine(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-xs sm:text-sm font-medium hover:bg-teal-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add medicine</span>
          </button>
        </header>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8">
          {activeTab === 'schedule' && (
            <DashboardView
              dashboard={dashboard}
              loading={loadingData}
              error={dataError}
              selectedDate={selectedDate}
              onChangeDate={setSelectedDate}
              onUpdateStatus={(medicineId, status) =>
                handleUpdateLogStatus(medicineId, status)
              }
              onToggleReminder={handleToggleReminder}
              onOpenAddMedicine={() => {
                setEditingMedicine(null);
                setModalOpen(true);
              }}
              onEditMedicine={(med) => {
                setEditingMedicine(med);
                setModalOpen(true);
              }}
              onDeleteMedicine={handleDeleteMedicine}
            />
          )}

          {activeTab === 'medicines' && (
            <MedicinesView
              medicines={medicines}
              loading={loadingData}
              onAdd={() => {
                setEditingMedicine(null);
                setModalOpen(true);
              }}
              onEdit={(med) => {
                setEditingMedicine(med);
                setModalOpen(true);
              }}
              onDelete={handleDeleteMedicine}
              onToggleReminder={handleToggleReminder}
            />
          )}

          {activeTab === 'reminders' && profile && (
            <RemindersView
              profile={profile}
              medicines={medicines}
              todayItems={dashboard?.items ?? []}
              messagingStatus={messagingStatus}
              onSaveProfile={handleSaveProfile}
              onSendReminder={handleSendReminder}
              onRespondReminder={handleRespondReminder}
              onTriggerFollowUpNow={handleTriggerFollowUpNow}
              onRegisterWebhook={() => api.registerTelegramWebhook()}
              onDetectChats={() => api.detectTelegramChats()}
              onSendTestTelegram={(chatId) =>
                api.sendTestTelegramMessage(chatId)
              }
            />
          )}

          {activeTab === 'history' && (
            <HistoryView
              history={history}
              loading={loadingData}
              onUndo={(medicineId, logDate) =>
                handleUpdateLogStatus(medicineId, 'pending', logDate)
              }
            />
          )}
        </main>
      </div>

      {/* Add / Edit Medicine Modal */}
      <MedicineModal
        open={modalOpen}
        editingMedicine={editingMedicine}
        onClose={() => {
          setModalOpen(false);
          setEditingMedicine(null);
        }}
        onSubmit={handleSaveMedicine}
      />

      {/* Clean Toast Feedback */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 max-w-sm bg-slate-900 text-white text-xs sm:text-sm px-4 py-3 rounded-lg shadow-lg border border-slate-800"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
