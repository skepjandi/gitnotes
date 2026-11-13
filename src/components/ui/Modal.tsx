import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal as RNModal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Surface } from './Surface';
import { useTheme, useTokens } from '../../contexts/ThemeContext';

export interface ModalProps {
  visible: boolean;
  onRequestClose: () => void;
  dismissOnBackdrop?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
  fullWidth?: boolean;
  bottomSheet?: boolean;
  accessibilityLabel?: string;
}

export function Modal(props: ModalProps) {
  const {
    visible,
    onRequestClose,
    dismissOnBackdrop = true,
    contentStyle,
    children,
    fullWidth = false,
    bottomSheet = false,
    accessibilityLabel,
  } = props;
  const { isDark } = useTheme();
  const { spacing, colors } = useTokens();
  const { height: viewportHeight } = useWindowDimensions();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();

  const pad = spacing[5];
  const slotHeight = Math.max(0, viewportHeight - pad * 2 - topInset);
  const bottomSheetSlotHeight = Math.max(0, slotHeight - topInset);

  const bgColor = colors.elevated;

  const surfaceStyle: ViewStyle = bottomSheet
    ? {
        backgroundColor: bgColor,
        maxHeight: bottomSheetSlotHeight,
        paddingBottom: bottomInset,
        overflow: 'hidden',
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }
    : fullWidth
    ? {
        width: '100%',
        padding: pad,
        maxHeight: slotHeight,
        backgroundColor: bgColor,
        overflow: 'hidden',
      }
    : {
        padding: pad,
        maxHeight: slotHeight,
        backgroundColor: bgColor,
      };

  return (
    <RNModal
      visible={visible}
      transparent
      animationType={bottomSheet ? 'slide' : 'fade'}
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      <BlurView
        intensity={40}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={dismissOnBackdrop ? onRequestClose : undefined}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.18)' }]}
        />
        <View
          pointerEvents="box-none"
          style={
            bottomSheet
              ? { flex: 1, width: '100%', justifyContent: 'flex-end' }
              : {
                  flex: 1,
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: pad,
                }
          }
        >
          {bottomSheet ? (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                justifyContent: 'flex-end',
              }}
            >
              <Surface
                elevation="floating"
                radius="lg"
                style={[surfaceStyle, contentStyle]}
                accessible
                accessibilityLabel={accessibilityLabel}
              >
                {children}
              </Surface>
            </KeyboardAvoidingView>
          ) : (
            <Surface
              elevation="floating"
              radius="lg"
              style={[surfaceStyle, contentStyle]}
              accessible
              accessibilityLabel={accessibilityLabel}
            >
              {children}
            </Surface>
          )}
        </View>
      </View>
    </RNModal>
  );
}
