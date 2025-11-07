import { Request, Response } from 'express';
import { Job } from '../../types';


const listAllJobs = (_req: Request, res: Response, jobs: Map<string, Job>) => {
    const jobList = Array.from(jobs.values()).map(job => ({
        id: job.id,
        status: job.status,
        command: job.command.substring(0, 100) + (job.command.length > 100 ? '...' : ''),
        startTime: job.startTime,
        endTime: job.endTime,
        outputFile: job.outputFile,
        duration: job.endTime ? job.endTime.getTime() - job.startTime.getTime() : null
    }));

    res.json({
        jobs: jobList,
        total: jobList.length,
        running: jobList.filter(j => j.status === 'running').length,
        completed: jobList.filter(j => j.status === 'completed').length,
        failed: jobList.filter(j => j.status === 'failed').length
    });
}

export default listAllJobs;
