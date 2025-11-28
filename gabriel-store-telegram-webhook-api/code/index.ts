import express, { Request, Response } from 'express';
import axios from 'axios';
import 'dotenv/config';

const { PORT, TELEGRAM_BOT_TOKEN, WEBHOOK_URL, FORWARD_ENDPOINT, URI_BASE, DEBUG } = process.env;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const URI = `${URI_BASE}`;
const webhookURL = `${WEBHOOK_URL}${URI}`;


const app = express();
app.use(express.json());


type NgrokTunnel = {
    name: string;
    ID: string;
    uri: string;
    public_url: string;
    proto: string;
    config: object;
    metrics: object;
};

async function ngrokApi(url: string): Promise<string | null> {
    try {
        const res = await axios.get(url);
        console.log('JSON recebido:', res.data);
        const tunnels: NgrokTunnel[] = res.data.tunnels;
        if (tunnels && tunnels.length > 0) {
            const publicUrl = tunnels[0].public_url;
            console.log('public_url:', publicUrl);
            return publicUrl;
        } else {
            console.log('Nenhum túnel encontrado.');
            return null;
        }
    } catch (err) {
        console.error('Erro ao buscar URL:', err);
        return null;
    }
}


async function getNgrokPublicUrl(): Promise<string | null> {
    const ngrokApiUrl = process.env.NGROK_WEB_URL;
    if (!ngrokApiUrl) {
        console.error('Variável de ambiente NGROK_WEB_URL não definida');
        return null;
    }
    try {
        const publicUrl = await ngrokApi(ngrokApiUrl);
        if (publicUrl) {
            return publicUrl;
        }
        return null;
    } catch (err) {
        console.error('Erro ao buscar ngrok API:', err);
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