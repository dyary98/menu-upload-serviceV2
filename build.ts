// build.ts
import fs from 'fs-extra';
import logger from 'jet-logger';
import * as esbuild from 'esbuild';

/**
 * Start build process
 */
(async () => {
  try {
    // Remove current build
    await remove('./dist/');
    
    // Build with esbuild
    await buildWorker();
    
    logger.info('Build completed successfully');
  } catch (err) {
    logger.err(err);
    process.exit(1);
  }
})();

/**
 * Remove file
 */
function remove(loc: string): Promise<void> {
  return new Promise((res, rej) => {
    return fs.remove(loc, (err) => {
      return (!!err ? rej(err) : res());
    });
  });
}

/**
 * Build worker with esbuild
 */
async function buildWorker() {
  try {
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      outfile: 'dist/index.js',
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      sourcemap: true,
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      // Handle node built-ins that might be used
      external: [
        'fs',
        'path',
        'crypto',
        'stream',
        'buffer',
        'util'
      ]
    });
  } catch (error) {
    logger.err('Build failed:', error);
    throw error;
  }
}