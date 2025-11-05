import { exec } from 'child_process';
import { Request, Response } from 'express';
import { isValidDirectoryType } from '../utils';

const deleteFilesbyFileName = (req: Request, res: Response) => {
    const { type, filename } = req.params;
    
    if (!isValidDirectoryType(type)) {
        return res.status(400).json({ error: 'Tipo deve ser "input" ou "output"' });
    }
    
    // Validar nome do arquivo para evitar path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }
    
    const filePath = `/shared/${type}/${filename}`;
    
    // Primeiro verificar se o arquivo existe
    const checkCmd = `docker exec ffmpeg test -f "${filePath}" && echo "exists"`;
    
    exec(checkCmd, (error, stdout) => {
        if (error || !stdout.includes('exists')) {
            return res.status(404).json({ error: 'Arquivo não encontrado' });
        }
        
        // Deletar o arquivo
        const deleteCmd = `docker exec ffmpeg rm "${filePath}"`;
        
        exec(deleteCmd, (error, _stdout, stderr) => {
            if (error) {
                return res.status(500).json({ 
                    error: 'Erro ao deletar arquivo',
                    stderr: stderr 
                });
            }
            
            res.json({ 
                success: true,
                message: `Arquivo ${filename} deletado com sucesso`,
                filename: filename,
                type: type
            });
        });
    });
}

export default deleteFilesbyFileName;