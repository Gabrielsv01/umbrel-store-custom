import { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';

const ui = (_req: Request, res: Response) => {
    try {
        const htmlPath = join(__dirname, 'ui', 'index.html');
        const html = readFileSync(htmlPath, 'utf8');
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        res.status(500).json({ 
            error: 'Erro ao carregar interface', 
            details: error instanceof Error ? error.message : 'Erro desconhecido' 
        });
    }
};

export default ui;