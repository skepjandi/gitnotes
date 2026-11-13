import type { PlanEntry, ToolDiff } from '../../../models/Chat';

export interface DemoScenario {
  thought: string;
  plan: PlanEntry[];
  read: { path: string; content: string };
  edit: { path: string; title: string; diff: ToolDiff };
  command: string;
  reply: string[];
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    thought: 'The user wants the greeting to be configurable. Let me read the module first.',
    plan: [
      { content: 'Read src/greet.ts', status: 'completed' },
      { content: 'Add a name parameter', status: 'in_progress' },
      { content: 'Run the test suite', status: 'pending' },
    ],
    read: { path: 'src/greet.ts', content: "export function greet() {\n  return 'Hello, world!';\n}\n" },
    edit: {
      path: 'src/greet.ts',
      title: 'Edit src/greet.ts',
      diff: {
        path: 'src/greet.ts',
        oldText: "export function greet() {\n  return 'Hello, world!';\n}\n",
        newText: "export function greet(name = 'world') {\n  return `Hello, ${name}!`;\n}\n",
      },
    },
    command: 'npm test',
    reply: ['I made `greet` ', 'accept an optional name. ', 'Defaults still produce ', '"Hello, world!".'],
  },
  {
    thought: 'A failing import is likely caused by the renamed helper. Checking the config.',
    plan: [
      { content: 'Inspect package.json scripts', status: 'completed' },
      { content: 'Fix the test script', status: 'in_progress' },
      { content: 'Verify the run', status: 'pending' },
    ],
    read: { path: 'package.json', content: '{\n  "scripts": {\n    "test": "jest --watch"\n  }\n}\n' },
    edit: {
      path: 'package.json',
      title: 'Edit package.json',
      diff: {
        path: 'package.json',
        oldText: '"test": "jest --watch"',
        newText: '"test": "jest --ci"',
      },
    },
    command: 'npm test',
    reply: ['The test script ', 'ran in watch mode, ', 'which never exits on CI. ', 'It now uses `--ci`.'],
  },
  {
    thought: 'Documentation is outdated. I will update the README usage section.',
    plan: [
      { content: 'Read README.md', status: 'completed' },
      { content: 'Document the new option', status: 'in_progress' },
      { content: 'Check formatting', status: 'pending' },
    ],
    read: { path: 'README.md', content: '# Demo\n\n## Usage\n\nRun `npm start`.\n' },
    edit: {
      path: 'README.md',
      title: 'Edit README.md',
      diff: {
        path: 'README.md',
        oldText: 'Run `npm start`.',
        newText: 'Run `npm start`, then open http://localhost:3000.',
      },
    },
    command: 'npm test',
    reply: ['README updated. ', 'This is a scripted demo, ', 'so nothing on your ', 'device was changed.'],
  },
];
