import axios from "axios";
import { MAX_LOGS } from "../constants";
import { webhookLogs } from "../logs";
import webhookConfig from "../webhook-config";
import { Request, Response } from 'express';
import crypto from 'crypto';

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

    if (!config) {
        console.warn(`[${serviceName}] - Serviço desconhecido. Requisição rejeitada.`);
        pushLog({
            service: serviceName,
            status: 'unknown_service',
            summary: 'Serviço desconhecido',
            payload: req.body,
        });
        return res.status(404).send('Serviço de webhook não encontrado.');
    }

    if (!config.destination) {
        pushLog({
            service: serviceName,
            status: 'failed',
            summary: 'Destino não configurado',
            payload: req.body,
        });
        return res.status(500).send('Destino do webhook não configurado.');
    }

    if (process.env.DEBUG === "true"){
        console.log(`[${serviceName}] - Requisição recebida:`, req.body);
    }

    if (process.env.DEBUG === "true"){
        if (config.filter) {
            console.log(`[${serviceName}] - Requisição recebida, filtrada:`, !config.filter(req.body, req.headers));
        }else{
            console.log(`[${serviceName}] - Requisição recebida, filter is undefined:`, config.filter);
        }
    }

    if (config.signatureSecret) {
        const headerName = config.signatureHeader || 'x-webhook-signature';
        const signature = normalizeHeaderValue(req.headers[headerName] as string | string[] | undefined);

        if (!signature) {
            pushLog({
                service: serviceName,
                status: 'unauthorized',
                summary: 'Assinatura ausente',
                payload: req.body,
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
                payload: req.body,
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
                payload: req.body,
            });
            return res.status(401).send('Assinatura do webhook inválida.');
        }
    }

    if (config.filter && !config.filter(req.body, req.headers)) {
        console.log(`[${serviceName}] - Requisição filtrada e ignorada com base no conteúdo.`);
        pushLog({
            service: serviceName,
            status: 'filtered',
            summary: 'Requisição filtrada',
            payload: req.body,
        });
        return res.status(200).send('OK, mas a requisição foi filtrada.');
    }

    try {
        if (process.env.DEBUG === "true"){
            console.log(`[${serviceName}] - Enviando requisição para:`, config.destination);
            console.log(`[${serviceName}] - Body da requisição:`, req.body);
            console.log(`[${serviceName}] - Body da headers:`, req.headers);
        }
        await axios.post(config.destination, req.body, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });
        console.log(`[${serviceName}] - Webhook repassado com sucesso.`);
        pushLog({
            service: serviceName,
            status: 'forwarded',
            summary: 'Webhook repassado com sucesso',
            payload: req.body,
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
            payload: req.body,
            details: destinationStatus ? `Destino respondeu HTTP ${destinationStatus}` : err?.message,
        });
        return res.status(500).send('Erro interno ao processar o webhook.');
    }
};


export default processWebhook;