// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';

export function terminalFixture(argv, env, exchanges) {
  const driver = `import os,pty,sys,json,time,select,signal
steps=json.loads(sys.argv[-1]);program=sys.argv[1:-1]
pid,fd=pty.fork()
if pid==0: os.execvpe(program[0],program,os.environ)
output=b'';deadline=time.monotonic()+40
def read_until(needle,start):
 global output
 while needle not in output[start:]:
  if time.monotonic()>deadline: raise TimeoutError('terminal did not respond')
  if select.select([fd],[],[],.1)[0]: output+=os.read(fd,65536)
try:
 read_until(b'you> ',0)
 for step in steps:
  start=len(output);os.write(fd,step['input'].encode())
  if step.get('until'): read_until(step['until'].encode(),start)
 while True:
  if time.monotonic()>deadline: raise TimeoutError('terminal did not exit')
  if select.select([fd],[],[],.1)[0]:
   try:
    data=os.read(fd,65536)
    if not data: break
    output+=data
   except OSError: break
 _,status=os.waitpid(pid,0)
 sys.stdout.buffer.write(output);sys.exit(os.waitstatus_to_exitcode(status))
except Exception:
 os.kill(pid,signal.SIGKILL);os.waitpid(pid,0);sys.stdout.buffer.write(output);raise
finally: os.close(fd)`;
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/python3', ['-c', driver, ...argv, JSON.stringify(exchanges)],
      { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject);
    child.once('close', status => resolve({ status, stdout, stderr }));
  });
}
