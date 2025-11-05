
import { exec } from 'child_process';
import { Request, Response } from 'express';

const downloadbyFilename = (req: Request, res: Response) => {
    const filename = req.params.filename;
    const filePath = `/shared/output/${filename}`;
    
    // Verificar se o arquivo existe
    const checkCmd = `docker exec ffmpeg test -f ${filePath} && echo "exists"`;
    
    exec(checkCmd, (error, stdout) => {
        if (error || !stdout.includes('exists')) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }
        
        // Enviar arquivo para download
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('Erro no download:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Erro no download' });
                }
            }
        });
    });
}

export default downloadbyFilename;