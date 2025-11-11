import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Job } from '../types';
import { executeFFmpegJobWithHeartbeat } from './jobs/utils';

const commandAsync = (req: Request, res: Response, jobs: Map<string, Job>) => {
    const { command: ffmpegCommand } = req.body;
    
    if (!ffmpegCommand) {
        return res.status(400).json({ error: 'Comando é obrigatório' });
    }

    const jobId = randomUUID(); // Usar randomUUID do crypto nativo
    const job: Job = {
        id: jobId,
        status: 'pending',
        command: ffmpegCommand,
        startTime: new Date()
    };

    jobs.set(jobId, job);

    // Executar comando em background
    setImmediate(() => {
        executeFFmpegJobWithHeartbeat(jobId, ffmpegCommand, jobs);
    });

    res.json({
        success: true,
        jobId,
        message: 'Job iniciado',
        statusUrl: `/job/${jobId}`,
        status: job.status
    });
}

export default commandAsync;