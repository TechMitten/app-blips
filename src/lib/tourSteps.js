// Guided-tour content and persistence. Pure, so the step list can be reasoned
// about (and tested) without React or the DOM.
//
// Each step names one or more `data-tour` anchors, tried in order: several
// controls only render after a first build or at wide widths, so a step falls
// back to a broader anchor rather than losing its spotlight. `view` switches
// the mobile pane before the step is measured; `placement` is the preferred
// side for the card.

import { SHORTCUT_HINTS } from './shortcuts';

// Bumped from v1 when the tour was rewritten, so people who dismissed the old
// eight-step tour are offered the new one once.
export const TOUR_KEY = 'appblips-tour-v2';

// 'dismissed' | 'completed' | null (never seen).
export function getTourState() {
  try { return localStorage.getItem(TOUR_KEY); }
  catch { return null; }
}

export function setTourState(state) {
  try { localStorage.setItem(TOUR_KEY, state); } catch { /* Optional preference. */ }
}

export function buildTourSteps({ wideScreen, firebaseEnabled, hasCode, showCodeView, studioMode }) {
  const site = studioMode === 'website';
  const noun = site ? 'site' : 'app';
  const aNoun = site ? 'a site' : 'an app';
  const steps = [];

  steps.push({
    id: 'idea',
    icon: 'idea',
    target: ['prompt'],
    view: 'chat',
    placement: 'top',
    title: 'Describe what you want',
    body: site
      ? 'Tell AppBlips who the site is for, the pages it needs, and how it should feel. Follow-up messages refine it in place.'
      : 'Tell AppBlips who the app is for and what it should do. Follow-up messages refine it in place, one change at a time.',
    tips: [
      'Attach an image or a screenshot of the preview to show what you mean.',
      'Enter sends, Shift + Enter adds a new line.',
    ],
  });

  steps.push({
    id: 'modes',
    icon: 'modes',
    target: ['mode', 'prompt'],
    view: 'chat',
    placement: 'top',
    title: 'Build, Ask, or AI',
    body: 'Tap the mode key to switch what your message does.',
    tips: [
      `Build creates or changes your ${noun}.`,
      `Ask answers questions about it without changing anything.`,
      `AI builds ${aNoun} that can use AI itself, like a chatbot, writer, or summarizer.`,
    ],
  });

  steps.push({
    id: 'preview',
    icon: 'preview',
    target: ['preview'],
    view: 'preview',
    placement: 'left',
    title: `Try it live`,
    body: `Preview runs your ${noun} for real, so you can click, type, and test as you go.${site ? ' Links between pages work, and the page strip jumps between them.' : ''}${showCodeView ? ' The Code tab shows the generated HTML.' : ''}`,
    tips: wideScreen ? undefined : ['Use Chat and Preview at the top to switch panels.'],
  });

  steps.push({
    id: 'devices',
    icon: 'devices',
    target: ['devices', 'tools', 'preview'],
    view: 'preview',
    placement: 'bottom',
    title: 'Check every screen size',
    body: wideScreen
      ? 'Switch between phone, tablet, and desktop frames. Preview tools add rotation and zoom, so you can see exactly how it fits.'
      : 'Preview tools switch between phone, tablet, and desktop frames, and add rotation and zoom.',
  });

  if (site && hasCode) {
    steps.push({
      id: 'edit',
      icon: 'edit',
      target: ['edit', 'preview'],
      view: 'preview',
      placement: 'bottom',
      title: 'Edit text directly',
      body: 'Turn on click-to-edit, then select any element in the preview to change its words, font, size, color, or alignment. No prompt needed. Saving creates a new version.',
    });
  }

  steps.push({
    id: 'versions',
    icon: 'history',
    target: ['versions', 'tools', 'history', 'preview'],
    view: 'preview',
    placement: 'bottom',
    title: 'Every change is a version',
    body: wideScreen
      ? `Step back and forward here (${SHORTCUT_HINTS.undo} / ${SHORTCUT_HINTS.redo}). History lists every checkpoint, grouped by chat session.`
      : 'Preview tools step back and forward through versions. History in the menu lists every checkpoint, grouped by chat session.',
  });

  steps.push({
    id: 'share',
    icon: 'share',
    target: ['share', 'preview'],
    view: 'preview',
    placement: 'bottom',
    title: firebaseEnabled ? 'Publish it' : 'Take it with you',
    body: firebaseEnabled
      ? `Deploy publishes your ${noun} to a public link, with optional password protection and home-screen install. Redeploy any time to push new changes.`
      : `Export downloads your ${noun}${site ? ' as a ZIP of pages' : ' as a single HTML file'}. Open launches it in a new browser tab.`,
  });

  steps.push({
    id: 'chats',
    icon: 'chats',
    target: ['newchat', 'prompt'],
    view: 'chat',
    placement: 'bottom',
    title: 'Fresh chat, same project',
    body: 'Start a new chat when the conversation gets long or you change direction. Your versions stay; the model just starts from the current code with a clean slate.',
  });

  if (wideScreen) {
    steps.push(
      {
        id: 'apps',
        icon: 'apps',
        target: ['apps'],
        placement: 'bottom',
        title: 'All your projects',
        body: `Work saves automatically. Apps (${SHORTCUT_HINTS.apps}) reopens, renames, or deletes projects; New starts another idea in the app or website studio.`,
      },
      {
        id: 'finish',
        icon: 'finish',
        target: ['tour', 'help'],
        placement: 'bottom',
        title: 'You are ready',
        body: `Try describing one small, useful ${noun}. You can replay this tour here any time.`,
        tips: [
          'Settings: theme, chat font, Code tab, reasoning effort.',
          `Help (${SHORTCUT_HINTS.help}) opens the full docs.`,
        ],
      },
    );
  } else {
    // One step for the whole drawer: highlighting the same closed hamburger
    // several times in a row reads as the tour being stuck.
    steps.push({
      id: 'finish',
      icon: 'menu',
      target: ['menu'],
      placement: 'bottom',
      title: 'Everything else is in the menu',
      body: `Try describing one small, useful ${noun} to begin.`,
      tips: [
        'Apps: reopen, rename, or delete saved projects.',
        'History, Settings, and Help live here too.',
        'Take the tour replays this walkthrough.',
      ],
    });
  }
  return steps;
}
