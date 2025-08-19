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
if (process.env.ENABLE_HELMET === 'true') {
    app.use(helmet({
         contentSecurityPolicy : process.env.ENABLE_CSP === 'true' ? { directives: { defaultSrc: ["'self'"] } } : false,
         hsts: process.env.ENABLE_HSTS === 'true',
         noSniff: process.env.ENABLE_NO_SNIFF === 'true',
         frameguard: process.env.ENABLE_FRAMEGUARD === 'true' ? { action: 'deny' } : false,
         xssFilter: process.env.ENABLE_XSS_FILTER === 'true'
    }));
}
app.set('trust proxy', true);
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/:serviceName', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);

// Auth
app.get('/api/webhooks', webhooks);
app.get('/api/logs/:serviceName', logs);
app.get('/dashboard', dashboard);
app.post('/', loginLimiter, express.urlencoded({ extended: false }), auth);

app.listen(PORT, () => {
    console.log(`API de Guarda de Webhooks rodando na porta ${PORT}`);
});