import { exec } from 'child_process';
import { Request, Response } from 'express';

const status = (_req: Request, res: Response) => {
    const dockerCmd = `docker exec ffmpeg ls -la /shared/`;
    
    exec(dockerCmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: stderr });
        }
        
        res.json({ 
            status: 'ok',
            directories: stdout 
        });
    });
}

export default status;