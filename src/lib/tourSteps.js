// Guided-tour content and persistence. Pure, so the step list can be reasoned
// about (and tested) without React or the DOM.
//
// Each step names one or more `data-tour` anchors, tried in order: several
// controls only render after a first build or at wide widths, so a step falls
// back to a broader anchor rather than losing its spotlight. `view` switches
// the mobile pane before the step is measured; `placement` is the preferred
// side for the card.

import { SHORTCUT_HINTS } from './shortcuts.js';

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

export function buildTourSteps({ wideScreen, hasCode, showCodeView, studioMode }) {
  const site = studioMode === 'website';
  const game = studioMode === 'game';
  // An imported React + Vite project: no page strip, no Publish or Open, and
  // Export hands back the whole project as a .zip.
  const codebase = studioMode === 'codebase';
  const noun = site || codebase ? 'site' : game ? 'game' : 'app';
  const steps = [];

  steps.push({
    id: 'idea',
    icon: 'idea',
    target: ['prompt'],
    view: 'chat',
    placement: 'top',
    title: 'Describe what you want',
    body: codebase
      ? 'Tell AppBlips what to change in your imported site. It reads and edits the project\'s real files, one change at a time.'
      : site
        ? 'Tell AppBlips who the site is for, the pages it needs, and how it should feel. Follow-up messages refine it in place.'
        : `Tell AppBlips who the ${noun} is for and what it should do. Follow-up messages refine it in place, one change at a time.`,
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
    title: 'Build or Ask',
    body: 'Tap the mode key to switch what your message does.',
    tips: [
      `Build creates or changes your ${noun}.`,
      'Ask answers questions about it without changing anything.',
    ],
  });

  steps.push({
    id: 'preview',
    icon: 'preview',
    target: ['preview'],
    view: 'preview',
    placement: 'left',
    title: `Try it live`,
    body: `Preview runs your ${noun} for real, so you can click, type, and test as you go.${site ? ' Links between pages work, and the page menu jumps between them.' : ''}${codebase ? ' The Files tab shows the project\'s files.' : showCodeView ? ' The Code tab shows the generated HTML.' : ''}`,
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
      ? 'Switch between phone, tablet, and desktop frames. Beside them, rotate a phone or tablet, use Full size to fill the whole preview area, or reload. Zoom sits on the right.'
      : 'Preview tools switch between phone, tablet, and desktop frames, and add rotation, Full size, and zoom.',
  });

  if (site && hasCode) {
    steps.push({
      id: 'edit',
      icon: 'edit',
      target: ['edit', 'preview'],
      view: 'preview',
      placement: 'bottom',
      title: 'Edit text directly',
      body: 'Turn on click-to-edit, then select any element in the preview to change its words, font, color, links or images, or to duplicate or delete it. Turn on drag mode (the move icon beside it) to drag elements anywhere on the page. No prompt needed. Every change is saved as a new version.',
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

  steps.push(codebase
    ? {
      id: 'share',
      icon: 'share',
      target: ['share', 'preview'],
      view: 'preview',
      placement: 'bottom',
      title: 'Take it with you',
      body: 'Export downloads the whole project as a .zip, ready for npm install. Files you did not change come back exactly as they were.',
    }
    : {
      id: 'share',
      icon: 'share',
      target: ['publish', 'share', 'preview'],
      view: 'preview',
      placement: 'bottom',
      title: 'Share it or take it with you',
      body: `Publish puts your ${noun} online at a free surge.sh address you can send to anyone.`,
      tips: [
        `Export (the download key) saves it${site ? ' as a ZIP of pages' : ' as a single HTML file'}.`,
        ...(studioMode === 'app' ? ['React apps can also download as a React project to keep building with npm.'] : []),
        'Open in a new tab runs it in your browser.',
      ],
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
        body: `Work saves automatically. Apps (${SHORTCUT_HINTS.apps}) reopens, renames, or deletes projects; New starts another idea in the app, website, or game studio, or imports a site from a .zip.`,
      },
      {
        id: 'finish',
        icon: 'finish',
        target: ['tour', 'help'],
        placement: 'bottom',
        title: 'You are ready',
        body: `${codebase ? 'Try asking for one small change' : `Try describing one small, useful ${noun}`}. You can replay this tour here any time.`,
        tips: [
          'Settings: theme, chat font, Code tab, AI provider and reasoning.',
          'Settings → Connectors adds services like contact forms, payments, analytics, live chat, and AI images.',
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
      body: `${codebase ? 'Try asking for one small change' : `Try describing one small, useful ${noun}`} to begin.`,
      tips: [
        'Apps: reopen, rename, or delete saved projects.',
        'History, Settings (including Connectors), and Help live here too.',
        'Take the tour replays this walkthrough.',
      ],
    });
  }
  return steps;
}
