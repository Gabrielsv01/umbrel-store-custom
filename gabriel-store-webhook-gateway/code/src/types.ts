export interface SubdomainRule {
    pattern: string;
    filter?: (payload: any, headers?: any) => boolean;
}

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseField = 'STATUS' | 'BODY' | 'HEADERS';

export interface ResponseForwardMap {
    STATUS?: boolean | '*';
    BODY?: boolean | '*';
    HEADERS?: boolean | '*' | string[];
}

export interface ResponsePolicy {
    forward?: ResponseField[] | ResponseForwardMap;
    // Legacy alias. Prefer `forward`.
    fields?: ResponseField[];
    passStatus?: boolean;
    passBody?: boolean;
    passHeaders?: boolean;
    allowedHeaders?: string[];
    defaultStatus?: number;
    defaultBody?: string;
}

export interface ResponsePolicyConfig {
    default?: ResponsePolicy;
    methods?: Partial<Record<WebhookMethod, ResponsePolicy>>;
}

export interface WebhookConfig {
    [key: string]: {
        destination: string;
        allowGet?: boolean;
        methods?: WebhookMethod[];
        response?: ResponsePolicyConfig;
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