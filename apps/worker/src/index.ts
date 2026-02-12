import { Worker } from './worker.js';

const worker = new Worker();

process.on('SIGINT', () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());

worker.start().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
