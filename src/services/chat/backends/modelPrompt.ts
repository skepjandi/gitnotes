import type { AIModelConfig } from '../../../models/AIProvider';
import { aiMemoryIndex } from '../../ai/AIMemoryIndexService';
import type { MemorySearchResult } from '../../ai/AIMemoryIndexService';
import { BYTES_PER_TOKEN } from '../../ai/config';
import { getModelContextLimit } from '../../ai/modelLimits';

const TOOL_ACTION_PATTERN = /^\s*(create|delete|edit|update|add|remove|modify)\s+(a\s+|an\s+|the\s+)?(note|todo|task)/i;

function isToolActionShaped(query: string): boolean {
  return TOOL_ACTION_PATTERN.test(query.trim());
}

function extractDateFromThoughtDumpPath(filePath: string): string {
  const match = filePath.match(/thoughts\/(\d{4})(\d{2})(\d{2})/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatMemoryBlock(results: MemorySearchResult[], budgetBytes: number): string | null {
  if (results.length === 0) return null;

  const sorted = [...results].sort((a, b) => b.score - a.score);
  const lines: string[] = [];
  let currentBytes = 0;

  for (const result of sorted) {
    const date = extractDateFromThoughtDumpPath(result.filePath);
    const prefix = date ? `[${date}] ` : '';
    const line = `${prefix}${result.snippet}`;
    const lineBytes = line.length;

    if (currentBytes + lineBytes > budgetBytes && lines.length > 0) break;
    lines.push(line);
    currentBytes += lineBytes;
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/** Relevant snippets from the user's thought dumps, sized to what is left of the model's context window. */
export async function buildMemoryBlockForQuery(
  query: string,
  model: AIModelConfig | undefined,
  existingPromptBytes: number,
): Promise<string | null> {
  if (aiMemoryIndex.getEntryCount() === 0) return null;
  if (isToolActionShaped(query)) return null;

  try {
    const results = await aiMemoryIndex.search(query, 5);
    if (results.length === 0) return null;

    let budgetBytes = 2000;
    if (model) {
      const limit = getModelContextLimit(model);
      if (limit) {
        const totalBudgetBytes = (limit.totalTokens - limit.reservedTokens) * BYTES_PER_TOKEN;
        const available = totalBudgetBytes - existingPromptBytes;
        budgetBytes = Math.max(200, Math.min(available, totalBudgetBytes * 0.15));
      }
    }

    return formatMemoryBlock(results, budgetBytes);
  } catch {
    return null;
  }
}
