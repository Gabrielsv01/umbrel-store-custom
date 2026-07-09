import rateLimit from "express-rate-limit";
import { CookieOptions, RequestHandler } from 'express';
import { RateLimitConfig } from './types';
import webhookConfig from './webhook-config';

const MAX_LOGS = 500;
const PORT = process.env.PORT || 5124;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '100kb';

// Nº de proxies confiáveis para derivar o IP do cliente (usado pelo rate limit).
// Default 1 = atrás do app-proxy do Umbrel. Exposição direta (sem proxy): use `false`.
// Também aceita `true`, um número, ou lista de subnets/preset (ex: "loopback, 10.0.0.0/8").
const parseTrustProxy = (value: string | undefined): boolean | number | string => {
    const trimmed = value?.trim();
    if (!trimmed) return 1;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    const asNumber = Number(trimmed);
    if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
    return trimmed;
};
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

// Quando false, os logs guardam metadados mas não o payload. Default true (com redação de segredos).
const LOG_PAYLOADS = process.env.LOG_PAYLOADS !== 'false';
const SESSION_COOKIE = 'webhook_admin';
const PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH || '';
const SESSIONS = new Map<string, number>();
const SESSION_EXPIRE_MS = 2 * 60 * 1000; // 2 minutes
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const sameSite = (process.env.COOKIE_SAME_SITE || 'lax').toLowerCase();
const COOKIE_SAME_SITE: 'lax' | 'strict' | 'none' =
  sameSite === 'strict' || sameSite === 'none' ? sameSite : 'lax';
const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  path: '/',
  maxAge: SESSION_EXPIRE_MS,
};
const parsePositiveInt = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5,
  message: 'Muitas tentativas de login. Tente novamente mais tarde.',
});

// Defaults do rate limit de webhooks. Sobrescreve via env ou, por serviço,
// pelo bloco `rateLimit` no config/webhooks.yml.
const DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS =
  parsePositiveInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS) ?? 15 * 60 * 1000; // 15 minutos
const DEFAULT_WEBHOOK_RATE_LIMIT_MAX =
  parsePositiveInt(process.env.WEBHOOK_RATE_LIMIT_MAX) ?? 100;

const passthroughMiddleware: RequestHandler = (_req, _res, next) => next();

const buildWebhookLimiter = (config?: RateLimitConfig): RequestHandler =>
  rateLimit({
    windowMs: config?.windowMs ?? DEFAULT_WEBHOOK_RATE_LIMIT_WINDOW_MS,
    max: config?.max ?? DEFAULT_WEBHOOK_RATE_LIMIT_MAX,
    message: 'Muitas requisições. Tente novamente mais tarde.',
  });

// Cada serviço tem seu próprio limitador, criado na inicialização (o
// express-rate-limit não permite instanciar durante o request), permitindo
// janelas/limites distintos por serviço. Serviços sem `rateLimit` usam o default.
const buildServiceLimiter = (config?: RateLimitConfig): RequestHandler =>
  config?.disabled ? passthroughMiddleware : buildWebhookLimiter(config);

const defaultWebhookLimiter = buildServiceLimiter();
const webhookLimitersByService: Record<string, RequestHandler> = {};
for (const serviceName of Object.keys(webhookConfig)) {
  webhookLimitersByService[serviceName] = buildServiceLimiter(webhookConfig[serviceName]?.rateLimit);
}

const webhookLimiter: RequestHandler = (req, res, next) => {
  const serviceName = (req.params as { serviceName?: string }).serviceName;
  const limiter = (serviceName && webhookLimitersByService[serviceName]) || defaultWebhookLimiter;
  return limiter(req, res, next);
};


export {
    MAX_LOGS,
    PORT,
    JSON_BODY_LIMIT,
    URLENCODED_BODY_LIMIT,
    TRUST_PROXY,
    LOG_PAYLOADS,
    SESSION_COOKIE,
    PASSWORD_HASH,
    SESSIONS,
    SESSION_EXPIRE_MS,
    SESSION_COOKIE_OPTIONS,
    loginLimiter,
    webhookLimiter
}