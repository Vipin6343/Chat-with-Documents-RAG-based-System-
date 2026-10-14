// Stateful SSE decoder: CRLF/LF/CR, comments, multiple data lines and UTF-8
// fragmentation are independent of network chunk boundaries.
export async function consumeSSE(response, onEvent, signal) {
  if (!response.body) throw new Error('Streaming is unavailable in this browser.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', type = 'message', lines = [], terminal = null;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  function dispatch() {
    if (!lines.length) { type = 'message'; return; }
    let data;
    try { data = JSON.parse(lines.join('\n')); }
    catch { throw new Error('The server sent an invalid streaming event.'); }
    if (!terminal && ['token', 'sources', 'done', 'error'].includes(type)) {
      if (type === 'done' || type === 'error') terminal = type;
      onEvent(type, data);
    }
    type = 'message'; lines = [];
  }
  function line(value) {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const key = colon < 0 ? value : value.slice(0, colon);
    let val = colon < 0 ? '' : value.slice(colon + 1);
    if (val.startsWith(' ')) val = val.slice(1);
    if (key === 'event') type = val;
    if (key === 'data') lines.push(val);
  }
  function drain(final = false) {
    let offset;
    while ((offset = buffer.search(/[\r\n]/)) >= 0) {
      if (!final && buffer[offset] === '\r' && offset === buffer.length - 1) break;
      const width = buffer[offset] === '\r' && buffer[offset + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, offset));
      buffer = buffer.slice(offset + width);
    }
    if (buffer.length > 2_000_000) throw new Error('Streaming event exceeded the size limit.');
  }
  try {
    while (!terminal) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (done) { buffer += decoder.decode(); drain(true); break; }
      buffer += decoder.decode(value, { stream: true }); drain();
    }
    if (!terminal) throw new Error('Connection ended before completion. The response is interrupted.');
    return terminal;
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
