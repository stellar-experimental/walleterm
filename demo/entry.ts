import { createDemoSite } from './server.ts';
import { runService } from '../bridge/launch.ts';
const config = JSON.parse(process.argv[2]);
await runService({ ...config, label: 'Walleterm demo' }, { create: createDemoSite });
