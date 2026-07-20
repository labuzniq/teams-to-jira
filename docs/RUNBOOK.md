# Runbook — Teams → Jira (Variant L)

## 0. Verification gates (do FIRST, before deploying anything)

1. **Custom app upload allowed?** Teams → Apps → Manage your apps → "Upload an app".
   If missing, ask the Teams admin to enable custom apps for your account/org.
2. **Prefilled create screen works?** While on VPN, open (values from any real project):
   `https://<jira>/secure/CreateIssueDetails!init.jspa?pid=<PID>&issuetype=<TYPEID>&summary=hello&description=world`
   Expected: Jira create form, prefilled. If Jira errors instead, Variant L is not
   viable on this instance — fall back to Variant F (see design spec §6).

## 1. Azure resources (one-time)

1. **Entra app registration**: single tenant. Note Application (client) ID and create
   a client secret. This is the bot identity.
2. **Azure Bot resource**: create with the app registration above; messaging endpoint
   `https://<app-service-host>/api/messages`; enable the Microsoft Teams channel.
3. **Storage account**: Standard LRS. Copy a connection string (Table service is used;
   table `userprefs` is auto-created).
4. **App Service**: Linux, Node 20, plan B1. No VNet integration needed for Variant L.

## 2. App Service configuration (env vars)

| Var | Value |
|---|---|
| `MicrosoftAppType` | `SingleTenant` |
| `MicrosoftAppId` | Entra app (client) ID |
| `MicrosoftAppPassword` | client secret |
| `MicrosoftAppTenantId` | tenant ID |
| `JIRA_BASE_URL` | `https://jira.<company>.com` |
| `STORAGE_CONNECTION_STRING` | storage connection string |
| `REGISTRY_PATH` | optional, defaults to `registry/projects.json` |

Deploy: `npm run build`, then deploy repo (with `dist/`, `registry/`, `node_modules`
via CI or zip-deploy `az webapp deploy`). Health check: `GET /health` → `ok`.

## 3. Fill the org project registry

Edit `registry/projects.json` with real projects. Finding IDs (needs any Jira
browser session):
- **pid**: Project settings URL contains `pid=...`, or hover a project link in
  admin → Projects.
- **issue type ids**: `https://<jira>/rest/api/2/issue/createmeta?projectKeys=<KEY>`
  in the browser (session-authenticated) lists issue types with ids. Also visible in
  Admin → Issue types (link URLs contain the id).
- **priority ids**: `https://<jira>/rest/api/2/priority` — defaults are 1..5.

## 4. Teams app package + org catalog

1. In `appPackage/manifest.json` replace `<<BOT_ID>>` with the Entra app ID and
   `<<BOT_DOMAIN>>` with the App Service hostname.
2. `npm run package` → `appPackage.zip`.
3. Personal test first: Teams → Apps → Manage your apps → Upload an app → Upload a
   custom app → pick the zip.
4. Org rollout: Teams admin center → Teams apps → Manage apps → Upload new app
   (admin does this); users then install from the org catalog ("Built for your org").

## 5. Manual E2E checklist (run after every deploy)

- [ ] Right-click any chat message → Apps → "Create Jira ticket" appears.
- [ ] First run shows "Jira setup" dialog; saving username leads to ticket dialog.
- [ ] Ticket dialog: title = first line of message; description starts with
      "Reported by <author> in Teams: https://teams.microsoft.com/l/message/...".
- [ ] Submitting shows "Open in Jira" card; button opens prefilled Jira create
      screen in browser (on VPN); Create in Jira succeeds; assignee = you.
- [ ] Second use: previously used project listed first.
- [ ] Very long message (>3000 chars): URL still opens; description ends with
      "... [truncated - see Teams link]"; Teams link intact at the top.
- [ ] Off VPN: button opens browser; Jira unreachable page (expected, acceptable).
- [ ] Message with code block/formatting: description is readable plain text.

## 6. Troubleshooting

- Dialog never opens / spinner: check App Service logs (`az webapp log tail`).
  Common: wrong `MicrosoftApp*` values → 401 from Bot Framework.
- "Something went wrong" card with unknown project: project key missing from
  registry and user projects — add to `registry/projects.json` and redeploy, or
  user adds it via the setup dialog.
- Prefill lands on wrong issue type: issue type name not present in that project —
  falls back to project's first issue type by design.
