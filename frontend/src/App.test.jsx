import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it, expect, vi } from 'vitest';
import App from './App';
import Chat, { SafeMarkdown } from './Chat';
import Documents from './Documents';

const wid = 'workspace-one', cid = 'conversation-one';
const doc = { id: 'doc-one', workspace_id: wid, filename: 'Research.pdf', status: 'ready', error: null };
const source = { source_id: 'S1', document_id: doc.id, workspace_id: wid, chunk_id: 'chunk-one', filename: doc.filename, location: { page: 2 }, excerpt: 'Apples grow on trees.' };
const result = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify({ conversation_id: cid, message_id: 'answer-one', ...data })}\n\n`;
function stream(text, close = true) {
  return new Response(new ReadableStream({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); if (close) controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

it('creates and selects workspaces, and opens server conversation history', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.endsWith('/workspaces')) return options.method === 'POST' ? result({ id: 'new-workspace', name: 'New research' }, 201) : result([{ id: wid, name: 'Research' }]);
    if (url.endsWith('/documents')) return result([]);
    if (url.endsWith('/conversations')) return result([{ id: cid, workspace_id: wid }]);
    if (url.endsWith('/messages')) return result([{ id: 'message', role: 'user', content: 'An earlier question', status: 'complete', sources: [] }]);
    throw new Error(`Unexpected URL ${url}`);
  }));
  render(<App/>);
  await user.click(await screen.findByRole('button', { name: /Chat · conversa/ }));
  expect(await screen.findByText('An earlier question')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'New workspace' }));
  await user.type(screen.getByLabelText('Workspace name'), 'New research');
  await user.click(screen.getByRole('button', { name: 'Create', exact: true }));
  await waitFor(() => expect(screen.getByLabelText('Workspace')).toHaveValue('new-workspace'));
  expect(screen.queryByText('An earlier question')).not.toBeInTheDocument();
});

it('uploads FormData, displays processing errors, refreshes status, and deletes', async () => {
  const user = userEvent.setup(); let docs = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (options.method === 'POST') {
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.getAll('files').map(f => f.name)).toEqual(['Research.pdf', 'bad.txt']);
      docs = [{ ...doc, status: 'processing' }, { ...doc, id: 'bad', filename: 'bad.txt', status: 'failed', error: 'No extractable text' }];
      return result(docs.map(d => ({ filename: d.filename, document: d, duplicate: false, error: null })), 202);
    }
    if (options.method === 'DELETE') { docs = docs.filter(d => !url.endsWith(d.id)); return result(null, 204); }
    return result(docs);
  }));
  render(<Documents wid={wid} onChange={() => {}}/>);
  await screen.findByText(/Your library is a blank page/);
  await user.upload(screen.getByLabelText('Upload documents'), [new File(['pdf'], 'Research.pdf', { type: 'application/pdf' }), new File([' '], 'bad.txt', { type: 'text/plain' })]);
  expect(await screen.findByText('processing')).toBeInTheDocument();
  expect(await screen.findByText('No extractable text')).toBeInTheDocument();
  docs = [doc];
  await user.click(screen.getByRole('button', { name: 'Refresh documents' }));
  expect(await screen.findByText('ready')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete Research.pdf' }));
  await user.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText(/Your library is a blank page/)).toBeInTheDocument();
});

it('streams an answer, displays final citations and loads source detail', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.endsWith('/messages')) return result([]);
    if (url.endsWith('/sources/chunk-one')) return result({ ...source, text: 'Full original source text.' });
    if (url.endsWith('/chat/stream')) {
      expect(JSON.parse(options.body)).toEqual({ question: 'Where do apples grow?', conversation_id: cid });
      return stream(frame('sources', { sources: [source], provisional: true }) + frame('token', { text: 'On trees. [S1]' }) + frame('sources', { sources: [source], provisional: false }) + frame('done', { status: 'complete' }));
    }
    throw new Error('Unexpected request');
  }));
  render(<Chat wid={wid} cid={cid} documents={[doc]}/>);
  await screen.findByText('What would you like to discover?');
  await user.type(screen.getByLabelText('Ask your documents'), 'Where do apples grow?');
  await user.click(screen.getByRole('button', { name: 'Send question' }));
  expect(await screen.findByText('On trees. [S1]')).toBeInTheDocument();
  expect(await screen.findByText('complete')).toBeInTheDocument();
  expect(screen.getByText('Referenced sources')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /S1 Page 2 Research.pdf/ }));
  expect(await screen.findByText('Full original source text.')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText('Page 2')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close source details' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('stops generation and prevents duplicate submissions', async () => {
  const user = userEvent.setup(); let sends = 0, signal;
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.endsWith('/messages')) return result([]);
    sends++; signal = options.signal; return stream(frame('token', { text: 'Partial answer' }), false);
  }));
  render(<Chat wid={wid} cid={cid} documents={[doc]}/>);
  await screen.findByText('What would you like to discover?');
  const input = screen.getByLabelText('Ask your documents');
  await user.type(input, 'Explain');
  fireEvent.submit(input.closest('form')); fireEvent.submit(input.closest('form'));
  await screen.findByText('Partial answer');
  await user.click(screen.getByRole('button', { name: 'Stop generation' }));
  expect(await screen.findByText('interrupted')).toBeInTheDocument();
  expect(signal.aborted).toBe(true); expect(sends).toBe(1);
});

it('aborts the old stream when switching conversation', async () => {
  const user = userEvent.setup(); let signal;
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (url.endsWith('/messages')) return result([]);
    signal = options.signal; return stream(frame('token', { text: 'Old workspace' }), false);
  }));
  const { rerender } = render(<Chat key="old" wid={wid} cid={cid} documents={[doc]}/>);
  await screen.findByText('What would you like to discover?');
  await user.type(screen.getByLabelText('Ask your documents'), 'Explain{Enter}');
  await screen.findByText('Old workspace');
  rerender(<Chat key="new" wid="new-workspace" cid="new-chat" documents={[]}/>);
  expect(signal.aborted).toBe(true);
  await screen.findByText('What would you like to discover?');
  expect(screen.queryByText('Old workspace')).not.toBeInTheDocument();
});

it('shows generation failure without completion or validated sources', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async url => url.endsWith('/messages') ? result([]) : stream(frame('token', { text: 'Unverified claim' }) + frame('error', { message: 'Invalid citations' }))));
  render(<Chat wid={wid} cid={cid} documents={[doc]}/>);
  await screen.findByText('What would you like to discover?');
  await user.type(screen.getByLabelText('Ask your documents'), 'Explain{Enter}');
  expect(await screen.findByText('Invalid citations')).toBeInTheDocument();
  expect(screen.getByText('failed')).toBeInTheDocument();
  expect(screen.queryByText('Referenced sources')).not.toBeInTheDocument();
});

it('does not execute raw HTML, unsafe links or remote Markdown images', () => {
  const { container } = render(<SafeMarkdown>{'<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n![tracker](https://tracking.example/pixel.png)'}</SafeMarkdown>);
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('a')).not.toHaveAttribute('href', 'javascript:alert(1)');
});

it('handles drag-and-drop per-file errors and upload retry', async () => {
  const user = userEvent.setup(); let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    if (options.method !== 'POST') return result([]);
    attempts++;
    expect(options.body.getAll('files').map(f => f.name)).toEqual(['Research.pdf']);
    return attempts === 1 ? result([{ filename: 'Research.pdf', error: 'Temporary storage failure', document: null }], 202)
      : result([{ filename: 'Research.pdf', error: null, document: doc, duplicate: true }], 202);
  }));
  render(<Documents wid={wid} onChange={() => {}}/>);
  await screen.findByText(/Your library is a blank page/);
  fireEvent.drop(screen.getByText('Make room for your ideas').closest('.drop-zone'), { dataTransfer: { files: [new File(['pdf'], 'Research.pdf'), new File(['invalid'], 'bad.exe')] } });
  expect(await screen.findByText(/Temporary storage failure/)).toBeInTheDocument();
  expect(screen.getByText(/Choose a PDF, DOCX or TXT/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry failed uploads' }));
  expect(await screen.findByText(/Already uploaded/)).toBeInTheDocument();
  expect(attempts).toBe(2);
});
