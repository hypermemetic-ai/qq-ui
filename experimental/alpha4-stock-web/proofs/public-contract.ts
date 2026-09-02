import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-api-workspace-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-commands/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-theme/client";
import {
  NumberedSessionAction, QQSessionView, QQ_THEME_TOKENS, type QQCommandPayload,
} from "../lib/client.js";

/** Compile-only proof of the supported alpha.4 contribution calls used by the spike. */
export function registerPublicContributions(ctx: Context): readonly (() => void)[] {
  const command = ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "qq-numbered-session",
    order: 20,
    inject: (_sessionId): { dispatch(id: string, payload: QQCommandPayload): unknown } => ({
      dispatch: (id, payload) => ctx.qqCommands.dispatch(id, payload),
    }),
  }, NumberedSessionAction));
  const page = ctx.slots.inject("conversation.view", () => ctx.slots.register({
    name: "conversation.view",
    id: "qq-session",
    label: "QQ",
    order: 50,
  }, QQSessionView));
  const theme = ctx.theme.overrideTokens("qq.alpha4-spike.type-proof", QQ_THEME_TOKENS);
  const slash = ctx.commandUi.register({
    name: "qq-type-proof",
    description: "QQ public-contract proof",
    available: () => true,
    ui: {
      kind: "popupSelect",
      options: async () => [],
      onSelect: async () => {},
    },
  });
  return [command, page, theme, slash];
}
