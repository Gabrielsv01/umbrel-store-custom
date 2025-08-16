export interface WebhookConfig {
    [key: string]: {
        destination: string;
        authorizedChatIds?: string[];
        authorizedUsernames?: string[];
        filter?: (payload: any, headers?: any) => boolean;
    };
}