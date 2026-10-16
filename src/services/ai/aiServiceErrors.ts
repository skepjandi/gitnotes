export interface ErrorDetails {
  status?: number;
  body?: string;
  isRateLimit: boolean;
  isParserError: boolean;
  isEmptyBody: boolean;
  underlying: unknown;
}

const BODY_SNIPPET_MAX = 200;

function asObj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
}

function isApiCallError(e: unknown): boolean {
  const o = asObj(e);
  return o?.name === 'AI_APICallError';
}

function isRetryError(e: unknown): boolean {
  const o = asObj(e);
  return o?.name === 'AI_RetryError';
}

function isEmptyBodyError(e: unknown): boolean {
  const o = asObj(e);
  if (!o) return false;
  if (o.name === 'AI_EmptyResponseBodyError') return true;
  const cause = asObj(o.cause);
  if (cause?.name === 'AI_EmptyResponseBodyError') return true;
  if (typeof o.message === 'string' && /empty response body/i.test(o.message)) return true;
  return false;
}

/**
 * The AI SDK throws `APICallError("Failed to process successful response")`
 * when a 2xx response body can't be parsed (e.g. OpenRouter free-tier
 * upstreams returning non-OpenAI chunks). The error message survives even
 * when the error has been re-wrapped by intermediate layers, so we check
 * it directly as a fallback to the structural `name === 'AI_APICallError'`
 * check.
 */
function hasParserErrorMessage(e: unknown): boolean {
  const o = asObj(e);
  if (!o) return false;
  if (typeof o.message === 'string' && /failed to process successful response/i.test(o.message)) return true;
  const cause = asObj(o.cause);
  if (cause?.message && typeof cause.message === 'string' && /failed to process successful response/i.test(cause.message)) return true;
  return false;
}

function unwrapInner(e: unknown): unknown {
  if (!isRetryError(e)) return e;
  const o = asObj(e);
  if (!o) return e;
  const errs = o.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    return errs[errs.length - 1];
  }
  if (o.lastError !== undefined) return o.lastError;
  return e;
}

function readStatus(e: unknown): number | undefined {
  const o = asObj(e);
  if (!o) return undefined;
  const s = o.statusCode;
  return typeof s === 'number' ? s : undefined;
}

function readBody(e: unknown): string | undefined {
  const o = asObj(e);
  if (!o) return undefined;
  const b = o.responseBody;
  return typeof b === 'string' ? b : undefined;
}

export function extractErrorDetails(error: unknown): ErrorDetails {
  const inner = unwrapInner(error);
  const status = readStatus(inner);
  const body = readBody(inner);
  const isEmptyBody = isEmptyBodyError(error) || isEmptyBodyError(inner);
  const isRateLimit = status === 429;
  const isApi = isApiCallError(inner);

  const isStatusedParserError =
    isApi && typeof status === 'number' && status >= 200 && status < 300 && !isEmptyBody;
  const isStatuslessParserError =
    isApi && typeof status !== 'number' && !isEmptyBody;
  const isMessageParserError =
    !isEmptyBody && (hasParserErrorMessage(error) || hasParserErrorMessage(inner));
  const isParserError = isStatusedParserError || isStatuslessParserError || isMessageParserError;

  return {
    status,
    body,
    isRateLimit,
    isParserError,
    isEmptyBody,
    underlying: inner,
  };
}

function snippet(s?: string): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (trimmed.length <= BODY_SNIPPET_MAX) return trimmed;
  return trimmed.slice(0, BODY_SNIPPET_MAX) + '…';
}

export function humanizeStreamError(error: unknown): string {
  const d = extractErrorDetails(error);

  if (d.isEmptyBody) {
    return 'The AI provider returned an empty response. This is often caused by high load on the provider, an invalid model name, or a tools-incompatible request. Please try again, or pick a different model.';
  }

  if (d.isParserError) {
    const body = snippet(d.body);
    const tail = body ? ` Response snippet: ${body}` : '';
    return `The provider returned a successful response the SDK could not parse.${tail}`;
  }

  if (typeof d.status === 'number') {
    const body = snippet(d.body);
    const tail = body ? `: ${body}` : '';
    if (d.isRateLimit) {
      return `HTTP 429 (rate limited)${tail}`;
    }
    return `HTTP ${d.status}${tail}`;
  }

  let message = error instanceof Error ? error.message : 'Unknown streaming error';
  // Redact iOS/macOS shared pasteboard RTFD paths that Apple Intelligence native
  // layer can leak as error messages when processing rich text content.
  if (/\/(?:Users\/[^/]+|var\/mobile\/[^/]+)\/.*shared-pasteboard\//.test(message)) {
    message = 'The AI provider encountered an internal error processing rich text content.';
  }
  return `Failed to stream chat response: ${message}`;
}

export function isEmptyBody(error: unknown): boolean {
  return extractErrorDetails(error).isEmptyBody;
}
