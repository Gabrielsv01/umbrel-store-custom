export interface SubdomainRule {
    pattern: string;
    filter?: (payload: any, headers?: any) => boolean;
}

export type FilterFunctionName = 'telegramFilter' | 'alexaskillFilter' | 'noFilter';

export type SubdomainYamlEntry = string | {
    path: string;
    filter?: FilterFunctionName;
};

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseField = 'STATUS' | 'BODY' | 'HEADERS';

export interface UpstreamForwardRequestConfig {
    HEADERS?: string[];
    BODY?: boolean;
}

export interface UpstreamProxyConfig {
    timeoutMs?: number;
    timeoutMsByMethod?: Partial<Record<WebhookMethod, number>>;
    forwardRequest?: UpstreamForwardRequestConfig;
    // Legacy alias. Prefer `forwardRequest.HEADERS`.
    forwardRequestHeaders?: string[];
}

export interface ResponseForwardMap {
    STATUS?: boolean | '*';
    BODY?: boolean | '*';
    HEADERS?: boolean | '*' | string[];
}

export interface ResponsePolicy {
    forward?: ResponseField[] | ResponseForwardMap;
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

export interface ServiceYamlConfig {
    destination: string;
    methods?: string | string[];
    upstream?: UpstreamProxyConfig;
    response?: ResponsePolicyConfig | ResponsePolicy;
    subdomain?: SubdomainYamlEntry | SubdomainYamlEntry[];
    authorizedChatIds?: string;
    authorizedUsernames?: string;
    applicationId?: string;
    signatureSecret?: string;
    signatureHeader?: string;
    signaturePrefix?: string;
    hmacAlgorithm?: string;
    filter?: FilterFunctionName;
}

export interface LoadedServiceConfig {
    destination: string;
    methods?: WebhookMethod[];
    upstream?: UpstreamProxyConfig;
    response?: ResponsePolicyConfig;
    subdomain?: SubdomainRule[];
    authorizedChatIds: string[];
    authorizedUsernames: string[];
    applicationId?: string;
    signatureSecret?: string;
    signatureHeader?: string;
    signaturePrefix?: string;
    hmacAlgorithm?: string;
    filter?: (payload: any, headers?: any) => boolean;
}

export interface ParsedForwardConfig {
    forwardFields: ResponseField[] | undefined;
    passStatusFromForwardMap: boolean | undefined;
    passBodyFromForwardMap: boolean | undefined;
    passHeadersFromForwardMap: boolean | undefined;
    headersWildcardAll: boolean;
    headersFromForwardMap: string[];
}

export interface WebhookConfig {
    [key: string]: {
        destination: string;
        methods?: WebhookMethod[];
        upstream?: UpstreamProxyConfig;
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