import { Component, type PropsWithChildren } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionListState } from "@deepseek-ai/dsh-api-session-controller/client";
import type {} from "@deepseek-ai/dsh-client-ui-commands/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-theme/client";
import type { SessionId } from "@deepseek-ai/dsh-session/types";

export declare const name = "qq-ui-alpha4-spike-client";
export declare const inject: readonly ["slots", "theme", "sessions", "commandUi"];
export declare const PLUGIN_ID = "@hypermemetic-ai/qq-ui-alpha4-spike";
export declare const COMMAND_ID = "qq.session.copy-numbered-identity";
export declare const SESSION_VIEW_ID = "qq-session";
export declare const HEADER_ENTRY_ID = "qq-numbered-session";

export interface QQCommandPayload {
  readonly sessionId: SessionId;
}

export interface QQCommand {
  readonly id: string;
  run(payload: QQCommandPayload): unknown;
}

export interface QQCommandDirectory {
  register(command: QQCommand): () => void;
  dispatch(id: string, payload: QQCommandPayload): unknown;
  ids(): readonly string[];
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    qqCommands: QQCommandDirectory;
  }
}

export declare const QQ_THEME_TOKENS: Readonly<Record<string, Readonly<{
  light: string;
  dark: string;
}>>>;

export declare function sessionOrdinal(list: Pick<SessionListState, "ids">, sessionId: SessionId): number | null;
export declare function numberedSessionIdentity(list: Pick<SessionListState, "ids">, sessionId: SessionId): string;
export declare function createCommandDirectory(): QQCommandDirectory;

export type NumberedSessionActionProps = PropsRuntime<"conversation.session.header.actions"> & {
  dispatch(id: string, payload: QQCommandPayload): unknown;
};
export declare function NumberedSessionAction(props: NumberedSessionActionProps): import("react").ReactElement;

export type QQSessionViewProps = PropsRuntime<"conversation.view">;
export declare class QQFeatureBoundary extends Component<PropsWithChildren<unknown>> {
  state: { failed: boolean };
  static getDerivedStateFromError(): { failed: boolean };
  render(): import("react").ReactNode;
}
export declare function QQSessionContent(props: QQSessionViewProps): import("react").ReactElement;
export declare function QQSessionView(props: QQSessionViewProps): import("react").ReactElement;

export declare function apply(ctx: Context): void;
