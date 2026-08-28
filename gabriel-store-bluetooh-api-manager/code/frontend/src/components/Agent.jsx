import { useEffect, useRef, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, IconButton, Typography, Alert,
  Chip, Avatar, Tooltip, Accordion, AccordionSummary, AccordionDetails,
  FormControl, InputLabel, Select, MenuItem, CircularProgress,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import AddCommentIcon from "@mui/icons-material/AddComment";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import SpeakerIcon from "@mui/icons-material/Speaker";
import { api } from "../api.js";
import { useVoiceEngine } from "../hooks/useVoiceEngine.js";
import VoiceEngineFields from "./VoiceEngineFields.jsx";

const SESSION_KEY = "agent_session_id";
// Minimal valid silent WAV (44-byte header, no samples) — just needs to be
// decodable so play() actually resolves, arming the <audio> element.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost) —
// this app is also reached over plain HTTP on the LAN (e.g. http://10.0.0.x:5157/),
// where the browser leaves it undefined, so it can't be relied on here.
function genId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = genId();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function renderInline(text, keyPrefix) {
  return text.split(/(`[^`\n]+`)/g).map((part, i) => (
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      <Box key={`${keyPrefix}-${i}`} component="code" sx={{
        fontFamily: "monospace", fontSize: "0.85em", bgcolor: "action.selected",
        borderRadius: 0.5, px: 0.5,
      }}>{part.slice(1, -1)}</Box>
    ) : part
  ));
}

// Splits on ```fenced code blocks``` and renders them as monospace panels;
// everything else stays plain text with `inline code` spans highlighted.
// An unclosed fence (still streaming in) is left as literal text until the
// closing ``` arrives — a minor, expected hiccup during streaming.
function MessageContent({ content }) {
  const segments = [];
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0, match;
  while ((match = codeBlockRe.exec(content)) !== null) {
    if (match.index > lastIndex) segments.push({ type: "text", content: content.slice(lastIndex, match.index) });
    segments.push({ type: "code", lang: match[1], content: match[2].replace(/\n$/, "") });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) segments.push({ type: "text", content: content.slice(lastIndex) });

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "code") {
          return (
            <Box key={i} sx={{ mt: i > 0 ? 1 : 0, mb: i < segments.length - 1 ? 1 : 0 }}>
              {seg.lang && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
                  {seg.lang}
                </Typography>
              )}
              <Box component="pre" sx={{
                m: 0, p: 1.25, borderRadius: 1, bgcolor: "action.hover",
                overflowX: "auto", fontFamily: "monospace", fontSize: "0.8rem",
              }}>
                <Box component="code">{seg.content}</Box>
              </Box>
            </Box>
          );
        }
        const trimmed = seg.content.replace(/^\n+|\n+$/g, "");
        if (!trimmed) return null;
        return (
          <Typography key={i} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {renderInline(trimmed, i)}
          </Typography>
        );
      })}
    </>
  );
}

function AudioIndicator({ state }) {
  if (state === "generating") {
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
        <CircularProgress size={12} thickness={6} />
        <Typography variant="caption" color="text.secondary">Gerando áudio…</Typography>
      </Stack>
    );
  }
  if (state === "playing") {
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
        <VolumeUpIcon fontSize="inherit" color="primary" sx={{
          animation: "agent-audio-pulse 1s infinite ease-in-out",
          "@keyframes agent-audio-pulse": {
            "0%, 100%": { opacity: 0.5 },
            "50%": { opacity: 1 },
          },
        }} />
        <Typography variant="caption" color="primary">Reproduzindo…</Typography>
      </Stack>
    );
  }
  if (state === "sent") {
    return (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mt: 0.5 }}>
        <SpeakerIcon fontSize="inherit" color="success" />
        <Typography variant="caption" color="text.secondary">Enviado ao alto-falante</Typography>
      </Stack>
    );
  }
  return null;
}

function TypingBubble() {
  const dot = (delay) => ({
    width: 6, height: 6, borderRadius: "50%", bgcolor: "text.secondary",
    display: "inline-block", mx: 0.25,
    animation: "agent-typing-bounce 1.1s infinite ease-in-out",
    animationDelay: `${delay}s`,
    "@keyframes agent-typing-bounce": {
      "0%, 80%, 100%": { transform: "scale(0.6)", opacity: 0.4 },
      "40%": { transform: "scale(1)", opacity: 1 },
    },
  });
  return (
    <Stack direction="row" spacing={1} sx={{ alignSelf: "flex-start", alignItems: "flex-end" }}>
      <Avatar sx={{ width: 28, height: 28 }}><SmartToyIcon fontSize="small" /></Avatar>
      <Card variant="outlined">
        <CardContent sx={{ py: 1.25, px: 1.75, "&:last-child": { pb: 1.25 } }}>
          <Box component="span" sx={dot(0)} />
          <Box component="span" sx={dot(0.15)} />
          <Box component="span" sx={dot(0.3)} />
        </CardContent>
      </Card>
    </Stack>
  );
}

export default function Agent() {
  const [configured, setConfigured] = useState(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [autoSend, setAutoSend] = useState(false);
  const [classic, setClassic] = useState([]);
  const [playbackTarget, setPlaybackTarget] = useState("off"); // off | browser | speaker
  const [ttsDevice, setTtsDevice] = useState("");
  // Per-message audio indicator: message id -> "generating" | "playing" | "sent".
  const [audioState, setAudioState] = useState({});
  const ve = useVoiceEngine("voice_engine_agent");
  const wsRef = useRef(null);
  const listRef = useRef(null);
  const audioRef = useRef(null);
  const currentPlayingMsgIdRef = useRef(null);
  // message_ids of "kind": "tool_calls" announcements (empty content by
  // protocol design — the actual call lives in a separate payload field we
  // don't render) — tracked so their message.update follow-ups are ignored
  // too, instead of showing an empty chat bubble.
  const skippedIdsRef = useRef(new Set());
  // Browsers block programmatic audio.play() unless it's tied to a user
  // gesture. The agent's reply audio only becomes ready well after the
  // gesture that sent the message (a poll timer, seconds later), so it gets
  // silently rejected. Fix: "unlock" the <audio> element by successfully
  // playing a near-silent clip during an actual gesture (Enter/click on
  // Enviar) — once an element has played successfully, later programmatic
  // .play() calls on it are allowed for the rest of the page session.
  const audioUnlockedRef = useRef(false);
  // Mirrors the voice-playback settings into a ref so the WebSocket handler
  // (created once per connect(), not per render) always reads the latest
  // values — reassigned every render (not via useEffect) so it never goes
  // stale without needing to track every individual useVoiceEngine field.
  const playbackRef = useRef({ target: "off", engine: "piper", voice: "", params: {}, device: "" });
  playbackRef.current = {
    target: playbackTarget, engine: ve.engine, voice: ve.activeVoice,
    params: ve.buildParams(), device: ttsDevice,
  };
  // Grace period before actually hiding the "digitando" indicator, so a
  // brief typing.stop→typing.start gap mid-turn (e.g. around a tool call)
  // doesn't visibly flicker.
  const typingStopTimerRef = useRef(null);

  function clearAudioState(msgId) {
    setAudioState((cur) => {
      if (!(msgId in cur)) return cur;
      const next = { ...cur };
      delete next[msgId];
      return next;
    });
  }

  useEffect(() => {
    api.agentStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    const tick = () => api.classicDevices().then(setClassic).catch(() => {});
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const connectedSpeakers = classic.filter((c) => c.connected);
    if (!ttsDevice && connectedSpeakers.length) setTtsDevice(connectedSpeakers[0].address);
  }, [classic, ttsDevice]);

  // Auto-send (experimental): while enabled, sends whatever's in the input
  // after it stops changing for a bit — works with the phone keyboard's own
  // dictation (mic button), which inserts text as you speak, so "no new text
  // for N ms" doubles as "the person stopped talking".
  useEffect(() => {
    if (!autoSend || !text.trim()) return;
    const t = setTimeout(() => send(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, autoSend]);

  async function speakResponse(content, pb, msgId) {
    if (!pb.voice || !content.trim()) return;
    if (pb.target === "speaker" && !pb.device) return;
    setAudioState((cur) => ({ ...cur, [msgId]: "generating" }));
    try {
      const job = await api.ttsSubmit({
        text: content, voice: pb.voice, engine: pb.engine,
        mode: pb.target === "speaker" ? "play" : "browser",
        device: pb.target === "speaker" ? pb.device : undefined,
        ...pb.params,
      });
      pollJob(job.id, msgId, pb.target);
    } catch (e) {
      clearAudioState(msgId);
      setError(`Falha ao gerar áudio da resposta: ${e.message}`);
    }
  }

  // Polls a generation job until it's playable, then either autoplays it in
  // the browser (flips the bubble's indicator to "playing", cleared by the
  // <audio> element's onEnded/onPause) or, for a speaker target, just flags
  // it "sent" for a few seconds once bluetooth-api-manager has queued it
  // (we can't observe the speaker's own playback progress from here).
  function pollJob(jobId, msgId, target) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      let status;
      try {
        status = await api.ttsStatus();
      } catch {
        clearInterval(interval);
        clearAudioState(msgId);
        return;
      }
      const job = status.jobs.find((j) => j.id === jobId);
      if (target === "browser" && job?.status === "ready") {
        clearInterval(interval);
        if (audioRef.current) {
          currentPlayingMsgIdRef.current = msgId;
          setAudioState((cur) => ({ ...cur, [msgId]: "playing" }));
          audioRef.current.src = api.ttsJobAudioUrl(jobId);
          audioRef.current.play().catch(() => clearAudioState(msgId));
        } else {
          clearAudioState(msgId);
        }
      } else if (target === "speaker" && job?.status === "queued-to-play") {
        clearInterval(interval);
        setAudioState((cur) => ({ ...cur, [msgId]: "sent" }));
        setTimeout(() => clearAudioState(msgId), 4000);
      } else if (job?.status === "error" || attempts > 40) {
        clearInterval(interval);
        clearAudioState(msgId);
      }
    }, 1000);
  }

  useEffect(() => {
    if (!configured) return;
    let stopped = false;
    let ws;
    let retryTimer;

    function maybeSpeak(msgId, content, payload) {
      // The agent may cycle typing.start/typing.stop multiple times within a
      // single turn (e.g. a pause between "decide to call a tool" and
      // "write the final answer" once results come back), so typing.stop
      // alone isn't a reliable "this is the final reply" signal. The
      // gateway only attaches context_usage on the finalize call for a
      // reply — that's the precise marker to trigger speech from.
      if (!payload?.context_usage) return;
      const pb = playbackRef.current;
      if (pb.target !== "off" && content && content.trim()) speakResponse(content, pb, msgId);
    }

    function scheduleHideTyping() {
      clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = setTimeout(() => setTyping(false), 500);
    }

    function handleMessage(data) {
      if (data.type === "typing.start") {
        clearTimeout(typingStopTimerRef.current);
        setTyping(true);
      } else if (data.type === "typing.stop") {
        scheduleHideTyping();
      } else if (data.type === "message.create") {
        scheduleHideTyping();
        const rawId = data.payload?.message_id;
        if (data.payload?.kind === "tool_calls") {
          if (rawId) skippedIdsRef.current.add(rawId);
          return;
        }
        const msgId = rawId || genId();
        const content = data.payload?.content || "";
        setMessages((cur) => [...cur, { id: msgId, role: "agent", content }]);
        maybeSpeak(msgId, content, data.payload);
      } else if (data.type === "message.update") {
        const msgId = data.payload?.message_id;
        if (msgId && skippedIdsRef.current.has(msgId)) return;
        const content = data.payload?.content;
        setMessages((cur) => cur.map((m) =>
          m.id === msgId ? { ...m, content: content ?? m.content } : m
        ));
        maybeSpeak(msgId, content, data.payload);
      } else if (data.type === "error") {
        setTyping(false);
        setError(data.payload?.message || "Erro na conexão com o agente.");
      }
    }

    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/ws/agent?session_id=${sessionId}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retryTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        try { handleMessage(JSON.parse(ev.data)); } catch { /* ignore malformed frame */ }
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(typingStopTimerRef.current);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, sessionId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing]);

  function newSession() {
    const id = genId();
    localStorage.setItem(SESSION_KEY, id);
    setMessages([]);
    setTyping(false);
    setError(null);
    setAudioState({});
    skippedIdsRef.current.clear();
    currentPlayingMsgIdRef.current = null;
    clearTimeout(typingStopTimerRef.current);
    setSessionId(id);
  }

  function unlockAudioForAutoplay() {
    if (audioUnlockedRef.current || !audioRef.current) return;
    const el = audioRef.current;
    el.src = SILENT_WAV;
    el.play().then(() => {
      el.pause();
      audioUnlockedRef.current = true;
    }).catch(() => { /* not a real gesture (e.g. auto-send timer) — retry next time */ });
  }

  function send() {
    const content = text.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    unlockAudioForAutoplay();
    const id = genId();
    setMessages((cur) => [...cur, { id, role: "user", content }]);
    wsRef.current.send(JSON.stringify({
      type: "message.send", id, session_id: sessionId, payload: { content },
    }));
    setText("");
  }

  if (configured === null) return null;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 2, flexShrink: 0 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Agente</Typography>
        {configured && (
          <>
            <Chip size="small" label={connected ? "conectado" : "reconectando…"}
              color={connected ? "success" : "warning"} />
            <Tooltip title="Nova conversa">
              <IconButton size="small" onClick={newSession}>
                <AddCommentIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>

      {!configured ? (
        <Alert severity="info">
          Nenhum agente configurado. Defina <code>PICOCLAW_URL</code> e <code>PICOCLAW_TOKEN</code> para
          habilitar essa aba (integração com um agente PicoClaw rodando em outro container).
        </Alert>
      ) : (
        <>
        <Accordion sx={{ flexShrink: 0, mb: 1.5 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">
              Reproduzir resposta em voz: {
                playbackTarget === "off" ? "desativado"
                : playbackTarget === "browser" ? "navegador"
                : "alto-falante"
              }
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ maxHeight: 340, overflowY: "auto" }}>
            <Stack spacing={1.5}>
              <FormControl size="small" sx={{ maxWidth: 240 }}>
                <InputLabel>Reproduzir resposta em</InputLabel>
                <Select label="Reproduzir resposta em" value={playbackTarget}
                  onChange={(e) => setPlaybackTarget(e.target.value)}>
                  <MenuItem value="off">Não reproduzir</MenuItem>
                  <MenuItem value="browser">Navegador</MenuItem>
                  <MenuItem value="speaker">Alto-falante</MenuItem>
                </Select>
              </FormControl>

              {playbackTarget !== "off" && (
                <>
                  <VoiceEngineFields ve={ve} />
                  {playbackTarget === "speaker" && (
                    <FormControl size="small" sx={{ minWidth: 180, maxWidth: 260 }}>
                      <InputLabel>Alto-falante</InputLabel>
                      <Select label="Alto-falante" value={ttsDevice} onChange={(e) => setTtsDevice(e.target.value)}>
                        {classic.filter((c) => c.connected).map((c) => (
                          <MenuItem key={c.address} value={c.address}>{c.name}</MenuItem>
                        ))}
                        {!classic.filter((c) => c.connected).length && (
                          <MenuItem value="" disabled>Nenhum conectado</MenuItem>
                        )}
                      </Select>
                    </FormControl>
                  )}
                </>
              )}
            </Stack>
          </AccordionDetails>
        </Accordion>
        <Card sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <CardContent sx={{
            flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
            "&:last-child": { pb: 2 },
          }}>
            {error && <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setError(null)}>{error}</Alert>}

            <Box ref={listRef} sx={{
              flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column",
              gap: 1.5, p: 0.5, mb: 2,
            }}>
              {messages.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ m: "auto" }}>
                  Diga algo pro agente…
                </Typography>
              )}
              {messages.map((m) => (
                <Stack key={m.id} direction="row" spacing={1} sx={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "80%", alignItems: "flex-end",
                }}>
                  {m.role === "agent" && (
                    <Avatar sx={{ width: 28, height: 28 }}><SmartToyIcon fontSize="small" /></Avatar>
                  )}
                  <Card variant="outlined" sx={{
                    bgcolor: m.role === "user" ? "primary.main" : undefined,
                    color: m.role === "user" ? "primary.contrastText" : undefined,
                  }}>
                    <CardContent sx={{ py: 1, px: 1.5, "&:last-child": { pb: 1 } }}>
                      <MessageContent content={m.content} />
                      {audioState[m.id] && <AudioIndicator state={audioState[m.id]} />}
                    </CardContent>
                  </Card>
                  {m.role === "user" && (
                    <Avatar sx={{ width: 28, height: 28 }}><PersonIcon fontSize="small" /></Avatar>
                  )}
                </Stack>
              ))}
              {typing && <TypingBubble />}
            </Box>

            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Tooltip title={autoSend
                ? "Envio automático ativado — usa o ditado do teclado; envia quando parar de digitar/falar (experimental)"
                : "Ativar envio automático (experimental) — pra usar com o ditado do teclado do celular"}>
                <IconButton color={autoSend ? "primary" : "default"} onClick={() => setAutoSend((v) => !v)}>
                  <AutoAwesomeIcon />
                </IconButton>
              </Tooltip>
              <TextField fullWidth size="small" placeholder="Escreva uma mensagem…" value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <IconButton color="primary" onClick={send} disabled={!connected || !text.trim()}>
                <SendIcon />
              </IconButton>
            </Stack>
            <audio ref={audioRef} style={{ display: "none" }}
              onEnded={() => {
                if (currentPlayingMsgIdRef.current) clearAudioState(currentPlayingMsgIdRef.current);
                currentPlayingMsgIdRef.current = null;
              }}
              onPause={() => {
                if (currentPlayingMsgIdRef.current) clearAudioState(currentPlayingMsgIdRef.current);
                currentPlayingMsgIdRef.current = null;
              }} />
          </CardContent>
        </Card>
        </>
      )}
    </Box>
  );
}
