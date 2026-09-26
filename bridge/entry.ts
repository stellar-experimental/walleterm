import { createBridge } from './server.ts';
import { runService } from './launch.ts';
const config = JSON.parse(process.argv[2]);
await runService({ ...config, label: 'Walleterm tunnel' }, { create: createBridge });
