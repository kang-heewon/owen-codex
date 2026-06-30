import { runSurfaceCheck, type SurfaceCheckResult } from '../surface/check.js';

const SURFACE_USAGE = [
  'Usage:',
  '  owx surface check [--json]',
  '',
  'Inspect and govern OWX public product surface.',
].join('\n');

function printHumanResult(result: SurfaceCheckResult): void {
  console.log(`Surface check ${result.status}`);
  for (const check of result.checks) {
    console.log(`- ${check.name}: ${check.status} (${check.detail})`);
  }
  if (result.issues.length === 0) return;
  console.log('Issues:');
  for (const issue of result.issues) {
    const subject = issue.command ? ` ${issue.command}` : '';
    console.log(`- ${issue.severity} ${issue.code}${subject}: ${issue.message}`);
  }
}

export async function surfaceCommand(args: string[], helpText: string, options: { packageRoot?: string } = {}): Promise<void> {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(SURFACE_USAGE);
    return;
  }

  const [subcommand, ...rest] = args;
  if (subcommand !== 'check') {
    throw new Error(`unknown surface command: ${subcommand}`);
  }

  const json = rest.includes('--json');
  const unknown = rest.filter((arg) => arg !== '--json');
  if (unknown.length > 0) {
    throw new Error(`unknown surface check option: ${unknown[0]}`);
  }

  const result = runSurfaceCheck({ helpText, packageRoot: options.packageRoot });
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    printHumanResult(result);
  }
  if (result.status !== 'passed') {
    process.exitCode = 1;
  }
}
