export const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function request(path, options = {}) {
  let response;
  try { response = await fetch(`${API_URL}${path}`, options); }
  catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the backend. Check that it is running and allows this frontend origin.');
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail)
        ? body.detail.map(item => item.msg).join('; ') : message;
    } catch { /* Keep HTTP status when response isn't JSON. */ }
    throw new Error(message);
  }
  return response;
}

export async function json(path, options = {}) {
  const response = await request(path, options);
  return response.status === 204 ? null : response.json();
}
export const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export const workspacePath = id => `/api/workspaces/${encodeURIComponent(id)}`;
