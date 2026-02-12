#!/usr/bin/env node

import { joinWorker } from './join-worker.js';

joinWorker().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
