import os from 'node:os';

/** OS identity is diagnostic only, never an execution permission or acceptance claim. */
export function executionHost({platform=process.platform,release=os.release(),env=process.env}={}) {
  const wsl=platform==='linux' && (/microsoft|wsl/i.test(release)||Boolean(env.WSL_INTEROP||env.WSL_DISTRO_NAME));
  const kind=wsl?(/microsoft-standard|wsl2/i.test(release)?'wsl2':'wsl-unverified'):
    platform==='linux'?'linux':platform==='darwin'?'macos':platform==='win32'?'windows-native':'unsupported';
  return {kind,release,executionEligible:true,
    reason:'OS identity is informational; execution requires a configured Host or available sandbox backend',
    releaseReady:false};
}
export function assertExecutionHost() {
  const host=executionHost();

  return host;
}
