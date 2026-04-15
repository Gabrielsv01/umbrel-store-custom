import { Request, Response } from 'express';
import { PASSWORD_HASH, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, SESSION_EXPIRE_MS, SESSIONS } from '../constants';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

async function auth(req: Request, res: Response) {
    const { password } = req.body;
    if (!password) return res.status(400).send('Senha obrigatória');
    
    const isValid = await bcrypt.compare(password, PASSWORD_HASH);
    if (isValid) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        SESSIONS.set(sessionToken, Date.now() + SESSION_EXPIRE_MS);
        res.cookie(SESSION_COOKIE, sessionToken, SESSION_COOKIE_OPTIONS);
        return res.redirect('/dashboard');
    } else {
        return res.status(401).send('Senha incorreta');
    }
}

export default auth;