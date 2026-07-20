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
// Hard cap on the user-editable summary sent to Jira (Jira's own summary limit
// is 255). Bounds the summary so it cannot push the create-issue URL over the
// length limit or force the Teams deep link out of the description.
const MAX_SUBMIT_SUMMARY = 255;

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
  // Put the Teams deep link literally FIRST so back-truncation in
  // buildCreateIssueUrl (which trims from the end) can never drop it, even
  // when the author's display name is very long.
  const header = link
    ? `${link}\nReported by ${author} in Teams`
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
  const summary = (data.summary ?? '').slice(0, MAX_SUBMIT_SUMMARY);
  const url = buildCreateIssueUrl({
    baseUrl: prefs.baseUrlOverride ?? deps.defaultBaseUrl,
    pid: project.pid,
    issueTypeId: issueTypeIdFor(project, data.issueTypeName ?? ''),
    summary,
    description: data.description ?? '',
    priorityId: data.priorityId ? Number(data.priorityId) : undefined,
    assignee: prefs.jiraUsername,
  });
  await deps.store.save(userId, touchRecentProject(prefs, project.key));
  return taskContinue(
    openInJiraCard({ url, projectKey: project.key, summary }),
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
