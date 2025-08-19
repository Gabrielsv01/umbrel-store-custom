import { Request, Response } from 'express';
import path from 'path';
import { isAuthenticated } from '../utils';

async function dashboard(req: Request, res: Response) {
    if (isAuthenticated(req)) {
         return res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
    } else {
        return res.redirect('/');
    }
}

export default dashboard;