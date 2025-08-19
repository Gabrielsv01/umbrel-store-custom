import express from 'express';
import { SESSION_COOKIE, SESSIONS } from './constants';


function isAuthenticated(req: express.Request): boolean {
    const token = req.cookies[SESSION_COOKIE];
    return token && SESSIONS.has(token);
}

export {
    isAuthenticated
}