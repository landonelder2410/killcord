// In production, replace the default console methods with structured JSON
// emitters so log aggregators (Datadog, Splunk, CloudWatch) can parse
// level, message, and timestamp without a custom parsing rule.
//
// Import this module as the very first import in index.ts so the patch
// is in place before any other module's initialisation code runs.

if (process.env.NODE_ENV === 'production') {
  const fmt = (args: unknown[]): string =>
    args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

  const emit = (level: string, args: unknown[], dest: NodeJS.WritableStream): void => {
    dest.write(
      JSON.stringify({ level, message: fmt(args), timestamp: new Date().toISOString() }) + '\n',
    );
  };

  console.log   = (...args) => emit('info',  args, process.stdout);
  console.info  = (...args) => emit('info',  args, process.stdout);
  console.warn  = (...args) => emit('warn',  args, process.stdout);
  console.error = (...args) => emit('error', args, process.stderr);
  console.debug = (...args) => emit('debug', args, process.stdout);
}

export {};
