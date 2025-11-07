export interface FileInfo {
    name: string;
    size: number;
    sizeFormatted: string;
    date: string;
    permissions: string;
    isMedia: boolean;
    downloadUrl: string | null;
    directUrl: string | null;
}

export interface FilesResponse {
    type: string;
    count: number;
    files: FileInfo[];
}

export interface DeleteResult {
    filename: string;
    success: boolean;
    message: string;
}

export interface MediaInfo {
    filename: string;
    type: string;
    format: {
        filename?: string;
        formatName?: string;
        formatLongName?: string;
        duration: number;
        durationFormatted: string;
        size: number;
        sizeFormatted: string;
        bitRate: number;
    };
    video?: {
        codec: string;
        codecLongName: string;
        width: number;
        height: number;
        resolution: string;
        frameRate: number;
        bitRate: number;
        pixelFormat: string;
    } | null;
    audio?: {
        codec: string;
        codecLongName: string;
        sampleRate: number;
        channels: number;
        bitRate: number;
    } | null;
    downloadUrl: string | null;
    directUrl: string | null;
}

export interface Job {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    command: string;
    startTime: Date;
    endTime?: Date;
    progress?: number;
    stdout?: string;
    stderr?: string;
    outputFile?: string;
    error?: string;
}