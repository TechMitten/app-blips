import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, ListChecks } from 'lucide-react';
import { SettingRow, Switch, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import SeoQuestionsModal from './SeoQuestionsModal';
import { isSeoComplete, seoPending } from '../lib/seo';

// Settings → Connectors → SEO. The switch, plus where this project's answers
// stand. The questions themselves have their own dialog (SeoQuestionsModal.jsx),
// which opens by itself the first time SEO is turned on for a project with no
// answers yet.
export default function SeoConnector({ state, onChange, seoProject }) {
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const answered = Boolean(seoProject?.profile?.form && isSeoComplete(seoProject.profile.form));
  const pending = answered && seoPending({ enabled: true, profile: seoProject.profile, sessionId: seoProject.sessionId });

  const toggle = (enabled) => {
    onChange({ enabled });
    if (enabled && seoProject && !answered) setQuestionsOpen(true);
  };

  return (
    <>
      <SettingRow
        id="set-seo"
        title="Enable SEO"
        description="Answer a few questions about the project you have open, and the AI will apply good SEO to it."
      >
        <Switch checked={state.enabled} onChange={toggle} labelledBy="set-seo" />
      </SettingRow>
      {state.enabled && (seoProject
        ? (
          <SettingRow
            id="set-seo-answers"
            title="Your answers"
            description={answered
              ? pending
                ? 'Saved. The AI will use them with your next request.'
                : 'Saved, and the AI already has them.'
              : 'You haven’t answered the questions for this project yet.'}
          >
            <button
              type="button"
              onClick={() => setQuestionsOpen(true)}
              className={answered ? SECONDARY_BUTTON : PRIMARY_BUTTON}
            >
              {answered
                ? <><CircleCheck size={15} aria-hidden="true" />Review answers</>
                : <><ListChecks size={15} aria-hidden="true" />Answer the questions</>}
            </button>
          </SettingRow>
        )
        : (
          <p className="py-4 text-sm leading-snug text-slate-600">
            Open or start a project first. The answers belong to one project, so each can have its own.
          </p>
        ))}
      {/* Portaled out of the settings card: a fixed overlay inside it would be
          clipped by the card's overflow. */}
      {questionsOpen && seoProject && createPortal(
        <SeoQuestionsModal project={seoProject} onClose={() => setQuestionsOpen(false)} />,
        document.body,
      )}
    </>
  );
}
