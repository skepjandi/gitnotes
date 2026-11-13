import { parseElicitation } from '../../../src/services/agent/acpElicitation';

describe('parseElicitation', () => {
  it('reads a string field', () => {
    const parsed = parseElicitation({
      sessionId: 's1',
      message: 'Your name?',
      requestedSchema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] },
    });
    expect(parsed).toEqual({
      mode: 'form',
      sessionId: 's1',
      message: 'Your name?',
      fields: [{ key: 'name', label: 'Name', required: true, kind: 'string' }],
    });
  });

  it('marks optional fields and keeps the description', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: { properties: { note: { type: 'string', description: 'Anything else' } } },
    });
    expect(parsed?.mode).toBe('form');
    expect(parsed?.mode === 'form' && parsed.fields[0]).toMatchObject({ required: false, description: 'Anything else' });
  });

  it('reads number and integer fields with their bounds', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: {
        properties: {
          count: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
          ratio: { type: 'number' },
        },
        required: ['count'],
      },
    });
    expect(parsed?.mode === 'form' && parsed.fields).toEqual([
      { key: 'count', label: 'count', required: true, kind: 'integer', minimum: 1, maximum: 10, default: 3 },
      { key: 'ratio', label: 'ratio', required: false, kind: 'number' },
    ]);
  });

  it('reads a boolean field with its default', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: { properties: { fast: { type: 'boolean', default: true } } },
    });
    expect(parsed?.mode === 'form' && parsed.fields[0]).toEqual({
      key: 'fast',
      label: 'fast',
      required: false,
      kind: 'boolean',
      default: true,
    });
  });

  it('reads a string enum and a oneOf enum with titles', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: {
        properties: {
          runner: { type: 'string', enum: ['jest', 'vitest'], enumNames: ['Jest', 'Vitest'], default: 'jest' },
          style: {
            oneOf: [
              { const: 'fast', title: 'Fast' },
              { const: 'slow', title: 'Slow' },
            ],
          },
        },
      },
    });
    expect(parsed?.mode === 'form' && parsed.fields).toEqual([
      {
        key: 'runner',
        label: 'runner',
        required: false,
        kind: 'enum',
        options: [
          { value: 'jest', label: 'Jest' },
          { value: 'vitest', label: 'Vitest' },
        ],
        default: 'jest',
      },
      {
        key: 'style',
        label: 'style',
        required: false,
        kind: 'enum',
        options: [
          { value: 'fast', label: 'Fast' },
          { value: 'slow', label: 'Slow' },
        ],
      },
    ]);
  });

  it('reads an array of enum values as a multi-enum', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: {
        properties: {
          files: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, default: ['a'] },
        },
        required: ['files'],
      },
    });
    expect(parsed?.mode === 'form' && parsed.fields[0]).toEqual({
      key: 'files',
      label: 'files',
      required: true,
      kind: 'multi-enum',
      options: [
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ],
      default: ['a'],
    });
  });

  it('makes a long string multiline', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: { properties: { body: { type: 'string', maxLength: 2000 } } },
    });
    expect(parsed?.mode === 'form' && parsed.fields[0]?.multiline).toBe(true);
  });

  it('keeps a short string single-line', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: { properties: { body: { type: 'string', maxLength: 40 } } },
    });
    expect(parsed?.mode === 'form' && parsed.fields[0]?.multiline).toBeUndefined();
  });

  it('drops properties it cannot render', () => {
    const parsed = parseElicitation({
      message: 'q',
      requestedSchema: { properties: { nested: { type: 'object' }, keep: { type: 'string' } } },
    });
    expect(parsed?.mode === 'form' && parsed.fields.map((field) => field.key)).toEqual(['keep']);
  });

  it('reads a url request', () => {
    expect(parseElicitation({ mode: 'url', message: 'Sign in', url: 'https://example.com/login' })).toEqual({
      mode: 'url',
      message: 'Sign in',
      url: 'https://example.com/login',
    });
  });

  it('rejects a url request without a url and a form without a schema', () => {
    expect(parseElicitation({ mode: 'url', message: 'Sign in' })).toBeNull();
    expect(parseElicitation({ message: 'q' })).toBeNull();
    expect(parseElicitation({ message: 'q', requestedSchema: { properties: 'nope' } })).toBeNull();
  });
});
