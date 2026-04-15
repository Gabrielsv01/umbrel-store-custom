export interface WebhookConfig {
    [key: string]: {
        destination: string;
        authorizedChatIds?: string[];
        authorizedUsernames?: string[];
        applicationId?: string;
        signatureSecret?: string;
        signatureHeader?: string;
        signaturePrefix?: string;
        hmacAlgorithm?: string;
        filter?: (payload: any, headers?: any) => boolean;
    };
}