
import { exec } from 'child_process';
import { Request, Response } from 'express';
import { isValidDirectoryType } from '../utils';
import { DeleteResult } from '../types';

const deleteMultipleFiles = (req: Request, res: Response) => {
    const { type } = req.params;
    const { files }: { files: string[] } = req.body;
    
    if (!isValidDirectoryType(type)) {
        return res.status(400).json({ error: 'Tipo deve ser "input" ou "output"' });
    }
    
    if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Lista de arquivos é obrigatória' });
    }
    
    // Validar todos os nomes de arquivos
    for (const filename of files) {
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({ 
                error: `Nome de arquivo inválido: ${filename}` 
            });
        }
    }
    
    const results: DeleteResult[] = [];
    let processedCount = 0;
    
    files.forEach(filename => {
        const filePath = `/shared/${type}/${filename}`;
        const deleteCmd = `docker exec ffmpeg rm "${filePath}" 2>/dev/null && echo "deleted" || echo "failed"`;
        
        exec(deleteCmd, (_error, stdout) => {
            const success = stdout.includes('deleted');
            
            results.push({
                filename: filename,
                success: success,
                message: success ? 'Deletado com sucesso' : 'Falha ao deletar ou arquivo não encontrado'
            });
            
            processedCount++;
            
            // Quando todos os arquivos foram processados
            if (processedCount === files.length) {
                const successCount = results.filter(r => r.success).length;
                const failedCount = results.length - successCount;
                
                res.json({
                    success: failedCount === 0,
                    message: `${successCount} arquivo(s) deletado(s), ${failedCount} falha(s)`,
                    type: type,
                    results: results,
                    summary: {
                        total: files.length,
                        deleted: successCount,
                        failed: failedCount
                    }
                });
            }
        });
    });
}


export default deleteMultipleFiles;