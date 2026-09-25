import { createBridge } from './server.mjs';
import { runService } from './launch.mjs';
const config = JSON.parse(process.argv[2]);
await runService({ ...config, label: 'Walleterm tunnel' }, { create: createBridge });
