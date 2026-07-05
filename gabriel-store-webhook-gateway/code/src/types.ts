export interface SubdomainRule {
    pattern: string;
    filter?: (payload: any, headers?: any) => boolean;
}

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface WebhookConfig {
    [key: string]: {
        destination: string;
        allowGet?: boolean;
        methods?: WebhookMethod[];
        subdomain?: SubdomainRule[];
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