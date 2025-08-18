import 'dotenv/config'; 
import express, { Request, Response } from 'express';
import axios from 'axios';
import webhookConfig from './webhook-config';
import { webhookLogs } from './logs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 5124;
const MAX_LOGS = 500;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.post('/:serviceName', processWebhook);
app.post('/:serviceName/webhook/:id/webhook', processWebhook);
app.post('/:serviceName/webhook-test/:id/webhook', processWebhook);

app.get('/api/webhooks', (_req: Request, res: Response) => {
    const webhooks = Object.keys(webhookConfig).map(serviceName => ({
        name: serviceName,
        endpoint: `/${serviceName}`
    }));
    res.json(webhooks);
});

app.get('/api/logs/:serviceName', (req: Request, res: Response) => {
   const { serviceName } = req.params;
    const limit = parseInt(req.query.limit as string) || 10; 

    const logs = webhookLogs
        .filter(log => log.service === serviceName)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) // Ordena por data (mais recente primeiro)
        .slice(0, limit);

    res.json(logs);
});

app.listen(PORT, () => {
    console.log(`API de Guarda de Webhooks rodando na porta ${PORT}`);
});