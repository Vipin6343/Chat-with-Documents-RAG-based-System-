"""Real HTTP smoke check; uses an empty workspace and makes no model calls.

Run with: uv run --locked python scripts/smoke.py
"""
import os
import asyncio
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

import httpx


async def serve(port, stop_path):
    import uvicorn
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    server = uvicorn.Server(uvicorn.Config('app.main:app', host='127.0.0.1', port=port))
    task = asyncio.create_task(server.serve())
    while not stop_path.exists() and not task.done():
        await asyncio.sleep(0.1)
    server.should_exit = True
    await task


def main():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory() as directory:
        env = dict(os.environ, DATA_DIR=directory)
        stop_path = Path(directory) / 'stop'
        process = subprocess.Popen(
            [sys.executable, str(Path(__file__).resolve()), '--serve', str(port), str(stop_path)],
            cwd=Path(__file__).resolve().parents[1], env=env,
            stdout=subprocess.DEVNULL,
        )
        try:
            with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=2, trust_env=False) as client:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError('Server exited before becoming ready; see server logs')
                    try:
                        health = client.get('/health')
                        break
                    except (httpx.ConnectError, httpx.ConnectTimeout):
                        time.sleep(0.25)
                else:
                    raise RuntimeError('Server failed to start within 20 seconds')
                assert health.json() == {'status': 'ok'}
                response = client.post('/api/workspaces', json={'name': 'Smoke test'})
                assert response.status_code == 201
                wid = response.json()['id']
                with client.stream('POST', f'/api/workspaces/{wid}/chat/stream',
                                   json={'question': 'What is in these documents?'}) as response:
                    assert response.status_code == 200
                    lines = list(response.iter_lines())
                    assert 'event: done' in lines and 'event: error' not in lines
                    assert 'event: token' in lines and '' in lines
                print('Real HTTP smoke test passed: health, workspace creation, no-context SSE')
        finally:
            try:
                stop_path.touch()
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if os.name == 'nt':
                    # Stop only this owned process tree, including venv launchers.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    process.kill()
                process.wait(timeout=10)
            if process.stderr:
                process.stderr.close()


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--serve':
        asyncio.run(serve(int(sys.argv[2]), Path(sys.argv[3])))
    else:
        main()
