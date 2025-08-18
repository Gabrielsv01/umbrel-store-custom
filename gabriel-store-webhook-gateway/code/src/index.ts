import 'dotenv/config'; 
import express, { Request, Response } from 'express';
import axios from 'axios';
import webhookConfig from './webhook-config';
import { webhookLogs } from './logs';
import path from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';

const MAX_LOGS = 500;
const PORT = process.env.PORT || 5124;
const SESSION_COOKIE = 'webhook_admin';
const PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH || '';
const SESSIONS = new Set<string>();
const SESSION_EXPIRE_MS = 2 * 60 * 1000; // 2 minutes

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function isAuthenticated(req: express.Request): boolean {
    const token = req.cookies[SESSION_COOKIE];
    return token && SESSIONS.has(token);
}

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

app.post('/api/:serviceName', processWebhook);
app.post('/api/:serviceName/webhook/:id/webhook', processWebhook);
app.post('/api/:serviceName/webhook-test/:id/webhook', processWebhook);

app.get('/api/webhooks', (_req: Request, res: Response) => {
    const webhooks = Object.keys(webhookConfig).map(serviceName => ({
        name: serviceName,
        endpoint: `api/${serviceName}`
    }));
    res.json(webhooks);
});

app.get('/api/logs/:serviceName', (req: Request, res: Response) => {
    if (!isAuthenticated(req)) {
        return res.status(401).send('Não autorizado');
    }

   const { serviceName } = req.params;
    const limit = parseInt(req.query.limit as string) || 10; 

    const logs = webhookLogs
        .filter(log => log.service === serviceName)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) // Ordena por data (mais recente primeiro)
        .slice(0, limit);

    res.json(logs);
});

app.get('/dashboard', (req, res) => {
    if (isAuthenticated(req)) {
         return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    } else {
        return res.redirect('/');
    }
});

app.post('/', express.urlencoded({ extended: false }), async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).send('Senha obrigatória');
    
    const isValid = await bcrypt.compare(password, PASSWORD_HASH);
    if (isValid) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        SESSIONS.add(sessionToken);
        res.cookie(SESSION_COOKIE, sessionToken, { httpOnly: true, maxAge: SESSION_EXPIRE_MS });
        setTimeout(() => {
            SESSIONS.delete(sessionToken);
        }, SESSION_EXPIRE_MS);
        return res.redirect('/dashboard');
    } else {
        return res.status(401).send('Senha incorreta');
    }
});

app.listen(PORT, () => {
    console.log(`API de Guarda de Webhooks rodando na porta ${PORT}`);
});