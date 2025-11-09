
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
        // Tenta primeiro com aspas duplas, depois aspas simples, depois sem aspas
        const outputMatch = command.match(/\/shared\/output\/(?:"([^"]+)"|'([^']+)'|([^\s"']+))/);
        if (outputMatch) {
            // Pega o primeiro grupo não-nulo (aspas duplas, aspas simples ou sem aspas)
            let filename = outputMatch[1] || outputMatch[2] || outputMatch[3];
            // Remover aspas extras no início ou fim se houver
            filename = filename.replace(/^["']|["']$/g, '');
            outputFile = filename;
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