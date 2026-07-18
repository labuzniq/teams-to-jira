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

  it('truncates an oversized summary so the URL fits MAX_URL_LENGTH', () => {
    const url = buildCreateIssueUrl({ ...BASE, summary: 'x'.repeat(2100), description: 'short' });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    const summary = new URL(url).searchParams.get('summary')!;
    expect(summary.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(summary.length).toBeLessThan(2100);
  });

  it('keeps the URL within MAX_URL_LENGTH when both summary and description are huge', () => {
    const url = buildCreateIssueUrl({
      ...BASE,
      summary: 'y'.repeat(4000),
      description: 'z'.repeat(4000),
    });
    expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
  });
});
