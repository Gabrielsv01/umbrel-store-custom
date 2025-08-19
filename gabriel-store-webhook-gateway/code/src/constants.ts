import rateLimit from "express-rate-limit";

const MAX_LOGS = 500;
const PORT = process.env.PORT || 5124;
const SESSION_COOKIE = 'webhook_admin';
const PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH || '';
const SESSIONS = new Set<string>();
const SESSION_EXPIRE_MS = 2 * 60 * 1000; // 2 minutes
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 5,
  message: 'Muitas tentativas de login. Tente novamente mais tarde.',
});
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: 'Muitas requisições. Tente novamente mais tarde.',
});


export {
    MAX_LOGS,
    PORT,
    SESSION_COOKIE,
    PASSWORD_HASH,
    SESSIONS,
    SESSION_EXPIRE_MS,
    loginLimiter,
    webhookLimiter
}