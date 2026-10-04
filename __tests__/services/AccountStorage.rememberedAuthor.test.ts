import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { AccountStorage } from '../../src/services/AccountStorage';

const HOST_ID = 'acc-test:github:default';
const REMEMBERED_EMAILS_KEY = '@gitnotes:remembered_commit_authors';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('AccountStorage remembered commit authors', () => {
  describe('getRememberedCommitAuthor', () => {
    it('returns null when no remembered author exists for host', async () => {
      const result = await AccountStorage.getRememberedCommitAuthor(HOST_ID);
      expect(result).toBeNull();
    });

    it('returns remembered author when stored for host', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({ [HOST_ID]: { email: 'test@example.com', name: 'Test User' } }),
      );

      const result = await AccountStorage.getRememberedCommitAuthor(HOST_ID);
      expect(result).toEqual({ email: 'test@example.com', name: 'Test User' });
    });

    it('returns null for host with no remembered author when other hosts exist', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({
          [HOST_ID]: { email: 'test@example.com' },
          'other-host-id': { email: 'other@example.com' },
        }),
      );

      const result = await AccountStorage.getRememberedCommitAuthor('non-existent-host');
      expect(result).toBeNull();
    });
  });

  describe('setRememberedCommitAuthor', () => {
    it('stores remembered author for host', async () => {
      await AccountStorage.setRememberedCommitAuthor(HOST_ID, {
        email: 'test@example.com',
        name: 'Test User',
      });

      const stored = await AsyncStorage.getItem(REMEMBERED_EMAILS_KEY);
      expect(JSON.parse(stored ?? '{}')).toEqual({
        [HOST_ID]: { email: 'test@example.com', name: 'Test User' },
      });
    });

    it('updates existing remembered author', async () => {
      await AccountStorage.setRememberedCommitAuthor(HOST_ID, {
        email: 'first@example.com',
        name: 'First',
      });
      await AccountStorage.setRememberedCommitAuthor(HOST_ID, {
        email: 'second@example.com',
        name: 'Second',
      });

      const result = await AccountStorage.getRememberedCommitAuthor(HOST_ID);
      expect(result).toEqual({ email: 'second@example.com', name: 'Second' });
    });

    it('clears remembered author when passed null', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({ [HOST_ID]: { email: 'test@example.com' } }),
      );

      await AccountStorage.setRememberedCommitAuthor(HOST_ID, null);

      const result = await AccountStorage.getRememberedCommitAuthor(HOST_ID);
      expect(result).toBeNull();
    });

    it('does not affect other hosts when clearing one', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({
          [HOST_ID]: { email: 'test@example.com' },
          'other-host': { email: 'other@example.com' },
        }),
      );

      await AccountStorage.setRememberedCommitAuthor(HOST_ID, null);

      const otherResult = await AccountStorage.getRememberedCommitAuthor('other-host');
      expect(otherResult).toEqual({ email: 'other@example.com' });
    });
  });

  describe('host removal cleanup', () => {
    it('clears remembered author when host is removed', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({ [HOST_ID]: { email: 'test@example.com' } }),
      );

      await AccountStorage.removeHostConnection(HOST_ID);

      const result = await AccountStorage.getRememberedCommitAuthor(HOST_ID);
      expect(result).toBeNull();
    });
  });

  describe('clearAll cleanup', () => {
    it('clears all remembered authors on clearAll', async () => {
      await AsyncStorage.setItem(
        REMEMBERED_EMAILS_KEY,
        JSON.stringify({
          [HOST_ID]: { email: 'test@example.com' },
          'other-host': { email: 'other@example.com' },
        }),
      );

      await AccountStorage.clearAll();

      const stored = await AsyncStorage.getItem(REMEMBERED_EMAILS_KEY);
      expect(stored).toBeNull();
    });
  });
});
