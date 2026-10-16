export type RemoteResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type AutobuildInfo = {
  entryPath: string;
  outputFileName: string;
  execStart: string;
};

export type ServiceAction =
  'start' | 'stop' | 'restart' | 'status' | 'logs' | 'disable' | 'remove' | 'rm';

export type ParsedCli = {
  command: 'deploy' | 'ps' | 'init' | ServiceAction;
  flagSsh?: string;
  dryRun: boolean;
  targetServiceArg?: string;
  help?: boolean;
  version?: boolean;
};
