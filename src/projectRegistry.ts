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
