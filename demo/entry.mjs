import { createDemoSite } from './server.mjs';
import { runService } from '../bridge/launch.mjs';
const config = JSON.parse(process.argv[2]);
await runService({ ...config, label: 'Walleterm demo' }, { create: createDemoSite });
