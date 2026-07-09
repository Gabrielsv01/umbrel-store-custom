import axios from "axios";
import { MAX_LOGS } from "../constants";
import { webhookLogs } from "../logs";
import webhookConfig from "../webhook-config";
import { Request, Response } from 'express';
import { WebhookMethod } from "../types";
import {
    copyUpstreamHeaders,
    findMatchingSubdomainRule,
    isMethodAllowed,
    normalizeHeaderValue,
    normalizeSubPathParam,
    resolveDestination,
    signatureMatches,
    tokensMatch,
} from './processWebhook-helpers';

type RequestWithRawBody = Request & { rawBody?: Buffer };

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


function createRequestContext(req: Request) {
    const { serviceName } = req.params;
    const config = webhookConfig[serviceName];
    const requestSubPath = normalizeSubPathParam((req.params as Record<string, unknown>).subPath);
    const normalizedSubPath = requestSubPath.replace(/^\/+|\/+$/g, '');
    const requestMethod = req.method.toUpperCase() as WebhookMethod;
    const isGetRequest = requestMethod === 'GET';
    const payload = isGetRequest ? req.query : req.body;

    return {
        serviceName,
        config,
        normalizedSubPath,
        requestMethod,
        isGetRequest,
        payload,
    };
}

function logAndRespond(
    res: Response,
    args: {
        serviceName: string;
        status: string;
        summary: string;
        payload: any;
        details?: string;
        httpStatus: number;
        body: string;
        warning?: string;
    },
) {
    if (args.warning) {
        console.warn(args.warning);
    }

    pushLog({
        service: args.serviceName,
        status: args.status,
        summary: args.summary,
        payload: args.payload,
        details: args.details,
    });

    return res.status(args.httpStatus).send(args.body);
}

function ensureServiceConfig(
    res: Response,
    serviceName: string,
    config: any,
    payload: any,
) {
    if (config) {
        return true;
    }

    logAndRespond(res, {
        serviceName,
        status: 'unknown_service',
        summary: 'Serviço desconhecido',
        payload,
        httpStatus: 404,
        body: 'Serviço de webhook não encontrado.',
        warning: `[${serviceName}] - Serviço desconhecido. Requisição rejeitada.`,
    });
    return false;
}

function ensureMethodAllowed(
    res: Response,
    serviceName: string,
    config: any,
    requestMethod: WebhookMethod,
    payload: any,
) {
    if (isMethodAllowed(requestMethod, config.methods)) {
        return true;
    }

    logAndRespond(res, {
        serviceName,
        status: 'method_not_allowed',
        summary: `Método ${requestMethod} não permitido para este serviço`,
        payload,
        httpStatus: 405,
        body: 'Método não permitido para este serviço.',
    });
    return false;
}

function resolveMatchedSubdomainRule(
    res: Response,
    serviceName: string,
    config: any,
    normalizedSubPath: string,
    payload: any,
) {
    if (!normalizedSubPath) {
        return { ok: true, matchedSubdomainRule: undefined as { pattern: string; filter?: (payload: any, headers?: any) => boolean } | undefined };
    }

    const matchedSubdomainRule = findMatchingSubdomainRule(normalizedSubPath, config.subdomain || []);
    if (matchedSubdomainRule) {
        return { ok: true, matchedSubdomainRule };
    }

    logAndRespond(res, {
        serviceName,
        status: 'subpath_not_allowed',
        summary: 'Subcaminho não permitido para este serviço',
        payload,
        details: normalizedSubPath,
        httpStatus: 404,
        body: 'Subcaminho não permitido para este serviço.',
    });
    return { ok: false, matchedSubdomainRule: undefined };
}

function ensureDestinationConfigured(
    res: Response,
    serviceName: string,
    config: any,
    payload: any,
) {
    if (config.destination) {
        return true;
    }

    logAndRespond(res, {
        serviceName,
        status: 'failed',
        summary: 'Destino não configurado',
        payload,
        httpStatus: 500,
        body: 'Destino do webhook não configurado.',
    });
    return false;
}

function validateGetTokenIfNeeded(
    req: Request,
    res: Response,
    args: {
        serviceName: string;
        config: any;
        payload: any;
    },
) {
    const { serviceName, config, payload } = args;

    // Opcional: sem token configurado, o GET segue sem exigência (comportamento legado).
    if (!config.getTokenSecret) {
        return true;
    }

    const headerName = config.getTokenHeader || 'x-webhook-token';
    const received = normalizeHeaderValue(req.headers[headerName]);

    if (received && tokensMatch(received, config.getTokenSecret)) {
        return true;
    }

    logAndRespond(res, {
        serviceName,
        status: 'unauthorized',
        summary: received ? 'Token de acesso inválido' : 'Token de acesso ausente',
        payload,
        details: `Header esperado: ${headerName}`,
        httpStatus: 401,
        body: 'Token de acesso do webhook inválido ou ausente.',
    });
    return false;
}

function validateSignatureIfNeeded(
    req: Request,
    res: Response,
    args: {
        serviceName: string;
        config: any;
        isGetRequest: boolean;
        payload: any;
    },
) {
    const { serviceName, config, isGetRequest, payload } = args;

    // GET não tem corpo para assinar via HMAC; autentica por token de header (opcional).
    if (isGetRequest) {
        return validateGetTokenIfNeeded(req, res, { serviceName, config, payload });
    }

    if (!config.signatureSecret) {
        return true;
    }

    const headerName = config.signatureHeader || 'x-webhook-signature';
    const signature = normalizeHeaderValue(req.headers[headerName]);

    if (!signature) {
        logAndRespond(res, {
            serviceName,
            status: 'unauthorized',
            summary: 'Assinatura ausente',
            payload,
            details: `Header esperado: ${headerName}`,
            httpStatus: 401,
            body: 'Assinatura do webhook ausente.',
        });
        return false;
    }

    const rawBody = (req as RequestWithRawBody).rawBody;
    if (!rawBody) {
        logAndRespond(res, {
            serviceName,
            status: 'failed',
            summary: 'Corpo bruto ausente para validação',
            payload,
            httpStatus: 400,
            body: 'Não foi possível validar a assinatura.',
        });
        return false;
    }

    const isValidSignature = signatureMatches(
        rawBody,
        signature,
        config.signatureSecret,
        config.hmacAlgorithm || 'sha256',
        config.signaturePrefix,
    );

    if (isValidSignature) {
        return true;
    }

    logAndRespond(res, {
        serviceName,
        status: 'unauthorized',
        summary: 'Assinatura inválida',
        payload,
        httpStatus: 401,
        body: 'Assinatura do webhook inválida.',
    });
    return false;
}

function applyRequestFilter(
    res: Response,
    args: {
        serviceName: string;
        payload: any;
        headers: any;
        requestFilter?: (payload: any, headers?: any) => boolean;
    },
) {
    const { serviceName, payload, headers, requestFilter } = args;
    if (!requestFilter || requestFilter(payload, headers)) {
        return true;
    }

    console.log(`[${serviceName}] - Requisição filtrada e ignorada com base no conteúdo.`);
    logAndRespond(res, {
        serviceName,
        status: 'filtered',
        summary: 'Requisição filtrada',
        payload,
        httpStatus: 200,
        body: 'OK, mas a requisição foi filtrada.',
    });
    return false;
}

async function forwardToDestination(
    req: Request,
    args: {
        config: any;
        requestMethod: WebhookMethod;
        destination: string;
    },
) {
    const methodsWithBody: WebhookMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const shouldSendBody = methodsWithBody.includes(args.requestMethod);

    const configuredForwardHeaders = (
        args.config?.upstream?.forwardRequest?.HEADERS
        || args.config?.upstream?.forwardRequestHeaders
    ) as string[] | undefined;
    const passThroughHeaderNames = configuredForwardHeaders && configuredForwardHeaders.length > 0
        ? configuredForwardHeaders
        : ['range', 'accept', 'user-agent', 'if-none-match', 'if-modified-since'];

    const upstreamHeaders: Record<string, string> = {};
    for (const headerName of passThroughHeaderNames) {
        const headerValue = normalizeHeaderValue(req.headers[headerName]);
        if (headerValue) {
            upstreamHeaders[headerName.toLowerCase()] = headerValue;
        }
    }

    if (shouldSendBody) {
        upstreamHeaders['content-type'] = 'application/json';
    }

    const configuredTimeoutByMethod = args.config?.upstream?.timeoutMsByMethod?.[args.requestMethod];
    const configuredTimeoutDefault = args.config?.upstream?.timeoutMs;
    const timeoutMs = configuredTimeoutByMethod
        ?? configuredTimeoutDefault
        ?? (args.requestMethod === 'GET' ? 0 : 5000);

    return axios.request({
        method: args.requestMethod,
        url: args.destination,
        params: !shouldSendBody ? req.query : undefined,
        data: shouldSendBody ? req.body : undefined,
        headers: Object.keys(upstreamHeaders).length > 0 ? upstreamHeaders : undefined,
        responseType: args.requestMethod === 'GET' ? 'stream' : 'arraybuffer',
        timeout: timeoutMs,
        validateStatus: () => true,
    });
}

function getEffectiveResponsePolicy(config: any, requestMethod: WebhookMethod) {
    return {
        ...(config.response?.default || {}),
        ...(config.response?.methods?.[requestMethod] || {}),
    };
}

function respondWithUpstream(
    res: Response,
    args: {
        upstreamResponse: any;
        effectiveResponsePolicy: any;
    },
) {
    const { upstreamResponse, effectiveResponsePolicy } = args;
    const passStatus = effectiveResponsePolicy.passStatus ?? true;
    const passBody = effectiveResponsePolicy.passBody ?? true;
    const passHeaders = effectiveResponsePolicy.passHeaders ?? true;
    const statusToSend = passStatus ? upstreamResponse.status : (effectiveResponsePolicy.defaultStatus ?? 200);

    if (passHeaders) {
        copyUpstreamHeaders(res, upstreamResponse.headers, effectiveResponsePolicy.allowedHeaders);
    }

    const upstreamData = upstreamResponse.data;
    const isStream = upstreamData && typeof upstreamData.pipe === 'function';

    if (!passBody) {
        if (isStream && typeof upstreamData.destroy === 'function') {
            upstreamData.destroy();
        }

        const bodyToSend = effectiveResponsePolicy.defaultBody ?? 'OK';
        return res.status(statusToSend).send(bodyToSend);
    }

    if (isStream) {
        res.status(statusToSend);
        upstreamData.on('error', (error: Error) => {
            console.error('Erro ao transmitir resposta do destino:', error.message);
            if (!res.headersSent) {
                res.status(502).send('Erro ao transmitir resposta do destino.');
                return;
            }

            res.end();
        });
        upstreamData.pipe(res);
        return;
    }

    const bodyToSend = upstreamResponse.data;
    return res.status(statusToSend).send(bodyToSend);
}

function prepareWebhookRequest(req: Request, res: Response) {
    const context = createRequestContext(req);
    const {
        serviceName,
        config,
        normalizedSubPath,
        requestMethod,
        isGetRequest,
        payload,
    } = context;

    if (!ensureServiceConfig(res, serviceName, config, payload)) return null;
    if (!ensureMethodAllowed(res, serviceName, config, requestMethod, payload)) return null;

    const subpathResult = resolveMatchedSubdomainRule(res, serviceName, config, normalizedSubPath, payload);
    if (!subpathResult.ok) return null;
    const matchedSubdomainRule = subpathResult.matchedSubdomainRule;

    if (!ensureDestinationConfigured(res, serviceName, config, payload)) return null;

    if (process.env.DEBUG === "true"){
        console.log(`[${serviceName}] - Requisição recebida (${req.method}):`, payload);
        if (config.filter) {
            console.log(`[${serviceName}] - Requisição recebida, filtrada:`, !config.filter(req.body, req.headers));
        } else {
            console.log(`[${serviceName}] - Requisição recebida, filter is undefined:`, config.filter);
        }
    }

    if (!validateSignatureIfNeeded(req, res, { serviceName, config, isGetRequest, payload })) return null;

    const requestFilter = matchedSubdomainRule?.filter || config.filter;
    if (!applyRequestFilter(res, { serviceName, payload, headers: req.headers, requestFilter })) return null;

    const destination = resolveDestination(config.destination, normalizedSubPath);
    return {
        serviceName,
        config,
        payload,
        requestMethod,
        destination,
    };
}

async function processWebhook(req: Request, res: Response) {
    const prepared = prepareWebhookRequest(req, res);
    if (!prepared) return;

    const {
        serviceName,
        config,
        payload,
        requestMethod,
        destination,
    } = prepared;

    try {
        if (process.env.DEBUG === "true"){
            console.log(`[${serviceName}] - Enviando requisição para:`, destination);
            console.log(`[${serviceName}] - Payload da requisição:`, payload);
            console.log(`[${serviceName}] - Body da headers:`, req.headers);
        }
        const upstreamResponse = await forwardToDestination(req, { config, requestMethod, destination });
        const effectiveResponsePolicy = getEffectiveResponsePolicy(config, requestMethod);

        const isSuccess = upstreamResponse.status >= 200 && upstreamResponse.status < 300;
        if (isSuccess) {
            console.log(`[${serviceName}] - Webhook repassado com sucesso.`);
        } else {
            console.warn(`[${serviceName}] - Destino respondeu com status ${upstreamResponse.status}.`);
        }

        pushLog({
            service: serviceName,
            status: isSuccess ? 'forwarded' : 'failed',
            summary: isSuccess ? 'Webhook repassado com sucesso' : `Destino respondeu HTTP ${upstreamResponse.status}`,
            payload,
            details: isSuccess ? undefined : `Destino respondeu HTTP ${upstreamResponse.status}`,
        });
        return respondWithUpstream(res, { upstreamResponse, effectiveResponsePolicy });

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