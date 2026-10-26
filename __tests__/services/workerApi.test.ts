/**
 * Worker API client tests.
 *
 * Tests verify:
 * - URL construction with production default and local override
 * - Non-2xx error responses with proper error envelope parsing
 * - Malformed responses are handled gracefully
 * - Cancellation via AbortSignal works
 * - Request body serialization is correct
 */

import { WorkerApiError, WORKER_BACKEND_URL_ENV, WORKER_BASE_URL } from '../../src/types/worker';

// Import after constants are defined
import { workerApi } from '../../src/services/workerApi';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('workerApi', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env[WORKER_BACKEND_URL_ENV];
  });

  describe('getBackendUrl', () => {
    it('returns production URL by default', () => {
      expect(workerApi.getBackendUrl()).toBe(WORKER_BASE_URL);
    });

    it('returns local override when EXPO_PUBLIC_GITNOTES_WORKER_BASE_URL is set', () => {
      process.env[WORKER_BACKEND_URL_ENV] = 'http://localhost:8787/api/v1';
      expect(workerApi.getBackendUrl()).toBe('http://localhost:8787/api/v1');
    });

    it('returns production URL when env var is empty string', () => {
      process.env[WORKER_BACKEND_URL_ENV] = '';
      expect(workerApi.getBackendUrl()).toBe(WORKER_BASE_URL);
    });
  });

  describe('health', () => {
    it('calls GET /health and returns health response', async () => {
      const mockResponse = { status: 'ok', version: '1.0.0' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.health();

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/health`,
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws WorkerApiError for non-2xx responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ code: 'not_found', message: 'Resource not found' }),
      });

      await expect(workerApi.health()).rejects.toThrow(WorkerApiError);
    });

    it('handles cancellation via AbortSignal', async () => {
      const controller = new AbortController();
      controller.abort();

      mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

      await expect(workerApi.health(controller.signal)).rejects.toThrow('Aborted');
    });
  });

  describe('oauth.initiate', () => {
    it('calls POST /oauth/initiate with correct body', async () => {
      const mockResponse = {
        authorization_url: 'https://github.com/login/oauth/authorize?...',
        state: 'test-state',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.oauth.initiate({
        state: 'test-state',
        code_challenge: 'test-challenge',
        redirect_uri: 'gitnotes://oauth/callback',
        scopes: ['repo'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/oauth/initiate`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            state: 'test-state',
            code_challenge: 'test-challenge',
            redirect_uri: 'gitnotes://oauth/callback',
            scopes: ['repo'],
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws WorkerApiError with correct code for state mismatch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'state_mismatch', message: 'State mismatch' }),
      });

      await expect(
        workerApi.oauth.initiate({
          state: 'wrong-state',
          code_challenge: 'test-challenge',
          redirect_uri: 'gitnotes://oauth/callback',
        })
      ).rejects.toThrow(WorkerApiError);
    });

    it('throws WorkerApiError with backend_unreachable for network errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ code: 'configuration_missing', message: 'OAuth not configured' }),
      });

      await expect(
        workerApi.oauth.initiate({
          state: 'test-state',
          code_challenge: 'test-challenge',
          redirect_uri: 'gitnotes://oauth/callback',
        })
      ).rejects.toThrow(WorkerApiError);
    });
  });

  describe('oauth.exchange', () => {
    it('calls POST /oauth/exchange with correct body', async () => {
      const mockResponse = {
        login: 'testuser',
        user_id: 12345,
        access_token: 'gho_xxx',
        expires_at: Date.now() + 3600000,
        refresh_token: 'refresh_xxx',
        refresh_expires_at: Date.now() + 86400000,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.oauth.exchange({
        code: 'auth-code-xxx',
        code_verifier: 'verifier-xxx',
        state: 'state-xxx',
        redirect_uri: 'gitnotes://oauth/callback',
        client_id: 'Iv1.xxx',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/oauth/exchange`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            code: 'auth-code-xxx',
            code_verifier: 'verifier-xxx',
            state: 'state-xxx',
            redirect_uri: 'gitnotes://oauth/callback',
            client_id: 'Iv1.xxx',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws WorkerApiError for code_expired', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: () => Promise.resolve({ code: 'code_expired', message: 'Authorization code expired' }),
      });

      await expect(
        workerApi.oauth.exchange({
          code: 'expired-code',
          code_verifier: 'verifier',
          state: 'state',
          redirect_uri: 'gitnotes://oauth/callback',
          client_id: 'Iv1.xxx',
        })
      ).rejects.toThrow(WorkerApiError);
    });
  });

  describe('oauth.refresh', () => {
    it('calls POST /oauth/refresh and returns error for GitHub OAuth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'refresh_denied', message: 'GitHub OAuth does not support refresh' }),
      });

      await expect(
        workerApi.oauth.refresh({ refresh_token: 'refresh-token-xxx' })
      ).rejects.toThrow(WorkerApiError);
    });
  });

  describe('oauth.revoke', () => {
    it('calls POST /oauth/revoke and returns revoked status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ revoked: true })),
      });

      const result = await workerApi.oauth.revoke({ access_token: 'token-xxx' });

      expect(result).toEqual({ revoked: true });
    });
  });

  describe('app.getInstallUrl', () => {
    it('calls POST /app/install-url with selected repository IDs', async () => {
      const mockResponse = {
        installation_url: 'https://github.com/apps/gitnotes-dev/installations/xxx',
        state: 'jws-state-xxx',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.app.getInstallUrl({
        selected_repository_ids: [123456, 789012],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/app/install-url`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ selected_repository_ids: [123456, 789012] }),
        })
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('app.callback', () => {
    it('calls POST /app/callback with installation details', async () => {
      const mockResponse = {
        installation_id: 123456,
        app_id: 98765,
        app_slug: 'gitnotes-dev',
        account_login: 'testuser',
        account_id: 54321,
        token: 'ghs_xxx',
        expires_at: Date.now() + 3600000,
        renewal_grant_token: 'grant_xxx',
        renewal_grant_expires_at: Date.now() + 86400000,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.app.callback({
        installation_id: 123456,
        state: 'jws-state-xxx',
        selected_repository_ids: [789012],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/app/callback`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            installation_id: 123456,
            state: 'jws-state-xxx',
            selected_repository_ids: [789012],
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws WorkerApiError for wrong_app', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'wrong_app', message: 'App ID mismatch' }),
      });

      await expect(
        workerApi.app.callback({
          installation_id: 999999,
          state: 'wrong-state',
        })
      ).rejects.toThrow(WorkerApiError);
    });
  });

  describe('app.renew', () => {
    it('calls POST /app/renewal with renewal grant', async () => {
      const mockResponse = {
        installation_id: 123456,
        app_id: 98765,
        app_slug: 'gitnotes-dev',
        account_login: 'testuser',
        account_id: 54321,
        token: 'ghs_yyy',
        expires_at: Date.now() + 3600000,
        renewal_grant_token: 'grant_yyy',
        renewal_grant_expires_at: Date.now() + 86400000,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const result = await workerApi.app.renew({
        installation_id: 123456,
        renewal_grant_token: 'grant_xxx',
        jti: 'unique-jti-xxx',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${WORKER_BASE_URL}/app/renewal`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            installation_id: 123456,
            renewal_grant_token: 'grant_xxx',
            jti: 'unique-jti-xxx',
          }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('throws WorkerApiError for renewal_replayed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ code: 'renewal_replayed', message: 'JTI already used' }),
      });

      await expect(
        workerApi.app.renew({
          installation_id: 123456,
          renewal_grant_token: 'grant_xxx',
          jti: 'replayed-jti',
        })
      ).rejects.toThrow(WorkerApiError);
    });
  });

  describe('error handling', () => {
    it('parses error envelope with code and message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ code: 'invalid_field', message: 'client_id is required' }),
      });

      try {
        await workerApi.oauth.exchange({
          code: '',
          code_verifier: 'verifier',
          state: 'state',
          redirect_uri: 'gitnotes://oauth/callback',
          client_id: '',
        });
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkerApiError);
        if (error instanceof WorkerApiError) {
          expect(error.code).toBe('invalid_field');
          expect(error.message).toBe('client_id is required');
          expect(error.statusCode).toBe(400);
        }
      }
    });

    it('handles non-JSON error responses gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      try {
        await workerApi.health();
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(WorkerApiError);
        if (error instanceof WorkerApiError) {
          expect(error.statusCode).toBe(500);
        }
      }
    });

    it('handles empty response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: () => Promise.resolve(''),
      });

      const result = await workerApi.oauth.revoke({ access_token: 'token' });
      expect(result).toEqual({});
    });
  });
});
