import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client";
type Props = {
    directories: string[];
    client: OpencodeClient;
    onRestore: (session: Session) => void | Promise<void>;
};
export declare function DialogArchivedSessions(props: Props): import("solid-js").JSX.Element;
export declare function SidebarArchivedSessions(props: Props): import("solid-js").JSX.Element;
export {};
