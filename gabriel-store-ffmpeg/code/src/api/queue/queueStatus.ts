import { Request, Response } from 'express';
import { Job } from '../../types';
import { QUEUE_CONFIG } from '../commandAsync';

const queueStatus = (req: Request, res: Response, jobs: Map<string, Job>, queue: { currentQueueProcessing: string[], queue: string[] }) => {
    // Obter detalhes dos jobs em processamento
    const processingJobs = queue.currentQueueProcessing
        .map(jobId => jobs.get(jobId))
        .filter(job => job !== undefined)
        .map(job => ({
            id: job!.id,
            status: job!.status,
            command: job!.command,
            startTime: job!.startTime,
            progress: job!.progress
        }));

    // Obter detalhes dos jobs na fila de espera
    const waitingJobs = queue.queue
        .map(jobId => jobs.get(jobId))
        .filter(job => job !== undefined)
        .map((job, index) => ({
            id: job!.id,
            status: job!.status,
            command: job!.command,
            startTime: job!.startTime,
            positionInQueue: index + 1
        }));

    // Estatísticas gerais
    const totalJobs = jobs.size;
    const completedJobs = Array.from(jobs.values()).filter(job => job.status === 'completed').length;
    const failedJobs = Array.from(jobs.values()).filter(job => job.status === 'failed').length;

    res.json({
        queue: {
            maxConcurrentJobs: QUEUE_CONFIG.maxConcurrentJobs,
            currentlyProcessing: {
                count: queue.currentQueueProcessing.length,
                jobs: processingJobs
            },
            waiting: {
                count: queue.queue.length,
                jobs: waitingJobs
            }
        },
        statistics: {
            totalJobs,
            completedJobs,
            failedJobs,
            runningJobs: processingJobs.length,
            queuedJobs: waitingJobs.length
        },
        timestamp: new Date().toISOString()
    });
};

export default queueStatus;