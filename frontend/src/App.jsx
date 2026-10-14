import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, ArrowUpRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { json, post, workspacePath } from './api';
import Documents from './Documents';
import Chat from './Chat';

export function ErrorNotice({ message, retry }) {
  if (!message) return null;
  return <div role="alert" className="error-notice"><span>{message}</span>{retry && <button onClick={retry}>Retry</button>}</div>;
}

export default function App() {
  const [workspaces, setWorkspaces] = useState([]);
  const [wid, setWid] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const creationLock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    json('/api/workspaces', { signal: controller.signal }).then(items => {
      if (controller.signal.aborted) return;
      setWorkspaces(items);
      setWid(current => items.some(w => w.id === current) ? current : items[0]?.id || '');
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  async function create(event) {
    event.preventDefault();
    if (!name.trim() || creationLock.current || loading) return;
    creationLock.current = true; setCreating(true); setError('');
    try {
      const workspace = await json('/api/workspaces', post({ name: name.trim() }));
      setWorkspaces(items => [...items, workspace]); setWid(workspace.id); setName(''); setShowCreate(false);
    } catch (e) { setError(e.message); }
    finally { creationLock.current = false; setCreating(false); }
  }
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#main"><span className="brand-icon"><BookOpen size={23}/></span>margin<span className="brand-dot">.</span></a>
      <span className="topbar-caption">YOUR DOCUMENTS. A CLEARER PICTURE.</span>
      <span className="local-badge"><span/> Personal workspace</span>
    </header>
    <div className="workspace-bar">
      <div className="workspace-select"><label htmlFor="workspace">Workspace</label><select id="workspace" value={wid} onChange={e => setWid(e.target.value)} disabled={loading || creating}>
        {!workspaces.length && <option value="">{loading ? 'Loading workspaces…' : 'Create your first workspace'}</option>}
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select></div>
      <button className="button secondary" onClick={() => setShowCreate(v => !v)} aria-expanded={showCreate}><Plus size={16}/> New workspace</button>
      {showCreate && <form onSubmit={create} className="workspace-form"><label className="sr-only" htmlFor="workspace-name">Workspace name</label><input autoFocus id="workspace-name" placeholder="e.g. Product research" value={name} maxLength={100} onChange={e => setName(e.target.value)}/><button className="button primary" disabled={creating || !name.trim()}>{creating ? 'Creating…' : 'Create'}</button></form>}
    </div>
    <ErrorNotice message={error} retry={() => setRefresh(v => v + 1)}/>
    {wid ? <Workspace key={wid} wid={wid} name={workspaces.find(w => w.id === wid)?.name}/> : <main id="main" className="welcome"><span className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span><h1>Your next answer starts<br/>with your documents.</h1><p>Create a workspace, add your files, and explore what they have to say—with sources you can follow.</p><button className="button primary" onClick={() => setShowCreate(true)} disabled={loading}>Create a workspace <ArrowUpRight size={18}/></button></main>}
  </div>;
}

function Workspace({ wid, name }) {
  const [conversations, setConversations] = useState([]);
  const [cid, setCid] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [documents, setDocuments] = useState([]);
  const [sidebar, setSidebar] = useState(true);
  const alive = useRef(true);
  const createLock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    json(`${workspacePath(wid)}/conversations`, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setConversations(items);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [wid, refresh]);
  async function createConversation() {
    if (createLock.current || loading) return;
    createLock.current = true; setCreating(true); setError('');
    try {
      const conversation = await json(`${workspacePath(wid)}/conversations`, post({}));
      if (alive.current) { setConversations(items => [conversation, ...items]); setCid(conversation.id); }
    } catch (e) { if (alive.current) setError(e.message); }
    finally { createLock.current = false; if (alive.current) setCreating(false); }
  }
  return <div className={`workspace-layout ${sidebar ? '' : 'sidebar-hidden'}`}>
    <aside className="sidebar" aria-label="Workspace library" hidden={!sidebar}>
      <Documents wid={wid} onChange={setDocuments}/>
      <section className="conversation-section"><div className="section-heading"><h2>Conversations</h2><button aria-label="New conversation" className="icon-button" onClick={createConversation} disabled={creating}><Plus size={18}/></button></div>
        <ErrorNotice message={error} retry={() => setRefresh(v => v + 1)}/>
        {loading && <p className="muted small" role="status">Loading conversations…</p>}
        {!loading && !conversations.length && <p className="muted small">A fresh conversation, a new perspective.</p>}
        <nav aria-label="Conversations">{conversations.map(c => <button key={c.id} className={`conversation-button ${cid === c.id ? 'selected' : ''}`} onClick={() => setCid(c.id)} aria-current={cid === c.id ? 'page' : undefined}><BookOpen size={15}/><span>Chat · {c.id.slice(0, 8)}</span><ArrowUpRight size={14}/></button>)}</nav>
      </section>
      <div className="sidebar-note"><span className="status-dot"/> Files stay organized by workspace.<br/>Answers stay connected to their sources.</div>
    </aside>
    <main id="main" className="main-panel">
      <div className="chat-header"><div className="flex items-center gap-3"><button className="icon-button" aria-label={sidebar ? 'Hide library' : 'Show library'} aria-expanded={sidebar} onClick={() => setSidebar(v => !v)}>{sidebar ? <PanelLeftClose size={19}/> : <PanelLeftOpen size={19}/>}</button><div><h1>{name}</h1><p>Chat with your documents</p></div></div><button className="button secondary" disabled={creating} onClick={createConversation}><Plus size={16}/>{creating ? 'Creating…' : 'New chat'}</button></div>
      {cid ? <Chat key={cid} wid={wid} cid={cid} documents={documents}/> : <div className="chat-empty"><div className="empty-symbol"><BookOpen size={34}/></div><span className="eyebrow">FROM INFORMATION TO UNDERSTANDING</span><h2>There’s more in your documents.<br/>Let’s find it.</h2><p>Ask a question, connect the details, or get the big picture.<br/>Every answer comes back to your sources.</p><div className="suggestions"><div><span>01</span><strong>Add your documents</strong><p>PDFs, Word documents, and text files.</p></div><div><span>02</span><strong>Start a conversation</strong><p>Explore your files in your own words.</p></div></div><button className="button primary" onClick={createConversation} disabled={creating || loading}>Start a conversation <ArrowUpRight size={18}/></button></div>}
    </main>
  </div>;
}
