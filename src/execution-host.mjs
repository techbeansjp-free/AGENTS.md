import os from 'node:os';

/** Platform identity is not an isolation proof. WSL needs a separate acceptance. */
export function executionHost({platform=process.platform,release=os.release(),env=process.env}={}) {
  const wsl=platform==='linux' && (/microsoft|wsl/i.test(release)||Boolean(env.WSL_INTEROP||env.WSL_DISTRO_NAME));
  const kind=wsl?(/microsoft-standard|wsl2/i.test(release)?'wsl2':'wsl-unverified'):
    platform==='linux'?'linux':platform==='darwin'?'macos':platform==='win32'?'windows-native':'unsupported';
  return {kind,release,executionEligible:kind==='linux',
    reason:kind==='linux'?'Requires per-run OS isolation preflight':
      wsl?'WSL Windows filesystem, interop and host credential boundaries require real-host validation':
      'Native Agent and verification boundaries are not validated',
    releaseReady:false};
}
export function assertExecutionHost() {
  const host=executionHost();
  if(!host.executionEligible)throw Error(`Execution isolation unsupported: ${host.kind}; ${host.reason}`);
  return host;
}
