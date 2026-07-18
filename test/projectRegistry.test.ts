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
