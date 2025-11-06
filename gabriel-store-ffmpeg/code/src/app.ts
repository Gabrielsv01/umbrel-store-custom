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

const app = express();

// Configurar multer para salvar arquivos na pasta shared/input
const storage = multer.diskStorage({
    destination: '/shared/input/',
    filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ storage: storage });
app.use(express.json());

// Servir arquivos estáticos da pasta output
app.use('/files', express.static('/shared/output'));

// Endpoint para verificar se os diretórios existem
app.get('/status', status);

// Endpoint para listar arquivos
app.get('/files/:type', fileType);

// Endpoint para obter informações detalhadas de um arquivo de mídia
app.get('/info/:type/:filename', infoByFilename);

app.post('/upload-json', uploadJson);

// Endpoint para deletar arquivos
app.delete('/files/:type/:filename', deleteFilesbyFileName);

// Endpoint para deletar múltiplos arquivos
app.delete('/files/:type', deleteMultipleFiles);

// Endpoint para limpar diretório completamente
app.delete('/clear/:type', clearDirectory);

// Endpoint para download de arquivos específicos
app.get('/download/:filename', downloadbyFilename);

// Endpoint para executar comandos FFmpeg
app.post('/ffmpeg', command);

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