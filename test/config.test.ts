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
