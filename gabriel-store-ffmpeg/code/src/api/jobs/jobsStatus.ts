import { Request, Response } from 'express';
import { Job } from '../../types';

const jobsStatus = (req: Request, res: Response, jobs: Map<string, Job>) => {
    try {
        const { jobIds } = req.body;

        if (!jobIds || !Array.isArray(jobIds)) {
            return res.status(400).json({ 
                error: 'jobIds deve ser um array' 
            });
        }

        const results = jobIds.map(jobId => {
            const job = jobs.get(jobId);
            
            if (!job) {
                return {
                    jobId,
                    found: false,
                    status: null,
                    isFinished: false,
                    isPending: false,
                    message: 'Job não encontrado'
                };
            }

            const isFinished = job.status === 'completed' || job.status === 'failed';
            const isPending = job.status === 'pending' || job.status === 'running';
            
            const duration = job.endTime && job.startTime 
                ? job.endTime.getTime() - job.startTime.getTime() 
                : null;

            return {
                jobId,
                found: true,
                status: job.status,
                isFinished,
                isPending,
                startTime: job.startTime,
                endTime: job.endTime,
                duration,
                outputFile: job.outputFile,
                ...(job.status === 'failed' && { error: job.error || job.stderr })
            };
        });

        const summary = {
            total: jobIds.length,
            found: results.filter(r => r.found).length,
            finished: results.filter(r => r.isFinished).length,
            pending: results.filter(r => r.isPending).length,
            notFound: results.filter(r => !r.found).length
        };

        res.json({
            success: true,
            summary,
            jobs: results
        });

    } catch (error) {
        console.error('Erro ao verificar status dos jobs:', error);
        res.status(500).json({ 
            error: 'Erro interno do servidor',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
}

export default jobsStatus;