import type { ChatMessage, ChatThread, ChatThreadSummary } from '../models/Chat';
import { stripThoughtContent } from './chatThoughts';

export const DEFAULT_CHAT_TITLE = 'New Chat';
const DEFAULT_CHAT_PREVIEW = 'No messages yet';
const TITLE_MAX_LENGTH = 60;
const PREVIEW_MAX_LENGTH = 120;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripLineDecorators(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^["'`~*_\-–—•()[{}:;,.!?/\\]+/, '')
    .replace(/["'`~*_\-–—•()[{}:;,.!?/\\]+$/, '')
    .trim();
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const sliced = value.slice(0, maxLength + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  const base = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : value.slice(0, maxLength);
  return `${base.trimEnd()}…`;
}

function humanizeToolName(value: string | undefined): string {
  const normalized = normalizeWhitespace((value ?? '').replace(/[_-]+/g, ' '));
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function firstMeaningfulLine(value: string): string {
  const lines = value.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = normalizeWhitespace(stripLineDecorators(line));
    if (cleaned) return cleaned;
  }
  return '';
}

function previewFromMessage(message: ChatMessage): string {
  if (message.kind === 'thought' || message.kind === 'plan') return '';
  const visibleContent = firstMeaningfulLine(stripThoughtContent(message.content ?? ''));
  if (visibleContent) return visibleContent;

  const toolResult = firstMeaningfulLine(message.toolCallResult ?? '');
  if (toolResult) return toolResult;

  return humanizeToolName(message.toolCallName);
}

export function isDefaultChatTitle(value: string | undefined): boolean {
  return normalizeWhitespace(value ?? '').toLowerCase() === DEFAULT_CHAT_TITLE.toLowerCase();
}

export function deriveChatTitleFromText(value: string): string {
  const title = truncateAtWordBoundary(firstMeaningfulLine(value), TITLE_MAX_LENGTH);
  return title || DEFAULT_CHAT_TITLE;
}

export function deriveThreadTitle(thread: ChatThread): string {
  if (!isDefaultChatTitle(thread.title)) {
    return normalizeWhitespace(thread.title) || DEFAULT_CHAT_TITLE;
  }

  const firstUserMessage = thread.messages.find((message) => message.role === 'user' && previewFromMessage(message));
  if (firstUserMessage) {
    return deriveChatTitleFromText(firstUserMessage.content);
  }

  const firstAssistantMessage = thread.messages.find((message) => message.role === 'assistant' && previewFromMessage(message));
  if (firstAssistantMessage) {
    return truncateAtWordBoundary(previewFromMessage(firstAssistantMessage), TITLE_MAX_LENGTH);
  }

  return DEFAULT_CHAT_TITLE;
}

export function deriveThreadPreview(thread: ChatThread): string | undefined {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const preview = truncateAtWordBoundary(previewFromMessage(thread.messages[index]), PREVIEW_MAX_LENGTH);
    if (preview && preview !== DEFAULT_CHAT_PREVIEW) return preview;
  }

  return undefined;
}

export function buildThreadSummary(thread: ChatThread): ChatThreadSummary {
  const preview = deriveThreadPreview(thread);
  return {
    id: thread.id,
    title: deriveThreadTitle(thread),
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : Date.now(),
    messageCount: thread.messages.length,
    ...(preview ? { preview } : {}),
    ...(thread.backend?.type === 'agent'
      ? { backend: 'agent' as const, agentName: thread.backend.agentName, cwd: thread.backend.cwd }
      : {}),
    ...(thread.backend?.type === 'demo' ? { backend: 'demo' as const } : {}),
  };
}
