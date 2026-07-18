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
 * MAX_URL_LENGTH, the description is shortened first and suffixed with
 * TRUNCATION_MARKER until it fits. The caller puts the Teams deep link at the
 * START of the description so back-truncation can never drop it. As a final
 * guard, a large user-controlled summary (the ticket dialog imposes no
 * maxLength) is hard-truncated too, so the URL never exceeds MAX_URL_LENGTH.
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
  if (url.length <= MAX_URL_LENGTH) return url;

  // Description alone could not make the URL fit: the summary is oversized.
  // Hard-truncate it as a final guard so MAX_URL_LENGTH always holds.
  const shrunkDesc = desc.length > 0 ? desc + TRUNCATION_MARKER : TRUNCATION_MARKER;
  let summary = p.summary;
  while (url.length > MAX_URL_LENGTH && summary.length > 0) {
    const overshoot = url.length - MAX_URL_LENGTH;
    summary = summary.slice(0, Math.max(0, summary.length - Math.max(overshoot, 50)));
    url = assemble({ ...p, summary: summary + TRUNCATION_MARKER }, shrunkDesc);
  }
  return url;
}
