import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { ImageAttachment } from '../../../models/Chat';
import ImageZoomRotate from '../../ImageZoomRotate';

export interface ImageViewerModalProps {
  image: ImageAttachment | null;
  onClose: () => void;
}

export function ImageViewerModal({ image, onClose }: ImageViewerModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={image !== null} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView testID="chat-image-viewer" style={{ flex: 1, backgroundColor: '#000000' }}>
        <Pressable
          testID="chat-image-viewer.close"
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          hitSlop={12}
          style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 2 }}
        >
          <Ionicons name="close" size={28} color="#ffffff" />
        </Pressable>
        {image ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <ImageZoomRotate>
              <Image
                source={{ uri: image.uri }}
                style={{ width: '100%', height: '100%' }}
                contentFit="contain"
                accessibilityLabel={image.name}
              />
            </ImageZoomRotate>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
