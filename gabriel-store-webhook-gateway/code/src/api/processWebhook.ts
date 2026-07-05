import axios from "axios";
import { MAX_LOGS } from "../constants";
import { webhookLogs } from "../logs";
import webhookConfig from "../webhook-config";
import { Request, Response } from 'express';
import crypto from 'crypto';
import { WebhookMethod } from "../types";

type RequestWithRawBody = Request & { rawBody?: Buffer };

function normalizeSubPathParam(value: unknown): string {
    if (Array.isArray(value)) {
        return value.join('/');
    }

    return typeof value === 'string' ? value : '';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSubdomainPattern(pathValue: string, pattern: string): boolean {
    const normalizedPath = pathValue.replace(/^\/+|\/+$/g, '');
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '');
    const wildcardRegex = `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`;
    return new RegExp(wildcardRegex).test(normalizedPath);
}

function findMatchingSubdomainRule(
    pathValue: string,
    rules: Array<{ pattern: string; filter?: (payload: any, headers?: any) => boolean }>,
) {
    return rules.find((rule) => matchSubdomainPattern(pathValue, rule.pattern));
}

function resolveDestination(baseDestination: string, subPath: string): string {
    if (!subPath) {
        return baseDestination;
    }

    const normalizedSubPath = subPath.replace(/^\/+/, '');

    try {
        const destinationUrl = new URL(baseDestination);
        const basePath = destinationUrl.pathname.replace(/\/+$/, '');
        const mergedPath = `${basePath}/${normalizedSubPath}`.replace(/\/+/g, '/');
        destinationUrl.pathname = mergedPath.startsWith('/') ? mergedPath : `/${mergedPath}`;
        return destinationUrl.toString();
    } catch {
        return `${baseDestination.replace(/\/+$/, '')}/${normalizedSubPath}`;
    }
}

function isMethodAllowed(
    method: string,
    methods: WebhookMethod[] | undefined,
    legacyAllowGet: boolean | undefined,
): boolean {
    const normalizedMethod = method.toUpperCase() as WebhookMethod;
    const allowedMethods = methods && methods.length > 0
        ? methods
        : (legacyAllowGet ? ['POST', 'GET'] : ['POST']);

    return allowedMethods.includes(normalizedMethod);
}

function pushLog(log: {
    service: string;
    status: string;
    summary: string;
    payload: any;
    details?: string;
}) {
    webhookLogs.push({
        timestamp: new Date().toISOString(),
        ...log,
    });

    if (webhookLogs.length > MAX_LOGS) {
        webhookLogs.splice(0, webhookLogs.length - MAX_LOGS);
    }
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
}

function signatureMatches(
    rawBody: Buffer,
    receivedSignature: string,
    secret: string,
    algorithm: string,
    prefix?: string,
): boolean {
    const cleanReceived = prefix && receivedSignature.startsWith(prefix)
        ? receivedSignature.slice(prefix.length)
        : receivedSignature;

    const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest('hex');
    const receivedBuffer = Buffer.from(cleanReceived, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function processWebhook(req: Request, res: Response) {
    const { serviceName } = req.params;
    const config = webhookConfig[serviceName];
    const requestSubPath = normalizeSubPathParam((req.params as Record<string, unknown>).subPath);
    const normalizedSubPath = requestSubPath.replace(/^\/+|\/+$/g, '');
    const requestMethod = req.method.toUpperCase() as WebhookMethod;
    const isGetRequest = requestMethod === 'GET';
    const payload = isGetRequest ? req.query : req.body;
    let matchedSubdomainRule: { pattern: string; filter?: (payload: any, headers?: any) => boolean } | undefined;

    if (!config) {
        console.warn(`[${serviceName}] - Serviço desconhecido. Requisição rejeitada.`);
        pushLog({
            service: serviceName,
            status: 'unknown_service',
            summary: 'Serviço desconhecido',
            payload,
        });
        return res.status(404).send('Serviço de webhook não encontrado.');
    }

    if (!isMethodAllowed(requestMethod, config.methods, config.allowGet)) {
        pushLog({
            service: serviceName,
            status: 'method_not_allowed',
            summary: `Método ${requestMethod} não permitido para este serviço`,
            payload,
        });
        return res.status(405).send('Método não permitido para este serviço.');
    }

    if (normalizedSubPath) {
        const allowedRules = config.subdomain || [];
        matchedSubdomainRule = findMatchingSubdomainRule(normalizedSubPath, allowedRules);

        if (!matchedSubdomainRule) {
            pushLog({
                service: serviceName,
                status: 'subpath_not_allowed',
                summary: 'Subcaminho não permitido para este serviço',
                payload,
                details: normalizedSubPath,
            });
            return res.status(404).send('Subcaminho não permitido para este serviço.');
        }
    }

    if (!config.destination) {
        pushLog({
            service: serviceName,
            status: 'failed',
            summary: 'Destino não configurado',
            payload,
        });
        return res.status(500).send('Destino do webhook não configurado.');
    }

    if (process.env.DEBUG === "true"){
        console.log(`[${serviceName}] - Requisição recebida (${req.method}):`, payload);
    }

    if (process.env.DEBUG === "true"){
        if (config.filter) {
            console.log(`[${serviceName}] - Requisição recebida, filtrada:`, !config.filter(req.body, req.headers));
        }else{
            console.log(`[${serviceName}] - Requisição recebida, filter is undefined:`, config.filter);
        }
    }

    if (config.signatureSecret && !isGetRequest) {
        const headerName = config.signatureHeader || 'x-webhook-signature';
        const signature = normalizeHeaderValue(req.headers[headerName] as string | string[] | undefined);

        if (!signature) {
            pushLog({
                service: serviceName,
                status: 'unauthorized',
                summary: 'Assinatura ausente',
                payload,
                details: `Header esperado: ${headerName}`,
            });
            return res.status(401).send('Assinatura do webhook ausente.');
        }

        const rawBody = (req as RequestWithRawBody).rawBody;
        if (!rawBody) {
            pushLog({
                service: serviceName,
                status: 'failed',
                summary: 'Corpo bruto ausente para validação',
                payload,
            });
            return res.status(400).send('Não foi possível validar a assinatura.');
        }

        const isValidSignature = signatureMatches(
            rawBody,
            signature,
            config.signatureSecret,
            config.hmacAlgorithm || 'sha256',
            config.signaturePrefix,
        );

        if (!isValidSignature) {
            pushLog({
                service: serviceName,
                status: 'unauthorized',
                summary: 'Assinatura inválida',
                payload,
            });
            return res.status(401).send('Assinatura do webhook inválida.');
        }
    }

    const requestFilter = matchedSubdomainRule?.filter || config.filter;

    if (requestFilter && !requestFilter(payload, req.headers)) {
        console.log(`[${serviceName}] - Requisição filtrada e ignorada com base no conteúdo.`);
        pushLog({
            service: serviceName,
            status: 'filtered',
            summary: 'Requisição filtrada',
            payload,
        });
        return res.status(200).send('OK, mas a requisição foi filtrada.');
    }

    try {
        const destination = resolveDestination(config.destination, normalizedSubPath);

        if (process.env.DEBUG === "true"){
            console.log(`[${serviceName}] - Enviando requisição para:`, destination);
            console.log(`[${serviceName}] - Payload da requisição:`, payload);
            console.log(`[${serviceName}] - Body da headers:`, req.headers);
        }
        const methodsWithBody: WebhookMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];
        const shouldSendBody = methodsWithBody.includes(requestMethod);

        await axios.request({
            method: requestMethod,
            url: destination,
            params: !shouldSendBody ? req.query : undefined,
            data: shouldSendBody ? req.body : undefined,
            headers: shouldSendBody ? { 'Content-Type': 'application/json' } : undefined,
            timeout: 5000,
        });
        console.log(`[${serviceName}] - Webhook repassado com sucesso.`);
        pushLog({
            service: serviceName,
            status: 'forwarded',
            summary: 'Webhook repassado com sucesso',
            payload,
        });
        return res.status(200).send('OK');

    } catch (error) {
        const err = error as any;
        const destinationStatus = err?.response?.status;
        console.error(`[${serviceName}] - Erro ao repassar o webhook.`, err?.message);
        pushLog({
            service: serviceName,
            status: 'failed',
            summary: 'Falha ao repassar webhook',
            payload,
            details: destinationStatus ? `Destino respondeu HTTP ${destinationStatus}` : err?.message,
        });
        return res.status(500).send('Erro interno ao processar o webhook.');
    }
};


export default processWebhook;