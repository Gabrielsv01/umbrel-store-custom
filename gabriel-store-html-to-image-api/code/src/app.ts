import express, { Request, Response } from 'express';
import fs from 'fs';
import puppeteer from 'puppeteer';
import multer from 'multer';

const app = express();

// --- CONFIGURAÇÃO ---

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
const TIMER_LOAD_MS = process.env.TIMER_LOAD_MS ? parseInt(process.env.TIMER_LOAD_MS, 10) : 2000; // Tempo para esperar o carregamento do CSS/Imagens

// --- FUNÇÃO CORE E UTILS ---

/**
 * Função auxiliar para extrair e validar os parâmetros de Viewport da requisição.
 * Padrão Instagram Story: 1080x1920.
 */
function getDimensions(req: Request): { width: number, height: number } {
    const defaultWidth = 1080; 
    const defaultHeight = 1920; 
    
    // Converte os query parameters para número, usando fallback se não existirem
    const width = parseInt(req.query.width as string) || defaultWidth;
    const height = parseInt(req.query.height as string) || defaultHeight;
    
    // Garante que os valores sejam razoáveis (mínimo 100)
    return { width: Math.max(100, width), height: Math.max(100, height) };
}


/**
 * Conecta ao navegador remoto e captura o screenshot do HTML fornecido.
 */
async function captureHtml(htmlContent: string, width: number, height: number) {
    let browser;
    try {

        // Conecta ao serviço de navegador Playwright/Chromium no Docker Compose
        browser = await puppeteer.connect({
            browserWSEndpoint: BROWSER_WS_URL,
        });
        const page = await browser.newPage();
        
        // 1. Define o viewport dinamicamente
        await page.setViewport({ width: width, height: height });

        // 2. Carrega o HTML. 'domcontentloaded' é ideal para HTML injetado.
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' }); 

        // 3. Espera 2 segundos para o CSS/Imagens serem processados
        await new Promise(r => setTimeout(r, TIMER_LOAD_MS)); 

        // 4. Captura o screenshot da viewport definida
        const imageBuffer = await page.screenshot({ 
            type: 'png', 
            fullPage: false // Captura a área definida pelo viewport (ideal para stories)
        }); 
        return imageBuffer;
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
        
        const { width, height } = getDimensions(req); // Extrai dimensões
        
        htmlPath = req.file.path;
        const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

        const imageBuffer = await captureHtml(htmlContent, width, height); // Passa dimensões

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
        
        const { width, height } = getDimensions(req); // Extrai dimensões

        const imageBuffer = await captureHtml(htmlContent, width, height); // Passa dimensões

        res.set('Content-Type', 'image/png');
        res.send(imageBuffer);
    } catch (error) {
        console.error('Erro ao converter HTML do body para imagem:', error);
        res.status(500).json({ error: 'Falha ao gerar imagem', details: error instanceof Error ? error.message : 'Erro desconhecido' });
    }
});

// --- INICIALIZAÇÃO ---

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`Html to image API rodando na porta ${PORT}`);
});

export default app;