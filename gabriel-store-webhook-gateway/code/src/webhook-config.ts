
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { ResponseField, ResponsePolicy, ResponsePolicyConfig, WebhookConfig, WebhookMethod } from './types';
import { telegramFilter, alexaskillFilter, noFilter } from './filters';

interface ParsedSubdomainRule {
    pattern: string;
    filter?: (payload: any, headers?: any) => boolean;
}

type SubdomainYamlEntry = string | {
    path: string;
    filter?: keyof typeof filterFunctions;
};

const SUPPORTED_METHODS: WebhookMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const SUPPORTED_METHODS_SET = new Set<WebhookMethod>(SUPPORTED_METHODS);
const SUPPORTED_RESPONSE_FIELDS_SET = new Set<ResponseField>(['STATUS', 'BODY', 'HEADERS']);

const filterFunctions = {
    telegramFilter,
    alexaskillFilter,
    noFilter,
};

const webhookConfig: WebhookConfig = {};

function normalizeSingleResponsePolicy(response: any): ResponsePolicy | undefined {
    if (!response || typeof response !== 'object') {
        return undefined;
    }

    const allowedHeadersRaw = response.allowedHeaders;
    const allowedHeaders = Array.isArray(allowedHeadersRaw)
        ? allowedHeadersRaw
        : (typeof allowedHeadersRaw === 'string' ? [allowedHeadersRaw] : []);

    const forwardRaw = response.forward ?? response.fields;

    const hasExplicitForward = forwardRaw !== undefined;
    const fieldsInput = Array.isArray(forwardRaw)
        ? forwardRaw
        : (typeof forwardRaw === 'string' ? [forwardRaw] : []);
    const normalizedFields = fieldsInput
        .map((field) => String(field).toUpperCase().trim())
        .filter((field): field is ResponseField => SUPPORTED_RESPONSE_FIELDS_SET.has(field as ResponseField));

    const fields = hasExplicitForward ? Array.from(new Set(normalizedFields)) : undefined;

    const forwardMap = (!Array.isArray(forwardRaw) && forwardRaw && typeof forwardRaw === 'object')
        ? forwardRaw as Record<string, unknown>
        : undefined;

    const parseForwardToggle = (value: unknown): boolean | undefined => {
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string' && value.trim() === '*') {
            return true;
        }
        return undefined;
    };

    const passStatusFromForwardMap = parseForwardToggle(forwardMap?.STATUS);
    const passBodyFromForwardMap = parseForwardToggle(forwardMap?.BODY);
    const headersForwardValue = forwardMap?.HEADERS;
    const headersWildcardAll = typeof headersForwardValue === 'string' && headersForwardValue.trim() === '*';
    const passHeadersFromForwardMap = parseForwardToggle(headersForwardValue)
        ?? (Array.isArray(headersForwardValue) ? true : undefined);
    const headersFromForwardMapRaw = Array.isArray(headersForwardValue)
        ? headersForwardValue
        : (typeof headersForwardValue === 'string' ? [headersForwardValue] : []);
    const headersFromForwardMap = headersFromForwardMapRaw
        .map((header) => String(header).toLowerCase().trim())
        .filter((header) => header !== '*')
        .filter(Boolean);

    const passStatusFromFields = fields ? fields.includes('STATUS') : undefined;
    const passBodyFromFields = fields ? fields.includes('BODY') : undefined;
    const passHeadersFromFields = fields ? fields.includes('HEADERS') : undefined;

    return {
        forward: fields,
        fields,
        passStatus: response.passStatus !== undefined
            ? Boolean(response.passStatus)
            : (passStatusFromForwardMap ?? passStatusFromFields),
        passBody: response.passBody !== undefined
            ? Boolean(response.passBody)
            : (passBodyFromForwardMap ?? passBodyFromFields),
        passHeaders: response.passHeaders !== undefined
            ? Boolean(response.passHeaders)
            : (passHeadersFromForwardMap ?? passHeadersFromFields),
        allowedHeaders: headersWildcardAll
            ? undefined
            : headersFromForwardMap.length > 0
            ? headersFromForwardMap
            : allowedHeaders.map((header) => header.toLowerCase().trim()).filter(Boolean),
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
    loadedConfig: WebhookConfig,
): ParsedSubdomainRule[] {
    const entries = Array.isArray(serviceSubdomain)
        ? serviceSubdomain
        : (serviceSubdomain ? [serviceSubdomain] : []);

    const parsedRules: ParsedSubdomainRule[] = [];

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

        const filterFunction = entry.filter
            ? (payload: any, headers: any) => filterFunctions[entry.filter as keyof typeof filterFunctions](payload, loadedConfig[serviceName], headers)
            : undefined;

        parsedRules.push({
            pattern: pathPattern,
            filter: filterFunction,
        });
    }

    return parsedRules;
}

function normalizeMethods(
    serviceMethods: string | string[] | undefined,
    allowGet: boolean | undefined,
): WebhookMethod[] {
    const methodsFromConfig = Array.isArray(serviceMethods)
        ? serviceMethods
        : (typeof serviceMethods === 'string' ? [serviceMethods] : []);

    const normalized = methodsFromConfig
        .map((method) => method.toUpperCase().trim())
        .filter((method): method is WebhookMethod => SUPPORTED_METHODS.includes(method as WebhookMethod));

    if (normalized.length > 0) {
        return Array.from(new Set(normalized));
    }

    return allowGet ? ['POST', 'GET'] : ['POST'];
}

const substituteEnvVars = (obj: any) => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    for (const key in obj) {
        const value = obj[key];
        if (typeof value === 'string') {
            const match = value.match(/\${(.*?)}/);
            if (match) {
                const varName = match[1];
                obj[key] = process.env[varName] || '';
            }
        } else if (typeof value === 'object') {
            substituteEnvVars(value);
        }
    }
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
        const parsedYaml: any = yaml.load(fileContents);

        substituteEnvVars(parsedYaml);

        const loadedConfig: WebhookConfig = {};

        for (const serviceName in parsedYaml) {
            const service = parsedYaml[serviceName];
            interface ServiceYamlConfig {
                destination: string;
                allowGet?: boolean;
                methods?: string | string[];
                response?: ResponsePolicyConfig | ResponsePolicy;
                subdomain?: SubdomainYamlEntry | SubdomainYamlEntry[];
                authorizedChatIds?: string;
                authorizedUsernames?: string;
                applicationId?: string;
                signatureSecret?: string;
                signatureHeader?: string;
                signaturePrefix?: string;
                hmacAlgorithm?: string;
                filter?: keyof typeof filterFunctions;
            }

            interface LoadedServiceConfig {
                destination: string;
                allowGet?: boolean;
                methods?: WebhookMethod[];
                response?: ResponsePolicyConfig;
                subdomain?: ParsedSubdomainRule[];
                authorizedChatIds: string[];
                authorizedUsernames: string[];
                applicationId?: string;
                signatureSecret?: string;
                signatureHeader?: string;
                signaturePrefix?: string;
                hmacAlgorithm?: string;
                filter?: (payload: any, headers?: any) => boolean;
            }

            const serviceTyped = service as ServiceYamlConfig;
            const subdomainRules = normalizeSubdomainEntries(serviceName, serviceTyped.subdomain, loadedConfig);
            const methods = normalizeMethods(serviceTyped.methods, serviceTyped.allowGet);
            const responsePolicy = normalizeResponsePolicy(serviceTyped.response);

            loadedConfig[serviceName] = {
                destination: serviceTyped.destination!,
                allowGet: Boolean(serviceTyped.allowGet),
                methods,
                response: responsePolicy,
                subdomain: subdomainRules,
                authorizedChatIds: serviceTyped.authorizedChatIds ? serviceTyped.authorizedChatIds.split(',').map((id: string) => id.trim()) : [],
                authorizedUsernames: serviceTyped.authorizedUsernames ? serviceTyped.authorizedUsernames.split(',').map((username: string) => username.trim()) : [],
                applicationId: serviceTyped.applicationId!,
                signatureSecret: serviceTyped.signatureSecret || undefined,
                signatureHeader: serviceTyped.signatureHeader?.toLowerCase() || undefined,
                signaturePrefix: serviceTyped.signaturePrefix || undefined,
                hmacAlgorithm: serviceTyped.hmacAlgorithm || 'sha256',
                filter: serviceTyped.filter ? (payload: any, headers: any) => filterFunctions[serviceTyped.filter as keyof typeof filterFunctions](payload, loadedConfig[serviceName], headers) : undefined,
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