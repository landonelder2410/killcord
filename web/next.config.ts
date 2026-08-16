import type { NextConfig } from 'next';
import path from 'path';

const config: NextConfig = {
  trailingSlash: true,
  // Tell Next.js this project's own directory is the tracing root — prevents
  // the "multiple lockfiles" warning from the monorepo parent.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default config;
