import crypto from 'crypto';
import { Response } from 'express';
import { WebhookMethod } from '../types';

export function normalizeSubPathParam(value: unknown): string {
    if (Array.isArray(value)) {
        return value.join('/');
    }

    return typeof value === 'string' ? value : '';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSubdomainPattern(pathValue: string, pattern: string): boolean {
    const normalizedPath = pathValue.replace(/^\/+|\/+$/g, '');
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, '');
    const wildcardRegex = `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`;
    return new RegExp(wildcardRegex).test(normalizedPath);
}

export function findMatchingSubdomainRule(
    pathValue: string,
    rules: Array<{ pattern: string; filter?: (payload: any, headers?: any) => boolean }>,
) {
    return rules.find((rule) => matchSubdomainPattern(pathValue, rule.pattern));
}

export function resolveDestination(baseDestination: string, subPath: string): string {
    if (!subPath) {
        return baseDestination;
    }

    const normalizedSubPath = subPath.replace(/^\/+/, '');

    try {
        const destinationUrl = new URL(baseDestination);
        const basePath = destinationUrl.pathname.replace(/\/+$/, '');
        const mergedPath = `${basePath}/${normalizedSubPath}`.replace(/\/+/g, '/');
        destinationUrl.pathname = mergedPath.startsWith('/') ? mergedPath : `/${mergedPath}`;
        return destinationUrl.toString();
    } catch {
        return `${baseDestination.replace(/\/+$/, '')}/${normalizedSubPath}`;
    }
}

export function isMethodAllowed(
    method: string,
    methods: WebhookMethod[] | undefined,
): boolean {
    const normalizedMethod = method.toUpperCase() as WebhookMethod;
    const allowedMethods = methods && methods.length > 0
        ? methods
        : ['POST'];

    return allowedMethods.includes(normalizedMethod);
}

export function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
    if (!value) return undefined;
    return Array.isArray(value) ? value[0] : value;
}

export function copyUpstreamHeaders(
    res: Response,
    headers: Record<string, unknown>,
    allowedHeaders?: string[],
) {
    const blockedHeaders = new Set([
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
        'content-length',
    ]);

    for (const [key, value] of Object.entries(headers)) {
        if (allowedHeaders && allowedHeaders.length > 0 && !allowedHeaders.includes(key.toLowerCase())) {
            continue;
        }

        if (blockedHeaders.has(key.toLowerCase())) {
            continue;
        }

        if (Array.isArray(value)) {
            res.setHeader(key, value.map((item) => String(item)));
            continue;
        }

        if (value !== undefined && value !== null) {
            res.setHeader(key, String(value));
        }
    }
}

const SENSITIVE_KEY_REGEX = /pass(word|wd)?|secret|api[-_]?key|apikey|authorization|access[-_]?token|refresh[-_]?token|token|cookie|credential|signature/i;
const REDACTED = '[REDACTED]';

// Substitui valores de chaves sensíveis por [REDACTED], recursivamente, em uma cópia.
// Heurística por nome de chave — não muta o objeto original.
export function redactSecrets(value: unknown, depth = 0): unknown {
    if (depth > 6 || value === null || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSecrets(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = SENSITIVE_KEY_REGEX.test(key) ? REDACTED : redactSecrets(val, depth + 1);
    }
    return result;
}

export function tokensMatch(received: string, expected: string): boolean {
    const receivedBuffer = Buffer.from(received, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    if (receivedBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function signatureMatches(
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