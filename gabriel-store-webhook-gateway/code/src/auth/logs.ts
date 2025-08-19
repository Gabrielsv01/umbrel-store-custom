import { Request, Response } from 'express';
import { isAuthenticated } from '../utils';
import { webhookLogs } from '../logs';

async function logs(req: Request, res: Response) {
    if (!isAuthenticated(req)) {
        return res.status(401).send('Não autorizado');
    }

   const { serviceName } = req.params;
    const limit = parseInt(req.query.limit as string) || 10; 

    const logs = webhookLogs
        .filter(log => log.service === serviceName)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

    res.json(logs);
}

export default logs;