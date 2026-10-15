// Parent observes a completion marker; early process.exit(0) cannot pass silently.
export const oracleArgv=code=>['/usr/bin/python3','-I','-c',`import subprocess
r=subprocess.run(['node','--input-type=module','-e',${JSON.stringify(code+";process.stdout.write('ASC_ORACLE_COMPLETED\\n');")}],capture_output=True)
assert r.returncode==0 and r.stdout==b'ASC_ORACLE_COMPLETED\\n', (r.returncode,r.stdout,r.stderr)`];
