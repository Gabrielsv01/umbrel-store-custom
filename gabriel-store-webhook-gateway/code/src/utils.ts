import express, { Response } from 'express';
import { SESSION_COOKIE, SESSIONS, SESSION_EXPIRE_MS, SESSION_COOKIE_OPTIONS } from './constants';


function isAuthenticated(req: express.Request, res?: Response): boolean {
    const token = req.cookies[SESSION_COOKIE] as string | undefined;

    if (!token) {
        return false;
    }

    const expiresAt = SESSIONS.get(token);
    if (!expiresAt || expiresAt < Date.now()) {
        SESSIONS.delete(token);
        return false;
    }

    // Sliding session expiration on each authenticated request.
    SESSIONS.set(token, Date.now() + SESSION_EXPIRE_MS);
    if (res) {
        res.cookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
    }

    return true;
}

export {
    isAuthenticated
}