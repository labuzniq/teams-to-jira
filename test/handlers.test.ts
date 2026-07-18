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
