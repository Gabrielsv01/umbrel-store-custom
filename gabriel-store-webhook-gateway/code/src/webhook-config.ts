
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import { WebhookConfig } from './types';
import { telegramFilter } from './filters';

const filterFunctions = {
    telegramFilter
};

const webhookConfig: WebhookConfig = {};

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
        const configPath = './webhooks.yml';
        const fileContents = fs.readFileSync(configPath, 'utf8');
        const parsedYaml: any = yaml.load(fileContents);

        substituteEnvVars(parsedYaml);

        const loadedConfig: WebhookConfig = {};

        for (const serviceName in parsedYaml) {
            const service = parsedYaml[serviceName];
            interface ServiceYamlConfig {
                destination: string;
                authorizedChatIds?: string;
                authorizedUsernames?: string;
                filter?: keyof typeof filterFunctions;
            }

            interface LoadedServiceConfig {
                destination: string;
                authorizedChatIds: string[];
                authorizedUsernames: string[];
                filter?: (payload: any, headers?: any) => boolean;
            }

            const serviceTyped = service as ServiceYamlConfig;

            loadedConfig[serviceName] = {
                destination: serviceTyped.destination!,
                authorizedChatIds: serviceTyped.authorizedChatIds ? serviceTyped.authorizedChatIds.split(',').map((id: string) => id.trim()) : [],
                authorizedUsernames: serviceTyped.authorizedUsernames ? serviceTyped.authorizedUsernames.split(',').map((username: string) => username.trim()) : [],
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