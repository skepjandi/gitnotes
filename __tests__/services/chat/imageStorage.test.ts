import * as FileSystem from 'expo-file-system/legacy';
import {
  MAX_IMAGE_BYTES,
  deleteThreadImages,
  readImageBase64,
  saveChatImage,
} from '../../../src/services/chat/imageStorage';
import { emitThreadRemoved } from '../../../src/services/chat/threadEvents';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 1024 })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => 'BASE64'),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const fs = FileSystem as unknown as {
  getInfoAsync: jest.Mock;
  makeDirectoryAsync: jest.Mock;
  copyAsync: jest.Mock;
  deleteAsync: jest.Mock;
  readAsStringAsync: jest.Mock;
};

describe('imageStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
  });

  it('copies the image into the thread folder of the document directory', async () => {
    const attachment = await saveChatImage('thread 1', { uri: 'file:///tmp/pic.png', mimeType: 'image/png', name: 'pic.png' });

    expect(fs.makeDirectoryAsync).toHaveBeenCalledWith('file:///documents/chat-images/thread%201/', { intermediates: true });
    expect(fs.copyAsync).toHaveBeenCalledWith({
      from: 'file:///tmp/pic.png',
      to: expect.stringContaining('file:///documents/chat-images/thread%201/'),
    });
    expect(attachment).toMatchObject({ uri: expect.stringContaining('file:///documents/chat-images/thread%201/'), mimeType: 'image/png', name: 'pic.png' });
    expect(attachment.uri.endsWith('.png')).toBe(true);
  });

  it('guesses the mime type from the file name', async () => {
    const attachment = await saveChatImage('t', { uri: 'file:///tmp/pic.jpeg' });
    expect(attachment.mimeType).toBe('image/jpeg');
    expect(attachment.uri.endsWith('.jpg')).toBe(true);
  });

  it('refuses an image that is too large', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: true, size: MAX_IMAGE_BYTES + 1 });
    await expect(saveChatImage('t', { uri: 'file:///tmp/big.png', name: 'big.png' })).rejects.toThrow(/big\.png is larger than 5 MB/);
    expect(fs.copyAsync).not.toHaveBeenCalled();
  });

  it('reads an attachment as base64', async () => {
    await expect(readImageBase64({ id: 'i', uri: 'file:///documents/chat-images/t/i.png', mimeType: 'image/png' })).resolves.toBe('BASE64');
    expect(fs.readAsStringAsync).toHaveBeenCalledWith('file:///documents/chat-images/t/i.png', { encoding: 'base64' });
  });

  it('deletes the images of a thread', async () => {
    await deleteThreadImages('thread 1');
    expect(fs.deleteAsync).toHaveBeenCalledWith('file:///documents/chat-images/thread%201/', { idempotent: true });
  });

  it('deletes the images when the thread is removed', async () => {
    emitThreadRemoved('thread 9');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fs.deleteAsync).toHaveBeenCalledWith('file:///documents/chat-images/thread%209/', { idempotent: true });
  });
});
