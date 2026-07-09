
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import {
    CompiledFilter,
    LoadedServiceConfig,
    ParsedForwardConfig,
    RateLimitConfig,
    ResponseField,
    ResponsePolicy,
    ResponsePolicyConfig,
    ServiceYamlConfig,
    SubdomainRule,
    SubdomainYamlEntry,
    UpstreamProxyConfig,
    WebhookConfig,
    WebhookMethod,
} from './types';
import { telegramFilter, alexaskillFilter, queryParamsFilter } from './filters';

const SUPPORTED_METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const SUPPORTED_METHODS_SET = new Set<WebhookMethod>(SUPPORTED_METHODS);
const SUPPORTED_RESPONSE_FIELDS_SET = new Set<ResponseField>(['STATUS', 'BODY', 'HEADERS']);

const webhookConfig: WebhookConfig = {};

function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item));
    }

    if (typeof value === 'string') {
        return [value];
    }

    return [];
}

function splitCsv(value: string | undefined): string[] {
    return value
        ? value.split(',').map((item) => item.trim()).filter(Boolean)
        : [];
}

function parseForwardToggle(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string' && value.trim() === '*') {
        return true;
    }

    return undefined;
}

function parseForwardConfig(forwardRaw: unknown): ParsedForwardConfig {
    const hasExplicitForward = forwardRaw !== undefined;
    const fieldsInput = toStringArray(forwardRaw);
    const normalizedFields = fieldsInput
        .map((field) => field.toUpperCase().trim())
        .filter((field): field is ResponseField => SUPPORTED_RESPONSE_FIELDS_SET.has(field as ResponseField));
    const forwardFields = hasExplicitForward ? Array.from(new Set(normalizedFields)) : undefined;

    const forwardMap = (!Array.isArray(forwardRaw) && forwardRaw && typeof forwardRaw === 'object')
        ? forwardRaw as Record<string, unknown>
        : undefined;

    const passStatusFromForwardMap = parseForwardToggle(forwardMap?.STATUS);
    const passBodyFromForwardMap = parseForwardToggle(forwardMap?.BODY);
    const headersForwardValue = forwardMap?.HEADERS;
    const headersWildcardAll = typeof headersForwardValue === 'string' && headersForwardValue.trim() === '*';
    const passHeadersFromForwardMap = parseForwardToggle(headersForwardValue)
        ?? (Array.isArray(headersForwardValue) ? true : undefined);

    const headersFromForwardMap = toStringArray(headersForwardValue)
        .map((header) => header.toLowerCase().trim())
        .filter((header) => header !== '*')
        .filter(Boolean);

    return {
        forwardFields,
        passStatusFromForwardMap,
        passBodyFromForwardMap,
        passHeadersFromForwardMap,
        headersWildcardAll,
        headersFromForwardMap,
    };
}

function normalizeSingleResponsePolicy(response: any): ResponsePolicy | undefined {
    if (!response || typeof response !== 'object') {
        return undefined;
    }

    const allowedHeaders = toStringArray(response.allowedHeaders)
        .map((header) => header.toLowerCase().trim())
        .filter(Boolean);

    const forwardRaw = response.forward;
    const {
        forwardFields,
        passStatusFromForwardMap,
        passBodyFromForwardMap,
        passHeadersFromForwardMap,
        headersWildcardAll,
        headersFromForwardMap,
    } = parseForwardConfig(forwardRaw);

    const passStatusFromForwardList = forwardFields ? forwardFields.includes('STATUS') : undefined;
    const passBodyFromForwardList = forwardFields ? forwardFields.includes('BODY') : undefined;
    const passHeadersFromForwardList = forwardFields ? forwardFields.includes('HEADERS') : undefined;

    return {
        forward: forwardFields,
        passStatus: response.passStatus !== undefined
            ? Boolean(response.passStatus)
            : (passStatusFromForwardMap ?? passStatusFromForwardList),
        passBody: response.passBody !== undefined
            ? Boolean(response.passBody)
            : (passBodyFromForwardMap ?? passBodyFromForwardList),
        passHeaders: response.passHeaders !== undefined
            ? Boolean(response.passHeaders)
            : (passHeadersFromForwardMap ?? passHeadersFromForwardList),
        allowedHeaders: headersWildcardAll
            ? undefined
            : headersFromForwardMap.length > 0
            ? headersFromForwardMap
            : allowedHeaders,
        defaultStatus: typeof response.defaultStatus === 'number' ? response.defaultStatus : undefined,
        defaultBody: typeof response.defaultBody === 'string' ? response.defaultBody : undefined,
    };
}

function normalizeResponsePolicy(response: any): ResponsePolicyConfig | undefined {
    if (!response || typeof response !== 'object') {
        return undefined;
    }

    const hasStructuredConfig = Object.prototype.hasOwnProperty.call(response, 'default')
        || Object.prototype.hasOwnProperty.call(response, 'methods');

    if (!hasStructuredConfig) {
        const legacyPolicy = normalizeSingleResponsePolicy(response);
        return legacyPolicy ? { default: legacyPolicy } : undefined;
    }

    const defaultPolicy = normalizeSingleResponsePolicy(response.default);
    const methodsRaw = response.methods && typeof response.methods === 'object' ? response.methods : {};
    const methods: Partial<Record<WebhookMethod, ResponsePolicy>> = {};

    for (const [rawMethod, rawPolicy] of Object.entries(methodsRaw as Record<string, unknown>)) {
        const method = rawMethod.toUpperCase().trim() as WebhookMethod;
        if (!SUPPORTED_METHODS_SET.has(method)) {
            continue;
        }

        const parsedPolicy = normalizeSingleResponsePolicy(rawPolicy);
        if (parsedPolicy) {
            methods[method] = parsedPolicy;
        }
    }

    return {
        default: defaultPolicy,
        methods: Object.keys(methods).length > 0 ? methods : undefined,
    };
}

function normalizeSubdomainEntries(
    serviceName: string,
    serviceSubdomain: SubdomainYamlEntry | SubdomainYamlEntry[] | undefined,
): SubdomainRule[] {
    const entries = Array.isArray(serviceSubdomain)
        ? serviceSubdomain
        : (serviceSubdomain ? [serviceSubdomain] : []);

    const parsedRules: SubdomainRule[] = [];

    for (const entry of entries) {
        if (typeof entry === 'string') {
            const pattern = entry.trim();
            if (pattern) {
                parsedRules.push({ pattern });
            }
            continue;
        }

        const pathPattern = entry?.path?.trim();
        if (!pathPattern) {
            continue;
        }

        parsedRules.push({
            pattern: pathPattern,
            filter: buildFilter(serviceName, entry.filter),
        });
    }

    return parsedRules;
}

function normalizeMethods(
    serviceMethods: string | string[] | undefined,
): WebhookMethod[] {
    const methodsFromConfig = toStringArray(serviceMethods);

    const normalized = methodsFromConfig
        .map((method) => method.toUpperCase().trim())
        .filter((method): method is WebhookMethod => SUPPORTED_METHODS.includes(method as WebhookMethod));

    if (normalized.length > 0) {
        return Array.from(new Set(normalized));
    }

    return ['POST'];
}

function normalizeQueryParams(queryParams: unknown): Record<string, string[]> | undefined {
    if (!queryParams || typeof queryParams !== 'object' || Array.isArray(queryParams)) {
        return undefined;
    }

    const result: Record<string, string[]> = {};
    for (const [param, rawValues] of Object.entries(queryParams as Record<string, unknown>)) {
        const values = toStringArray(rawValues).map((value) => value.trim()).filter(Boolean);
        if (values.length > 0) {
            result[param] = Array.from(new Set(values));
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}

// Aceita array (YAML) ou string CSV e devolve uma lista de strings limpa.
function toStringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return splitCsv(value);
    }
    return [];
}

function buildQueryParamsMatcher(raw: unknown): CompiledFilter {
    const params = normalizeQueryParams(raw) ?? {};
    return (payload, headers, query) => queryParamsFilter(payload, params, headers, query);
}

function buildTelegramMatcher(raw: unknown): CompiledFilter {
    const cfg = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
    const filterConfig = {
        chatIds: toStringList(cfg.chatIds),
        usernames: toStringList(cfg.usernames),
    };
    return (payload) => telegramFilter(payload, filterConfig);
}

function buildAlexaMatcher(raw: unknown): CompiledFilter {
    const cfg = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
    const filterConfig = {
        applicationId: cfg.applicationId !== undefined && cfg.applicationId !== null
            ? String(cfg.applicationId)
            : undefined,
    };
    return (payload) => alexaskillFilter(payload, filterConfig);
}

// Proposta A: `filter` é um objeto cujas chaves são os tipos de filtro.
// Vários tipos presentes => todos precisam passar (AND). Omitido/ inválido => sem filtragem.
function buildFilter(serviceName: string, filterField: unknown): CompiledFilter | undefined {
    if (filterField === undefined || filterField === null) {
        return undefined;
    }

    if (typeof filterField !== 'object' || Array.isArray(filterField)) {
        console.warn(`[${serviceName}] - Campo "filter" inválido: esperado objeto (ex: filter: { queryParams: { ... } }). Filtro ignorado.`);
        return undefined;
    }

    const f = filterField as Record<string, unknown>;
    const matchers: CompiledFilter[] = [];

    if ('queryParams' in f) matchers.push(buildQueryParamsMatcher(f.queryParams));
    if ('telegram' in f) matchers.push(buildTelegramMatcher(f.telegram));
    if ('alexa' in f) matchers.push(buildAlexaMatcher(f.alexa));

    if (matchers.length === 0) {
        console.warn(`[${serviceName}] - Bloco "filter" sem nenhum tipo conhecido (queryParams/telegram/alexa). Filtro ignorado.`);
        return undefined;
    }

    if (matchers.length === 1) {
        return matchers[0];
    }

    // Múltiplos filtros: todos precisam passar (AND).
    return (payload, headers, query) => matchers.every((matcher) => matcher(payload, headers, query));
}

function normalizeRateLimit(rateLimit: unknown): RateLimitConfig | undefined {
    // `rateLimit: false` desabilita o rate limit do serviço.
    if (rateLimit === false) {
        return { disabled: true };
    }

    if (!rateLimit || typeof rateLimit !== 'object') {
        return undefined;
    }

    const raw = rateLimit as Record<string, unknown>;

    if (raw.disabled === true) {
        return { disabled: true };
    }

    const windowMsRaw = raw.windowMs;
    const windowMinutesRaw = raw.windowMinutes;
    const windowMs = (typeof windowMsRaw === 'number' && Number.isFinite(windowMsRaw) && windowMsRaw > 0)
        ? windowMsRaw
        : (typeof windowMinutesRaw === 'number' && Number.isFinite(windowMinutesRaw) && windowMinutesRaw > 0)
            ? windowMinutesRaw * 60 * 1000
            : undefined;

    const maxRaw = raw.max;
    const max = (typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 0)
        ? maxRaw
        : undefined;

    if (windowMs === undefined && max === undefined) {
        return undefined;
    }

    return { windowMs, max };
}

function normalizeUpstreamConfig(upstream: unknown): UpstreamProxyConfig | undefined {
    if (!upstream || typeof upstream !== 'object') {
        return undefined;
    }

    const upstreamConfig = upstream as Record<string, unknown>;

    const timeoutMsRaw = upstreamConfig.timeoutMs;
    const timeoutMs = typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw) && timeoutMsRaw >= 0
        ? timeoutMsRaw
        : undefined;

    const timeoutMsByMethodRaw = upstreamConfig.timeoutMsByMethod;
    const timeoutMsByMethod: Partial<Record<WebhookMethod, number>> = {};
    if (timeoutMsByMethodRaw && typeof timeoutMsByMethodRaw === 'object' && !Array.isArray(timeoutMsByMethodRaw)) {
        for (const [rawMethod, rawTimeout] of Object.entries(timeoutMsByMethodRaw as Record<string, unknown>)) {
            const method = rawMethod.toUpperCase().trim() as WebhookMethod;
            if (!SUPPORTED_METHODS_SET.has(method)) {
                continue;
            }

            if (typeof rawTimeout === 'number' && Number.isFinite(rawTimeout) && rawTimeout >= 0) {
                timeoutMsByMethod[method] = rawTimeout;
            }
        }
    }

    const forwardRequestRaw = upstreamConfig.forwardRequest;
    const forwardRequestObject = (
        forwardRequestRaw
        && typeof forwardRequestRaw === 'object'
        && !Array.isArray(forwardRequestRaw)
    ) ? forwardRequestRaw as Record<string, unknown> : undefined;

    const forwardRequestHeadersFromNewShape = toStringArray(forwardRequestObject?.HEADERS)
        .map((header) => header.toLowerCase().trim())
        .filter(Boolean);

    const forwardRequestHeaders = toStringArray(upstreamConfig.forwardRequestHeaders)
        .map((header) => header.toLowerCase().trim())
        .filter(Boolean);

    const normalizedForwardHeaders = forwardRequestHeadersFromNewShape.length > 0
        ? forwardRequestHeadersFromNewShape
        : forwardRequestHeaders;

    const forwardRequestBody = typeof forwardRequestObject?.BODY === 'boolean'
        ? forwardRequestObject.BODY
        : undefined;

    if (
        timeoutMs === undefined
        && Object.keys(timeoutMsByMethod).length === 0
        && normalizedForwardHeaders.length === 0
        && forwardRequestBody === undefined
    ) {
        return undefined;
    }

    return {
        timeoutMs,
        timeoutMsByMethod: Object.keys(timeoutMsByMethod).length > 0 ? timeoutMsByMethod : undefined,
        forwardRequest: {
            HEADERS: normalizedForwardHeaders.length > 0 ? Array.from(new Set(normalizedForwardHeaders)) : undefined,
            BODY: forwardRequestBody,
        },
        forwardRequestHeaders: forwardRequestHeaders.length > 0 ? Array.from(new Set(forwardRequestHeaders)) : undefined,
    };
}

const substituteEnvVars = (value: unknown): unknown => {
    if (typeof value === 'string') {
        const match = value.match(/\${(.*?)}/);
        if (!match) {
            return value;
        }

        return process.env[match[1]] || '';
    }

    if (Array.isArray(value)) {
        return value.map((item) => substituteEnvVars(item));
    }

    if (typeof value === 'object' && value !== null) {
        const transformed: Record<string, unknown> = {};
        for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
            transformed[key] = substituteEnvVars(childValue);
        }
        return transformed;
    }

    return value;
};

const loadConfig = () => {
    try {
        const configPathFromEnv = process.env.WEBHOOK_CONFIG_PATH;
        const preferredConfigPath = path.resolve(__dirname, '..', 'config', 'webhooks.yml');
        const legacyConfigPath = path.resolve(__dirname, '..', 'webhooks.yml');
        const configPath = configPathFromEnv
            || (fs.existsSync(preferredConfigPath) ? preferredConfigPath : legacyConfigPath);

        if (!fs.existsSync(configPath)) {
            throw new Error(`Arquivo de configuração não encontrado: ${configPath}`);
        }

        const stat = fs.statSync(configPath);
        if (stat.isDirectory()) {
            throw new Error(`Caminho de configuração aponta para diretório, esperado arquivo: ${configPath}`);
        }

        const fileContents = fs.readFileSync(configPath, 'utf8');
        const parsedYaml = substituteEnvVars(yaml.load(fileContents)) as Record<string, unknown>;

        const loadedConfig: WebhookConfig = {};

        for (const serviceName in parsedYaml) {
            const service = parsedYaml[serviceName];

            const serviceTyped = service as ServiceYamlConfig;
            const subdomainRules = normalizeSubdomainEntries(serviceName, serviceTyped.subdomain);
            const methods = normalizeMethods(serviceTyped.methods);
            const upstream = normalizeUpstreamConfig(serviceTyped.upstream);
            const responsePolicy = normalizeResponsePolicy(serviceTyped.response);
            const rateLimit = normalizeRateLimit(serviceTyped.rateLimit);

            loadedConfig[serviceName] = {
                destination: serviceTyped.destination!,
                methods,
                upstream,
                response: responsePolicy,
                subdomain: subdomainRules,
                signatureSecret: serviceTyped.signatureSecret || undefined,
                signatureHeader: serviceTyped.signatureHeader?.toLowerCase() || undefined,
                signaturePrefix: serviceTyped.signaturePrefix || undefined,
                hmacAlgorithm: serviceTyped.hmacAlgorithm || 'sha256',
                getTokenSecret: serviceTyped.getTokenSecret || undefined,
                getTokenHeader: serviceTyped.getTokenHeader?.toLowerCase() || undefined,
                filter: buildFilter(serviceName, serviceTyped.filter),
                rateLimit,
            } as LoadedServiceConfig;
        }
        Object.assign(webhookConfig, loadedConfig);
        console.log('Configuração de webhooks carregada com sucesso. Serviços:', Object.keys(loadedConfig));
    } catch (e) {
        console.error('Erro ao carregar a configuração do YAML:', e);
    }
};

loadConfig();

export default webhookConfig;