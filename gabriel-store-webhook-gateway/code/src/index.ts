import helmet from 'helmet';
import 'dotenv/config'; 
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import {
    PORT,
    JSON_BODY_LIMIT,
    URLENCODED_BODY_LIMIT,
    TRUST_PROXY,
    loginLimiter,
    webhookLimiter
} from './constants';
import { processWebhook } from './api';
import { auth, dashboard, logs, webhooks } from './auth';

const app = express();
if (process.env.ENABLE_HELMET === 'true') {
    app.use(helmet({
         contentSecurityPolicy : process.env.ENABLE_CSP === 'true' ? { directives: { defaultSrc: ["'self'"] } } : false,
         hsts: process.env.ENABLE_HSTS === 'true' ? {
             maxAge: 31536000,
             includeSubDomains: true,
             preload: process.env.ENABLE_HSTS_PRELOAD === 'true'
         } : false,
         noSniff: process.env.ENABLE_NO_SNIFF === 'true',
         frameguard: process.env.ENABLE_FRAMEGUARD === 'true' ? { action: 'deny' } : false,
         xssFilter: process.env.ENABLE_XSS_FILTER === 'true',
         crossOriginEmbedderPolicy: process.env.ENABLE_COEP === 'true'
    }));
}

// Permissions-Policy: o Helmet não emite esse header, então setamos manualmente.
// Default é negar todos os recursos (deny-all); pode ser sobrescrito via PERMISSIONS_POLICY_VALUE.
if (process.env.ENABLE_PERMISSIONS_POLICY === 'true') {
    const permissionsPolicy = process.env.PERMISSIONS_POLICY_VALUE
        || 'geolocation=(), camera=(), microphone=(), payment=(), usb=()';
    app.use((_req, res, next) => {
        res.setHeader('Permissions-Policy', permissionsPolicy);
        next();
    });
}

app.set('trust proxy', TRUST_PROXY);
app.use(express.json({
    limit: JSON_BODY_LIMIT,
    verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    }
}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/webhooks', webhooks);
app.get('/api/logs/:serviceName', logs);
app.get('/dashboard', dashboard);
app.post('/', loginLimiter, express.urlencoded({ extended: false, limit: URLENCODED_BODY_LIMIT }), auth);

app.post('/api/:serviceName', webhookLimiter, processWebhook);
app.post('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.post('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.get('/api/:serviceName', webhookLimiter, processWebhook);
app.get('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.get('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.get('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.put('/api/:serviceName', webhookLimiter, processWebhook);
app.put('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.put('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.put('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.patch('/api/:serviceName', webhookLimiter, processWebhook);
app.patch('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.patch('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.patch('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.delete('/api/:serviceName', webhookLimiter, processWebhook);
app.delete('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.delete('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.delete('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.head('/api/:serviceName', webhookLimiter, processWebhook);
app.head('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.head('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.head('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);
app.options('/api/:serviceName', webhookLimiter, processWebhook);
app.options('/api/:serviceName/*subPath', webhookLimiter, processWebhook);
app.options('/api/:serviceName/webhook/:id/webhook', webhookLimiter, processWebhook);
app.options('/api/:serviceName/webhook-test/:id/webhook', webhookLimiter, processWebhook);

app.listen(PORT, () => {
    console.log(`API de Guarda de Webhooks rodando na porta ${PORT}`);
});