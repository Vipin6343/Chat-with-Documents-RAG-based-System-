import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Square, Sparkles, ArrowUpRight, X, FileText } from 'lucide-react';
import { json, request, post, workspacePath } from './api';
import { consumeSSE } from './sse';
import { ErrorNotice } from './App';

export function locationLabel(location = {}) {
  if (location.page) return `Page ${location.page}`;
  if (location.paragraph) return `Paragraph ${location.paragraph}`;
  if (location.table) return `Table ${location.table}, row ${location.row}`;
  return 'Document excerpt';
}

export function SafeMarkdown({ children }) {
  return <Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
    img: ({ alt }) => <span className="muted">[Image: {alt || 'omitted'}]</span>,
  }}>{children}</Markdown>;
}

export default function Chat({ wid, cid, documents }) {
  const [messages, setMessages] = useState([]), [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [source, setSource] = useState(null);
  const alive = useRef(true), controller = useRef(null), history = useRef(null);
  const scroll = useRef(null), stick = useRef(true), textarea = useRef(null);
  const base = workspacePath(wid);
  const load = useCallback(async (quiet = false) => {
    history.current?.abort();
    const abort = new AbortController(); history.current = abort;
    if (!quiet) setLoading(true);
    try {
      const items = await json(`${base}/conversations/${cid}/messages`, { signal: abort.signal });
      if (alive.current && !abort.signal.aborted) { setMessages(items); setError(''); }
    } catch (e) { if (alive.current && !abort.signal.aborted) setError(e.message); }
    finally { if (alive.current && !abort.signal.aborted) setLoading(false); }
  }, [base, cid]);
  useEffect(() => {
    alive.current = true; load();
    return () => { alive.current = false; controller.current?.abort(); history.current?.abort(); };
  }, [load]);
  const pending = messages.some(m => m.status === 'streaming');
  useEffect(() => {
    if (busy || !pending) return;
    const timer = setInterval(() => load(true), 2000);
    return () => clearInterval(timer);
  }, [busy, pending, load]);
  useEffect(() => {
    if (stick.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  async function send(event) {
    event?.preventDefault();
    const text = question.trim();
    if (!text || controller.current || loading || pending) return;
    const abort = new AbortController(); controller.current = abort;
    history.current?.abort();
    setBusy(true); setError(''); setQuestion(''); stick.current = true;
    const localId = crypto.randomUUID();
    const user = { id: crypto.randomUUID(), role: 'user', content: text, status: 'complete', sources: [] };
    setMessages(items => [...items, user, { id: localId, role: 'assistant', content: '', sources: [], status: 'streaming', provisional: true }]);
    const update = transform => {
      if (alive.current && controller.current === abort) setMessages(items => items.map(m => m.localId === localId || m.id === localId ? transform(m) : m));
    };
    let terminal = false;
    try {
      const response = await request(`${base}/chat/stream`, { ...post({ question: text, conversation_id: cid }), signal: abort.signal });
      await consumeSSE(response, (type, data) => {
        if (!alive.current || abort.signal.aborted || controller.current !== abort) return;
        if (data.conversation_id !== cid) throw new Error('The server returned a different conversation.');
        update(m => {
          const next = { ...m, localId, id: data.message_id || m.id };
          if (type === 'token') next.content += data.text || '';
          if (type === 'sources') { next.sources = data.sources || []; next.provisional = data.provisional; }
          if (type === 'done') { next.status = 'complete'; next.provisional = false; }
          if (type === 'error') { next.status = 'failed'; next.error = data.message || 'Generation failed.'; next.sources = []; }
          return next;
        });
        if (type === 'done' || type === 'error') terminal = true;
      }, abort.signal);
    } catch (e) {
      if (!terminal) update(m => ({ ...m, status: abort.signal.aborted || e.message.includes('interrupted') ? 'interrupted' : 'failed',
        error: abort.signal.aborted ? 'Generation stopped. This answer is incomplete.' : e.message, sources: [] }));
    } finally {
      if (controller.current === abort) controller.current = null;
      if (alive.current) { setBusy(false); textarea.current?.focus(); }
    }
  }
  const ready = documents.filter(d => d.status === 'ready').length;
  return <div className="chat-body">
    <div className="messages" ref={scroll} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
      <ErrorNotice message={error} retry={() => load()}/>
      {loading && <div className="history-loading" role="status">Opening your conversation…</div>}
      {!loading && !messages.length && <div className="conversation-empty"><span className="eyebrow">A NEW CONVERSATION</span><h2>What would you like to discover?</h2><p>{ready ? `${ready} document${ready === 1 ? '' : 's'} ready to explore.` : 'Upload a document and wait until it is ready, or ask a question to get started.'}</p><div className="prompt-chips">{['Summarize the key ideas in these documents.', 'What are the most important takeaways?', 'Explain the main concepts in simple terms.'].map(prompt => <button key={prompt} onClick={() => { setQuestion(prompt); textarea.current?.focus(); }}>{prompt}<ArrowUpRight size={15}/></button>)}</div></div>}
      {messages.map((message, index) => <article key={message.localId || message.id} className={`message message-${message.role}`} aria-label={`${message.role} message`}>
        <div className="message-avatar">{message.role === 'assistant' ? <Sparkles size={18}/> : 'You'}</div>
        <div className="message-content"><div className="message-byline"><strong>{message.role === 'assistant' ? 'Margin' : 'You'}</strong>{message.role === 'assistant' && <span className={`message-state state-${message.status}`}>{message.status === 'streaming' ? 'Generating · provisional' : message.status}</span>}</div>
          <div className="markdown">{message.content ? <SafeMarkdown>{message.content}</SafeMarkdown> : message.status === 'streaming' ? <span role="status" className="thinking">Finding the right words<span>…</span></span> : <p>No answer was returned.</p>}</div>
          {message.error && <p className="response-error" role="alert">{message.error}</p>}
          {message.status === 'failed' || message.status === 'interrupted' ? <button className="text-button" disabled={busy || pending} onClick={() => { setQuestion(messages.slice(0, index).findLast(m => m.role === 'user')?.content || ''); textarea.current?.focus(); }}>Use question again</button> : null}
          {!!message.sources?.length && <div className="sources"><p className="sources-label">{message.provisional || message.status === 'streaming' ? 'Retrieved sources · awaiting validation' : 'Referenced sources'}</p><div className="source-cards">{message.sources.map(s => <button key={s.source_id} className="source-card" onClick={() => setSource(s)} disabled={!documents.some(d => d.id === s.document_id)} title="Read the full source"><span className="source-top"><span className="source-id">{s.source_id}</span><span>{locationLabel(s.location)}</span><ArrowUpRight size={14}/></span><strong>{s.filename}</strong><p>{s.excerpt}</p>{!documents.some(d => d.id === s.document_id) && <small>Document unavailable</small>}</button>)}</div></div>}
        </div>
      </article>)}
    </div>
    <div className="composer-wrap"><form className="composer" onSubmit={send}><label htmlFor="question" className="sr-only">Ask your documents</label><textarea ref={textarea} id="question" placeholder="Ask anything about your documents…" value={question} onChange={e => setQuestion(e.target.value)} maxLength={4000} rows={2} disabled={loading} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><div className="composer-bottom"><span><span className="status-dot"/>{ready} ready document{ready === 1 ? '' : 's'}<span className="keyboard-hint"> · Enter to send</span></span>{busy ? <button type="button" className="button stop-button" onClick={() => controller.current?.abort()}><Square size={14}/> Stop generation</button> : <button className="send-button" aria-label="Send question" disabled={!question.trim() || loading || pending}><ArrowUp size={20}/></button>}</div></form><p className="composer-note">Grounded in your documents. Review the sources for important details.</p><span className="sr-only" role="status">{busy ? 'Generating response' : pending ? 'A response is still running on the server' : 'Ready for a question'}</span></div>
    {source && <SourcePanel key={source.chunk_id} wid={wid} source={source} onClose={() => setSource(null)}/>}
  </div>;
}

function SourcePanel({ wid, source, onClose }) {
  const [detail, setDetail] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const dialog = useRef(null);
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setError('');
    json(`${workspacePath(wid)}/sources/${source.chunk_id}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [wid, source.chunk_id, retry]);
  return <dialog className="source-dialog" ref={dialog} onCancel={onClose} aria-labelledby="source-title"><div className="source-dialog-header"><span><FileText size={18}/> Source {source.source_id}</span><button autoFocus className="icon-button" aria-label="Close source details" onClick={onClose}><X size={20}/></button></div><h2 id="source-title">{source.filename}</h2><span className="source-location">{locationLabel(detail?.location || source.location)}</span><ErrorNotice message={error} retry={() => setRetry(n => n + 1)}/>{!detail && !error && <p role="status">Loading source text…</p>}{detail && <div className="source-full-text">{detail.text}</div>}<p className="source-footer">Original document text · source metadata supplied by the backend</p></dialog>;
}
