import { exec } from "child_process";
import { Job } from "../../types";

// Configurações de heartbeat
const HEARTBEAT_CONFIG = {
    interval: 30000, // Verificar a cada 30 segundos
    maxSilentTime: 120000 // 2 minutos sem atividade = considera morto
};

// Função para verificar processos FFmpeg ativos
function checkRunningFFmpegProcesses(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        exec('docker exec ffmpeg ps aux', (error, stdout, stderr) => {
            if (error) {
                // Se der erro, assume que não há processos (container pode estar reiniciando)
                resolve([]);
                return;
            }
            
            const processes = stdout
                .split('\n')
                .filter(line => (line.includes('ffmpeg') || line.includes('ffprobe') || line.includes('ffplay')) && !line.includes('grep') && !line.includes('ps aux'))
                .map(line => line.trim())
                .filter(line => line.length > 0);
                
            resolve(processes);
        });
    });
}

// Versão principal com heartbeat check
async function executeFFmpegJobWithHeartbeat(jobId: string, command: string, jobs: Map<string, Job>) {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'running';
    job.lastHeartbeat = new Date();
    console.log(`🚀 Executando job com heartbeat ${jobId}: ${command}`);

    // Verificar se é ffprobe/ffplay (não precisa de -y) ou ffmpeg (precisa de -y)
    const isFFprobe = command.trim().startsWith('ffprobe') || command.trim().startsWith('ffplay');
    const dockerCmd = isFFprobe 
        ? `docker exec ffmpeg ${command}` 
        : `docker exec ffmpeg ${command} -y`;
    
    console.log(`🔧 Comando Docker: ${dockerCmd} ${isFFprobe ? '(sem -y)' : '(com -y)'}`);
    
    // Executar sem timeout fixo
    const process = exec(dockerCmd, (error, stdout, stderr) => {
        const updatedJob = jobs.get(jobId);
        if (!updatedJob) return;

        // Limpar heartbeat quando processo termina
        if (updatedJob.heartbeatInterval) {
            clearInterval(updatedJob.heartbeatInterval);
            delete updatedJob.heartbeatInterval;
        }

        updatedJob.endTime = new Date();
        updatedJob.stdout = stdout;
        updatedJob.stderr = stderr;

        if (error) {
            updatedJob.status = 'failed';
            updatedJob.error = stderr || error.message;
            console.log(`💥 Job ${jobId} falhou:`, updatedJob.error);
        } else {
            updatedJob.status = 'completed';
            
            // Para ffprobe/ffplay, o resultado está no stdout
            if (isFFprobe) {
                console.log(`✅ ${command.split(' ')[0]} ${jobId} concluído. Resultado no stdout.`);
            } else {
                // Extrair nome do arquivo de saída para ffmpeg
                // Tenta primeiro com aspas duplas, depois aspas simples, depois sem aspas
                const outputMatch = command.match(/\/shared\/output\/(?:"([^"]+)"|'([^']+)'|([^\s"']+))/);
                if (outputMatch) {
                    // Pega o primeiro grupo não-nulo (aspas duplas, aspas simples ou sem aspas)
                    let filename = outputMatch[1] || outputMatch[2] || outputMatch[3];
                    // Remover aspas extras no início ou fim se houver
                    filename = filename.replace(/^["']|["']$/g, '');
                    updatedJob.outputFile = filename;
                }
                console.log(`✅ Job ${jobId} concluído. Arquivo de saída:`, updatedJob.outputFile);
            }
        }
    });

    // Configurar heartbeat check
    const heartbeatInterval = setInterval(async () => {
        try {
            const currentJob = jobs.get(jobId);
            if (!currentJob || currentJob.status !== 'running') {
                clearInterval(heartbeatInterval);
                return;
            }

            const runningProcesses = await checkRunningFFmpegProcesses();
            
            // Verificar se o comando do job está nos processos ativos
            const commandName = command.trim().split(' ')[0];
            const commandSignature = command.substring(commandName.length + 1, 50); // Remove comando e pega parte
            const isStillRunning = runningProcesses.some(processLine => 
                processLine.includes(commandName) &&
                (processLine.includes(commandSignature) || 
                 (currentJob.outputFile && processLine.includes(currentJob.outputFile)))
            );
            
            if (isStillRunning) {
                // Processo encontrado - atualizar heartbeat
                currentJob.lastHeartbeat = new Date();
                console.log(`💓 Heartbeat OK para job ${jobId}`);
            } else {
                // Processo não encontrado - verificar se é timeout de heartbeat
                const timeSinceLastHeartbeat = new Date().getTime() - (currentJob.lastHeartbeat?.getTime() || 0);
                
                if (timeSinceLastHeartbeat > HEARTBEAT_CONFIG.maxSilentTime) {
                    console.log(`💔 Heartbeat perdido para job ${jobId} (${timeSinceLastHeartbeat}ms sem atividade)`);
                    
                    // Matar processo se ainda existir
                    process.kill('SIGTERM');
                    
                    // Marcar job como falhou
                    currentJob.status = 'failed';
                    currentJob.error = `Processo interrompido - heartbeat perdido após ${Math.round(timeSinceLastHeartbeat/1000)}s`;
                    currentJob.endTime = new Date();
                    
                    clearInterval(heartbeatInterval);
                } else {
                    console.log(`⏳ Job ${jobId} sem processo detectado, mas dentro do limite de heartbeat`);
                }
            }
        } catch (error) {
            console.error(`❌ Erro no heartbeat do job ${jobId}:`, error);
        }
    }, HEARTBEAT_CONFIG.interval);

    // Armazenar referência do interval no job para limpeza
    job.heartbeatInterval = heartbeatInterval;

    // Limpar interval quando processo termina
    process.on('exit', () => {
        if (job.heartbeatInterval) {
            clearInterval(job.heartbeatInterval);
            delete job.heartbeatInterval;
        }
    });

    // Limpar interval se processo é morto
    process.on('error', () => {
        if (job.heartbeatInterval) {
            clearInterval(job.heartbeatInterval);
            delete job.heartbeatInterval;
        }
    });
}

// Função para sincronizar jobs órfãos (executar periodicamente)
async function syncJobsWithRunningProcesses(jobs: Map<string, Job>) {
    try {
        const runningProcesses = await checkRunningFFmpegProcesses();
        console.log(`🔍 Verificando sincronização: ${runningProcesses.length} processos FFmpeg ativos`);
        
        let orphanedJobs = 0;
        
        // Encontrar jobs marcados como 'running' mas sem processo ativo
        for (const [jobId, job] of jobs.entries()) {
            if (job.status === 'running') {
                const commandName = job.command.trim().split(' ')[0];
                
                // Só verificar jobs FFmpeg
                if (commandName.startsWith('ff')) {
                    const commandSignature = job.command.substring(commandName.length + 1, 50);
                    const isActuallyRunning = runningProcesses.some(process => 
                        process.includes(commandName) &&
                        (process.includes(commandSignature) ||
                         (job.outputFile && process.includes(job.outputFile)))
                    );
                    
                    if (!isActuallyRunning) {
                        const timeSinceStart = new Date().getTime() - job.startTime.getTime();
                        
                        // Dar tempo para processo começar (30 segundos)
                        if (timeSinceStart > 30000) {
                            console.log(`👻 Job órfão detectado ${jobId} (${commandName}) - marcando como falhou`);
                            job.status = 'failed';
                            job.error = 'Processo FFmpeg não encontrado durante sincronização';
                            job.endTime = new Date();
                            
                            // Limpar heartbeat se existir
                            if (job.heartbeatInterval) {
                                clearInterval(job.heartbeatInterval);
                                delete job.heartbeatInterval;
                            }
                            
                            orphanedJobs++;
                        }
                    }
                }
            }
        }
        
        if (orphanedJobs > 0) {
            console.log(`🧹 ${orphanedJobs} jobs órfãos sincronizados`);
        }
    } catch (error) {
        console.error('❌ Erro ao sincronizar jobs:', error);
    }
}

// Configurações de limpeza
const JOB_CLEANUP_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // 24 horas em ms
    maxJobs: 100, // Máximo de jobs a manter
    cleanupInterval: 60 * 60 * 1000, // Limpar a cada 1 hora
    syncInterval: 5 * 60 * 1000 // Sincronizar jobs órfãos a cada 5 minutos
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
            // Limpar heartbeat se existir
            if (job.heartbeatInterval) {
                clearInterval(job.heartbeatInterval);
            }
            
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
        toRemove.forEach(([jobId, job]) => {
            // Limpar heartbeat se existir
            if (job.heartbeatInterval) {
                clearInterval(job.heartbeatInterval);
            }
            jobs.delete(jobId);
            removedCount++;
        });
    }

    if (removedCount > 0) {
        console.log(`🧹 Limpeza automática: ${removedCount} jobs removidos. Jobs restantes: ${jobs.size}`);
    }
}

export { 
    executeFFmpegJobWithHeartbeat,
    syncJobsWithRunningProcesses,
    cleanupOldJobs, 
    JOB_CLEANUP_CONFIG,
    HEARTBEAT_CONFIG 
};