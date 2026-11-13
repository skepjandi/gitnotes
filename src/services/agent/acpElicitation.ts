import type { ElicitationField } from '../chat/types';

export type ParsedElicitation = {
  sessionId?: string;
  toolCallId?: string;
} & (
  | { mode: 'form'; message: string; fields: ElicitationField[] }
  | { mode: 'url'; message: string; url: string }
);

const MULTILINE_THRESHOLD = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function enumOptions(schema: Record<string, unknown>): Array<{ value: string; label: string }> | null {
  const titled = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(titled)) {
    const options: Array<{ value: string; label: string }> = [];
    for (const entry of titled) {
      if (isRecord(entry) && typeof entry.const === 'string') {
        options.push({ value: entry.const, label: typeof entry.title === 'string' && entry.title ? entry.title : entry.const });
      }
    }
    return options.length > 0 ? options : null;
  }
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    const options: Array<{ value: string; label: string }> = [];
    schema.enum.forEach((value, index) => {
      if (typeof value !== 'string') return;
      const name = names[index];
      options.push({ value, label: typeof name === 'string' && name ? name : value });
    });
    return options.length > 0 ? options : null;
  }
  return null;
}

function parseField(key: string, schema: Record<string, unknown>, required: boolean): ElicitationField | null {
  const field = {
    key,
    label: typeof schema.title === 'string' && schema.title ? schema.title : key,
    required,
    ...(typeof schema.description === 'string' && schema.description ? { description: schema.description } : {}),
  };

  if (schema.type === 'array') {
    const items = isRecord(schema.items) ? schema.items : null;
    const options = items ? enumOptions(items) : null;
    if (!options) return null;
    const fallback = Array.isArray(schema.default) ? schema.default.filter((entry): entry is string => typeof entry === 'string') : undefined;
    return { ...field, kind: 'multi-enum', options, ...(fallback ? { default: fallback } : {}) };
  }

  const choices = enumOptions(schema);
  if (choices) {
    const fallback = typeof schema.default === 'string' ? schema.default : undefined;
    return { ...field, kind: 'enum', options: choices, ...(fallback !== undefined ? { default: fallback } : {}) };
  }

  if (schema.type === 'string') {
    const fallback = typeof schema.default === 'string' ? schema.default : undefined;
    const maxLength = finiteNumber(schema.maxLength);
    const multiline = (maxLength !== undefined && maxLength > MULTILINE_THRESHOLD) || schema.format === 'multiline';
    return { ...field, kind: 'string', ...(multiline ? { multiline: true } : {}), ...(fallback !== undefined ? { default: fallback } : {}) };
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    const minimum = finiteNumber(schema.minimum);
    const maximum = finiteNumber(schema.maximum);
    const fallback = finiteNumber(schema.default);
    return {
      ...field,
      kind: schema.type,
      ...(minimum !== undefined ? { minimum } : {}),
      ...(maximum !== undefined ? { maximum } : {}),
      ...(fallback !== undefined ? { default: fallback } : {}),
    };
  }

  if (schema.type === 'boolean') {
    return { ...field, kind: 'boolean', ...(typeof schema.default === 'boolean' ? { default: schema.default } : {}) };
  }
  return null;
}

/** `elicitation/create` params -> a form/url request; `null` when the payload is unusable. */
export function parseElicitation(params: unknown): ParsedElicitation | null {
  if (!isRecord(params) || typeof params.message !== 'string') return null;
  const common = {
    message: params.message,
    ...(typeof params.sessionId === 'string' ? { sessionId: params.sessionId } : {}),
    ...(typeof params.toolCallId === 'string' ? { toolCallId: params.toolCallId } : {}),
  };

  if (params.mode === 'url') {
    return typeof params.url === 'string' && params.url ? { ...common, mode: 'url', url: params.url } : null;
  }
  if (params.mode !== undefined && params.mode !== 'form') return null;
  const schema = params.requestedSchema;
  if (!isRecord(schema) || !isRecord(schema.properties)) return null;
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === 'string') : []);
  const fields: ElicitationField[] = [];
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!isRecord(value)) continue;
    const field = parseField(key, value, required.has(key));
    if (field) fields.push(field);
  }
  return { ...common, mode: 'form', fields };
}
