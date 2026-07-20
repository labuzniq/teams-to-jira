// src/index.ts
import * as fs from 'fs';
import express from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';
import { loadConfig } from './config';
import { parseRegistry } from './projectRegistry';
import { MemoryUserStore, UserStore } from './userStore';
import { TableUserStore } from './tableUserStore';
import { TeamsJiraBot } from './bot';
import { Deps } from './handlers';

const config = loadConfig(process.env);
const registry = parseRegistry(fs.readFileSync(config.registryPath, 'utf8'));

const store: UserStore = config.storageConnectionString
  ? TableUserStore.fromConnectionString(config.storageConnectionString)
  : new MemoryUserStore();
if (!config.storageConnectionString) {
  console.warn('STORAGE_CONNECTION_STRING not set — using in-memory store (dev only)');
}

const deps: Deps = { registry, store, defaultBaseUrl: config.jiraBaseUrl };
const bot = new TeamsJiraBot(deps);

// Reads MicrosoftAppId / MicrosoftAppPassword / MicrosoftAppType /
// MicrosoftAppTenantId from process.env.
const auth = new ConfigurationBotFrameworkAuthentication(process.env as never);
const adapter = new CloudAdapter(auth);

adapter.onTurnError = async (context, error) => {
  console.error('Turn error:', error.message);
  await context.sendActivity('The Jira extension hit an error. Try again.');
};

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.status(200).send('ok'));
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

app.listen(config.port, () => {
  console.log(`teams-to-jira listening on :${config.port}`);
});
