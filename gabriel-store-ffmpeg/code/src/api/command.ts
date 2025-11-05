
import { exec } from 'child_process';
import { Request, Response } from 'express';

const command = (req: Request, res: Response) => {
    const { command }: { command: string } = req.body;
    
    if (!command) {
        return res.status(400).json({ error: 'Comando FFmpeg é obrigatório' });
    }
    
    // Adicionar -y automaticamente se for comando ffmpeg e não tiver -y
    let finalCommand = command;
    if (command.startsWith('ffmpeg ') && !command.includes(' -y ')) {
        finalCommand = command.replace('ffmpeg ', 'ffmpeg -y ');
    }
    
    // Executa o comando no container FFmpeg
    const dockerCmd = `docker exec ffmpeg ${finalCommand}`;
    
    exec(dockerCmd, { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ 
                error: error.message,
                stderr: stderr 
            });
        }
        
        // Tentar extrair nome do arquivo de output do comando
        let outputFile: string | null = null;
        const outputMatch = command.match(/\/shared\/output\/([^\s]+)/);
        if (outputMatch) {
            outputFile = outputMatch[1];
        }
        
        res.json({ 
            success: true,
            stdout: stdout,
            stderr: stderr,
            outputFile: outputFile,
            downloadUrl: outputFile ? `/download/${outputFile}` : null,
            directUrl: outputFile ? `/files/${outputFile}` : null
        });
    });
}

export default command;