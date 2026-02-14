const { spawn } = require('child_process');

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeout = 60000,
      cwd = process.cwd()
    } = options;

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        reject(new Error(`Process timed out after ${timeout}ms`));
        return;
      }

      resolve({
        exitCode: code,
        stdout,
        stderr
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

module.exports = { runProcess };
