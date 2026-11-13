import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useTokens } from '../../../contexts/ThemeContext';
import type { ImageAttachment } from '../../../models/Chat';

const THUMB = 56;

export interface ImageThumbnailsProps {
  images: ImageAttachment[];
  onRemove: (imageId: string) => void;
  onPress?: (image: ImageAttachment) => void;
}

/** Composer row of picked images, each with a remove button. */
export function ImageThumbnails({ images, onRemove, onPress }: ImageThumbnailsProps) {
  const { colors, spacing } = useTokens();
  const { t } = useTranslation();
  return (
    <ScrollView
      testID="chat-input.images"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginBottom: spacing[2] }}
      keyboardShouldPersistTaps="handled"
    >
      {images.map((image) => (
        <View key={image.id} style={{ marginRight: spacing[2], paddingTop: 6, paddingRight: 6 }}>
          <Pressable testID={`chat-input.image.${image.id}`} accessibilityRole="imagebutton" onPress={() => onPress?.(image)}>
            <Image
              source={{ uri: image.uri }}
              contentFit="cover"
              accessibilityLabel={image.name}
              style={{ width: THUMB, height: THUMB, borderRadius: 10, backgroundColor: colors.border }}
            />
          </Pressable>
          <Pressable
            testID={`chat-input.image.remove.${image.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('chat.images.remove')}
            hitSlop={8}
            onPress={() => onRemove(image.id)}
            style={{ position: 'absolute', top: 0, right: 0 }}
          >
            <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
