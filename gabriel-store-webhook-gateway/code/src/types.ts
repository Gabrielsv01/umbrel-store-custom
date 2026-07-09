export interface SubdomainRule {
    pattern: string;
    filter?: (payload: any, headers?: any, query?: any) => boolean;
}

// Proposta A: o filtro é um objeto cujas chaves são os tipos de filtro.
// Vários tipos presentes => todos precisam passar (AND). Omitido => sem filtragem.
export type CompiledFilter = (payload: any, headers?: any, query?: any) => boolean;

export interface FilterObjectConfig {
    queryParams?: Record<string, string | string[]>;
    telegram?: {
        chatIds?: string | string[];
        usernames?: string | string[];
    };
    alexa?: {
        applicationId?: string;
    };
}

export type SubdomainYamlEntry = string | {
    path: string;
    filter?: FilterObjectConfig;
};

export type WebhookMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ResponseField = 'STATUS' | 'BODY' | 'HEADERS';

export interface UpstreamForwardRequestConfig {
    HEADERS?: string[];
    BODY?: boolean;
}

export interface RateLimitConfig {
    windowMs?: number;
    max?: number;
    disabled?: boolean;
}

export type RateLimitYamlConfig = false | {
    windowMs?: number;
    windowMinutes?: number;
    max?: number;
    disabled?: boolean;
};

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
    signatureSecret?: string;
    signatureHeader?: string;
    signaturePrefix?: string;
    hmacAlgorithm?: string;
    getTokenSecret?: string;
    getTokenHeader?: string;
    filter?: FilterObjectConfig;
    rateLimit?: RateLimitYamlConfig;
}

export interface LoadedServiceConfig {
    destination: string;
    methods?: WebhookMethod[];
    upstream?: UpstreamProxyConfig;
    response?: ResponsePolicyConfig;
    subdomain?: SubdomainRule[];
    signatureSecret?: string;
    signatureHeader?: string;
    signaturePrefix?: string;
    hmacAlgorithm?: string;
    getTokenSecret?: string;
    getTokenHeader?: string;
    filter?: (payload: any, headers?: any, query?: any) => boolean;
    rateLimit?: RateLimitConfig;
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
        signatureSecret?: string;
        signatureHeader?: string;
        signaturePrefix?: string;
        hmacAlgorithm?: string;
        getTokenSecret?: string;
        getTokenHeader?: string;
        filter?: (payload: any, headers?: any, query?: any) => boolean;
        rateLimit?: RateLimitConfig;
    };
}