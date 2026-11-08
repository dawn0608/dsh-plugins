#!/usr/bin/env node
// Compatibility entry for existing source checkouts; deploy the built runtime.
import { main } from '../plugins/skill-manager/lib/install-sync.js';
await main();
