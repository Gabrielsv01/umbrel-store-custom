import { Request, Response } from 'express';

const uploadJson = (req: Request, res: Response) => {
    try {
        const { data, filename } = req.body;
        
        if (!data) {
            return res.status(400).json({ error: 'Campo "data" (base64) é obrigatório' });
        }

        const buffer = Buffer.from(data, 'base64');
        const savedFilename = Date.now() + '-' + (filename || 'uploaded-file');
        const filePath = `/shared/input/${savedFilename}`;

        require('fs').writeFileSync(filePath, buffer);

        res.json({
            success: true,
            message: 'Arquivo enviado com sucesso',
            file: {
                savedName: savedFilename,
                size: buffer.length,
                path: filePath
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao processar base64' });
    }
}
export default uploadJson;