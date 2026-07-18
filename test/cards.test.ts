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
