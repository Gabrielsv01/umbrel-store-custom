import { useState, useRef, useCallback } from 'react';
import { buildDockerImageStream } from '../services/api';
import type { DockerBuildProgress, BuildLogEntry } from '../types/dockerBuilder';

export function useDockerBuilder() {
  const [building, setBuilding] = useState(false);
  const [buildLog, setBuildLog] = useState<BuildLogEntry[]>([]);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [lastBuiltImage, setLastBuiltImage] = useState<string | null>(null);
  const [buildProgress, setBuildProgress] = useState<number>(0);

  const buildLockRef = useRef(false);
  const currentStreamRef = useRef<{ close: () => void } | null>(null);

  const handleBuild = useCallback(
    async (
      dockerfile: string,
      imageName: string,
      tag: string = 'latest',
      buildArgs?: Record<string, string>,
      platform?: string
    ) => {
      if (buildLockRef.current) {
        setBuildError('A build is already in progress. Please wait for it to complete.');
        return;
      }

      buildLockRef.current = true;
      setBuilding(true);
      setBuildError(null);
      setBuildLog([]);
      setBuildProgress(0);

      const addLog = (message: string, type: BuildLogEntry['type']) => {
        setBuildLog((prev) => {
          const updated = [
            ...prev,
            {
              timestamp: new Date(),
              message,
              type,
            },
          ];
          // Keep only last 1000 entries to prevent memory issues with large builds
          return updated.slice(-1000);
        });
      };

      try {
        addLog(`Starting build: ${imageName}:${tag}...`, 'info');

        const stream = buildDockerImageStream(
          dockerfile,
          imageName,
          tag,
          buildArgs,
          platform,
          (progress: DockerBuildProgress) => {
            if (progress.type === 'start') {
              addLog(progress.status || 'Starting build...', 'info');
            } else if (progress.type === 'progress') {
              addLog(progress.status || 'Building...', 'progress');
              if (progress.percent !== undefined) {
                setBuildProgress(progress.percent);
              }
            } else if (progress.type === 'done') {
              setBuildProgress(100);
              addLog(`Build completed: ${progress.image}`, 'success');
              setLastBuiltImage(progress.image || null);
            } else if (progress.type === 'error') {
              addLog(`Error: ${progress.error || 'Unknown error'}`, 'error');
              throw new Error(progress.error || 'Build failed');
            }
          },
          (error: Error) => {
            addLog(`Connection error: ${error.message}`, 'error');
            throw error;
          }
        );

        currentStreamRef.current = stream;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setBuildError(errorMessage);
        addLog(errorMessage, 'error');
      } finally {
        setBuilding(false);
        buildLockRef.current = false;
        currentStreamRef.current = null;
      }
    },
    []
  );

  const cancelBuild = useCallback(() => {
    if (currentStreamRef.current) {
      currentStreamRef.current.close();
      currentStreamRef.current = null;
    }
    setBuilding(false);
    buildLockRef.current = false;
    setBuildLog((prev) => [
      ...prev,
      {
        timestamp: new Date(),
        message: 'Build cancelled',
        type: 'info',
      },
    ]);
  }, []);

  const resetBuild = useCallback(() => {
    setLastBuiltImage(null);
    setBuildLog([]);
    setBuildError(null);
    setBuildProgress(0);
  }, []);

  return {
    building,
    buildLog,
    buildError,
    lastBuiltImage,
    buildProgress,
    handleBuild,
    cancelBuild,
    resetBuild,
  };
}
