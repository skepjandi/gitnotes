import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * English source for every onboarding string. Keys live under
 * `onboarding.tour.*` in the locale files; `en.json` must mirror this object
 * (enforced by a unit test). Other locales fall back to English.
 */
export const TOUR_COPY = {
  skip: 'Skip',
  back: 'Back',
  stepOf: 'Step {{current}} of {{total}}',
  proBadge: 'PRO',
  reportIssue: 'Found a bug or have a feature request?',
  reportIssueLink: 'Report it on GitHub Issues',

  'welcome.chipMarkdown': 'Markdown notes',
  'welcome.chipGit': 'Your Git repos',
  'welcome.chipAI': 'AI built in',

  'notes.eyebrow': 'Your notes, your repo',
  'notes.title': 'Notes that live in Git',
  'notes.body':
    'Every note is a plain file in a repository you own. GitNotēs commits and syncs it for you, so your notes are versioned, portable and never locked in.',
  'notes.stageEdit': 'Edit a note',
  'notes.stageCommit': 'Committed on your device',
  'notes.stagePush': 'Pushed to your repo',
  'notes.nodeNote': 'Note',
  'notes.nodeCommit': 'Commit',
  'notes.nodeRepo': 'Repo',
  'notes.hosts': 'GitHub · GitLab · Gitea · Forgejo',
  'notes.p1.lead': 'Write anywhere',
  'notes.p1.text': 'Markdown, Org or Neorg, saved as ordinary files in your repository.',
  'notes.p2.lead': 'Works offline',
  'notes.p2.text': 'Edits are committed on your device and pushed as soon as you are back online.',
  'notes.p3.lead': 'Nothing is lost',
  'notes.p3.text': 'Browse history, diffs and branches in the Git tab. Conflicts are resolved in the app.',

  'tabs.eyebrow': 'Find your way around',
  'tabs.title': 'Five tabs, one workspace',
  'tabs.body': 'Everything lives behind the tab bar. Here is what each tab is for.',
  'tabs.home.lead': 'Home',
  'tabs.home.text': 'Start a note, journal or canvas in one tap. Your daily quote lives here.',
  'tabs.notes.lead': 'Notes',
  'tabs.notes.text': 'Browse, search, pin and organize every note by folder and tag.',
  'tabs.git.lead': 'Git',
  'tabs.git.text': 'Your repositories: pending changes, history, branches and conflicts.',
  'tabs.todos.lead': 'Todos',
  'tabs.todos.text': 'Tasks and checklists that sit alongside your notes.',
  'tabs.settings.lead': 'Settings',
  'tabs.settings.text': 'Accounts, repositories, themes, AI and GitNotēs Pro.',

  'git.eyebrow': 'The Git button',
  'git.title': 'Sync with one thumb',
  'git.body':
    'The round button floating over your notes is your shortcut for Git. It works across every connected repository.',
  'git.captionIdle': '3 changes waiting',
  'git.captionStage': 'Release now to Stage',
  'git.captionCommit': 'Release now to Commit',
  'git.captionPush': 'Hold to the end to Push',
  'git.captionDone': 'All synced',
  'git.stepStage': 'Stage',
  'git.stepCommit': 'Commit',
  'git.stepPush': 'Push',
  'git.legendChanges': 'Changes',
  'git.legendStaged': 'Staged',
  'git.legendUnpushed': 'Unpushed',
  'git.legendSynced': 'Synced',
  'git.p1.lead': 'Tap to review',
  'git.p1.text': 'Jumps to your pending changes, staged files or unpushed commits.',
  'git.p2.lead': 'Hold to sync',
  'git.p2.text':
    'A ring fills over about 3 seconds. Release in the first third to Stage, the second to Commit, or hold to the end to Push.',
  'git.p3.lead': 'Colour tells the state',
  'git.p3.text': 'Green for changes, amber for staged, accent for unpushed, grey when synced, red for a conflict.',
  'git.p4.lead': 'Not for you?',
  'git.p4.text': 'Hide it any time in Settings → Show floating git button.',

  'ai.eyebrow': 'GitNotēs AI',
  'ai.title': 'An assistant that knows your notes',
  'ai.body':
    'The sparkle button is your way into AI. Chat about your notes, todos and canvases, dump a thought, or dictate one by voice.',
  'ai.captionIdle': 'Tap: start a new chat',
  'ai.captionHold': 'Hold…',
  'ai.captionOpen': 'The hub opens',
  'ai.itemNewChat': 'New chat',
  'ai.itemVoice': 'Voice dump',
  'ai.itemHistory': 'Chat history',
  'ai.itemSettings': 'AI settings',
  'ai.itemThought': 'Thought dump',
  'ai.p1.lead': 'Tap to chat',
  'ai.p1.text': 'Starts a new chat with your notes, todos and canvases as context.',
  'ai.p2.lead': 'Hold for the hub',
  'ai.p2.text': 'New chat, history, thought dump, voice dump and AI settings. Drag the button wherever suits you.',
  'ai.p3.lead': 'You stay in control',
  'ai.p3.text': 'AI only edits when you allow it, and you can turn it off any time in Settings → AI.',
  'ai.p4.lead': 'Part of Pro',
  'ai.p4.text': 'AI chat and thought and voice dump are included in GitNotēs Pro.',

  'capture.eyebrow': 'Capture & create',
  'capture.title': 'More than a notes list',
  'capture.body': 'A few more ways to get ideas out of your head and into your repo.',
  'capture.thought.lead': 'Thought Dump',
  'capture.thought.text': 'Fleeting ideas, saved as Markdown',
  'capture.journal.lead': 'Journal',
  'capture.journal.text': 'A note per day, plus a calendar',
  'capture.canvas.lead': 'Canvases',
  'capture.canvas.text': 'Draw, chart and diagram',
  'capture.templates.lead': 'Templates',
  'capture.templates.text': 'Start notes from a template',
  'capture.reminders.lead': 'Reminders',
  'capture.reminders.text': 'Get nudged to open a note',
  'capture.links.lead': 'Links & graph',
  'capture.links.text': 'Connect notes with [[links]]',
  'capture.footnote': 'PRO marks features included in GitNotēs Pro.',

  'pro.title': 'Free to start, Pro to go further',
  'pro.freeBody': '1 account and 1 repository, with notes and Git sync.',
  'pro.proTitle': 'GitNotēs Pro',
  'pro.ai': 'AI chat',
  'pro.dump': 'Thought and voice dump',
  'pro.quotes': 'Personalized quotes',
  'pro.canvases': 'Canvases',
  'pro.templates': 'Templates',
  'pro.more': 'More repositories and accounts',
  'pro.reminder': 'You can upgrade any time in Settings → GitNotēs Pro.',
  'pro.settings': 'Open Settings',
} as const;

export type TourCopyKey = keyof typeof TOUR_COPY;

export function useTourText(): (key: TourCopyKey, params?: Record<string, string | number>) => string {
  const { t } = useTranslation();
  return useCallback(
    (key, params) => t(`onboarding.tour.${key}`, { defaultValue: TOUR_COPY[key], ...params }),
    [t],
  );
}
