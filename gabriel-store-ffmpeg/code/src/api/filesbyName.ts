
import { Request, Response } from 'express';


const filesbyNmae = async (req: Request, res: Response) => {
    const { type, filename } = req.params;
    
    // Validar o tipo de arquivo (deve ser 'input' ou 'output')
    if (type !== 'input' && type !== 'output') {
        return res.status(400).json({ 
            error: 'Tipo inválido. Use "input" ou "output"' 
        });
    }
    
    // Validar se o nome do arquivo foi fornecido
    if (!filename) {
        return res.status(400).json({ 
            error: 'Nome do arquivo é obrigatório' 
        });
    }
    
    // Construir o caminho do arquivo baseado no tipo
    const filePath = `/shared/${type}/${filename}`;
    
    // Enviar o arquivo para download
    res.download(filePath, filename, (err) => {
        if (err) {
            console.error('Erro ao fazer download do arquivo:', err);
            if ((err as any).code === 'ENOENT') {
                res.status(404).json({ 
                    error: 'Arquivo não encontrado',
                    path: filePath 
                });
            } else {
                res.status(500).json({ 
                    error: 'Erro interno do servidor ao fazer download',
                    details: err.message 
                });
            }
        }
    });
};

export default filesbyNmae;