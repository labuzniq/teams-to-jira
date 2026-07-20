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
