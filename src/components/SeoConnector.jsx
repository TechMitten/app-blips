import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, ListChecks, Send } from 'lucide-react';
import { SettingRow, Switch, PRIMARY_BUTTON, SECONDARY_BUTTON } from './SettingControls';
import SeoQuestionsModal from './SeoQuestionsModal';
import { isSeoComplete, seoPending } from '../lib/seo';

// Settings → Tools → SEO. The switch, plus where this project's answers
// stand. Both belong to the open project (seoProject, from App.jsx), not to
// the shared connector settings: with no project open the switch is off and
// can't be used. The questions themselves have their own dialog (SeoQuestionsModal.jsx),
// which opens by itself the first time SEO is turned on for a project with no
// answers yet.
export default function SeoConnector({ seoProject }) {
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const answered = Boolean(seoProject?.profile?.form && isSeoComplete(seoProject.profile.form));
  const pending = answered && seoPending({ enabled: true, profile: seoProject.profile, sessionId: seoProject.sessionId });

  const enabled = Boolean(seoProject?.enabled);

  const toggle = (on) => {
    if (!seoProject) return;
    seoProject.onToggle(on);
    if (on && !answered) setQuestionsOpen(true);
  };

  return (
    <>
      <SettingRow
        id="set-seo"
        title="Enable SEO"
        description="For the project you have open. Answer a few questions about it, and the AI will apply good SEO to it. Each project has its own switch and answers."
      >
        <Switch checked={enabled} onChange={toggle} disabled={!seoProject} labelledBy="set-seo" />
      </SettingRow>
      {seoProject
        ? enabled && (
          <SettingRow
            id="set-seo-answers"
            title="Your answers"
            description={answered
              ? pending
                ? 'Saved. The AI will use them with your next request, or apply them now.'
                : 'Saved, and the AI already has them.'
              : 'You haven’t answered the questions for this project yet.'}
          >
            {pending && seoProject.hasCode && (
              <button type="button" onClick={seoProject.onApply} disabled={seoProject.busy} className={`mr-2 ${PRIMARY_BUTTON}`}>
                <Send size={15} aria-hidden="true" />Apply now
              </button>
            )}
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
            Open or start a project first. SEO is set up for one project at a time, so each can have its own.
          </p>
        )}
      {/* Portaled out of the settings card: a fixed overlay inside it would be
          clipped by the card's overflow. */}
      {questionsOpen && seoProject && createPortal(
        <SeoQuestionsModal project={seoProject} onClose={() => setQuestionsOpen(false)} />,
        document.body,
      )}
    </>
  );
}
