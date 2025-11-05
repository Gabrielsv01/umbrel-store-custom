import { exec } from 'child_process';
import { Request, Response } from 'express';
import { FileInfo, FilesResponse } from '../types';
import { formatFileSize, isValidDirectoryType } from '../utils';

const fileType = (req: Request, res: Response) => {
    const { type } = req.params;
    
    if (!isValidDirectoryType(type)) {
        return res.status(400).json({ error: 'Tipo deve ser "input" ou "output"' });
    }
    
    const dockerCmd = `docker exec ffmpeg find /shared/${type} -type f -exec ls -la {} + 2>/dev/null || echo "empty"`;
    
    exec(dockerCmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: stderr });
        }
        
        const files: FileInfo[] = [];
        
        if (stdout.trim() === 'empty' || !stdout.trim()) {
            return res.json({ 
                type: type,
                count: 0,
                files: []
            } as FilesResponse);
        }
        
        // Parse da saída do ls -la
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
            if (line.startsWith('-')) { // Linha de arquivo (não diretório)
                const parts = line.split(/\s+/);
                if (parts.length >= 9) {
                    const permissions = parts[0];
                    const size = parseInt(parts[4]);
                    const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
                    const filename = parts.slice(8).join(' ').split('/').pop() || '';
                    
                    // Verificar se é arquivo de vídeo/áudio
                    const isMedia = /\.(mp4|avi|mov|mkv|webm|mp3|wav|aac|flac)$/i.test(filename);
                    
                    files.push({
                        name: filename,
                        size: size,
                        sizeFormatted: formatFileSize(size),
                        date: date,
                        permissions: permissions,
                        isMedia: isMedia,
                        downloadUrl: type === 'output' ? `/download/${filename}` : null,
                        directUrl: type === 'output' ? `/files/${filename}` : null
                    });
                }
            }
        }
        
        res.json({
            type: type,
            count: files.length,
            files: files.sort((a, b) => a.name.localeCompare(b.name))
        } as FilesResponse);
    });
}

export default fileType;