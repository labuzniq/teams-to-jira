# Teams → Jira Message Extension — Design Spec

**Date:** 2026-07-18
**Status:** Approved design, pre-implementation
**Audience:** Team/org users on a Microsoft Teams tenant, creating tickets in an internal Jira Server/Data Center instance.

## 1. Goal

From any Teams chat message: right-click → "Create Jira ticket" → end up with a Jira issue whose title/description are prefilled from the message, assigned to the acting user. No process runs on end-user machines.

## 2. Established constraints (from requirements discussion)

| Constraint | Value |
|---|---|
| Jira deployment | Jira Server / Data Center, self-hosted |
| Jira network reachability | **VPN/internal only** — not reachable from public internet |
| Jira auth (API variant) | Personal Access Token (Jira 8.14+) |
| End-user machines | Must run **nothing** locally |
| Available infrastructure | Org Azure subscription with site-to-site VPN/ExpressRoute to corp network |
| Distribution | Org app catalog (admin upload); no public store |
| Custom app upload | Believed allowed; **verify before build** |
| Dialog fields | Project (recent keys remembered + manual entry), issue type, priority, title (prefilled from first line), description (prefilled from message + author + Teams deep link back to message) |
| Assignment | Ticket assigned to acting user |

## 3. Two variants

Two designs share the Teams-side shell (manifest, bot registration, message action command) and differ in how the Jira issue gets created.

- **Variant L (Lite / Redirect)** — *build first.* Backend builds a prefilled Jira create-screen URL; user finishes in the Jira web UI using their existing browser session. Backend never talks to Jira.
- **Variant F (Full / API)** — *documented upgrade path.* Backend calls the Jira REST API with per-user PATs and creates the issue directly; user never leaves Teams.

### Why L first

- Zero credentials stored → near-zero security surface, trivial IT approval.
- No VNet integration, no Key Vault, no Jira API client → a fraction of the code and Azure setup.
- User explicitly accepts finishing the ticket in Jira's own UI.
- F remains a clean superset; migration path in §8.

## 4. Shared Teams-side shell (both variants)

### 4.1 Components

- **Teams app manifest**: message extension with one action command, `context: ["message"]`, `fetchTask: true`. App package (manifest + icons) uploaded to org catalog.
- **Azure Bot registration**: single-tenant Microsoft Entra app. Org-only; no multi-tenant surface.
- **Bot backend**: Node.js / TypeScript, Bot Framework SDK (`botbuilder`), Express-style app handling `composeExtension/fetchTask` and `composeExtension/submitAction` invokes.
- **Hosting**: Azure App Service **B1** (always-warm; Teams message-extension invokes have a ~5 s response budget, so cold starts are disqualifying). Variant L does not need VNet integration; Variant F does.
- **State**: Azure Table Storage. Partition key = Entra user object ID (taken from the validated Bot Framework activity, never from user input).

### 4.2 Invoke flow (shared)

1. User right-clicks a message → **Create Jira ticket**.
2. Teams sends `composeExtension/fetchTask` to the bot endpoint with the message payload and user identity (Bot Framework JWT validated by SDK).
3. Bot loads the user's stored preferences. If none exist → return the **config dialog** (Adaptive Card task module) instead of the ticket dialog.
4. Bot returns the **ticket dialog** (Adaptive Card task module):
   - **Project**: choice set of recent projects (most-recent-first, max 10) + free-entry fallback.
   - **Issue type**: dropdown.
   - **Priority**: dropdown.
   - **Title**: text input, prefilled with the message's first line (stripped of HTML, truncated ~120 chars).
   - **Description**: multiline input, prefilled with `Reported by <author> in Teams` + deep link `https://teams.microsoft.com/l/message/...` (built from the invoke context) followed by the message text — link first, so Variant L's URL-length truncation (§5.4) can never drop it.
5. User edits and submits → `composeExtension/submitAction` → variant-specific handling (§5 / §6).
6. Recent-projects list for the user is updated in Table Storage.

### 4.3 Message content extraction

- Message body arrives as HTML in the action payload; convert to plain text (strip tags, decode entities, preserve line breaks). Code blocks become `{code}` … `{code}` Jira wiki markup in Variant L URLs and API payloads alike — nice-to-have, not required for v1.

## 5. Variant L — Redirect (build first)

### 5.1 Mechanism

Jira Server/DC supports prefilled create screens via direct link:

```
https://<jira-base>/secure/CreateIssueDetails!init.jspa
    ?pid=<numeric project id>
    &issuetype=<numeric issue type id>
    &summary=<url-encoded title>
    &description=<url-encoded description>
    &priority=<numeric priority id>
    &assignee=<jira username>
```

This is a GET that renders Jira's own create form, prefilled. The user reviews and clicks **Create** inside Jira, authenticated by their existing browser session (SSO/VPN). Nothing is submitted on the user's behalf.

**Verification gate (do before any code):** open a hand-built `CreateIssueDetails!init.jspa` URL against the real Jira instance and confirm it renders prefilled. If the instance has disabled it, Variant L is dead and Variant F becomes the plan.

### 5.2 Flow after submit

Teams cannot auto-open a browser from a submitAction. So:

1. `submitAction` response is a task module (or compose card) containing a single **"Open in Jira →"** `Action.OpenUrl` button carrying the constructed URL, plus a short preview (project, title).
2. User clicks → default browser opens the prefilled Jira create screen → user clicks Create in Jira.

Total: right-click → dialog → submit → one button click → browser. (One click more than Variant F's in-Teams finish.)

### 5.3 Configuration (the pid problem)

`pid` and `issuetype` are numeric IDs; without API access the backend cannot resolve them from keys/names. Resolution:

- **Org-level project registry** (app config JSON, maintainer-curated): list of `{ key, name, pid, issueTypes: [{name, id}], priorities: [{name, id}] }`. Priorities are usually instance-global (Highest=1 … Lowest=5 by default) — one shared list with per-instance override.
- **Per-user config dialog** (first run, editable later via the same action's config state):
  - Jira base URL (prefilled with org default from app config).
  - Jira username (for the `assignee` param → assign-to-me).
  - Optional: add a project not in the org registry by pasting `pid` + issue type IDs (doc explains finding them: project settings URL contains `pid`; issue type IDs visible in `/rest/api/2/issue/createmeta` or issue type admin URLs).
- Per-user recent projects (keys) stored in Table Storage; dialog orders choices by recency.

### 5.4 Limits (accepted)

- **URL length**: cap description at ~1,800 URL-encoded chars; truncate with `… [truncated — see Teams link]`. The Teams deep link is placed *before* the message body in the description so truncation never eats it.
- **Browser must reach Jira**: user must be on VPN. Failure mode is Jira's own unreachable page — self-explanatory.
- **No confirmation loop**: Teams never learns whether the ticket was actually created. No ticket link back in the chat.
- **XSRF**: not an issue — the link only renders a form; the user submits it within Jira's own session/XSRF flow.

### 5.5 Security posture

- No Jira credentials handled or stored — the backend holds only usernames, project registry data, and recency lists.
- Bot endpoint validates Bot Framework JWTs (SDK default); single-tenant app registration.
- No PII beyond Teams user IDs, Jira usernames, and message excerpts transiently processed in memory (message text is never persisted).

### 5.6 Azure footprint

App Service B1, Table Storage, Bot registration. No VNet integration, no Key Vault. Backend can run in any region/subscription — it needs only inbound HTTPS from Teams.

## 6. Variant F — Full API (upgrade path)

Everything in §4, plus:

### 6.1 Jira integration

- App Service gets **VNet integration**; traffic to Jira routes over the existing site-to-site VPN/ExpressRoute.
- Jira REST API v2. Issue creation: `POST /rest/api/2/issue` with `Authorization: Bearer <user PAT>`; then assign to self (or set `assignee` in the create payload).
- Project/issue-type/priority metadata fetched live per project (`/rest/api/2/issue/createmeta`), cached in memory ~10 min — removes the pid registry entirely; users type/choose project *keys*.

### 6.2 Per-user credentials

- First-use config dialog: Jira base URL (org default prefilled) + PAT. Validate immediately with `GET /rest/api/2/myself`; store only on success.
- PAT storage: **Azure Key Vault**, one secret per Entra user object ID. Table Storage keeps non-secret prefs only. App Service uses managed identity with get/set/delete on secrets.
- 401 on any later call → treat PAT as revoked/expired → re-prompt config dialog.

### 6.3 Flow after submit

`submitAction` → create issue via API → respond with an Adaptive Card: ticket key, link, title — insertable into the conversation so the requester sees "tracked as ABC-123". This closes the loop Variant L cannot.

### 6.4 Error handling

- Jira 400 (bad field/project): surface Jira's error messages inline in the dialog, form values preserved.
- Jira unreachable / VPN down: inline error, retry allowed.
- Never log PATs or message bodies; log Jira error codes + user ID only.

## 7. Testing

- **Unit**: URL builder (encoding, truncation, deep-link placement), HTML→text conversion, card builders, recent-projects logic. Variant F adds Jira client tests against mocked HTTP.
- **Manual E2E**: sideload to own Teams before org-catalog publish; checklist covering first-run config, recent projects, long/short messages, non-VPN failure mode.
- **Pre-build verification gates**: (1) custom app upload allowed in tenant; (2) `CreateIssueDetails!init.jspa` renders prefilled on the target Jira version.

## 8. Migration path L → F

Manifest, bot registration, hosting, dialogs, and Table Storage schema are shared. Migration = add VNet integration + Key Vault + Jira client module; swap the submitAction handler's tail (build URL → call API); replace pid registry with live createmeta; extend config dialog with PAT field. No user-visible reinstall — same app ID, updated backend.

## 9. Out of scope (YAGNI)

- Jira Cloud support (design keeps base-URL abstraction; not implemented).
- MCP-based integration (explicitly deprioritized by user).
- Public Teams store publishing.
- Attachments, custom fields, multi-issue creation, bidirectional sync.
