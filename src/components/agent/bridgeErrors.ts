import type { TFunction } from 'i18next';
import { BridgeError, type BridgeErrorKind } from '../../services/agent/types';

const ERROR_KEYS: Record<BridgeErrorKind, string> = {
  unreachable: 'agents.errors.unreachable',
  unauthorized: 'agents.errors.unauthorized',
  'protocol-mismatch': 'agents.errors.protocolMismatch',
  'cleartext-blocked': 'agents.errors.cleartextBlocked',
  timeout: 'agents.errors.timeout',
  unknown: 'agents.errors.unknown',
};

/** Friendly, actionable text for a failed bridge call; the raw `BridgeError.message` is for logs, not users. */
export function bridgeErrorMessage(t: TFunction, error: unknown): string {
  return t(ERROR_KEYS[error instanceof BridgeError ? error.kind : 'unknown']);
}
