# Teams → Jira Message Extension, Variant L (Redirect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams message action that opens a dialog prefilled from the selected chat message and hands the user an "Open in Jira" button pointing at a prefilled `CreateIssueDetails!init.jspa` create screen on the internal Jira Server/DC.

**Architecture:** Node/TypeScript Bot Framework app (Express) hosted later on Azure App Service B1. The bot handles `composeExtension/fetchTask` and `composeExtension/submitAction` invokes, transforms message HTML → text, and builds a Jira create-screen URL. No Jira API calls, no credentials stored. Per-user prefs (Jira username, recent projects, personal project registry) in Azure Table Storage; org project registry (key→pid/issue-type IDs) is a committed JSON file. All invoke logic is in pure functions (`handlers.ts`) so the bot class is a thin adapter — tests never need the Bot Framework runtime.

**Tech Stack:** Node 20+, TypeScript (strict), `botbuilder` ^4.23, `express` ^4.19, `@azure/data-tables` ^13.3, Jest + ts-jest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-teams-jira-message-extension-design.md` (Variant L, §4–§5).
- Runtime deps limited to: `botbuilder`, `express`, `@azure/data-tables`. No HTML-parsing or utility libraries.
- TypeScript `strict: true`; build must be clean (`npm run build` zero errors).
- No secrets in the repo — bot credentials and storage connection strings come from env vars only.
- Message text is never persisted — only transformed in memory per request.
- Description in the built URL: Teams deep link comes BEFORE message body; truncation marker is `... [truncated - see Teams link]`; total URL length ≤ 2000 chars.
- Recent projects list: most-recent-first, deduplicated, max 10.
- Default Jira priorities when registry omits them: Highest=1, High=2, Medium=3, Low=4, Lowest=5; default selection Medium (3).
- Conventional commits; commit at the end of every task.
- Do not work on `main`; execute this plan on a feature branch/worktree (e.g. `feat/variant-l`).

## File Structure

```
package.json / tsconfig.json / jest.config.js / .gitignore
registry/projects.json          — org project registry (sample committed)
src/messageText.ts              — HTML → plain text
src/projectRegistry.ts          — registry types, parsing, lookups
src/jiraUrl.ts                  — CreateIssueDetails URL builder + truncation
src/userStore.ts                — UserPrefs, UserStore interface, MemoryUserStore, recency helper
src/tableUserStore.ts           — Azure Table Storage implementation of UserStore
src/cards.ts                    — Adaptive Card builders (config, ticket dialog, open-in-jira, error)
src/handlers.ts                 — pure fetchTask/submitAction logic (the brain)
src/config.ts                   — env → AppConfig
src/bot.ts                      — TeamsActivityHandler wiring to handlers.ts
src/index.ts                    — Express server + CloudAdapter
scripts/make-icons.js           — generates appPackage PNG icons
appPackage/manifest.json        — Teams app manifest
docs/RUNBOOK.md                 — Azure setup, packaging, verification gates, E2E checklist
test/*.test.ts                  — one test file per src module (except bot.ts/index.ts)
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `jest.config.js`, `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `npm test`, `npm run build` commands used by every later task

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "teams-to-jira",
  "version": "0.1.0",
  "private": true,
  "description": "Teams message extension: create prefilled Jira Server tickets via redirect",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc && node dist/index.js",
    "test": "jest",
    "package": "node scripts/make-icons.js && cd appPackage && zip -r ../appPackage.zip manifest.json color.png outline.png"
  },
  "dependencies": {
    "@azure/data-tables": "^13.3.0",
    "botbuilder": "^4.23.0",
    "express": "^4.19.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Write `jest.config.js`**

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  passWithNoTests: true,
};
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
appPackage.zip
appPackage/color.png
appPackage/outline.png
.env
*.log
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npm run build && npm test`
Expected: install succeeds; build succeeds (no src files yet is fine — tsc exits 0 on empty include with `"strict"`; if it errors with "No inputs were found", create `src/index.ts` containing only `export {};` and rerun); jest reports "no tests found" but exits 0 (passWithNoTests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tsconfig.json jest.config.js .gitignore src
git commit -m "chore: scaffold TypeScript bot project with jest"
```

---

### Task 2: HTML → text conversion (`messageText.ts`)

**Files:**
- Create: `src/messageText.ts`
- Test: `test/messageText.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `htmlToText(html: string): string` — used by Task 7 (`handlers.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// test/messageText.test.ts
import { htmlToText } from '../src/messageText';

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('converts block endings and <br> to newlines', () => {
    expect(htmlToText('<p>line one</p><p>line two</p>')).toBe('line one\nline two');
    expect(htmlToText('a<br>b<br/>c')).toBe('a\nb\nc');
  });

  it('decodes common HTML entities', () => {
    expect(htmlToText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f')).toBe(
      'a & b <c> "d" \'e\' f'
    );
  });

  it('collapses 3+ newlines to two and trims', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\nb');
    expect(htmlToText('  <p> x </p> ')).toBe('x');
  });

  it('passes plain text through unchanged', () => {
    expect(htmlToText('just plain text')).toBe('just plain text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/messageText.test.ts`
Expected: FAIL — cannot find module '../src/messageText'

- [ ] **Step 3: Implement**

```ts
// src/messageText.ts

/** Convert Teams message HTML to plain text suitable for a Jira description. */
export function htmlToText(html: string): string {
  let s = html;
  // line-breaking elements → newline
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  // all remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // entities (order matters: &amp; last would double-decode if first)
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  // normalize whitespace
  s = s
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  s = s.replace(/\n{2,}/g, '\n');
  return s.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/messageText.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/messageText.ts test/messageText.test.ts
git commit -m "feat: convert Teams message HTML to plain text"
```

---

### Task 3: Project registry (`projectRegistry.ts`)

**Files:**
- Create: `src/projectRegistry.ts`, `registry/projects.json`
- Test: `test/projectRegistry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by Tasks 5, 6, 7):
  - `interface IssueType { name: string; id: number }`
  - `interface RegistryProject { key: string; name: string; pid: number; issueTypes: IssueType[] }`
  - `interface Priority { name: string; id: number }`
  - `interface Registry { projects: RegistryProject[]; priorities: Priority[] }`
  - `DEFAULT_PRIORITIES: Priority[]`
  - `parseRegistry(json: string): Registry` (throws on invalid)
  - `findProject(reg: Registry, extra: RegistryProject[], key: string): RegistryProject | undefined`
  - `issueTypeIdFor(p: RegistryProject, name: string): number` (falls back to first issue type)
  - `unionIssueTypeNames(projects: RegistryProject[]): string[]`

- [ ] **Step 1: Write the failing test**

```ts
// test/projectRegistry.test.ts
import {
  parseRegistry,
  findProject,
  issueTypeIdFor,
  unionIssueTypeNames,
  DEFAULT_PRIORITIES,
  RegistryProject,
} from '../src/projectRegistry';

const VALID = JSON.stringify({
  projects: [
    { key: 'ABC', name: 'Alpha', pid: 10100, issueTypes: [{ name: 'Task', id: 3 }, { name: 'Bug', id: 1 }] },
    { key: 'XYZ', name: 'Xylo', pid: 10200, issueTypes: [{ name: 'Task', id: 3 }, { name: 'Story', id: 7 }] },
  ],
});

describe('parseRegistry', () => {
  it('parses projects and applies default priorities when omitted', () => {
    const reg = parseRegistry(VALID);
    expect(reg.projects).toHaveLength(2);
    expect(reg.priorities).toEqual(DEFAULT_PRIORITIES);
  });

  it('keeps explicit priorities', () => {
    const reg = parseRegistry(
      JSON.stringify({ projects: [], priorities: [{ name: 'Urgent', id: 9 }] })
    );
    expect(reg.priorities).toEqual([{ name: 'Urgent', id: 9 }]);
  });

  it('throws on a project missing pid', () => {
    expect(() =>
      parseRegistry(JSON.stringify({ projects: [{ key: 'A', name: 'a', issueTypes: [] }] }))
    ).toThrow(/pid/);
  });
});

describe('lookups', () => {
  const reg = parseRegistry(VALID);
  const extra: RegistryProject[] = [
    { key: 'PERS', name: 'Personal', pid: 10900, issueTypes: [{ name: 'Task', id: 3 }] },
  ];

  it('findProject searches registry then extras', () => {
    expect(findProject(reg, extra, 'XYZ')?.pid).toBe(10200);
    expect(findProject(reg, extra, 'PERS')?.pid).toBe(10900);
    expect(findProject(reg, extra, 'NOPE')).toBeUndefined();
  });

  it('issueTypeIdFor maps name, falls back to first type', () => {
    const p = reg.projects[0];
    expect(issueTypeIdFor(p, 'Bug')).toBe(1);
    expect(issueTypeIdFor(p, 'Story')).toBe(3); // not in ABC → first type (Task=3)
  });

  it('unionIssueTypeNames dedupes across projects preserving order', () => {
    expect(unionIssueTypeNames(reg.projects)).toEqual(['Task', 'Bug', 'Story']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/projectRegistry.test.ts`
Expected: FAIL — cannot find module '../src/projectRegistry'

- [ ] **Step 3: Implement**

```ts
// src/projectRegistry.ts

export interface IssueType {
  name: string;
  id: number;
}

export interface RegistryProject {
  key: string;
  name: string;
  pid: number;
  issueTypes: IssueType[];
}

export interface Priority {
  name: string;
  id: number;
}

export interface Registry {
  projects: RegistryProject[];
  priorities: Priority[];
}

export const DEFAULT_PRIORITIES: Priority[] = [
  { name: 'Highest', id: 1 },
  { name: 'High', id: 2 },
  { name: 'Medium', id: 3 },
  { name: 'Low', id: 4 },
  { name: 'Lowest', id: 5 },
];

export function parseRegistry(json: string): Registry {
  const raw = JSON.parse(json) as Partial<Registry>;
  if (!Array.isArray(raw.projects)) throw new Error('registry: "projects" must be an array');
  for (const p of raw.projects) {
    if (!p.key || typeof p.key !== 'string') throw new Error('registry: project missing key');
    if (typeof p.pid !== 'number') throw new Error(`registry: project ${p.key} missing numeric pid`);
    if (!Array.isArray(p.issueTypes)) throw new Error(`registry: project ${p.key} missing issueTypes`);
  }
  return {
    projects: raw.projects as RegistryProject[],
    priorities: Array.isArray(raw.priorities) && raw.priorities.length > 0
      ? (raw.priorities as Priority[])
      : DEFAULT_PRIORITIES,
  };
}

export function findProject(
  reg: Registry,
  extra: RegistryProject[],
  key: string
): RegistryProject | undefined {
  return reg.projects.find((p) => p.key === key) ?? extra.find((p) => p.key === key);
}

export function issueTypeIdFor(p: RegistryProject, name: string): number {
  const hit = p.issueTypes.find((t) => t.name === name);
  return (hit ?? p.issueTypes[0]).id;
}

export function unionIssueTypeNames(projects: RegistryProject[]): string[] {
  const seen: string[] = [];
  for (const p of projects) {
    for (const t of p.issueTypes) {
      if (!seen.includes(t.name)) seen.push(t.name);
    }
  }
  return seen;
}
```

- [ ] **Step 4: Write the sample org registry**

```json
// registry/projects.json  (sample — replace pids/ids with real values from your Jira)
{
  "projects": [
    {
      "key": "ABC",
      "name": "Sample Project",
      "pid": 10100,
      "issueTypes": [
        { "name": "Task", "id": 3 },
        { "name": "Bug", "id": 1 },
        { "name": "Story", "id": 7 }
      ]
    }
  ]
}
```

(Write it WITHOUT the comment line — JSON has no comments.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest test/projectRegistry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add src/projectRegistry.ts test/projectRegistry.test.ts registry/projects.json
git commit -m "feat: org project registry with pid and issue-type lookups"
```

---

### Task 4: Jira URL builder (`jiraUrl.ts`)

**Files:**
- Create: `src/jiraUrl.ts`
- Test: `test/jiraUrl.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces (used by Task 7):
  - `interface CreateIssueParams { baseUrl: string; pid: number; issueTypeId: number; summary: string; description: string; priorityId?: number; assignee?: string }`
  - `buildCreateIssueUrl(p: CreateIssueParams): string`
  - `MAX_URL_LENGTH = 2000`, `TRUNCATION_MARKER = '... [truncated - see Teams link]'`

- [ ] **Step 1: Write the failing test**

```ts
// test/jiraUrl.test.ts
import { buildCreateIssueUrl, MAX_URL_LENGTH, TRUNCATION_MARKER } from '../src/jiraUrl';

const BASE = {
  baseUrl: 'https://jira.corp.example',
  pid: 10100,
  issueTypeId: 3,
  summary: 'Fix the thing',
  description: 'It broke',
};

describe('buildCreateIssueUrl', () => {
  it('builds the CreateIssueDetails URL with required params', () => {
    const url = buildCreateIssueUrl(BASE);
    expect(url.startsWith('https://jira.corp.example/secure/CreateIssueDetails!init.jspa?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('pid')).toBe('10100');
    expect(q.get('issuetype')).toBe('3');
    expect(q.get('summary')).toBe('Fix the thing');
    expect(q.get('description')).toBe('It broke');
    expect(q.has('priority')).toBe(false);
    expect(q.has('assignee')).toBe(false);
  });

  it('includes priority and assignee when given', () => {
    const q = new URL(
      buildCreateIssueUrl({ ...BASE, priorityId: 2, assignee: 'jsmith' })
    ).searchParams;
    expect(q.get('priority')).toBe('2');
    expect(q.get('assignee')).toBe('jsmith');
  });

  it('strips a trailing slash from baseUrl', () => {
    const url = buildCreateIssueUrl({ ...BASE, baseUrl: 'https://jira.corp.example/' });
    expect(url).toContain('https://jira.corp.example/secure/');
  });

  it('truncates long descriptions so the URL fits MAX_URL_LENGTH', () => {
    const url = buildCreateIssueUrl({ ...BASE, description: 'x'.repeat(5000) });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    const desc = new URL(url).searchParams.get('description')!;
    expect(desc.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(desc.startsWith('xxx')).toBe(true);
  });

  it('leaves short descriptions untouched', () => {
    const desc = new URL(buildCreateIssueUrl(BASE)).searchParams.get('description');
    expect(desc).toBe('It broke');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/jiraUrl.test.ts`
Expected: FAIL — cannot find module '../src/jiraUrl'

- [ ] **Step 3: Implement**

```ts
// src/jiraUrl.ts

export const MAX_URL_LENGTH = 2000;
export const TRUNCATION_MARKER = '... [truncated - see Teams link]';

export interface CreateIssueParams {
  baseUrl: string;
  pid: number;
  issueTypeId: number;
  summary: string;
  description: string;
  priorityId?: number;
  assignee?: string;
}

function assemble(p: CreateIssueParams, description: string): string {
  const base = p.baseUrl.replace(/\/+$/, '');
  const q = new URLSearchParams();
  q.set('pid', String(p.pid));
  q.set('issuetype', String(p.issueTypeId));
  q.set('summary', p.summary);
  q.set('description', description);
  if (p.priorityId !== undefined) q.set('priority', String(p.priorityId));
  if (p.assignee) q.set('assignee', p.assignee);
  return `${base}/secure/CreateIssueDetails!init.jspa?${q.toString()}`;
}

/**
 * Build a prefilled Jira Server/DC create-issue URL. If the URL exceeds
 * MAX_URL_LENGTH, the description is shortened and suffixed with
 * TRUNCATION_MARKER until it fits. The caller puts the Teams deep link at the
 * START of the description so truncation can never drop it.
 */
export function buildCreateIssueUrl(p: CreateIssueParams): string {
  let url = assemble(p, p.description);
  if (url.length <= MAX_URL_LENGTH) return url;

  let desc = p.description;
  while (url.length > MAX_URL_LENGTH && desc.length > 0) {
    // overshoot is in encoded chars; cut conservatively in raw chars
    const overshoot = url.length - MAX_URL_LENGTH;
    desc = desc.slice(0, Math.max(0, desc.length - Math.max(overshoot, 50)));
    url = assemble(p, desc + TRUNCATION_MARKER);
  }
  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/jiraUrl.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/jiraUrl.ts test/jiraUrl.test.ts
git commit -m "feat: prefilled CreateIssueDetails URL builder with length-safe truncation"
```

---

### Task 5: User preferences store (`userStore.ts`)

**Files:**
- Create: `src/userStore.ts`
- Test: `test/userStore.test.ts`

**Interfaces:**
- Consumes: `RegistryProject` from Task 3
- Produces (used by Tasks 7, 9):
  - `interface UserPrefs { jiraUsername: string; baseUrlOverride?: string; recentProjectKeys: string[]; userProjects: RegistryProject[] }`
  - `interface UserStore { get(userId: string): Promise<UserPrefs | undefined>; save(userId: string, prefs: UserPrefs): Promise<void> }`
  - `class MemoryUserStore implements UserStore`
  - `touchRecentProject(prefs: UserPrefs, key: string): UserPrefs` (pure; front-inserts, dedupes, caps at 10)

- [ ] **Step 1: Write the failing test**

```ts
// test/userStore.test.ts
import { MemoryUserStore, touchRecentProject, UserPrefs } from '../src/userStore';

const prefs = (recent: string[]): UserPrefs => ({
  jiraUsername: 'jsmith',
  recentProjectKeys: recent,
  userProjects: [],
});

describe('MemoryUserStore', () => {
  it('returns undefined for unknown user, round-trips saved prefs', async () => {
    const store = new MemoryUserStore();
    expect(await store.get('u1')).toBeUndefined();
    await store.save('u1', prefs(['ABC']));
    expect((await store.get('u1'))!.recentProjectKeys).toEqual(['ABC']);
  });
});

describe('touchRecentProject', () => {
  it('front-inserts a new key', () => {
    expect(touchRecentProject(prefs(['ABC']), 'XYZ').recentProjectKeys).toEqual(['XYZ', 'ABC']);
  });

  it('moves an existing key to front without duplicating', () => {
    expect(touchRecentProject(prefs(['ABC', 'XYZ']), 'XYZ').recentProjectKeys).toEqual(['XYZ', 'ABC']);
  });

  it('caps the list at 10', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const out = touchRecentProject(prefs(ten), 'NEW').recentProjectKeys;
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('NEW');
    expect(out).not.toContain('P9');
  });

  it('does not mutate the input', () => {
    const p = prefs(['ABC']);
    touchRecentProject(p, 'XYZ');
    expect(p.recentProjectKeys).toEqual(['ABC']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/userStore.test.ts`
Expected: FAIL — cannot find module '../src/userStore'

- [ ] **Step 3: Implement**

```ts
// src/userStore.ts
import { RegistryProject } from './projectRegistry';

export interface UserPrefs {
  jiraUsername: string;
  baseUrlOverride?: string;
  recentProjectKeys: string[];
  userProjects: RegistryProject[];
}

export interface UserStore {
  get(userId: string): Promise<UserPrefs | undefined>;
  save(userId: string, prefs: UserPrefs): Promise<void>;
}

export class MemoryUserStore implements UserStore {
  private data = new Map<string, UserPrefs>();

  async get(userId: string): Promise<UserPrefs | undefined> {
    return this.data.get(userId);
  }

  async save(userId: string, prefs: UserPrefs): Promise<void> {
    this.data.set(userId, prefs);
  }
}

const MAX_RECENT = 10;

export function touchRecentProject(prefs: UserPrefs, key: string): UserPrefs {
  const rest = prefs.recentProjectKeys.filter((k) => k !== key);
  return { ...prefs, recentProjectKeys: [key, ...rest].slice(0, MAX_RECENT) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/userStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/userStore.ts test/userStore.test.ts
git commit -m "feat: user preferences store with recent-projects recency"
```

---

### Task 6: Adaptive Card builders (`cards.ts`)

**Files:**
- Create: `src/cards.ts`
- Test: `test/cards.test.ts`

**Interfaces:**
- Consumes: `Priority` from Task 3
- Produces (used by Task 7). All return plain JSON objects (Adaptive Card `content`):
  - `configCard(opts: { defaultBaseUrl: string; username?: string; baseUrlOverride?: string }): object` — inputs with ids `jiraUsername`, `baseUrlOverride`, `newProjectKey`, `newProjectPid`, `newProjectIssueTypes`; submit data `{ formType: 'config' }`
  - `ticketDialogCard(opts: { projects: { key: string; name: string }[]; issueTypeNames: string[]; priorities: Priority[]; summary: string; description: string }): object` — inputs `projectKey`, `issueTypeName`, `priorityId`, `summary`, `description`; submit data `{ formType: 'ticket' }`; default priority value `'3'` if present, else first
  - `openInJiraCard(opts: { url: string; projectKey: string; summary: string }): object` — `Action.OpenUrl` with the URL
  - `errorCard(message: string): object`

- [ ] **Step 1: Write the failing test**

```ts
// test/cards.test.ts
import { configCard, ticketDialogCard, openInJiraCard, errorCard } from '../src/cards';

type AnyCard = { type: string; body: any[]; actions?: any[] };

const inputById = (card: AnyCard, id: string) =>
  card.body.find((el: any) => el.id === id);

describe('ticketDialogCard', () => {
  const card = ticketDialogCard({
    projects: [{ key: 'XYZ', name: 'Xylo' }, { key: 'ABC', name: 'Alpha' }],
    issueTypeNames: ['Task', 'Bug'],
    priorities: [{ name: 'High', id: 2 }, { name: 'Medium', id: 3 }],
    summary: 'First line',
    description: 'Reported by A in Teams: link\n\nbody',
  }) as AnyCard;

  it('is an AdaptiveCard with ticket submit data', () => {
    expect(card.type).toBe('AdaptiveCard');
    expect(card.actions![0].data).toEqual({ formType: 'ticket' });
  });

  it('prefills summary and description', () => {
    expect(inputById(card, 'summary').value).toBe('First line');
    expect(inputById(card, 'description').value).toContain('Reported by A');
    expect(inputById(card, 'description').isMultiline).toBe(true);
  });

  it('offers projects in given order, first preselected', () => {
    const ps = inputById(card, 'projectKey');
    expect(ps.choices.map((c: any) => c.value)).toEqual(['XYZ', 'ABC']);
    expect(ps.value).toBe('XYZ');
  });

  it('defaults priority to Medium (id 3) when present', () => {
    expect(inputById(card, 'priorityId').value).toBe('3');
  });
});

describe('configCard', () => {
  it('carries config submit data and prefills username', () => {
    const card = configCard({ defaultBaseUrl: 'https://j', username: 'jsmith' }) as AnyCard;
    expect(card.actions![0].data).toEqual({ formType: 'config' });
    expect(inputById(card, 'jiraUsername').value).toBe('jsmith');
    expect(inputById(card, 'newProjectKey')).toBeDefined();
  });
});

describe('openInJiraCard', () => {
  it('has an OpenUrl action pointing at the URL', () => {
    const card = openInJiraCard({ url: 'https://j/secure/x', projectKey: 'ABC', summary: 's' }) as AnyCard;
    const open = card.actions!.find((a: any) => a.type === 'Action.OpenUrl');
    expect(open.url).toBe('https://j/secure/x');
  });
});

describe('errorCard', () => {
  it('shows the message', () => {
    const card = errorCard('boom') as AnyCard;
    expect(JSON.stringify(card)).toContain('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/cards.test.ts`
Expected: FAIL — cannot find module '../src/cards'

- [ ] **Step 3: Implement**

```ts
// src/cards.ts
import { Priority } from './projectRegistry';

const SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
const VERSION = '1.4';

export function ticketDialogCard(opts: {
  projects: { key: string; name: string }[];
  issueTypeNames: string[];
  priorities: Priority[];
  summary: string;
  description: string;
}): object {
  const priorityDefault =
    opts.priorities.find((p) => p.id === 3) ?? opts.priorities[0];
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body: [
      {
        type: 'Input.ChoiceSet',
        id: 'projectKey',
        label: 'Project',
        isRequired: true,
        choices: opts.projects.map((p) => ({ title: `${p.key} — ${p.name}`, value: p.key })),
        value: opts.projects[0]?.key,
      },
      {
        type: 'Input.ChoiceSet',
        id: 'issueTypeName',
        label: 'Issue type',
        choices: opts.issueTypeNames.map((n) => ({ title: n, value: n })),
        value: opts.issueTypeNames[0],
      },
      {
        type: 'Input.ChoiceSet',
        id: 'priorityId',
        label: 'Priority',
        choices: opts.priorities.map((p) => ({ title: p.name, value: String(p.id) })),
        value: priorityDefault ? String(priorityDefault.id) : undefined,
      },
      { type: 'Input.Text', id: 'summary', label: 'Title', isRequired: true, value: opts.summary },
      {
        type: 'Input.Text',
        id: 'description',
        label: 'Description',
        isMultiline: true,
        value: opts.description,
      },
    ],
    actions: [{ type: 'Action.Submit', title: 'Create in Jira', data: { formType: 'ticket' } }],
  };
}

export function configCard(opts: {
  defaultBaseUrl: string;
  username?: string;
  baseUrlOverride?: string;
}): object {
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body: [
      {
        type: 'TextBlock',
        text: 'Jira setup (one time)',
        weight: 'Bolder',
        size: 'Medium',
      },
      {
        type: 'Input.Text',
        id: 'jiraUsername',
        label: 'Your Jira username (used to assign tickets to you)',
        isRequired: true,
        value: opts.username,
      },
      {
        type: 'Input.Text',
        id: 'baseUrlOverride',
        label: `Jira base URL (leave empty for ${opts.defaultBaseUrl})`,
        value: opts.baseUrlOverride,
      },
      {
        type: 'TextBlock',
        text: 'Optional: add a project not in the org list (find pid in Jira project settings URL)',
        wrap: true,
        spacing: 'Medium',
      },
      { type: 'Input.Text', id: 'newProjectKey', label: 'Project key (e.g. PERS)' },
      { type: 'Input.Text', id: 'newProjectPid', label: 'Project id (pid, numeric)' },
      {
        type: 'Input.Text',
        id: 'newProjectIssueTypes',
        label: 'Issue types as Name:id, comma-separated (e.g. Task:3,Bug:1)',
      },
    ],
    actions: [{ type: 'Action.Submit', title: 'Save', data: { formType: 'config' } }],
  };
}

export function openInJiraCard(opts: { url: string; projectKey: string; summary: string }): object {
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body: [
      { type: 'TextBlock', text: 'Ready to create in Jira', weight: 'Bolder', size: 'Medium' },
      { type: 'TextBlock', text: `${opts.projectKey}: ${opts.summary}`, wrap: true },
      {
        type: 'TextBlock',
        text: 'The Jira create screen opens prefilled in your browser (VPN required). Review and click Create there.',
        wrap: true,
        isSubtle: true,
      },
    ],
    actions: [{ type: 'Action.OpenUrl', title: 'Open in Jira', url: opts.url }],
  };
}

export function errorCard(message: string): object {
  return {
    type: 'AdaptiveCard',
    $schema: SCHEMA,
    version: VERSION,
    body: [
      { type: 'TextBlock', text: 'Something went wrong', weight: 'Bolder', color: 'Attention' },
      { type: 'TextBlock', text: message, wrap: true },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/cards.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/cards.ts test/cards.test.ts
git commit -m "feat: adaptive card builders for config, ticket dialog, open-in-jira"
```

---

### Task 7: Invoke logic (`handlers.ts`) — the brain

**Files:**
- Create: `src/handlers.ts`
- Test: `test/handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces (used by Task 8):
  - `interface MessagePayloadLite { body?: { content?: string; contentType?: string }; from?: { user?: { displayName?: string } }; linkToMessage?: string }`
  - `interface Deps { registry: Registry; store: UserStore; defaultBaseUrl: string }`
  - `taskContinue(card: object, title?: string): MessagingExtensionActionResponse-shaped object`
  - `onFetchTask(deps: Deps, userId: string, payload: MessagePayloadLite): Promise<object>`
  - `onSubmitAction(deps: Deps, userId: string, data: Record<string, string | undefined>, payload: MessagePayloadLite): Promise<object>`

Behavior contract:
- fetchTask, no prefs → config card. With prefs → ticket dialog: projects = org registry + userProjects, ordered by user recency (recent first, then remaining registry order); summary = first line of converted text (≤120 chars); description = `Reported by <name> in Teams: <link>` + blank line + converted text.
- submitAction `formType: 'config'` → validate username; parse optional custom project; save prefs; return ticket dialog (message payload is present on submit actions too).
- submitAction `formType: 'ticket'` → resolve project (unknown → error card), map issue type name → id for that project, build URL with assignee = stored username, save recency, return open-in-jira card.

- [ ] **Step 1: Write the failing test**

```ts
// test/handlers.test.ts
import { onFetchTask, onSubmitAction, Deps, MessagePayloadLite } from '../src/handlers';
import { parseRegistry } from '../src/projectRegistry';
import { MemoryUserStore } from '../src/userStore';

const REG = parseRegistry(
  JSON.stringify({
    projects: [
      { key: 'ABC', name: 'Alpha', pid: 10100, issueTypes: [{ name: 'Task', id: 3 }, { name: 'Bug', id: 1 }] },
      { key: 'XYZ', name: 'Xylo', pid: 10200, issueTypes: [{ name: 'Task', id: 3 }] },
    ],
  })
);

const PAYLOAD: MessagePayloadLite = {
  body: { content: '<p>Server is <b>down</b></p><p>since 9am</p>', contentType: 'html' },
  from: { user: { displayName: 'Ann Example' } },
  linkToMessage: 'https://teams.microsoft.com/l/message/19:x/123',
};

function makeDeps(): Deps {
  return { registry: REG, store: new MemoryUserStore(), defaultBaseUrl: 'https://jira.corp.example' };
}

const cardOf = (resp: any) => resp.task.value.card.content;
const inputById = (card: any, id: string) => card.body.find((el: any) => el.id === id);
const submitData = (card: any) => card.actions[0].data;

describe('onFetchTask', () => {
  it('returns config card when user has no prefs', async () => {
    const resp: any = await onFetchTask(makeDeps(), 'u1', PAYLOAD);
    expect(resp.task.type).toBe('continue');
    expect(submitData(cardOf(resp))).toEqual({ formType: 'config' });
  });

  it('returns prefilled ticket dialog for configured user, recency first', async () => {
    const deps = makeDeps();
    await deps.store.save('u1', {
      jiraUsername: 'ann',
      recentProjectKeys: ['XYZ'],
      userProjects: [],
    });
    const card = cardOf(await onFetchTask(deps, 'u1', PAYLOAD));
    expect(inputById(card, 'summary').value).toBe('Server is down');
    const desc = inputById(card, 'description').value as string;
    expect(desc.startsWith('Reported by Ann Example in Teams: https://teams.microsoft.com/l/message/19:x/123')).toBe(true);
    expect(desc).toContain('since 9am');
    expect(inputById(card, 'projectKey').choices.map((c: any) => c.value)).toEqual(['XYZ', 'ABC']);
  });
});

describe('onSubmitAction config', () => {
  it('saves prefs (with custom project) and returns ticket dialog', async () => {
    const deps = makeDeps();
    const resp: any = await onSubmitAction(
      deps,
      'u1',
      {
        formType: 'config',
        jiraUsername: 'ann',
        newProjectKey: 'PERS',
        newProjectPid: '10900',
        newProjectIssueTypes: 'Task:3,Chore:11',
      },
      PAYLOAD
    );
    const saved = (await deps.store.get('u1'))!;
    expect(saved.jiraUsername).toBe('ann');
    expect(saved.userProjects).toEqual([
      { key: 'PERS', name: 'PERS', pid: 10900, issueTypes: [{ name: 'Task', id: 3 }, { name: 'Chore', id: 11 }] },
    ]);
    expect(submitData(cardOf(resp))).toEqual({ formType: 'ticket' });
  });

  it('re-shows config card with error when username missing', async () => {
    const resp: any = await onSubmitAction(makeDeps(), 'u1', { formType: 'config' }, PAYLOAD);
    expect(submitData(cardOf(resp))).toEqual({ formType: 'config' });
  });
});

describe('onSubmitAction ticket', () => {
  const DATA = {
    formType: 'ticket',
    projectKey: 'ABC',
    issueTypeName: 'Bug',
    priorityId: '2',
    summary: 'Server down',
    description: 'Reported by Ann in Teams: link\n\nbody',
  };

  it('returns open-in-jira card with correct URL and updates recency', async () => {
    const deps = makeDeps();
    await deps.store.save('u1', { jiraUsername: 'ann', recentProjectKeys: [], userProjects: [] });
    const resp: any = await onSubmitAction(deps, 'u1', DATA, PAYLOAD);
    const card = cardOf(resp);
    const open = card.actions.find((a: any) => a.type === 'Action.OpenUrl');
    const q = new URL(open.url).searchParams;
    expect(q.get('pid')).toBe('10100');
    expect(q.get('issuetype')).toBe('1'); // Bug in ABC
    expect(q.get('priority')).toBe('2');
    expect(q.get('assignee')).toBe('ann');
    expect(q.get('summary')).toBe('Server down');
    expect((await deps.store.get('u1'))!.recentProjectKeys).toEqual(['ABC']);
  });

  it('returns error card for unknown project key', async () => {
    const deps = makeDeps();
    await deps.store.save('u1', { jiraUsername: 'ann', recentProjectKeys: [], userProjects: [] });
    const resp: any = await onSubmitAction(deps, 'u1', { ...DATA, projectKey: 'NOPE' }, PAYLOAD);
    expect(JSON.stringify(cardOf(resp))).toContain('NOPE');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/handlers.test.ts`
Expected: FAIL — cannot find module '../src/handlers'

- [ ] **Step 3: Implement**

```ts
// src/handlers.ts
import { htmlToText } from './messageText';
import {
  Registry,
  RegistryProject,
  findProject,
  issueTypeIdFor,
  unionIssueTypeNames,
} from './projectRegistry';
import { buildCreateIssueUrl } from './jiraUrl';
import { UserStore, UserPrefs, touchRecentProject } from './userStore';
import { configCard, ticketDialogCard, openInJiraCard, errorCard } from './cards';

export interface MessagePayloadLite {
  body?: { content?: string; contentType?: string };
  from?: { user?: { displayName?: string } };
  linkToMessage?: string;
}

export interface Deps {
  registry: Registry;
  store: UserStore;
  defaultBaseUrl: string;
}

const MAX_SUMMARY = 120;

export function taskContinue(card: object, title = 'Create Jira ticket'): object {
  return {
    task: {
      type: 'continue',
      value: {
        title,
        height: 'medium',
        width: 'medium',
        card: { contentType: 'application/vnd.microsoft.card.adaptive', content: card },
      },
    },
  };
}

function extractText(payload: MessagePayloadLite): string {
  const raw = payload.body?.content ?? '';
  return payload.body?.contentType === 'html' ? htmlToText(raw) : raw.trim();
}

function buildPrefill(payload: MessagePayloadLite): { summary: string; description: string } {
  const text = extractText(payload);
  const firstLine = text.split('\n')[0] ?? '';
  const summary = firstLine.slice(0, MAX_SUMMARY);
  const author = payload.from?.user?.displayName ?? 'unknown';
  const link = payload.linkToMessage ?? '';
  const header = link
    ? `Reported by ${author} in Teams: ${link}`
    : `Reported by ${author} in Teams`;
  return { summary, description: `${header}\n\n${text}` };
}

function orderedProjects(deps: Deps, prefs: UserPrefs): RegistryProject[] {
  const all = [...deps.registry.projects, ...prefs.userProjects];
  const recent = prefs.recentProjectKeys
    .map((k) => all.find((p) => p.key === k))
    .filter((p): p is RegistryProject => p !== undefined);
  const rest = all.filter((p) => !prefs.recentProjectKeys.includes(p.key));
  return [...recent, ...rest];
}

function ticketDialogFor(deps: Deps, prefs: UserPrefs, payload: MessagePayloadLite): object {
  const projects = orderedProjects(deps, prefs);
  const { summary, description } = buildPrefill(payload);
  return taskContinue(
    ticketDialogCard({
      projects: projects.map((p) => ({ key: p.key, name: p.name })),
      issueTypeNames: unionIssueTypeNames(projects),
      priorities: deps.registry.priorities,
      summary,
      description,
    })
  );
}

export async function onFetchTask(
  deps: Deps,
  userId: string,
  payload: MessagePayloadLite
): Promise<object> {
  const prefs = await deps.store.get(userId);
  if (!prefs) {
    return taskContinue(configCard({ defaultBaseUrl: deps.defaultBaseUrl }), 'Jira setup');
  }
  return ticketDialogFor(deps, prefs, payload);
}

function parseIssueTypes(csv: string): { name: string; id: number }[] {
  return csv
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const [name, id] = pair.split(':');
      return { name: name.trim(), id: Number(id) };
    })
    .filter((t) => t.name.length > 0 && Number.isFinite(t.id));
}

async function handleConfigSubmit(
  deps: Deps,
  userId: string,
  data: Record<string, string | undefined>,
  payload: MessagePayloadLite
): Promise<object> {
  const username = data.jiraUsername?.trim();
  if (!username) {
    return taskContinue(configCard({ defaultBaseUrl: deps.defaultBaseUrl }), 'Jira setup');
  }
  const existing = await deps.store.get(userId);
  const prefs: UserPrefs = {
    jiraUsername: username,
    baseUrlOverride: data.baseUrlOverride?.trim() || undefined,
    recentProjectKeys: existing?.recentProjectKeys ?? [],
    userProjects: existing?.userProjects ?? [],
  };
  const key = data.newProjectKey?.trim();
  const pid = Number(data.newProjectPid);
  if (key && Number.isFinite(pid) && pid > 0) {
    const issueTypes = parseIssueTypes(data.newProjectIssueTypes ?? '');
    if (issueTypes.length > 0) {
      prefs.userProjects = [
        ...prefs.userProjects.filter((p) => p.key !== key),
        { key, name: key, pid, issueTypes },
      ];
    }
  }
  await deps.store.save(userId, prefs);
  return ticketDialogFor(deps, prefs, payload);
}

async function handleTicketSubmit(
  deps: Deps,
  userId: string,
  data: Record<string, string | undefined>,
  payload: MessagePayloadLite
): Promise<object> {
  const prefs = await deps.store.get(userId);
  if (!prefs) {
    return taskContinue(configCard({ defaultBaseUrl: deps.defaultBaseUrl }), 'Jira setup');
  }
  const projectKey = data.projectKey ?? '';
  const project = findProject(deps.registry, prefs.userProjects, projectKey);
  if (!project) {
    return taskContinue(errorCard(`Unknown project key "${projectKey}". Add it via Jira setup.`));
  }
  const url = buildCreateIssueUrl({
    baseUrl: prefs.baseUrlOverride ?? deps.defaultBaseUrl,
    pid: project.pid,
    issueTypeId: issueTypeIdFor(project, data.issueTypeName ?? ''),
    summary: data.summary ?? '',
    description: data.description ?? '',
    priorityId: data.priorityId ? Number(data.priorityId) : undefined,
    assignee: prefs.jiraUsername,
  });
  await deps.store.save(userId, touchRecentProject(prefs, project.key));
  return taskContinue(
    openInJiraCard({ url, projectKey: project.key, summary: data.summary ?? '' }),
    'Open in Jira'
  );
}

export async function onSubmitAction(
  deps: Deps,
  userId: string,
  data: Record<string, string | undefined>,
  payload: MessagePayloadLite
): Promise<object> {
  if (data.formType === 'config') return handleConfigSubmit(deps, userId, data, payload);
  if (data.formType === 'ticket') return handleTicketSubmit(deps, userId, data, payload);
  return taskContinue(errorCard('Unrecognized submission.'));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/handlers.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, all files

- [ ] **Step 6: Commit**

```bash
git add src/handlers.ts test/handlers.test.ts
git commit -m "feat: fetchTask/submitAction logic for config and ticket dialogs"
```

---

### Task 8: Config, bot class, server (`config.ts`, `bot.ts`, `index.ts`)

**Files:**
- Create: `src/config.ts`, `src/bot.ts`
- Create/Replace: `src/index.ts` (replace the `export {};` placeholder if Task 1 created one)
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `Deps`, `onFetchTask`, `onSubmitAction` from Task 7; `parseRegistry` from Task 3; `MemoryUserStore` from Task 5.
- Produces:
  - `interface AppConfig { jiraBaseUrl: string; registryPath: string; port: number; storageConnectionString?: string }`
  - `loadConfig(env: NodeJS.ProcessEnv): AppConfig` (throws when `JIRA_BASE_URL` missing)
  - `class TeamsJiraBot extends TeamsActivityHandler` (used by Task 9's wiring note)

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('reads values from env with defaults', () => {
    const cfg = loadConfig({ JIRA_BASE_URL: 'https://jira.corp.example', PORT: '4000' });
    expect(cfg).toEqual({
      jiraBaseUrl: 'https://jira.corp.example',
      registryPath: 'registry/projects.json',
      port: 4000,
      storageConnectionString: undefined,
    });
  });

  it('defaults port to 3978 and honors REGISTRY_PATH / STORAGE_CONNECTION_STRING', () => {
    const cfg = loadConfig({
      JIRA_BASE_URL: 'https://j',
      REGISTRY_PATH: '/etc/reg.json',
      STORAGE_CONNECTION_STRING: 'UseDevelopmentStorage=true',
    });
    expect(cfg.port).toBe(3978);
    expect(cfg.registryPath).toBe('/etc/reg.json');
    expect(cfg.storageConnectionString).toBe('UseDevelopmentStorage=true');
  });

  it('throws without JIRA_BASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/JIRA_BASE_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/config.test.ts`
Expected: FAIL — cannot find module '../src/config'

- [ ] **Step 3: Implement `src/config.ts`**

```ts
// src/config.ts

export interface AppConfig {
  jiraBaseUrl: string;
  registryPath: string;
  port: number;
  storageConnectionString?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const jiraBaseUrl = env.JIRA_BASE_URL;
  if (!jiraBaseUrl) throw new Error('JIRA_BASE_URL env var is required');
  return {
    jiraBaseUrl,
    registryPath: env.REGISTRY_PATH ?? 'registry/projects.json',
    port: env.PORT ? Number(env.PORT) : 3978,
    storageConnectionString: env.STORAGE_CONNECTION_STRING,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/config.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement `src/bot.ts`** (thin adapter — no unit test; covered by handlers tests + manual E2E)

```ts
// src/bot.ts
import {
  TeamsActivityHandler,
  TurnContext,
  MessagingExtensionAction,
  MessagingExtensionActionResponse,
} from 'botbuilder';
import { Deps, onFetchTask, onSubmitAction, MessagePayloadLite } from './handlers';

function userIdOf(context: TurnContext): string {
  return context.activity.from.aadObjectId ?? context.activity.from.id;
}

export class TeamsJiraBot extends TeamsActivityHandler {
  constructor(private deps: Deps) {
    super();
  }

  protected async handleTeamsMessagingExtensionFetchTask(
    context: TurnContext,
    action: MessagingExtensionAction
  ): Promise<MessagingExtensionActionResponse> {
    return (await onFetchTask(
      this.deps,
      userIdOf(context),
      (action.messagePayload ?? {}) as MessagePayloadLite
    )) as MessagingExtensionActionResponse;
  }

  protected async handleTeamsMessagingExtensionSubmitAction(
    context: TurnContext,
    action: MessagingExtensionAction
  ): Promise<MessagingExtensionActionResponse> {
    return (await onSubmitAction(
      this.deps,
      userIdOf(context),
      (action.data ?? {}) as Record<string, string | undefined>,
      (action.messagePayload ?? {}) as MessagePayloadLite
    )) as MessagingExtensionActionResponse;
  }
}
```

- [ ] **Step 6: Implement `src/index.ts`**

```ts
// src/index.ts
import * as fs from 'fs';
import express from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';
import { loadConfig } from './config';
import { parseRegistry } from './projectRegistry';
import { MemoryUserStore, UserStore } from './userStore';
import { TableUserStore } from './tableUserStore';
import { TeamsJiraBot } from './bot';
import { Deps } from './handlers';

const config = loadConfig(process.env);
const registry = parseRegistry(fs.readFileSync(config.registryPath, 'utf8'));

const store: UserStore = config.storageConnectionString
  ? TableUserStore.fromConnectionString(config.storageConnectionString)
  : new MemoryUserStore();
if (!config.storageConnectionString) {
  console.warn('STORAGE_CONNECTION_STRING not set — using in-memory store (dev only)');
}

const deps: Deps = { registry, store, defaultBaseUrl: config.jiraBaseUrl };
const bot = new TeamsJiraBot(deps);

// Reads MicrosoftAppId / MicrosoftAppPassword / MicrosoftAppType /
// MicrosoftAppTenantId from process.env.
const auth = new ConfigurationBotFrameworkAuthentication(process.env as never);
const adapter = new CloudAdapter(auth);

adapter.onTurnError = async (context, error) => {
  console.error('Turn error:', error.message);
  await context.sendActivity('The Jira extension hit an error. Try again.');
};

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

app.listen(config.port, () => {
  console.log(`teams-to-jira listening on :${config.port}`);
});
```

Note: `TableUserStore` does not exist until Task 9. To keep this task buildable, create a stub now:

```ts
// src/tableUserStore.ts (stub — replaced in Task 9)
import { MemoryUserStore } from './userStore';

export class TableUserStore extends MemoryUserStore {
  static fromConnectionString(_conn: string): TableUserStore {
    throw new Error('TableUserStore not implemented yet (Task 9)');
  }
}
```

- [ ] **Step 7: Build and smoke-run**

Run: `npm run build && JIRA_BASE_URL=https://jira.corp.example node dist/index.js &` then `sleep 2 && curl -s localhost:3978/health && kill %1`
Expected: build clean; curl prints `ok`.

- [ ] **Step 8: Full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/config.ts src/bot.ts src/index.ts src/tableUserStore.ts test/config.test.ts
git commit -m "feat: bot adapter, env config, express server wiring"
```

---

### Task 9: Table Storage store (`tableUserStore.ts`)

**Files:**
- Replace: `src/tableUserStore.ts` (stub from Task 8)
- Test: `test/tableUserStore.test.ts`

**Interfaces:**
- Consumes: `UserStore`, `UserPrefs` from Task 5.
- Produces: `class TableUserStore implements UserStore` with `constructor(client: TableClientLike)` and `static fromConnectionString(conn: string, table?: string): TableUserStore`. Entity layout: `partitionKey: 'user'`, `rowKey: <userId>`, `prefsJson: <JSON string>`.
- `interface TableClientLike { getEntity(pk: string, rk: string): Promise<{ prefsJson?: string }>; upsertEntity(e: { partitionKey: string; rowKey: string; prefsJson: string }, mode: string): Promise<unknown>; createTable(): Promise<unknown> }` — lets tests inject a fake instead of hitting Azure.

- [ ] **Step 1: Write the failing test**

```ts
// test/tableUserStore.test.ts
import { TableUserStore } from '../src/tableUserStore';
import { UserPrefs } from '../src/userStore';

class FakeTableClient {
  entities = new Map<string, { partitionKey: string; rowKey: string; prefsJson: string }>();
  createCalls = 0;

  async createTable(): Promise<void> {
    this.createCalls++;
  }

  async getEntity(pk: string, rk: string): Promise<{ prefsJson?: string }> {
    const e = this.entities.get(`${pk}|${rk}`);
    if (!e) {
      const err = new Error('not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return e;
  }

  async upsertEntity(
    e: { partitionKey: string; rowKey: string; prefsJson: string },
    _mode: string
  ): Promise<void> {
    this.entities.set(`${e.partitionKey}|${e.rowKey}`, e);
  }
}

const PREFS: UserPrefs = {
  jiraUsername: 'ann',
  recentProjectKeys: ['ABC'],
  userProjects: [],
};

describe('TableUserStore', () => {
  it('returns undefined on 404', async () => {
    const store = new TableUserStore(new FakeTableClient());
    expect(await store.get('u1')).toBeUndefined();
  });

  it('round-trips prefs as JSON under partition "user"', async () => {
    const fake = new FakeTableClient();
    const store = new TableUserStore(fake);
    await store.save('u1', PREFS);
    expect(fake.entities.has('user|u1')).toBe(true);
    expect(await store.get('u1')).toEqual(PREFS);
  });

  it('rethrows non-404 errors', async () => {
    const fake = new FakeTableClient();
    fake.getEntity = async () => {
      const err = new Error('boom') as Error & { statusCode: number };
      err.statusCode = 500;
      throw err;
    };
    const store = new TableUserStore(fake);
    await expect(store.get('u1')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest test/tableUserStore.test.ts`
Expected: FAIL — stub's constructor/behavior mismatch ("TableUserStore not implemented yet" or type errors)

- [ ] **Step 3: Implement (replace stub entirely)**

```ts
// src/tableUserStore.ts
import { TableClient } from '@azure/data-tables';
import { UserStore, UserPrefs } from './userStore';

const PARTITION = 'user';
const DEFAULT_TABLE = 'userprefs';

export interface TableClientLike {
  createTable(): Promise<unknown>;
  getEntity(partitionKey: string, rowKey: string): Promise<{ prefsJson?: string }>;
  upsertEntity(
    entity: { partitionKey: string; rowKey: string; prefsJson: string },
    mode: string
  ): Promise<unknown>;
}

export class TableUserStore implements UserStore {
  private ready: Promise<unknown> | undefined;

  constructor(private client: TableClientLike) {}

  static fromConnectionString(conn: string, table = DEFAULT_TABLE): TableUserStore {
    return new TableUserStore(
      TableClient.fromConnectionString(conn, table) as unknown as TableClientLike
    );
  }

  private ensureTable(): Promise<unknown> {
    // createTable is idempotent-ish: 409 "already exists" is swallowed
    this.ready ??= this.client.createTable().catch((err: { statusCode?: number }) => {
      if (err.statusCode !== 409) throw err;
    });
    return this.ready;
  }

  async get(userId: string): Promise<UserPrefs | undefined> {
    await this.ensureTable();
    try {
      const entity = await this.client.getEntity(PARTITION, userId);
      return entity.prefsJson ? (JSON.parse(entity.prefsJson) as UserPrefs) : undefined;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return undefined;
      throw err;
    }
  }

  async save(userId: string, prefs: UserPrefs): Promise<void> {
    await this.ensureTable();
    await this.client.upsertEntity(
      { partitionKey: PARTITION, rowKey: userId, prefsJson: JSON.stringify(prefs) },
      'Replace'
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest test/tableUserStore.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: PASS, clean build

- [ ] **Step 6: Commit**

```bash
git add src/tableUserStore.ts test/tableUserStore.test.ts
git commit -m "feat: azure table storage user prefs store"
```

---

### Task 10: Teams app package (`manifest.json`, icons, zip)

**Files:**
- Create: `appPackage/manifest.json`, `scripts/make-icons.js`

**Interfaces:**
- Consumes: nothing from code — `${{BOT_ID}}`-style placeholders are replaced manually before upload (documented in RUNBOOK).
- Produces: `npm run package` → `appPackage.zip` for org-catalog upload.

- [ ] **Step 1: Write `appPackage/manifest.json`**

Placeholders `<<BOT_ID>>` (Entra app id of the bot) and `<<BOT_DOMAIN>>` (App Service hostname, e.g. `teams-to-jira.azurewebsites.net`) get find-replaced before packaging.

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.16/MicrosoftTeams.schema.json",
  "manifestVersion": "1.16",
  "version": "0.1.0",
  "id": "<<BOT_ID>>",
  "packageName": "com.example.teamstojira",
  "developer": {
    "name": "Internal Tools",
    "websiteUrl": "https://<<BOT_DOMAIN>>",
    "privacyUrl": "https://<<BOT_DOMAIN>>/health",
    "termsOfUseUrl": "https://<<BOT_DOMAIN>>/health"
  },
  "name": { "short": "Jira Ticket", "full": "Create Jira ticket from message" },
  "description": {
    "short": "Create a prefilled Jira ticket from any message",
    "full": "Right-click a message and open a prefilled Jira Server create screen in your browser. No credentials stored; uses your existing Jira browser session."
  },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#0052CC",
  "bots": [
    {
      "botId": "<<BOT_ID>>",
      "scopes": ["personal", "team", "groupChat"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "composeExtensions": [
    {
      "botId": "<<BOT_ID>>",
      "commands": [
        {
          "id": "createJiraTicket",
          "type": "action",
          "title": "Create Jira ticket",
          "description": "Create a prefilled Jira ticket from this message",
          "context": ["message"],
          "fetchTask": true
        }
      ]
    }
  ],
  "permissions": ["identity"],
  "validDomains": ["<<BOT_DOMAIN>>"]
}
```

- [ ] **Step 2: Write `scripts/make-icons.js`** (generates solid-color PNGs — 192×192 color, 32×32 outline — with zero dependencies)

```js
// scripts/make-icons.js — writes appPackage/color.png (192x192) and outline.png (32x32)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, [r, g, b, a]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4)]);
  for (let x = 0; x < size; x++) row.set([r, g, b, a], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = path.join(__dirname, '..', 'appPackage');
fs.writeFileSync(path.join(dir, 'color.png'), png(192, [0x00, 0x52, 0xcc, 0xff])); // Jira blue
fs.writeFileSync(path.join(dir, 'outline.png'), png(32, [0xff, 0xff, 0xff, 0xff]));
console.log('icons written');
```

- [ ] **Step 3: Verify packaging**

Run: `npm run package && unzip -l appPackage.zip`
Expected: zip contains `manifest.json`, `color.png`, `outline.png`. Then `node -e "const z=require('fs').statSync('appPackage/color.png'); console.log(z.size > 100)"` prints `true`.

- [ ] **Step 4: Commit**

```bash
git add appPackage/manifest.json scripts/make-icons.js
git commit -m "feat: teams app manifest and icon/package generation"
```

---

### Task 11: Runbook (Azure setup, verification gates, E2E checklist)

**Files:**
- Create: `docs/RUNBOOK.md`

**Interfaces:**
- Consumes: everything — this is the operator manual.
- Produces: the document ops/you follow to deploy and validate.

- [ ] **Step 1: Write `docs/RUNBOOK.md`**

```markdown
# Runbook — Teams → Jira (Variant L)

## 0. Verification gates (do FIRST, before deploying anything)

1. **Custom app upload allowed?** Teams → Apps → Manage your apps → "Upload an app".
   If missing, ask the Teams admin to enable custom apps for your account/org.
2. **Prefilled create screen works?** While on VPN, open (values from any real project):
   `https://<jira>/secure/CreateIssueDetails!init.jspa?pid=<PID>&issuetype=<TYPEID>&summary=hello&description=world`
   Expected: Jira create form, prefilled. If Jira errors instead, Variant L is not
   viable on this instance — fall back to Variant F (see design spec §6).

## 1. Azure resources (one-time)

1. **Entra app registration**: single tenant. Note Application (client) ID and create
   a client secret. This is the bot identity.
2. **Azure Bot resource**: create with the app registration above; messaging endpoint
   `https://<app-service-host>/api/messages`; enable the Microsoft Teams channel.
3. **Storage account**: Standard LRS. Copy a connection string (Table service is used;
   table `userprefs` is auto-created).
4. **App Service**: Linux, Node 20, plan B1. No VNet integration needed for Variant L.

## 2. App Service configuration (env vars)

| Var | Value |
|---|---|
| `MicrosoftAppType` | `SingleTenant` |
| `MicrosoftAppId` | Entra app (client) ID |
| `MicrosoftAppPassword` | client secret |
| `MicrosoftAppTenantId` | tenant ID |
| `JIRA_BASE_URL` | `https://jira.<company>.com` |
| `STORAGE_CONNECTION_STRING` | storage connection string |
| `REGISTRY_PATH` | optional, defaults to `registry/projects.json` |

Deploy: `npm run build`, then deploy repo (with `dist/`, `registry/`, `node_modules`
via CI or zip-deploy `az webapp deploy`). Health check: `GET /health` → `ok`.

## 3. Fill the org project registry

Edit `registry/projects.json` with real projects. Finding IDs (needs any Jira
browser session):
- **pid**: Project settings URL contains `pid=...`, or hover a project link in
  admin → Projects.
- **issue type ids**: `https://<jira>/rest/api/2/issue/createmeta?projectKeys=<KEY>`
  in the browser (session-authenticated) lists issue types with ids. Also visible in
  Admin → Issue types (link URLs contain the id).
- **priority ids**: `https://<jira>/rest/api/2/priority` — defaults are 1..5.

## 4. Teams app package + org catalog

1. In `appPackage/manifest.json` replace `<<BOT_ID>>` with the Entra app ID and
   `<<BOT_DOMAIN>>` with the App Service hostname.
2. `npm run package` → `appPackage.zip`.
3. Personal test first: Teams → Apps → Manage your apps → Upload an app → Upload a
   custom app → pick the zip.
4. Org rollout: Teams admin center → Teams apps → Manage apps → Upload new app
   (admin does this); users then install from the org catalog ("Built for your org").

## 5. Manual E2E checklist (run after every deploy)

- [ ] Right-click any chat message → Apps → "Create Jira ticket" appears.
- [ ] First run shows "Jira setup" dialog; saving username leads to ticket dialog.
- [ ] Ticket dialog: title = first line of message; description starts with
      "Reported by <author> in Teams: https://teams.microsoft.com/l/message/...".
- [ ] Submitting shows "Open in Jira" card; button opens prefilled Jira create
      screen in browser (on VPN); Create in Jira succeeds; assignee = you.
- [ ] Second use: previously used project listed first.
- [ ] Very long message (>3000 chars): URL still opens; description ends with
      "... [truncated - see Teams link]"; Teams link intact at the top.
- [ ] Off VPN: button opens browser; Jira unreachable page (expected, acceptable).
- [ ] Message with code block/formatting: description is readable plain text.

## 6. Troubleshooting

- Dialog never opens / spinner: check App Service logs (`az webapp log tail`).
  Common: wrong `MicrosoftApp*` values → 401 from Bot Framework.
- "Something went wrong" card with unknown project: project key missing from
  registry and user projects — add to `registry/projects.json` and redeploy, or
  user adds it via the setup dialog.
- Prefill lands on wrong issue type: issue type name not present in that project —
  falls back to project's first issue type by design.
```

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "docs: deployment runbook with verification gates and e2e checklist"
```

---

## Self-review notes (already applied)

- Spec §4.2 recency ordering, §5.2 open-url flow, §5.3 pid registry + per-user custom projects, §5.4 truncation/link-first, §5.6 no-VNet footprint: covered by Tasks 3–7, 10–11.
- Deferred consciously (YAGNI, spec-compatible): Jira wiki `{code}` markup for code blocks (spec calls it nice-to-have); config re-entry UX beyond re-running setup when prefs missing.
- Type consistency checked: `UserPrefs`/`RegistryProject` shapes match across Tasks 3, 5, 7, 9; card input ids (`projectKey`, `issueTypeName`, `priorityId`, `summary`, `description`) match between Tasks 6 and 7 tests.
