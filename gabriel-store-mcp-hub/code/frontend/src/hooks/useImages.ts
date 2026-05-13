import { useCallback, useRef, useState } from 'react';
import { listImages, removeImage } from '../services/api';
import type {
  ImageRecord,
  PullPayload,
  PullProgress,
} from '../types/resources';
import { toErrorMessage } from '../utils/error';

export function useImages() {
  const [showImages, setShowImages] = useState(false);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [removingImageId, setRemovingImageId] = useState<string | null>(null);
  const [pullingImage, setPullingImage] = useState(false);
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const pullLockRef = useRef(false);

  const fetchImages = useCallback(async () => {
    setImagesLoading(true);
    setImagesError(null);
    try {
      const data = await listImages();
      setImages(data);
    } catch (err) {
      setImagesError(toErrorMessage(err, 'Failed to fetch images'));
    } finally {
      setImagesLoading(false);
    }
  }, []);

  const openImages = useCallback(async () => {
    setShowImages(true);
    await fetchImages();
  }, [fetchImages]);

  const closeImages = useCallback(() => {
    setShowImages(false);
  }, []);

  const handleRemoveImage = useCallback(
    async (image: ImageRecord) => {
      if (image.inUse) return;
      const label = image.tags?.[0] || image.shortId;
      const confirmed = window.confirm(`Remove image ${label}?`);
      if (!confirmed) return;

      setRemovingImageId(image.id);
      setImagesError(null);
      try {
        await removeImage(image.shortId);
        await fetchImages();
      } catch (err) {
        setImagesError(toErrorMessage(err, 'Failed to remove image'));
      } finally {
        setRemovingImageId(null);
      }
    },
    [fetchImages]
  );

  const handlePullImage = useCallback(
    async (imageRef: string, onSuccess?: () => void) => {
      const ref = imageRef.trim();
      if (!ref) return;

      if (pullLockRef.current) {
        setImagesError(
          pullProgress?.image
            ? `Already pulling ${pullProgress.image}. Wait for it to finish before starting another pull.`
            : 'Another image pull is already running. Wait for it to finish.'
        );
        return;
      }

      pullLockRef.current = true;

      setPullingImage(true);
      setImagesError(null);
      setPullProgress({ image: ref, status: 'Starting pull…', percent: null });

      try {
        await new Promise<void>((resolve, reject) => {
          const source = new EventSource(
            `/api/images/pull/stream?image=${encodeURIComponent(ref)}`
          );

          source.onmessage = (event) => {
            try {
              const payload = JSON.parse(event.data) as PullPayload;

              if (payload.type === 'progress') {
                setPullProgress({
                  image: ref,
                  status: payload.status || 'Pulling…',
                  id: payload.id || null,
                  current: Number(payload.overallCurrent) || 0,
                  total: Number(payload.overallTotal) || 0,
                  percent:
                    typeof payload.overallPercent === 'number'
                      ? payload.overallPercent
                      : null,
                });
                return;
              }

              if (payload.type === 'done') {
                source.close();
                resolve();
                return;
              }

              if (payload.type === 'error') {
                source.close();
                reject(new Error(payload.error || 'Failed to pull image'));
              }
            } catch {
              source.close();
              reject(new Error('Failed to parse pull progress'));
            }
          };

          source.onerror = () => {
            source.close();
            reject(new Error('Pull connection failed'));
          };
        });

        if (typeof onSuccess === 'function') onSuccess();
        await fetchImages();
      } catch (err) {
        setImagesError(toErrorMessage(err, 'Failed to pull image'));
      } finally {
        setPullingImage(false);
        setPullProgress(null);
        pullLockRef.current = false;
      }
    },
    [fetchImages, pullProgress?.image]
  );

  return {
    showImages,
    images,
    imagesLoading,
    imagesError,
    removingImageId,
    pullingImage,
    pullProgress,
    fetchImages,
    openImages,
    closeImages,
    handleRemoveImage,
    handlePullImage,
  };
}
