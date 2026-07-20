// src/bot.ts
import {
  TeamsActivityHandler,
  TurnContext,
  MessagingExtensionAction,
  MessagingExtensionActionResponse,
} from 'botbuilder';
import { Deps, onFetchTask, onSubmitAction, MessagePayloadLite } from './handlers';

function userIdOf(context: TurnContext): string {
  return context.activity.from.aadObjectId ?? context.activity.from.id;
}

export class TeamsJiraBot extends TeamsActivityHandler {
  constructor(private deps: Deps) {
    super();
  }

  protected async handleTeamsMessagingExtensionFetchTask(
    context: TurnContext,
    action: MessagingExtensionAction
  ): Promise<MessagingExtensionActionResponse> {
    return (await onFetchTask(
      this.deps,
      userIdOf(context),
      (action.messagePayload ?? {}) as MessagePayloadLite
    )) as MessagingExtensionActionResponse;
  }

  protected async handleTeamsMessagingExtensionSubmitAction(
    context: TurnContext,
    action: MessagingExtensionAction
  ): Promise<MessagingExtensionActionResponse> {
    return (await onSubmitAction(
      this.deps,
      userIdOf(context),
      (action.data ?? {}) as Record<string, string | undefined>,
      (action.messagePayload ?? {}) as MessagePayloadLite
    )) as MessagingExtensionActionResponse;
  }
}
