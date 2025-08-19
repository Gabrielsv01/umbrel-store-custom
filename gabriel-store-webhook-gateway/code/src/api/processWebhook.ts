import axios from "axios";
import { MAX_LOGS } from "../constants";
import { webhookLogs } from "../logs";
import webhookConfig from "../webhook-config";
import { Request, Response } from 'express';

async function processWebhook(req: Request, res: Response) {
     const { serviceName } = req.params;
    const config = webhookConfig[serviceName];

    const logEntry = {
        timestamp: new Date().toISOString(),
        service: serviceName,
        status: 'passed',
        summary: `Recebido do ${serviceName}`,
        payload: req.body,
    };

    if (!config) {
        console.warn(`[${serviceName}] - Serviço desconhecido. Requisição rejeitada.`);
        return res.status(404).send('Serviço de webhook não encontrado.');
    }
    
    if (config.filter && !config.filter(req.body, req.headers)) {
        console.log(`[${serviceName}] - Requisição filtrada e ignorada com base no conteúdo.`);
        return res.status(200).send('OK, mas a requisição foi filtrada.');
    }
    
    webhookLogs.push(logEntry);
    
    if (webhookLogs.length > MAX_LOGS) {
        webhookLogs.splice(0, webhookLogs.length - MAX_LOGS);
    }


    try {
        await axios.post(config.destination, req.body, {
            headers: req.headers as any
        });
        console.log(`[${serviceName}] - Webhook repassado com sucesso.`);
        return res.status(200).send('OK');

    } catch (error) {
        console.error(`[${serviceName}] - Erro ao repassar o webhook.`, (error as any).message);
        return res.status(500).send('Erro interno ao processar o webhook.');
    }
};


export default processWebhook;