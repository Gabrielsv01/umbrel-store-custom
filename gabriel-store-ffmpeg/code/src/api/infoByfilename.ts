
import { exec } from 'child_process';
import { Request, Response } from 'express';
import { formatDuration, formatFileSize, isValidDirectoryType } from '../utils';
import { MediaInfo } from '../types';

const infoByFilename = (req: Request, res: Response) => {
    const { type, filename } = req.params;
    
    if (!isValidDirectoryType(type)) {
        return res.status(400).json({ error: 'Tipo deve ser "input" ou "output"' });
    }
    
    const filePath = `/shared/${type}/${filename}`;
    
    // Usar ffprobe para obter informações detalhadas do arquivo
    const probeCmd = `docker exec ffmpeg ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`;
    
    exec(probeCmd, (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ 
                error: 'Erro ao analisar arquivo',
                stderr: stderr 
            });
        }
        
        try {
            const probeData = JSON.parse(stdout);
            const format = probeData.format || {};
            const streams = probeData.streams || [];
            
            // Extrair informações principais
            const videoStream = streams.find((s: any) => s.codec_type === 'video');
            const audioStream = streams.find((s: any) => s.codec_type === 'audio');
            
            const info: MediaInfo = {
                filename: filename,
                type: type,
                format: {
                    filename: format.filename,
                    formatName: format.format_name,
                    formatLongName: format.format_long_name,
                    duration: parseFloat(format.duration) || 0,
                    durationFormatted: formatDuration(parseFloat(format.duration) || 0),
                    size: parseInt(format.size) || 0,
                    sizeFormatted: formatFileSize(parseInt(format.size) || 0),
                    bitRate: parseInt(format.bit_rate) || 0
                },
                video: videoStream ? {
                    codec: videoStream.codec_name,
                    codecLongName: videoStream.codec_long_name,
                    width: videoStream.width,
                    height: videoStream.height,
                    resolution: `${videoStream.width}x${videoStream.height}`,
                    frameRate: eval(videoStream.r_frame_rate) || 0,
                    bitRate: parseInt(videoStream.bit_rate) || 0,
                    pixelFormat: videoStream.pix_fmt
                } : null,
                audio: audioStream ? {
                    codec: audioStream.codec_name,
                    codecLongName: audioStream.codec_long_name,
                    sampleRate: parseInt(audioStream.sample_rate) || 0,
                    channels: audioStream.channels,
                    bitRate: parseInt(audioStream.bit_rate) || 0
                } : null,
                downloadUrl: type === 'output' ? `/download/${filename}` : null,
                directUrl: type === 'output' ? `/files/${filename}` : null
            };
            
            res.json(info);
            
        } catch (parseError: any) {
            res.status(500).json({ 
                error: 'Erro ao processar informações do arquivo',
                details: parseError.message 
            });
        }
    });
}

export default infoByFilename;