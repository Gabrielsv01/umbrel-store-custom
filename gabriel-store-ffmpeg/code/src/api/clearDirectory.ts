import { exec } from 'child_process';
import { Request, Response } from 'express';
import { isValidDirectoryType } from '../utils';


const clearDirectory = (req: Request, res: Response) => {
    const { type } = req.params;
    
    if (!isValidDirectoryType(type)) {
        return res.status(400).json({ error: 'Tipo deve ser "input" ou "output"' });
    }
    
    // Confirmar com query parameter
    if (req.query.confirm !== 'true') {
        return res.status(400).json({ 
            error: 'Para limpar todos os arquivos, adicione ?confirm=true à URL' 
        });
    }
    
    const clearCmd = `docker exec ffmpeg sh -c "rm -f /shared/${type}/* 2>/dev/null; echo 'cleared'"`;
    
    exec(clearCmd, (error, _stdout, stderr) => {
        if (error) {
            return res.status(500).json({ 
                error: 'Erro ao limpar diretório',
                stderr: stderr 
            });
        }
        
        res.json({
            success: true,
            message: `Todos os arquivos do diretório ${type} foram removidos`,
            type: type
        });
    });
}

export default clearDirectory;