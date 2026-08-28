import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";

// Kokoro's own defaults (kokoro-fastapi NormalizationOptions) — sending these
// explicitly when unchanged is equivalent to omitting the field entirely.
export const NORM_DEFAULTS = {
  normalize: true,
  unit_normalization: false,
  url_normalization: true,
  email_normalization: true,
  optional_pluralization_normalization: true,
  phone_normalization: true,
  replace_remaining_symbols: true,
};
export const NORM_LABELS = {
  normalize: "Normalizar texto (recomendado)",
  unit_normalization: "Unidades (10KB → 10 kilobytes)",
  url_normalization: "URLs",
  email_normalization: "E-mails",
  optional_pluralization_normalization: "Plurais opcionais — ex.: (s)",
  phone_normalization: "Telefones",
  replace_remaining_symbols: "Símbolos restantes por extenso",
};

function loadSaved(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Owns every bit of state needed to pick a TTS engine/voice and its
// engine-specific params — shared by the Voz tab and the Agente tab's
// "reproduzir resposta em voz" panel, so both stay in feature parity.
// Persists to localStorage under `storageKey` so the choice survives reloads;
// pass distinct keys per host so e.g. the Agente panel doesn't clobber the
// Voz tab's own saved engine/voice (they're independent use cases).
export function useVoiceEngine(storageKey = "voice_engine_settings") {
  const saved = useMemo(() => loadSaved(storageKey), [storageKey]);
  const [engines, setEngines] = useState([{ id: "piper", label: "Piper", available: true }]);
  const [engine, setEngine] = useState(saved.engine || "piper");
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [kokoroVoices, setKokoroVoices] = useState([]);
  const [kokoroWeights, setKokoroWeights] = useState(saved.kokoroWeights || {});
  const [lengthScale, setLengthScale] = useState(saved.lengthScale || "1.0");
  const [advanced, setAdvanced] = useState(saved.advanced || false);
  const [noiseScale, setNoiseScale] = useState(saved.noiseScale || "");
  const [noiseW, setNoiseW] = useState(saved.noiseW || "");
  const [sentenceSilence, setSentenceSilence] = useState(saved.sentenceSilence || "");
  const [speed, setSpeed] = useState(saved.speed ?? 1.0);
  const [volume, setVolume] = useState(saved.volume ?? 1.0);
  const [allowVoiceTags, setAllowVoiceTags] = useState(saved.allowVoiceTags || false);
  const [ssml, setSsml] = useState(saved.ssml || false);
  const [normOptions, setNormOptions] = useState(saved.normOptions || NORM_DEFAULTS);
  const [voiceError, setVoiceError] = useState(null);
  // Only restore the saved voice/kokoroVoices on the very first voice-list
  // fetch (right after mount) — later engine switches within the same
  // session just default to the first available voice, as before.
  const restoringRef = useRef(true);

  useEffect(() => {
    api.ttsEngines().then(setEngines).catch(() => {});
  }, []);

  useEffect(() => {
    setVoices([]);
    setVoice("");
    setKokoroVoices([]);
    const restoring = restoringRef.current;
    restoringRef.current = false;
    api.ttsVoices(engine).then((v) => {
      setVoices(v);
      if (!v[0]) return;
      if (engine === "kokoro") {
        const savedKokoro = saved.kokoroVoices;
        if (restoring && Array.isArray(savedKokoro) && savedKokoro.length && savedKokoro.every((id) => v.includes(id))) {
          setKokoroVoices(savedKokoro);
        } else {
          setKokoroVoices([v[0]]);
        }
      } else if (restoring && saved.voice && v.includes(saved.voice)) {
        setVoice(saved.voice);
      } else {
        setVoice(v[0]);
      }
    }).catch((e) => setVoiceError(`${engine}: ${e.message}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  useEffect(() => {
    const data = {
      engine, voice, kokoroVoices, kokoroWeights, lengthScale, advanced,
      noiseScale, noiseW, sentenceSilence, speed, volume, allowVoiceTags,
      ssml, normOptions,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch { /* ignore quota/private-mode errors */ }
  }, [storageKey, engine, voice, kokoroVoices, kokoroWeights, lengthScale, advanced,
      noiseScale, noiseW, sentenceSilence, speed, volume, allowVoiceTags, ssml, normOptions]);

  // SSML translation emits [voice:]/[rate:] spans, so the API requires
  // allow_voice_tags whenever ssml is on.
  useEffect(() => {
    if (ssml) setAllowVoiceTags(true);
  }, [ssml]);

  // A single voice needs no weight; combining 2+ uses Kokoro's
  // "nome(peso)+nome2(peso2)" syntax so each voice's blend share is explicit.
  const activeVoice = engine === "kokoro"
    ? (kokoroVoices.length <= 1 ? (kokoroVoices[0] || "") : kokoroVoices.map((id) => `${id}(${kokoroWeights[id] ?? 1})`).join("+"))
    : voice;

  function buildParams() {
    if (engine === "kokoro") {
      return {
        speed, volume_multiplier: volume, allow_voice_tags: allowVoiceTags,
        ssml, normalization_options: normOptions,
      };
    }
    return {
      length_scale: lengthScale,
      noise_scale: advanced && noiseScale ? noiseScale : undefined,
      noise_w: advanced && noiseW ? noiseW : undefined,
      sentence_silence: advanced && sentenceSilence ? sentenceSilence : undefined,
    };
  }

  return {
    engines, engine, setEngine, voices, voice, setVoice,
    kokoroVoices, setKokoroVoices, kokoroWeights, setKokoroWeights,
    lengthScale, setLengthScale, advanced, setAdvanced,
    noiseScale, setNoiseScale, noiseW, setNoiseW, sentenceSilence, setSentenceSilence,
    speed, setSpeed, volume, setVolume, allowVoiceTags, setAllowVoiceTags,
    ssml, setSsml, normOptions, setNormOptions,
    activeVoice, buildParams, voiceError, setVoiceError,
  };
}
