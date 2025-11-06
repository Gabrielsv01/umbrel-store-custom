

import { Request, Response } from 'express';
import fs from 'fs';
import MarkdownIt from 'markdown-it';

const PORT = process.env.PORT || 3001;
const md = new MarkdownIt();

const doc = (_req: Request, res: Response) => {
    try {
        const readmePath = '/app/README.md';

        if (!fs.existsSync(readmePath)) {
            return res.status(404).send('README.md não encontrado');
        }

        const readmeContent = fs.readFileSync(readmePath, 'utf8');
        const htmlContent = md.render(readmeContent);

        const styledHtml = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>FFmpeg API Documentation</title>
            </head>
            <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                        line-height: 1.6;
                        color: #333;
                        max-width: 1200px;
                        margin: 0 auto;
                        padding: 20px;
                        background-color: #fff;
                    }
                    .status-badge {
                        display: inline-block;
                        background-color: #27ae60;
                        color: white;
                        padding: 4px 12px;
                        border-radius: 15px;
                        font-size: 0.8em;
                        font-weight: bold;
                        margin-bottom: 20px;
                    }
                    .api-info {
                        background-color: #e8f5e8;
                        border: 1px solid #27ae60;
                        border-radius: 5px;
                        padding: 15px;
                        margin: 20px 0;
                    }
                    h1, h2, h3, h4, h5, h6 {
                        color: #2c3e50;
                        margin-top: 2em;
                        margin-bottom: 1em;
                    }
                    h1 {
                        border-bottom: 3px solid #3498db;
                        padding-bottom: 10px;
                    }
                    h2 {
                        border-bottom: 2px solid #ecf0f1;
                        padding-bottom: 5px;
                    }
                    code {
                        background-color: #f8f9fa;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                        font-size: 0.9em;
                        color: #e74c3c;
                    }
                    pre {
                        background-color: #f8f9fa;
                        border: 1px solid #e9ecef;
                        border-radius: 5px;
                        padding: 15px;
                        overflow-x: auto;
                        margin: 1em 0;
                    }
                    pre code {
                        background: none;
                        padding: 0;
                        color: #333;
                    }
                    table {
                        border-collapse: collapse;
                        width: 100%;
                        margin: 1em 0;
                    }
                    th, td {
                        border: 1px solid #ddd;
                        padding: 12px;
                        text-align: left;
                    }
                    th {
                        background-color: #f8f9fa;
                        font-weight: 600;
                    }
                    a {
                        color: #3498db;
                        text-decoration: none;
                    }
                    a:hover {
                        text-decoration: underline;
                    }
                    blockquote {
                        border-left: 4px solid #3498db;
                        margin: 1em 0;
                        padding-left: 1em;
                        color: #7f8c8d;
                    }
                    ul li {
                        margin: 0.5em 0;
                    }
                </style>
            <body>
                <div class="status-badge">🚀 API Online - Porta ${PORT}</div>
                <div class="api-info">
                    <strong>🔗 API Base URL:</strong> <code>http://localhost:${PORT}</code><br>
                    <strong>📊 Status:</strong> <a href="/status">Verificar status dos diretórios</a><br>
                    <strong>📁 Arquivos:</strong> <a href="/files/input">Input</a> | <a href="/files/output">Output</a>
                </div>
                ${htmlContent}
                <hr style="margin-top: 3em; border: none; border-top: 1px solid #eee;">
                <p style="text-align: center; color: #7f8c8d; font-size: 0.9em;">
                    📖 Esta documentação é servida automaticamente pela API FFmpeg | 
                    <a href="/status">Status</a> | 
                    <strong>Porta ${PORT}</strong>
                </p>
            </body>
            </html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(styledHtml);

    } catch (error) {
        console.error('Erro ao carregar README:', error);
        res.status(500).send(`
            <html>
                <head>
                    <title>FFmpeg API - Erro</title>
                    <style>body { font-family: Arial, sans-serif; margin: 40px; }</style>
                </head>
                <body>
                    <h1>FFmpeg API</h1>
                    <p style="color: #e74c3c;">Erro ao carregar documentação: ${error}</p>
                    <p>API está funcionando na porta ${PORT}</p>
                </body>
            </html>
        `);
    }
};

export default doc;