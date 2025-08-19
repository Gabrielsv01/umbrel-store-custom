import { isAuthenticated } from "../utils";
import webhookConfig from "../webhook-config";
import { Request, Response } from 'express';

async function webhooks(req: Request, res: Response) {
    if (!isAuthenticated(req)) {
        return res.status(401).send('Não autorizado');
    }

    const webhooks = Object.keys(webhookConfig).map(serviceName => ({
        name: serviceName,
        endpoint: `api/${serviceName}`
    }));
    res.json(webhooks);
}   

export default webhooks;