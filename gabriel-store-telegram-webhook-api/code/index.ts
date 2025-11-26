import express, { Request, Response } from 'express';
import axios from 'axios';
import 'dotenv/config';

const { PORT, TELEGRAM_BOT_TOKEN, WEBHOOK_URL, FORWARD_ENDPOINT, URI_BASE, DEBUG } = process.env;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const URI = `${URI_BASE}`;
const webhookURL = `${WEBHOOK_URL}${URI}`;


const app = express();
app.use(express.json());

async function getNgrokPublicUrl(): Promise<string | null> {
    const ngrokWebUrl = process.env.NGROK_WEB_URL;
    if (!ngrokWebUrl) {
        console.error('Variável de ambiente NGROK_WEB_URL não definida');
        return null;
    }
    try {
        const res = await axios.get(ngrokWebUrl);
        const html = res.data as string;
        const match = html.match(/<th>URL<\/th><td>(https:\/\/[^<]+)<\/td>/);
        if (match && match[1]) {
            return match[1];
        }
        return null;
    } catch (err) {
        console.error('Erro ao buscar ngrok web interface:', err);
        return null;
    }
}


const setupWebhook = async (url: string): Promise<void> => {
    try {
        await axios.get(`${TELEGRAM_API}/setWebhook?url=${url}&drop_pending_updates=true`);
        console.log('Webhook configurado com sucesso!');
    } catch (error: any) {
        console.error('Erro ao configurar webhook:', error);
    }
};


app.post(URI, async (req: Request, res: Response) => {
    try {
        if (DEBUG === 'true'){
            console.log('Requisição recebida:', req.body);
        }
        
        await axios.post(FORWARD_ENDPOINT as string, req.body, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        if (DEBUG === 'true'){
            console.log('Requisição encaminhada com sucesso.');
        }
        res.status(200).send('ok');
    } catch (error: any) {
        console.error('Erro ao encaminhar mensagem:', error.message);
        res.status(500).send('Erro interno');
    }
});



app.listen(Number(PORT), async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    let finalWebhookUrl = webhookURL;
    if (process.env.NGROK_WEB_URL) {
        const ngrokUrl = await getNgrokPublicUrl();
        if (ngrokUrl) {
            finalWebhookUrl = `${ngrokUrl}${URI}`;
            console.log('Usando URL do ngrok para webhook:', finalWebhookUrl);
        } else {
            console.log('Não foi possível obter a URL do ngrok, usando WEBHOOK_URL padrão.');
        }
    } else {
        console.log('NGROK_WEB_URL não definida, usando WEBHOOK_URL padrão.');
    }
    try {
        await setupWebhook(finalWebhookUrl);
        console.log('Webhook configurado com sucesso!');
    } catch (error: any) {
        console.error('Erro ao configurar webhook:', error);
    }
});