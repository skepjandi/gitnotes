import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  type NavigationContainerRefWithCurrent,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LinkingOptions } from '@react-navigation/native';

import TabNavigator from './TabNavigator';
import ChatScreen from '../screens/ChatScreen';
import GraphViewScreen from '../screens/GraphViewScreen';
import ChatThreadListScreen from '../screens/ChatThreadListScreen';
import NoteEditorScreen from '../screens/NoteEditorScreen';
import CanvasEditorScreen from '../screens/CanvasEditorScreen';
import PdfViewerScreen from '../screens/PdfViewerScreen';
import FileViewerScreen from '../screens/FileViewerScreen';
import ImageViewerScreen from '../screens/ImageViewerScreen';
import VideoViewerScreen from '../screens/VideoViewerScreen';
import RenderStyleSettingsScreen from '../screens/RenderStyleSettingsScreen';
import RenderStyleEditorScreen from '../screens/RenderStyleEditorScreen';
import TemplateManagerScreen from '../screens/TemplateManagerScreen';
import SyncStatusScreen from '../screens/SyncStatusScreen';
import { FloatingAIButton } from '../components/ai/FloatingAIButton';
import AppFloatingGitButton from '../components/git/AppFloatingGitButton';
import { ChatRepoPickerModal } from '../components/ai/ChatRepoPickerModal';
import { AddReminderScreen } from '../components/settings/AddReminderScreen';
import ThoughtDumpScreen from '../screens/ThoughtDumpScreen';
import CalendarScreen from '../screens/CalendarScreen';
import PaywallScreen from '../screens/PaywallScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import QuickSetupScreen from '../screens/QuickSetupScreen';
import OAuthCallbackScreen from '../screens/OAuthCallbackScreen';
import AppCallbackScreen from '../screens/AppCallbackScreen';
import ExploreCommitScreen from '../screens/ExploreCommitScreen';
import ExploreConflictScreen from '../screens/ExploreConflictScreen';
import ConflictResolveScreen from '../screens/ConflictResolveScreen';
import ExploreDiffScreen from '../screens/ExploreDiffScreen';
import ExploreFileScreen from '../screens/ExploreFileScreen';
import { RootStackParamList } from './types';
import { useTheme } from '../contexts/ThemeContext';
import { useAIStore } from '../stores/aiStore';
import { useAIHubStore } from '../stores/aiHubStore';
import { selectIsPro, useProStore } from '../stores/proStore';
import { useFloatingGitButtonStore } from '../stores/floatingGitButtonStore';
import { ReferralService } from '../services/ReferralService';

const Stack = createNativeStackNavigator<RootStackParamList>();
type AppNavigationRef = NonNullable<
  NavigationContainerRefWithCurrent<RootStackParamList>['current']
>;

function isAppNavigationRef(value: unknown): value is AppNavigationRef {
  if (typeof value !== 'object' || value === null) return false;
  return [
    'addListener',
    'canGoBack',
    'dispatch',
    'getCurrentRoute',
    'getRootState',
    'goBack',
    'isReady',
    'navigate',
    'reset',
  ].every((method) => typeof Reflect.get(value, method) === 'function');
}

const getLinkingConfig = (): LinkingOptions<RootStackParamList> => {
  const baseConfig: LinkingOptions<RootStackParamList> = {
    prefixes: ['gitnotes://', 'https://gitnotes.org'],
    config: {
      screens: {
        MainTabs: {
          screens: {
            HomeTab: 'home',
            NotesTab: 'notes',
            ExploreTab: 'explore',
            SettingsTab: 'settings',
            CanvasList: 'canvases',
          },
        },
        NoteEditor: 'note/:noteId',
        CanvasEditor: 'canvas/:canvasId',
        ChatThreadList: 'chat',
        ChatScreen: 'chat/:threadId',
        ThoughtDump: 'thought-dump',
        OAuthCallback: 'oauth/callback',
        AppCallback: 'app/callback',
      },
    },
  };

  if (__DEV__) {
    (baseConfig.config as NonNullable<typeof baseConfig.config>).screens.NeumorphicGallery = '__dev__/neumorphic';
  }

  return baseConfig;
};

const linking = getLinkingConfig();

interface AppNavigatorProps {
  showOnboarding?: boolean;
  onOnboardingComplete?: () => void;
  onOnboardingSkip?: () => void;
  observeNavigationContainer?: typeof import('expo-observe/integrations/react-navigation').ObserveNavigationContainer;
  observeInteractiveMarker?: typeof import('expo-observe').ObserveInteractiveMarker;
  onNavigationReady?: () => void;
}

export default function AppNavigator({
  showOnboarding,
  onOnboardingComplete,
  onOnboardingSkip,
  observeNavigationContainer,
  observeInteractiveMarker,
  onNavigationReady,
}: AppNavigatorProps) {
  const { isDark, colors } = useTheme();
  const navigationRef = useRef<AppNavigationRef | null>(null);
  const setNavigationRef = useCallback((value: unknown) => {
    navigationRef.current = isAppNavigationRef(value) ? value : null;
  }, []);
  const chatRepoOwner = useAIStore((state) => state.chatRepoOwner);
  const chatRepoName = useAIStore((state) => state.chatRepoName);
  const showChatRepoPicker = useAIHubStore((state) => state.pickerVisible);
  const openChatRepoPicker = useAIHubStore((state) => state.openChatRepoPicker);
  const closeChatRepoPicker = useAIHubStore((state) => state.closeChatRepoPicker);
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>(undefined);
  const [navigationReady, setNavigationReady] = useState(false);
  const isPro = useProStore(selectIsPro);
  const interstitialEligible = useProStore((s) => s.interstitialEligible);
  const markInterstitialShown = useProStore((s) => s.markInterstitialShown);
  const floatingGitButtonVisible = useFloatingGitButtonStore((s) => s.visible);
  const floatingGitButtonHydrated = useFloatingGitButtonStore((s) => s.hydrated);
  const hydrateFloatingGitButton = useFloatingGitButtonStore((s) => s.hydrate);

  useEffect(() => {
    void hydrateFloatingGitButton();
  }, [hydrateFloatingGitButton]);

  // Handle referral deep links: gitnotes://r/<code> and https://gitnotes.org/r/<code>
  // captureReferralUrl returns true if consumed, false otherwise.
  const handleReferralDeepLink = useCallback(async (url: string) => {
    await ReferralService.captureReferralUrl(url);
  }, []);

  // Handle AppState changes (foregrounding) to check for pending deep links
  useEffect(() => {
    const checkIncomingUrl = async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          await handleReferralDeepLink(initialUrl);
        }
      } catch { /* ignore */ }
    };
    void checkIncomingUrl();

    const subscription = Linking.addEventListener('url', (event: { url: string }) => {
      void handleReferralDeepLink(event.url);
    });
    return () => subscription.remove();
  }, [handleReferralDeepLink]);

  // Deferred interstitial: only consume the one-shot flag after confirming navigation is ready.
  // navigationReady state variable ensures re-check when onReady fires.
  const hasNavigatedToInterstitial = React.useRef(false);
  useEffect(() => {
    if (!interstitialEligible || isPro || hasNavigatedToInterstitial.current) return;
    if (!navigationRef.current?.isReady()) return;
    hasNavigatedToInterstitial.current = true;
    markInterstitialShown();
    navigationRef.current.navigate('Paywall');
  }, [interstitialEligible, isPro, markInterstitialShown, navigationRef, navigationReady]);

  useEffect(() => {
    if (showOnboarding) return;
    if (navigationRef.current?.isReady()) {
      navigationRef.current.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  }, [showOnboarding, navigationRef]);

  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };
  const hasChatRepo = Boolean(chatRepoOwner && chatRepoName);
  const Navigation = observeNavigationContainer ?? NavigationContainer;

  const handleStateChange = useCallback(() => {
    const routeName = navigationRef.current?.getCurrentRoute()?.name;
    setCurrentRouteName(routeName);

    if (routeName === 'ChatThreadList' && !hasChatRepo) {
      openChatRepoPicker();
    }
  }, [hasChatRepo, navigationRef, openChatRepoPicker]);

  const handleCloseChatRepoPicker = useCallback(() => {
    closeChatRepoPicker();

    if (navigationRef.current?.isReady() && navigationRef.current.getCurrentRoute()?.name === 'ChatThreadList' && !hasChatRepo && navigationRef.current.canGoBack()) {
      navigationRef.current.goBack();
    }
  }, [hasChatRepo, navigationRef, closeChatRepoPicker]);

  const handleChatRepoSelected = useCallback(() => {
    closeChatRepoPicker();
  }, [closeChatRepoPicker]);

  const handleGoToSettings = useCallback(() => {
    closeChatRepoPicker();

    if (navigationRef.current?.isReady()) {
      navigationRef.current.navigate('MainTabs', { screen: 'SettingsTab' });
    }
  }, [navigationRef, closeChatRepoPicker]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Navigation
        linking={linking}
        theme={navigationTheme}
        ref={setNavigationRef}
        onReady={() => {
          handleStateChange();
          setNavigationReady(true);
          onNavigationReady?.();
        }}
        onStateChange={handleStateChange}
      >
        <View style={{ flex: 1 }}>
          <Stack.Navigator
            initialRouteName={showOnboarding ? 'Onboarding' : 'MainTabs'}
            screenLayout={
              observeInteractiveMarker
                ? ({ route, children }) => (
                    <>
                      {children}
                      {navigationReady && route.name !== 'MainTabs'
                        ? React.createElement(observeInteractiveMarker)
                        : null}
                    </>
                  )
                : undefined
            }
          >
            <Stack.Screen
              name="Onboarding"
              options={{ headerShown: false }}
            >
              {() => (
                <OnboardingScreen
                  onComplete={onOnboardingComplete!}
                  onSkip={onOnboardingSkip!}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="QuickSetup"
              options={{ headerShown: false }}
            >
              {() => (
                <QuickSetupScreen
                  onComplete={onOnboardingComplete!}
                />
              )}
            </Stack.Screen>
            <Stack.Screen name="MainTabs" options={{ headerShown: false }}>
              {() => (
                <TabNavigator
                  observeInteractiveMarker={observeInteractiveMarker}
                  navigationReady={navigationReady}
                />
              )}
            </Stack.Screen>
            <Stack.Screen 
              name="NoteEditor" 
              component={NoteEditorScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="CanvasEditor"
              component={CanvasEditorScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="GraphView"
              component={GraphViewScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="PdfViewer"
              component={PdfViewerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="FileViewer"
              component={FileViewerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ImageViewer"
              component={ImageViewerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="VideoViewer"
              component={VideoViewerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ChatThreadList"
              component={ChatThreadListScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ChatScreen"
              component={ChatScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="RenderStyleSettings"
              component={RenderStyleSettingsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="RenderStyleEditor"
              component={RenderStyleEditorScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="TemplateManager"
              component={TemplateManagerScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="SyncStatus"
              component={SyncStatusScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AddReminder"
              component={AddReminderScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ThoughtDump"
              component={ThoughtDumpScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Calendar"
              component={CalendarScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Paywall"
              component={PaywallScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ExploreCommit"
              component={ExploreCommitScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ExploreDiff"
              component={ExploreDiffScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ExploreFile"
              component={ExploreFileScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ExploreConflict"
              component={ExploreConflictScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ConflictResolve"
              component={ConflictResolveScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OAuthCallback"
              component={OAuthCallbackScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AppCallback"
              component={AppCallbackScreen}
              options={{ headerShown: false }}
            />
            {__DEV__ && (
              <Stack.Screen
                name="NeumorphicGallery"
                component={require('../screens/__dev__/NeumorphicGallery').default}
                options={{ headerShown: true, title: 'Neumorphic Gallery' }}
              />
            )}
          </Stack.Navigator>
          <FloatingAIButton currentRouteName={currentRouteName} />
          {floatingGitButtonHydrated && floatingGitButtonVisible ? (
            <AppFloatingGitButton />
          ) : null}
        </View>
      </Navigation>
        <ChatRepoPickerModal
          visible={showChatRepoPicker}
          onClose={handleCloseChatRepoPicker}
          onSelected={handleChatRepoSelected}
          onGoToSettings={handleGoToSettings}
        />
    </GestureHandlerRootView>
  );
}
