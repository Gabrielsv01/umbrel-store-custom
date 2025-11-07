

import { Request, Response } from 'express';
import { Job } from '../../types';

const getJobById = (req: Request, res: Response, jobs: Map<string, Job>) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job não encontrado' });
    }

    const response: any = {
        id: job.id,
        status: job.status,
        command: job.command,
        startTime: job.startTime,
        duration: job.endTime ? job.endTime.getTime() - job.startTime.getTime() : null
    };

    if (job.progress) response.progress = job.progress;
    if (job.stdout) response.stdout = job.stdout;
    if (job.stderr) response.stderr = job.stderr;
    if (job.outputFile) {
        response.outputFile = job.outputFile;
        response.downloadUrl = `/download/${job.outputFile}`;
        response.directUrl = `/files/${job.outputFile}`;
    }
    if (job.error) response.error = job.error;
    if (job.endTime) response.endTime = job.endTime;

    res.json(response);
}

export default getJobById;