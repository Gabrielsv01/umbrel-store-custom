import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Job } from '../types';
import { executeFFmpegJobWithHeartbeat } from './jobs/utils';

// Configuração da fila
const QUEUE_CONFIG = {
    maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS) || 3
};

const commandAsync = (req: Request, res: Response, jobs: Map<string, Job>, queue: { currentQueueProcessing: string[], queue: string[] }) => {
    const { command: ffmpegCommand, useQueue } = req.body;
    
    if (!ffmpegCommand) {
        return res.status(400).json({ error: 'Comando é obrigatório' });
    }
    
    const isQueueEnabled = useQueue === true || useQueue === 'true';
    const jobId = randomUUID();
    
    const job: Job = {
        id: jobId,
        status: 'pending',
        command: ffmpegCommand,
        startTime: new Date()
    };

    jobs.set(jobId, job);

    if (isQueueEnabled) {
        // Verificar se o job já está na fila ou em processamento
        if (queue.currentQueueProcessing.includes(jobId) || queue.queue.includes(jobId)) {
            return res.status(400).json({ error: 'Job já está na fila' });
        }

        // Se há espaço na fila de processamento (menos de 3 jobs), adicionar diretamente
        if (queue.currentQueueProcessing.length < QUEUE_CONFIG.maxConcurrentJobs) {
            queue.currentQueueProcessing.push(jobId);
            job.status = 'running';
            
            // Executar comando em background
            setImmediate(() => {
                executeFFmpegJobWithHeartbeat(jobId, ffmpegCommand, jobs, true, queue);
            });

            return res.json({
                success: true,
                jobId,
                message: 'Job iniciado imediatamente',
                currentlyProcessing: queue.currentQueueProcessing.length,
                waitingInQueue: queue.queue.length,
                statusUrl: `/job/${jobId}`,
                status: job.status
            });
        } else {
            // Adicionar na fila de espera
            queue.queue.push(jobId);
            job.status = 'queued';
            
            return res.json({
                success: true,
                jobId,
                message: 'Job adicionado à fila de espera',
                positionInQueue: queue.queue.length,
                currentlyProcessing: queue.currentQueueProcessing.length,
                statusUrl: `/job/${jobId}`,
                status: job.status
            });
        }
    } else {
        // Sem fila - executar diretamente como antes
        setImmediate(() => {
            executeFFmpegJobWithHeartbeat(jobId, ffmpegCommand, jobs, false);
        });

        return res.json({
            success: true,
            jobId,
            message: 'Job iniciado (sem fila)',
            statusUrl: `/job/${jobId}`,
            status: job.status
        });
    }
};

export default commandAsync;
export { QUEUE_CONFIG };