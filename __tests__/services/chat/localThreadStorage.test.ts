import AsyncStorage from '@react-native-async-storage/async-storage';
import { LocalThreadStorage } from '@/services/chat/storage/localThreadStorage';
import { makeAgentThread } from './helpers';

const INDEX_KEY = 'gitnotes.agentChat.index';
const threadKey = (id: string) => `gitnotes.agentChat.thread.${id}`;

const thread = (id: string, updatedAt: number, text = 'hello') =>
  makeAgentThread({
    id,
    updatedAt,
    messages: [{ id: `${id}-m`, role: 'user', content: text, timestamp: updatedAt }],
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('LocalThreadStorage', () => {
  it('round-trips a thread and lists it', async () => {
    const storage = new LocalThreadStorage();
    const saved = thread('a', 100, 'first message');
    await storage.save(saved);

    expect(await storage.load('a')).toEqual(saved);
    const summaries = await storage.listSummaries();
    expect(summaries).toEqual([
      expect.objectContaining({ id: 'a', backend: 'agent', agentName: 'Claude Code', messageCount: 1 }),
    ]);
  });

  it('returns null for threads that were never saved', async () => {
    expect(await new LocalThreadStorage().load('missing')).toBeNull();
  });

  it('lists newest first and re-sorts when a thread is saved again', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('old', 100));
    await storage.save(thread('mid', 200));
    await storage.save(thread('new', 300));
    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['new', 'mid', 'old']);

    await storage.save(thread('old', 400));
    const summaries = await storage.listSummaries();
    expect(summaries.map((s) => s.id)).toEqual(['old', 'new', 'mid']);
    expect(summaries).toHaveLength(3);
  });

  it('keeps every row when different threads save at the same time', async () => {
    const storage = new LocalThreadStorage();
    await Promise.all(Array.from({ length: 12 }, (_, i) => storage.save(thread(`t${i}`, i))));
    const ids = (await storage.listSummaries()).map((s) => s.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('rebuilds a corrupt index from the stored threads', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await storage.save(thread('b', 200));
    await AsyncStorage.setItem(INDEX_KEY, '{not json');

    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['b', 'a']);
    expect(JSON.parse((await AsyncStorage.getItem(INDEX_KEY)) ?? '')).toHaveLength(2);
  });

  it('rebuilds when the index holds malformed rows', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([{ id: 'a' }, 42]));
    expect(await storage.listSummaries()).toEqual([expect.objectContaining({ id: 'a', messageCount: 1 })]);
  });

  it('adds a thread whose index write never happened (crash between the two writes)', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await AsyncStorage.setItem(threadKey('orphan'), JSON.stringify(thread('orphan', 500)));

    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['orphan', 'a']);
  });

  it('drops index rows whose thread entry is gone', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await storage.save(thread('b', 200));
    await AsyncStorage.removeItem(threadKey('b'));

    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['a']);
  });

  it('treats a corrupt thread entry as missing, keeps the others, and a rebuild leaves it out', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await storage.save(thread('b', 200));
    await AsyncStorage.setItem(threadKey('b'), '<<<garbage');

    expect(await storage.load('b')).toBeNull();
    expect(await storage.load('a')).toMatchObject({ id: 'a' });
    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['b', 'a']);

    await AsyncStorage.setItem(INDEX_KEY, 'broken');
    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['a']);
  });

  it('rejects stored values that are not threads', async () => {
    await AsyncStorage.setItem(threadKey('x'), JSON.stringify({ id: 'x', title: 'no messages' }));
    expect(await new LocalThreadStorage().load('x')).toBeNull();
  });

  it('remove deletes the thread and its index row', async () => {
    const storage = new LocalThreadStorage();
    await storage.save(thread('a', 100));
    await storage.save(thread('b', 200));
    await storage.remove('a');

    expect(await storage.load('a')).toBeNull();
    expect((await storage.listSummaries()).map((s) => s.id)).toEqual(['b']);
    expect(await AsyncStorage.getItem(threadKey('a'))).toBeNull();
  });

  it('writes the thread entry before the index', async () => {
    const order: string[] = [];
    const setItem = AsyncStorage.setItem as jest.Mock;
    const original = setItem.getMockImplementation();
    setItem.mockImplementation(async (key: string, value: string) => {
      order.push(key);
      await original?.(key, value);
    });
    await new LocalThreadStorage().save(thread('a', 1));
    setItem.mockImplementation(original);

    expect(order).toEqual([threadKey('a'), INDEX_KEY]);
  });
});
