import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import multer from 'multer';
import status from './api/status';
import fileType from './api/filesType';
import infoByFilename from './api/infoByfilename';
import deleteFilesbyFileName from './api/deleteFilesbyFileName';
import deleteMultipleFiles from './api/deleteMultipleFiles';
import command from './api/command';
import downloadbyFilename from './api/downloadbyFilename';
import clearDirectory from './api/clearDirectory';
import uploadJson from './api/uploadJson';
import doc from './api/doc';
import ui from './api/ui';
import DeleteJobById from './api/jobs/deletebyId';
import { Job } from './types';
import listAllJobs from './api/jobs/listAllJobs';
import commandAsync from './api/commandAsync';
import { cleanupOldJobs, JOB_CLEANUP_CONFIG, syncJobsWithRunningProcesses } from './api/jobs/utils';
import getJobById from './api/jobs/getJobById';
import jobsStatus from './api/jobs/jobsStatus';
import retryById from './api/jobs/retryById';
import filesbyNmae from './api/filesbyName';

const app = express();

const jobs: Map<string, Job> = new Map();

// Configurar multer para salvar arquivos na pasta shared/input
const storage = multer.diskStorage({
    destination: '/shared/input/',
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });

// Aumenta o limite de payload para requisições JSON (500MB)
app.use(express.json({ 
    limit: '500mb'
}));

// Aumenta o limite para URL encoded data
app.use(express.urlencoded({ 
    limit: '500mb', 
    extended: true,
    parameterLimit: 100000 
}));

// Servir arquivos estáticos da pasta output
app.use('/files', express.static('/shared/output'));

// Servir arquivos estáticos da UI (CSS e JS)
app.use('/ui', express.static(__dirname + '/api/ui'));

// Endpoint para verificar se os diretórios existem
app.get('/status', status);

// Endpoint para listar arquivos
app.get('/files/:type', fileType);



// Endpoint para obter informações detalhadas de um arquivo de mídia
app.get('/info/:type/:filename', infoByFilename);

app.post('/upload-json', uploadJson);

// Adicionar endpoint multipart para arquivos grandes (recomendado)
app.post('/upload', upload.single('file'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const formatFileSize = (bytes: number): string => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        };

        res.json({
            success: true,
            message: 'Arquivo enviado com sucesso',
            file: {
                originalName: req.file.originalname,
                savedName: req.file.filename,
                size: req.file.size,
                sizeFormatted: formatFileSize(req.file.size),
                path: req.file.path,
                mimetype: req.file.mimetype
            }
        });
    } catch (error) {
        console.error('Erro no upload:', error);
        res.status(500).json({ 
            error: 'Erro ao fazer upload do arquivo',
            details: error instanceof Error ? error.message : 'Erro desconhecido'
        });
    }
});

// Endpoint para deletar arquivos
app.delete('/files/:type/:filename', deleteFilesbyFileName);

// Endpoint para deletar múltiplos arquivos
app.delete('/files/:type', deleteMultipleFiles);

// Endpoint para limpar diretório completamente
app.delete('/clear/:type', clearDirectory);

// Endpoint para download de arquivos específicos
app.get('/download/:filename', downloadbyFilename);

// Endpoint para download de arquivos por tipo (input/output) e nome
app.get('/files/:type/:filename', filesbyNmae);

// Endpoint para executar comandos FFmpeg
app.post('/ffmpeg', command);

// Endpoint assíncrono para FFmpeg
app.post('/ffmpeg-async', (req: Request, res: Response) => {
    return commandAsync(req, res, jobs);
});

// Endpoint para verificar status do job
app.get('/job/:jobId', (req: Request, res: Response) => {
    return getJobById(req, res, jobs);
});

// Endpoint para verificar status de múltiplos jobs
app.post('/jobs/status', (req: Request, res: Response) => {
    return jobsStatus(req, res, jobs);
});

// Endpoint para retentar execução de um job
app.post('/job/:jobId/retry', (req: Request, res: Response) => {
    return retryById(req, res, jobs);
});

// Endpoint para listar todos os jobs
app.get('/jobs', (req: Request, res: Response) => {
    return listAllJobs(req, res, jobs);
});

// Endpoint para cancelar/remover job
app.delete('/job/:jobId', (req: Request, res: Response) => {
   return DeleteJobById(req, res, jobs);
});

// Endpoint para criar diretórios se não existirem
app.post('/init', (_req: Request, res: Response) => {
    const dockerCmd = `docker exec ffmpeg mkdir -p /shared/input /shared/output`;
    
    exec(dockerCmd, (error, _stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: stderr });
        }
        
        res.json({ 
            success: true,
            message: 'Diretórios criados/verificados' 
        });
    });
});

// Endpoint para servir o README na rota raiz
app.get('/', doc);

// Interface web para gerenciar FFmpeg API
app.get('/ui', ui);

// Iniciar limpeza automática
setInterval(() => cleanupOldJobs(jobs), JOB_CLEANUP_CONFIG.cleanupInterval);
// Adicionar sincronização de jobs órfãos
setInterval(() => syncJobsWithRunningProcesses(jobs), JOB_CLEANUP_CONFIG.syncInterval);


const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`FFmpeg API rodando na porta ${PORT}`);
    
    // Inicializar diretórios na inicialização
    setTimeout(() => {
        exec(`docker exec ffmpeg mkdir -p /shared/input /shared/output`, (error) => {
            if (!error) {
                console.log('Diretórios inicializados');
            }
        });
    }, 2000);
});

export default app;