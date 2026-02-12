#!/usr/bin/env node

import { createServer } from './create-server.js';

createServer().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
