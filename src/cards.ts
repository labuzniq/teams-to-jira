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
