import { useCallback, useMemo, useState } from 'react';
import type { ImageAttachment } from '../../../models/Chat';
import { saveChatImage } from '../../../services/chat/imageStorage';

export const MAX_IMAGES = 5;

export type ImageSource = 'library' | 'camera';

export interface ImageAttachments {
  images: ImageAttachment[];
  /** Opens the picker; resolves with the failure kind (camera permission denied, or picking/saving threw), else `null`. */
  pick: (source: ImageSource) => Promise<'permission' | 'failed' | null>;
  remove: (imageId: string) => void;
  clear: () => void;
}

/** Images staged in the composer for the next agent prompt, persisted to app storage as they are picked. */
export function useImageAttachments(threadId: string): ImageAttachments {
  const [images, setImages] = useState<ImageAttachment[]>([]);

  const pick = useCallback(
    async (source: ImageSource) => {
      const remaining = MAX_IMAGES - images.length;
      if (remaining <= 0) return null;
      try {
        const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');
        let result: Awaited<ReturnType<typeof ImagePicker.launchCameraAsync>>;
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) return 'permission';
          result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
        } else {
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 0.8,
          });
        }
        if (result.canceled) return null;
        const saved = await Promise.all(
          result.assets.slice(0, remaining).map((asset) =>
            saveChatImage(threadId, {
              uri: asset.uri,
              mimeType: asset.mimeType,
              name: asset.fileName ?? undefined,
              width: asset.width,
              height: asset.height,
            }),
          ),
        );
        setImages((current) => [...current, ...saved].slice(0, MAX_IMAGES));
        return null;
      } catch {
        return 'failed';
      }
    },
    [images.length, threadId],
  );

  const remove = useCallback(
    (imageId: string) => setImages((current) => current.filter((image) => image.id !== imageId)),
    [],
  );
  const clear = useCallback(() => setImages([]), []);

  return useMemo(() => ({ images, pick, remove, clear }), [images, pick, remove, clear]);
}
