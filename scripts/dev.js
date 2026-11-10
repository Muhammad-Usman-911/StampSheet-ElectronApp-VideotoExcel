// Development: Vite dev server with hot reload + Electron pointing at it.
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const bin = (n) => path.join(root, 'node_modules', '.bin', n);
const vite = spawn(bin('vite'), [], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
let started = false;
vite.stdout.on('data', (d) => {
  process.stdout.write(d);
  if (!started && /Local:/.test(String(d))) {
    started = true;
    const el = spawn(bin('electron'), ['.', '--no-sandbox'], { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: 'http://localhost:5173' } });
    el.on('exit', () => { vite.kill(); process.exit(0); });
  }
});
