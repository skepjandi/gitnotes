import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AIHubDemo } from './AIHubDemo';
import { CaptureDemo } from './CaptureDemo';
import { GitButtonDemo } from './GitButtonDemo';
import { NotesInGitDemo } from './NotesInGitDemo';
import { TabsDemo, TOUR_TABS } from './TabsDemo';
import { TourPage, type TourPoint } from './TourPage';
import { useTourText } from './tourCopy';
import { useDemoStage } from './useDemoStage';

export const TOUR_PAGE_IDS = ['notes', 'tabs', 'git', 'ai', 'capture'] as const;
export type TourPageId = (typeof TOUR_PAGE_IDS)[number];

function TabsPage() {
  const tx = useTourText();
  const reduceMotion = useReducedMotion();
  const active = useDemoStage({ stages: TOUR_TABS.length, stepMs: 1500, endDwellMs: 1500, reduceMotion });
  const points: readonly TourPoint[] = [
    { icon: 'home-outline', lead: tx('tabs.home.lead'), text: tx('tabs.home.text') },
    { icon: 'document-text-outline', lead: tx('tabs.notes.lead'), text: tx('tabs.notes.text') },
    { icon: 'git-branch-outline', lead: tx('tabs.git.lead'), text: tx('tabs.git.text') },
    { icon: 'checkbox-outline', lead: tx('tabs.todos.lead'), text: tx('tabs.todos.text') },
    { icon: 'settings-outline', lead: tx('tabs.settings.lead'), text: tx('tabs.settings.text') },
  ];
  return (
    <TourPage
      testID="onboarding.page.tabs"
      eyebrow={tx('tabs.eyebrow')}
      title={tx('tabs.title')}
      body={tx('tabs.body')}
      demo={<TabsDemo activeIndex={active} />}
      points={points}
      highlightIndex={reduceMotion ? undefined : active}
    />
  );
}

function NotesPage() {
  const tx = useTourText();
  return (
    <TourPage
      testID="onboarding.page.notes"
      eyebrow={tx('notes.eyebrow')}
      title={tx('notes.title')}
      body={tx('notes.body')}
      demo={<NotesInGitDemo />}
      points={[
        { icon: 'create-outline', lead: tx('notes.p1.lead'), text: tx('notes.p1.text') },
        { icon: 'cloud-offline-outline', lead: tx('notes.p2.lead'), text: tx('notes.p2.text') },
        { icon: 'time-outline', lead: tx('notes.p3.lead'), text: tx('notes.p3.text') },
      ]}
    />
  );
}

function GitPage() {
  const tx = useTourText();
  return (
    <TourPage
      testID="onboarding.page.git"
      eyebrow={tx('git.eyebrow')}
      title={tx('git.title')}
      body={tx('git.body')}
      demo={<GitButtonDemo />}
      points={[
        { icon: 'hand-left-outline', lead: tx('git.p1.lead'), text: tx('git.p1.text') },
        { icon: 'timer-outline', lead: tx('git.p2.lead'), text: tx('git.p2.text') },
        { icon: 'color-palette-outline', lead: tx('git.p3.lead'), text: tx('git.p3.text') },
        { icon: 'eye-off-outline', lead: tx('git.p4.lead'), text: tx('git.p4.text') },
      ]}
    />
  );
}

function AIPage() {
  const tx = useTourText();
  return (
    <TourPage
      testID="onboarding.page.ai"
      eyebrow={tx('ai.eyebrow')}
      title={tx('ai.title')}
      body={tx('ai.body')}
      demo={<AIHubDemo />}
      points={[
        { icon: 'chatbubble-ellipses-outline', lead: tx('ai.p1.lead'), text: tx('ai.p1.text') },
        { icon: 'apps-outline', lead: tx('ai.p2.lead'), text: tx('ai.p2.text') },
        { icon: 'shield-checkmark-outline', lead: tx('ai.p3.lead'), text: tx('ai.p3.text') },
        { icon: 'sparkles-outline', lead: tx('ai.p4.lead'), text: tx('ai.p4.text'), pro: true },
      ]}
    />
  );
}

function CapturePage() {
  const tx = useTourText();
  return (
    <TourPage
      testID="onboarding.page.capture"
      eyebrow={tx('capture.eyebrow')}
      title={tx('capture.title')}
      body={tx('capture.body')}
      demo={<CaptureDemo />}
      footnote={tx('capture.footnote')}
    />
  );
}

const PAGES: Record<TourPageId, () => React.JSX.Element> = {
  notes: NotesPage,
  tabs: TabsPage,
  git: GitPage,
  ai: AIPage,
  capture: CapturePage,
};

interface OnboardingTourProps {
  readonly page: TourPageId;
}

export function OnboardingTour({ page }: OnboardingTourProps) {
  const Page = PAGES[page];
  return <Page />;
}
