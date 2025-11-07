
import { Request, Response } from 'express';
import { Job } from '../../types';

const DeleteJobById = (req: Request, res: Response, jobs: Map<string, Job>) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job não encontrado' });
    }

    if (job.status === 'running') {
        job.status = 'failed';
        job.error = 'Job cancelado pelo usuário';
        job.endTime = new Date();
    }

    jobs.delete(jobId);
    
    res.json({
        success: true,
        message: 'Job removido',
        jobId
    });
}

export default DeleteJobById;