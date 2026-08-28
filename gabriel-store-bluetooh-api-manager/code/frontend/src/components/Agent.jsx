import { useEffect, useRef, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, IconButton, Typography, Alert,
  Chip, Avatar, Tooltip,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import AddCommentIcon from "@mui/icons-material/AddComment";
import { api } from "../api.js";

const SESSION_KEY = "agent_session_id";

function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
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
  const wsRef = useRef(null);
  const listRef = useRef(null);
  // message_ids of "kind": "tool_calls" announcements (empty content by
  // protocol design — the actual call lives in a separate payload field we
  // don't render) — tracked so their message.update follow-ups are ignored
  // too, instead of showing an empty chat bubble.
  const skippedIdsRef = useRef(new Set());

  useEffect(() => {
    api.agentStatus().then((s) => setConfigured(s.configured)).catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (!configured) return;
    let stopped = false;
    let ws;
    let retryTimer;

    function handleMessage(data) {
      if (data.type === "typing.start") setTyping(true);
      else if (data.type === "typing.stop") setTyping(false);
      else if (data.type === "message.create") {
        setTyping(false);
        const msgId = data.payload?.message_id;
        if (data.payload?.kind === "tool_calls") {
          if (msgId) skippedIdsRef.current.add(msgId);
          return;
        }
        setMessages((cur) => [...cur, {
          id: msgId || crypto.randomUUID(),
          role: "agent",
          content: data.payload?.content || "",
        }]);
      } else if (data.type === "message.update") {
        const msgId = data.payload?.message_id;
        if (msgId && skippedIdsRef.current.has(msgId)) return;
        setMessages((cur) => cur.map((m) =>
          m.id === msgId ? { ...m, content: data.payload?.content ?? m.content } : m
        ));
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
      ws?.close();
    };
  }, [configured, sessionId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, typing]);

  function newSession() {
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    setMessages([]);
    setTyping(false);
    setError(null);
    skippedIdsRef.current.clear();
    setSessionId(id);
  }

  function send() {
    const content = text.trim();
    if (!content || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const id = crypto.randomUUID();
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
              <TextField fullWidth size="small" placeholder="Escreva uma mensagem…" value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <IconButton color="primary" onClick={send} disabled={!connected || !text.trim()}>
                <SendIcon />
              </IconButton>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
