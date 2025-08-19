import helmet from 'helmet';
import 'dotenv/config'; 
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import {
    PORT,
    loginLimiter,
    webhookLimiter
} from './constants';
import { processWebhook } from './api';
import { auth, dashboard, logs, webhooks } from './auth';

const app = express();
app.use(helmet());
app.use(helmet.contentSecurityPolicy({ directives: { defaultSrc: ["'self'"] } }));
app.use(helmet.hsts());
app.use(helmet.noSniff());
app.use(helmet.frameguard({ action: 'deny' }));
app.use(helmet.xssFilter());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/:serviceName', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);

// Auth
app.get('/api/webhooks', loginLimiter, webhooks);
app.get('/api/logs/:serviceName', loginLimiter, logs);
app.get('/dashboard', loginLimiter, dashboard);
app.post('/', loginLimiter, express.urlencoded({ extended: false }), auth);

app.listen(PORT, () => {
    console.log(`API de Guarda de Webhooks rodando na porta ${PORT}`);
});