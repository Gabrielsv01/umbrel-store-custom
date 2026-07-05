
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { WebhookConfig, WebhookMethod } from './types';
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

const filterFunctions = {
    telegramFilter,
    alexaskillFilter,
    noFilter,
};

const webhookConfig: WebhookConfig = {};

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

            loadedConfig[serviceName] = {
                destination: serviceTyped.destination!,
                allowGet: Boolean(serviceTyped.allowGet),
                methods,
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