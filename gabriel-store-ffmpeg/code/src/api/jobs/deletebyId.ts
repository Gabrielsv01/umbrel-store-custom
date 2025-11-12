
import { Request, Response } from 'express';
import { Job } from '../../types';
import { processNextInQueue } from './utils';

const DeleteJobById = (req: Request, res: Response, jobs: Map<string, Job>, queue?: { currentQueueProcessing: string[], queue: string[] }) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job não encontrado' });
    }

    // Verificar se estava sendo processado antes da remoção
    const wasRunning = job.status === 'running';
    
    // Se o job está rodando, cancelar
    if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Job cancelado pelo usuário';
        job.endTime = new Date();
        
        // Limpar heartbeat se existir
        if (job.heartbeatInterval) {
            clearInterval(job.heartbeatInterval);
            delete job.heartbeatInterval;
        }
    }

    // Remover da fila se necessário
    if (queue) {
        // Remover da fila de processamento
        const indexInProcessing = queue.currentQueueProcessing.indexOf(jobId);
        if (indexInProcessing > -1) {
            queue.currentQueueProcessing.splice(indexInProcessing, 1);
            
            // Se estava sendo processado, processar próximo job da fila
            if (wasRunning) {
                setImmediate(() => {
                    processNextInQueue(jobId, jobs, queue);
                });
            }
        }
        
        // Remover da fila de espera
        const indexInQueue = queue.queue.indexOf(jobId);
        if (indexInQueue > -1) {
            queue.queue.splice(indexInQueue, 1);
        }
    }

    jobs.delete(jobId);
    
    res.json({
        success: true,
        message: 'Job removido',
        jobId,
        removedFromQueue: queue ? true : false
    });
};

export default DeleteJobById;