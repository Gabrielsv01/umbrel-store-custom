import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

const INITIAL = {
  playing: false, current: null, queue: [], paused: false, priming: false,
  position: 0, repeat: "off", has_previous: false, shuffled: false,
};

// Shared by App.jsx (NowPlayingBar) and PlayerPage.jsx (its own route,
// rendered outside the App shell) so both reflect the exact same live
// playback state instead of polling/duplicating this logic separately.
export function useAudioStatus() {
  const [audioStatus, setAudioStatus] = useState(INITIAL);

  useEffect(() => {
    const tick = () => api.audioStatus().then(setAudioStatus).catch(() => {});
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);

  const handlePause = useCallback(() => api.audioPause().then(setAudioStatus).catch(() => {}), []);
  const handleResume = useCallback(() => api.audioResume().then(setAudioStatus).catch(() => {}), []);
  const handleSkip = useCallback(() => api.audioSkip().then(setAudioStatus).catch(() => {}), []);
  const handleStop = useCallback(() => api.audioStop().then(setAudioStatus).catch(() => {}), []);
  const handlePrevious = useCallback(() => api.audioPrevious().then(setAudioStatus).catch(() => {}), []);
  const handleSeek = useCallback((pos) => api.audioSeek(pos).then(setAudioStatus).catch(() => {}), []);
  const handleRepeat = useCallback((mode) => api.audioRepeat(mode).then(setAudioStatus).catch(() => {}), []);
  const handleShuffle = useCallback((enabled) => api.audioShuffle(enabled).then(setAudioStatus).catch(() => {}), []);

  return {
    audioStatus, setAudioStatus,
    handlePause, handleResume, handleSkip, handleStop,
    handlePrevious, handleSeek, handleRepeat, handleShuffle,
  };
}
