import express, { Request, Response } from 'express';
import fs from 'fs';
import puppeteer, { Viewport } from 'puppeteer'; // Importa Viewport para tipagem
import multer from 'multer';

const app = express();

// --- CONFIGURAÇÃO E VARIÁVEIS DE AMBIENTE ---

// Permite ao Express interpretar JSON no corpo da requisição para o Endpoint 1 (upload)
app.use(express.json()); 

// Multer para upload temporário de HTML
const htmlStorage = multer.diskStorage({
    destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
        cb(null, '/tmp');
    },
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const uploadHtml = multer({ storage: htmlStorage });

const BROWSER_WS_URL = process.env.BROWSER_WS_URL || 'ws://playwright:3000?ignoreHTTPSErrors=true';
const TIMER_LOAD_MS = process.env.TIMER_LOAD_MS ? parseInt(process.env.TIMER_LOAD_MS, 10) : 2000; 

// --- FUNÇÃO CORE E UTILS ---

/**
 * Converte um valor de string (query ou body) para número ou booleano, ou retorna o default.
 */
function getParam<T>(value: any, defaultValue: T): T {
    if (typeof value === 'undefined') {
        return defaultValue;
    }
    if (typeof defaultValue === 'number') {
        return Math.max(100, parseInt(value as string)) as T;
    }
    if (typeof defaultValue === 'boolean') {
        const strValue = String(value).toLowerCase();
        return (strValue === 'true' || strValue === '1') as T;
    }
    return value as T;
}

/**
 * Extrai todas as opções de Viewport (width, height, scale, mobile, etc.) da requisição.
 */
function getViewportOptions(req: Request): Viewport {
    // Parâmetros são extraídos da Query (GET) e usamos defaults
    const query = req.query;
    
    return {
        width: getParam(query.width, 1080),
        height: getParam(query.height, 1920),
        deviceScaleFactor: getParam(query.deviceScaleFactor, 1),
        isMobile: getParam(query.isMobile, false),
        hasTouch: getParam(query.hasTouch, false),
        isLandscape: getParam(query.isLandscape, false),
    };
}


/**
 * Conecta ao navegador remoto e captura o screenshot do HTML fornecido.
 */
async function captureHtml(htmlContent: string, viewportOptions: Viewport): Promise<Buffer> {
    let browser;
    try {
        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSER_WS_URL,
        });
        const page = await browser.newPage();
        
        // 1. Define o viewport dinamicamente com todas as opções passadas
        await page.setViewport(viewportOptions);

        // 2. Carrega o HTML.
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        // 3. Espera o tempo definido
        await new Promise(r => setTimeout(r, TIMER_LOAD_MS)); 

        // 4. Captura o screenshot da viewport definida
        const imageBuffer = await page.screenshot({ 
            type: 'png', 
            fullPage: false // Captura a área definida pela viewport
        }); 
        return Buffer.from(imageBuffer);
    } finally {
        if (browser) await browser.close();
    }
}

// --- ENDPOINTS ---

// Endpoint 1: Recebe HTML via upload de arquivo
app.post('/html-to-image', uploadHtml.single('html'), async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    let htmlPath;
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo HTML enviado' });
        }
        
        // Extrai todas as opções da query string
        const viewportOptions = getViewportOptions(req);
        
        htmlPath = req.file.path;
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

        // Passa o objeto completo de opções
        const imageBuffer = await captureHtml(htmlContent, viewportOptions); 

        fs.unlinkSync(htmlPath);
        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (error) {
        console.error('Erro ao converter HTML para imagem:', error);
        if (htmlPath && fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
        res.status(500).json({ error: 'Falha ao gerar imagem', details: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
});

// Endpoint 2: Recebe HTML via body
app.post('/html-body-to-image', express.text({ type: '*/*', limit: '20mb' }), async (req: Request, res: Response) => {
    try {
        const htmlContent = req.body;
        if (!htmlContent || typeof htmlContent !== 'string') {
            return res.status(400).json({ error: 'Body vazio ou inválido' });
        }
        
        // Extrai todas as opções da query string
        const viewportOptions = getViewportOptions(req);

        // Passa o objeto completo de opções
        const imageBuffer = await captureHtml(htmlContent, viewportOptions); 

        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (error) {
        console.error('Erro ao converter HTML do body para imagem:', error);
        res.status(500).json({ error: 'Falha ao gerar imagem', details: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
});

// --- INICIALIZAÇÃO ---


// Endpoint de healthcheck
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`Html to image API rodando na porta ${PORT}`);
});

export default app;