import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, Check, Clock, Send } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';

const HERO_IMAGE_PATH =
  '/src/assets/images/login_calm_morning_1795245144037.jpg';

export function SignInView() {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to complete sign in. Please try again.';
      setError(message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:grid lg:grid-cols-12 items-stretch">
      <div className="lg:col-span-6 xl:col-span-5 flex flex-col justify-between px-6 py-8 sm:px-12 lg:px-16 lg:py-12 bg-white border-b lg:border-b-0 lg:border-r border-slate-200">
        <div className="flex items-center justify-between">
          <span className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap">
            ClearDose
          </span>
        </div>

        <div className="my-12 lg:my-0 max-w-md">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 leading-[1.15] text-balance">
            Daily medication tracking with timely Telegram check-ins.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-600">
            Organize before-meal and after-meal doses across daily, weekday, or
            weekend schedules, record adherence in one click, and confirm doses
            directly through Telegram with automatic 1-hour snooze follow-ups.
          </p>

          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            <div className="py-3.5 flex items-start gap-3">
              <Clock className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">
                  Chronological daily schedule
                </span>{' '}
                — track scheduled, taken, and remaining doses with instant undo.
              </div>
            </div>
            <div className="py-3.5 flex items-start gap-3">
              <Send className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">
                  Interactive Telegram reminders
                </span>{' '}
                — reply Yes, No, or Will take later with automatic 1-hour
                re-messaging.
              </div>
            </div>
            <div className="py-3.5 flex items-start gap-3">
              <Check className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" />
              <div className="text-sm text-slate-700">
                <span className="font-medium text-slate-900">
                  Persistent PostgreSQL ledger
                </span>{' '}
                — securely linked to your account across sessions.
              </div>
            </div>
          </div>

          <div className="mt-8">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3 rounded-lg bg-teal-700 text-white text-sm font-medium hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
            >
              <span>
                {signingIn ? 'Signing in...' : 'Sign in with Google'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {error && (
              <p
                role="alert"
                className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3.5 py-2.5"
              >
                {error}
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-500">
          Your phone number and Telegram Chat ID are requested right after sign
          in to enable medication check-ins.
        </p>
      </div>

      <div className="lg:col-span-6 xl:col-span-7 relative min-h-[300px] lg:min-h-screen bg-slate-200 overflow-hidden">
        {!imageFailed ? (
          <img
            src={HERO_IMAGE_PATH}
            alt="Ceramic glass of water beside a matte sage weekly pill organizer in morning sunlight"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="w-full h-full lg:h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 via-teal-50/40 to-slate-200 p-12">
            <div className="max-w-sm text-center">
              <p className="font-display text-lg font-semibold text-slate-800">
                ClearDose
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Calm, structured daily medication adherence.
              </p>
            </div>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/15 to-transparent flex items-end p-8 sm:p-12">
          <div className="max-w-lg text-white">
            <p className="font-mono text-xs tracking-wide text-slate-200 tabular-nums">
              08:00 AM · Before Meal · Daily
            </p>
            <p className="mt-2 font-display text-xl sm:text-2xl font-medium leading-snug text-balance">
              &ldquo;Have you taken your medicine?&rdquo; — one tap to log your
              dose, or snooze automatically for one hour.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
