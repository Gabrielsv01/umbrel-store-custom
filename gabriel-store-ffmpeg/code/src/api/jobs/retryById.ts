import { Request, Response } from 'express';
import { Job } from '../../types';
import { randomUUID } from 'crypto';
import { executeFFmpegJobWithHeartbeat } from './utils';

const retryById = (req: Request, res: Response, jobs: Map<string, Job>) => {
    try {
        const { jobId } = req.params;
        const existingJob = jobs.get(jobId);

        if (!existingJob) {
            return res.status(404).json({ 
                error: 'Job não encontrado',
                jobId
            });
        }

        // Verificar se o job pode ser retentado
        if (existingJob.status === 'running' || existingJob.status === 'pending') {
            return res.status(400).json({ 
                error: 'Job ainda está em execução ou pendente',
                currentStatus: existingJob.status,
                jobId
            });
        }

        // Criar novo job com o mesmo comando
        const newJobId = randomUUID();
        const newJob: Job = {
            id: newJobId,
            status: 'pending',
            command: existingJob.command,
            startTime: new Date()
        };

        jobs.set(newJobId, newJob);

        // Executar comando em background
        setImmediate(() => {
            executeFFmpegJobWithHeartbeat(newJobId, existingJob.command, jobs);
        });

        res.json({
            success: true,
            message: 'Job retentado com sucesso',
            originalJobId: jobId,
            newJobId,
            command: existingJob.command,
            status: newJob.status,
            statusUrl: `/job/${newJobId}`
        });

    } catch (error) {
        console.error('Erro ao retentar job:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
}

export default retryById;