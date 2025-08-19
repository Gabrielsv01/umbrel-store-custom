
import express, { Request, Response } from 'express';
import axios from 'axios';
import 'dotenv/config'; 

const { PORT, TELEGRAM_BOT_TOKEN, WEBHOOK_URL, FORWARD_ENDPOINT, URI_BASE } = process.env;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const URI = `${URI_BASE}/${TELEGRAM_BOT_TOKEN}`;
const webhookURL = `${WEBHOOK_URL}${URI}`;


const app = express();
app.use(express.json());


const setupWebhook = async (): Promise<void> => {
    try {
        await axios.get(`${TELEGRAM_API}/setWebhook?url=${webhookURL}&drop_pending_updates=true`);
        console.log('Webhook configurado com sucesso!');
    } catch (error: any) {
        console.error('Erro ao configurar webhook:', error);
    }
};


app.post(URI, async (req: Request, res: Response) => {
    try {
        await axios.post(FORWARD_ENDPOINT as string, req.body);
        res.status(200).send('ok');
    } catch (error: any) {
        console.error('Erro ao encaminhar mensagem:', error.message);
        res.status(500).send('Erro interno');
    }
});


app.listen(Number(PORT), async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    await setupWebhook();
});