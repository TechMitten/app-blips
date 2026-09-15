import { useState } from 'react';
import { Sparkles, ToggleRight, KeyRound, ShieldCheck, MessageSquare } from 'lucide-react';
import Modal from './Modal';

// Explainer shown each time the AI switch in the prompt footer is turned on.
// It's plain-language on purpose: the switch only unlocks an API
// (`blip.ai.text`) inside generated apps, which is not obvious from the label.
// The checkbox lets the user opt out of seeing it again.
//
// `mode` is the safe public value from lib/generatedAiMode; only the setup row
// differs -- hosted/relay users get no key of their own, BYOK users provide one.
// `onClose(neverShowAgain)` reports whether the opt-out was ticked.

function Point({ icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600"
        aria-hidden="true"
      >
        {Icon && <Icon size={15} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900 leading-snug">{title}</p>
        <p className="text-sm text-slate-600 leading-relaxed mt-0.5">{children}</p>
      </div>
    </div>
  );
}

export default function AiIntroModal({ mode = 'byok', onClose }) {
  const usesOwnKey = mode === 'byok';
  const [neverShowAgain, setNeverShowAgain] = useState(false);

  return (
    <Modal
      zIndex={70}
      cardProps={{ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ai-intro-title' }}
    >
      <div className="px-6 py-5 border-b border-slate-100 flex items-start gap-3.5">
        <div className="w-10 h-10 shrink-0 brand-mark rounded-xl flex items-center justify-center text-white">
          <Sparkles size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2 id="ai-intro-title" className="text-base 2xl:text-lg font-semibold text-slate-900">
            AI in your apps
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            What the AI switch turns on.
          </p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <p className="text-sm text-slate-600 leading-relaxed">
          The AI switch lets the apps you build use AI. With it on, an app you make can
          ask an AI to read or write text &mdash; for example, summarize a note, draft a
          reply, or answer a question someone types.
        </p>

        <Point icon={ToggleRight} title="Nothing happens until your app uses it">
          Turning this on doesn&rsquo;t call the AI by itself. It only lets your app do so
          when someone uses that part of it. You can switch it back off any time.
        </Point>

        <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface border border-indigo-100 text-indigo-600"
              aria-hidden="true"
            >
              <MessageSquare size={15} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 leading-snug">
                Ask for it in your prompt
              </p>
              <p className="text-sm text-slate-600 leading-relaxed mt-0.5">
                The switch on its own doesn&rsquo;t add AI to an app. Describe the AI part
                like any other feature when you build or update it, in your own words:
              </p>
            </div>
          </div>
          <ul className="space-y-1.5 sm:pl-11">
            {[
              'A notes app that summarizes each note with AI.',
              'A study helper that quizzes me on any topic.',
              'A chatbot that answers questions about text I paste in.',
            ].map((example) => (
              <li
                key={example}
                className="rounded-lg border border-indigo-100 bg-surface px-3 py-2 text-sm text-slate-700 leading-relaxed"
              >
                {example}
              </li>
            ))}
          </ul>
        </div>

        {usesOwnKey ? (
          <Point icon={KeyRound} title="You add your own AI service">
            The first time an app needs AI, you&rsquo;ll be asked for your AI service
            address, a model name, and a key. Those stay in this browser &mdash; they
            aren&rsquo;t saved into your app and aren&rsquo;t sent to AppBlips.
          </Point>
        ) : (
          <Point icon={ShieldCheck} title="Nothing to set up">
            AI calls are handled for you, so there&rsquo;s no key to add or service to
            choose. You and your visitors never see any account details.
          </Point>
        )}
      </div>

      <div className="bg-slate-50 px-6 py-4 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={neverShowAgain}
            onChange={(e) => setNeverShowAgain(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Don&rsquo;t show this again
        </label>
        <button
          type="button"
          onClick={() => onClose(neverShowAgain)}
          className="brand-fill-text rounded-lg px-5 py-2 font-semibold text-sm bg-brand text-white hover:bg-brand-hover shadow-sm transition-colors active:scale-[0.98] cursor-pointer"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}
