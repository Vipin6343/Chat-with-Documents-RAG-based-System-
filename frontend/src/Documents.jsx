import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, UploadCloud, Trash2, RefreshCw } from 'lucide-react';
import { json, workspacePath } from './api';
import { ErrorNotice } from './App';

export default function Documents({ wid, onChange }) {
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [confirm, setConfirm] = useState('');
  const [retryFiles, setRetryFiles] = useState([]);
  const alive = useRef(true), busy = useRef(false), poll = useRef(null), input = useRef(null);
  const controllers = useRef(new Set());
  const base = `${workspacePath(wid)}/documents`;
  const load = useCallback(async () => {
    if (poll.current) return;
    const controller = new AbortController(); poll.current = controller;
    try {
      const items = await json(base, { signal: controller.signal });
      if (alive.current && !controller.signal.aborted) { setDocuments(items); onChange(items); setError(''); }
    } catch (e) { if (alive.current && !controller.signal.aborted) setError(e.message); }
    finally { if (poll.current === controller) poll.current = null; if (alive.current && !controller.signal.aborted) setLoading(false); }
  }, [base, onChange]);
  useEffect(() => {
    alive.current = true; load();
    const timer = setInterval(load, 2500);
    return () => { alive.current = false; clearInterval(timer); poll.current?.abort(); poll.current = null; controllers.current.forEach(c => c.abort()); };
  }, [load]);
  async function upload(files) {
    if (busy.current || !files.length) return;
    const invalid = [], valid = [];
    for (const file of files) {
      if (!/\.(pdf|docx|txt)$/i.test(file.name)) invalid.push({ filename: file.name, error: 'Choose a PDF, DOCX or TXT file.' });
      else if (file.size === 0) invalid.push({ filename: file.name, error: 'This file is empty.' });
      else valid.push(file);
    }
    setReports(invalid); setRetryFiles([]);
    if (!valid.length) return;
    busy.current = true; setUploading(true);
    const controller = new AbortController(); controllers.current.add(controller);
    const body = new FormData(); valid.forEach(file => body.append('files', file));
    try {
      const result = await json(base, { method: 'POST', body, signal: controller.signal });
      if (alive.current) {
        setReports([...invalid, ...result]);
        setRetryFiles(valid.filter((_, i) => result[i]?.error));
        await load();
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) { setReports([...invalid, ...valid.map(f => ({ filename: f.name, error: e.message }))]); setRetryFiles(valid); }
    } finally { controllers.current.delete(controller); busy.current = false; if (alive.current) setUploading(false); }
  }
  async function remove(id) {
    if (deleting) return;
    setDeleting(id); setError('');
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      await json(`${base}/${id}`, { method: 'DELETE', signal: controller.signal });
      if (alive.current) { setConfirm(''); await load(); }
    } catch (e) { if (alive.current && !controller.signal.aborted) setError(e.message); }
    finally { controllers.current.delete(controller); if (alive.current) setDeleting(''); }
  }
  return <section className="documents-section"><div className="section-heading"><h2>Document library <span>{documents.length}</span></h2><button className="icon-button" aria-label="Refresh documents" onClick={load}><RefreshCw size={15}/></button></div>
    <div className={`drop-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files)); }}>
      <UploadCloud size={25}/><strong>{uploading ? 'Uploading documents…' : 'Make room for your ideas'}</strong><span>Drop files here or choose from your device</span>
      <button className="button upload-button" onClick={() => input.current.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Choose files'}</button><small>PDF, DOCX, TXT · multiple files welcome</small>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Upload documents" accept=".pdf,.docx,.txt" multiple disabled={uploading} onChange={e => { upload(Array.from(e.target.files)); e.target.value = ''; }}/>
    </div>
    {!!reports.length && <div className="upload-reports" aria-live="polite">{reports.map((r, i) => <p key={i} className={r.error ? 'text-red-700' : ''}><strong>{r.filename}</strong>: {r.error || (r.duplicate ? `Already uploaded (${r.document?.status}).` : 'Accepted for processing.')}</p>)}{retryFiles.length > 0 && <button className="text-button" disabled={uploading} onClick={() => upload(retryFiles)}>Retry failed uploads</button>}</div>}
    <ErrorNotice message={error} retry={load}/>
    {loading && <p role="status" className="muted small">Loading documents…</p>}
    {!loading && !documents.length && <p className="empty-library">Your library is a blank page.<br/>Add a document to get started.</p>}
    <ul className="document-list">{documents.map(doc => <li key={doc.id} className="document-card"><div className="document-row"><span className={`file-icon ${doc.filename.toLowerCase().endsWith('.pdf') ? 'pdf' : ''}`}><FileText size={18}/></span><div className="min-w-0 flex-1"><p className="filename" title={doc.filename}>{doc.filename}</p><span className={`status status-${doc.status}`}><span/>{doc.status}</span></div><button className="icon-button delete-button" aria-label={`Delete ${doc.filename}`} onClick={() => setConfirm(doc.id)} disabled={!!deleting}><Trash2 size={15}/></button></div>
      {doc.error && <p className="document-error">{doc.error}</p>}
      {doc.status === 'failed' && <p className="small muted">To retry processing, delete this entry and choose the file again.</p>}
      {confirm === doc.id && <div className="delete-confirm"><p>Delete this file and its searchable text?</p><button className="text-button danger" disabled={!!deleting} onClick={() => remove(doc.id)}>{deleting ? 'Deleting…' : 'Confirm delete'}</button><button className="text-button" onClick={() => setConfirm('')} disabled={!!deleting}>Cancel</button></div>}
    </li>)}</ul>
  </section>;
}
