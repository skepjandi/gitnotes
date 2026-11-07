import { Note } from '../../models/Note';

const NOW = Date.UTC(2026, 0, 15);
const DAY = 86_400_000;

/** Shown in the design preview when the user has not selected any notes yet, so every style option is visible. */
export const SAMPLE_NOTES: Note[] = [
  {
    id: 'sample-1',
    title: 'Welcome to my notes',
    createdAt: NOW,
    updatedAt: NOW,
    tags: ['hello', 'meta'],
    isPinned: true,
    content: `A short introduction with **bold**, _italic_ and a [link](https://example.com).

## What lives here

- Quick thoughts and long reads
- Code snippets and checklists
- Links between notes, like [[Reading list]]

### A snippet

\`\`\`ts
const greet = (name: string) => \`Hello, \${name}\`;
\`\`\`

> Writing is thinking made visible.

| Topic | Status |
| ----- | ------ |
| Design | Done |
| Writing | Ongoing |
`,
  },
  {
    id: 'sample-2',
    title: 'Reading list',
    createdAt: NOW - DAY * 3,
    updatedAt: NOW - DAY * 2,
    tags: ['books'],
    content: `## Next up

- [x] Finish the current book
- [ ] Pick something short
- [ ] Write a summary

Back to [[Welcome to my notes]].
`,
  },
  {
    id: 'sample-3',
    title: 'Trip planning',
    createdAt: NOW - DAY * 10,
    updatedAt: NOW - DAY * 9,
    tags: ['travel'],
    content: `Ideas for a long weekend: pack light, book early, and leave one day unplanned.`,
  },
];
