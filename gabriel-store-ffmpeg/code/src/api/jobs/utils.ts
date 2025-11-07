import { exec } from "child_process";
import { Job } from "../../types";

async function executeFFmpegJob(jobId: string, command: string, jobs: Map<string, Job>) {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'running';
    console.log(`Executando job ${jobId}: ${command}`);

    const dockerCmd = `docker exec ffmpeg ${command} -y`;
    
    exec(dockerCmd, { timeout: 300000 }, (error, stdout, stderr) => {
        const updatedJob = jobs.get(jobId);
        if (!updatedJob) return;

        updatedJob.endTime = new Date();
        updatedJob.stdout = stdout;
        updatedJob.stderr = stderr;

        if (error) {
            updatedJob.status = 'failed';
            updatedJob.error = stderr || error.message;
            console.log(`Job ${jobId} falhou:`, updatedJob.error);
        } else {
            updatedJob.status = 'completed';
            
            // Extrair nome do arquivo de saída
            const outputMatch = command.match(/\/shared\/output\/([^\s]+)/);
            if (outputMatch) {
                updatedJob.outputFile = outputMatch[1];
            }
            
            console.log(`Job ${jobId} concluído. Arquivo de saída:`, updatedJob.outputFile);
        }
    });
}



// Configurações de limpeza
const JOB_CLEANUP_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // 24 horas em ms
    maxJobs: 100, // Máximo de jobs a manter
    cleanupInterval: 60 * 60 * 1000 // Limpar a cada 1 hora
};

// Função para limpar jobs antigos
function cleanupOldJobs(jobs: Map<string, Job>) {
    const now = new Date().getTime();
    let removedCount = 0;

    // Remover jobs antigos
    for (const [jobId, job] of jobs.entries()) {
        const jobAge = now - job.startTime.getTime();
        
        // Remover se: job completou/falhou E é mais antigo que maxAge
        if ((job.status === 'completed' || job.status === 'failed') && jobAge > JOB_CLEANUP_CONFIG.maxAge) {
            jobs.delete(jobId);
            removedCount++;
        }
    }

    // Se ainda tiver muitos jobs, remover os mais antigos (mantendo os running)
    if (jobs.size > JOB_CLEANUP_CONFIG.maxJobs) {
        const sortedJobs = Array.from(jobs.entries())
            .filter(([_, job]) => job.status !== 'running') // Não remover jobs em execução
            .sort(([_, a], [__, b]) => a.startTime.getTime() - b.startTime.getTime());

        const toRemove = sortedJobs.slice(0, jobs.size - JOB_CLEANUP_CONFIG.maxJobs);
        toRemove.forEach(([jobId]) => {
            jobs.delete(jobId);
            removedCount++;
        });
    }

    if (removedCount > 0) {
        console.log(`🧹 Limpeza automática: ${removedCount} jobs removidos. Jobs restantes: ${jobs.size}`);
    }
}

export { executeFFmpegJob, cleanupOldJobs, JOB_CLEANUP_CONFIG };