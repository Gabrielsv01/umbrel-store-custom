import rateLimit from "express-rate-limit";
import { CookieOptions } from 'express';

const MAX_LOGS = 500;
const PORT = process.env.PORT || 5124;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '1mb';
const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '100kb';
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
    JSON_BODY_LIMIT,
    URLENCODED_BODY_LIMIT,
    SESSION_COOKIE,
    PASSWORD_HASH,
    SESSIONS,
    SESSION_EXPIRE_MS,
    SESSION_COOKIE_OPTIONS,
    loginLimiter,
    webhookLimiter
}