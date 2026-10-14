import { it, expect } from 'vitest';
import { consumeSSE } from './sse';
const encode = text => new TextEncoder().encode(text);
function response(parts) {
  return new Response(new ReadableStream({ start(c) { parts.forEach(p => c.enqueue(p)); c.close(); } }));
}
it('decodes byte-fragmented Unicode, CRLF, comments and multiline data', async () => {
  const bytes = encode(': comment\r\nevent: token\r\ndata: {"text":"नमस्ते 🌱"}\r\n\r\nevent: sources\ndata: {"sources":[],\ndata: "provisional":false}\n\nevent: done\ndata: {}\n\n');
  const events = [];
  await consumeSSE(response(Array.from(bytes, b => new Uint8Array([b]))), (...event) => events.push(event));
  expect(events).toEqual([['token', { text: 'नमस्ते 🌱' }], ['sources', { sources: [], provisional: false }], ['done', {}]]);
});
it('works at every split boundary', async () => {
  const bytes = encode('event: token\ndata: {"text":"hello"}\n\nevent: done\ndata: {}\n\n');
  for (let i = 1; i < bytes.length; i++) {
    const events = [];
    await consumeSSE(response([bytes.slice(0, i), bytes.slice(i)]), type => events.push(type));
    expect(events).toEqual(['token', 'done']);
  }
});
it('never accepts done after error', async () => {
  const events = [];
  expect(await consumeSSE(response([encode('event: error\ndata: {}\n\nevent: done\ndata: {}\n\n')]), type => events.push(type))).toBe('error');
  expect(events).toEqual(['error']);
});
it('rejects premature EOF and incomplete frames', async () => {
  const events = [];
  await expect(consumeSSE(response([encode('event: token\ndata: {}')]), type => events.push(type))).rejects.toThrow('interrupted');
  expect(events).toEqual([]);
});
it('rejects malformed JSON', async () => {
  await expect(consumeSSE(response([encode('event: token\ndata: invalid\n\n')]), () => {})).rejects.toThrow('invalid');
});
it('cancels pending reads with AbortController', async () => {
  const controller = new AbortController(); let cancelled = false;
  const pending = consumeSSE(new Response(new ReadableStream({ cancel() { cancelled = true; } })), () => {}, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toBe(true);
});
