import * as FileSystem from 'expo-file-system/legacy';
import type { ImageAttachment } from '../../models/Chat';
import { generateId } from '../../utils/ids';
import { chatT } from './copy';

export const MAX_IMAGES_PER_MESSAGE = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

export interface ImageSource {
  uri: string;
  mimeType?: string;
  name?: string;
  width?: number;
  height?: number;
}

function imagesRoot(): string {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) throw new Error('expo-file-system documentDirectory is not available in this environment');
  return `${docDir}chat-images/`;
}

function threadDir(threadId: string): string {
  return `${imagesRoot()}${encodeURIComponent(threadId)}/`;
}

function guessMimeType(source: ImageSource): string {
  if (source.mimeType?.startsWith('image/')) return source.mimeType;
  const match = /\.([a-z0-9]+)(?:\?|$)/i.exec(source.name ?? source.uri);
  const extension = match?.[1]?.toLowerCase();
  const found = Object.entries(EXTENSION_BY_MIME).find(([, ext]) => ext === extension || (extension === 'jpeg' && ext === 'jpg'));
  return found?.[0] ?? 'image/jpeg';
}

/** Copies a picked/captured image into the app's document directory so it outlives the picker's temp file. */
export async function saveChatImage(threadId: string, source: ImageSource): Promise<ImageAttachment> {
  const info = await FileSystem.getInfoAsync(source.uri);
  const name = source.name ?? 'image';
  if (info.exists && typeof info.size === 'number' && info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      chatT('chat.imageTooLarge', {
        name,
        max: MAX_IMAGE_BYTES / (1024 * 1024),
        defaultValue: `${name} is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`,
      }),
    );
  }
  const mimeType = guessMimeType(source);
  const id = generateId();
  const dir = threadDir(threadId);
  const uri = `${dir}${id}.${EXTENSION_BY_MIME[mimeType] ?? 'jpg'}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  await FileSystem.copyAsync({ from: source.uri, to: uri });
  return {
    id,
    uri,
    mimeType,
    ...(source.name ? { name: source.name } : {}),
    ...(source.width !== undefined ? { width: source.width } : {}),
    ...(source.height !== undefined ? { height: source.height } : {}),
  };
}

export async function deleteThreadImages(threadId: string): Promise<void> {
  await FileSystem.deleteAsync(threadDir(threadId), { idempotent: true });
}

export function readImageBase64(attachment: ImageAttachment): Promise<string> {
  return FileSystem.readAsStringAsync(attachment.uri, { encoding: FileSystem.EncodingType.Base64 });
}
