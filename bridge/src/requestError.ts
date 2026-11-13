import type { BridgeErrorCode } from './protocol.js';

/** Failure of a request/response frame; `code` and `message` go to the client verbatim. */
export class RequestError extends Error {
  readonly code: BridgeErrorCode;

  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
