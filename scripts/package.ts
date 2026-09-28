import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFiles } from '../demo/server.ts';

// Build the command pair for this Mac: walleterm (Go) and walleterm-bridge (Bun runtime included).
const root = fileURLToPath(new URL('../', import.meta.url));
const [outArg, versionArg] = process.argv.slice(2);
if (!outArg) throw Error('Use bun scripts/package.ts <output directory> [version].');
const out = resolve(outArg);
const run = (command: string, args: string[], env = process.env) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw Error(`${command} ${args[0]} failed.`);
};
const described = spawnSync('git', ['describe', '--tags', '--always', '--dirty'], {
  cwd: root,
  encoding: 'utf8',
});
const version = versionArg || (described.status === 0 ? described.stdout.trim().replace(/^v/, '') : 'dev');
if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw Error('Use a version with letters, digits, ".", "+", or "-".');
mkdirSync(out, { recursive: true });

// Build browser files and the generated entry in a private directory. Concurrent builds cannot mix them.
const work = mkdtempSync(join(tmpdir(), 'walleterm-package-'));
try {
  const dist = join(work, 'dist');
  run(process.execPath, ['scripts/build.ts', dist]);
  // Import each demo file as an embedded asset. The bridge serves the same routes as a source checkout.
  const imports: string[] = [],
    routes: string[] = [];
  Object.entries(demoFiles(dist)).forEach(([route, [path, type]], index) => {
    imports.push(`import f${index} from ${JSON.stringify(path)} with { type: 'file' };`);
    routes.push(`  ${JSON.stringify(route)}: [f${index}, ${JSON.stringify(type)}],`);
  });
  const entry = join(work, 'bridge-main.ts');
  writeFileSync(
    entry,
    `import { main } from ${JSON.stringify(join(root, 'bridge/main.ts'))};\n${imports.join('\n')}\nawait main(process.argv.slice(2), {\n${routes.join('\n')}\n});\n`,
  );
  // Callers must not change the runtime through .env or bunfig.toml in their working directory.
  const result = await Bun.build({
    entrypoints: [entry],
    compile: { outfile: join(out, 'walleterm-bridge'), autoloadDotenv: false, autoloadBunfig: false },
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, 'The bridge build failed.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
// Give Go only what it needs. Variables such as GOFLAGS in a loaded .env cannot change the build.
const goEnvironment: NodeJS.ProcessEnv = { CGO_ENABLED: '0', GOTOOLCHAIN: 'local' };
for (const name of ['PATH', 'HOME', 'TMPDIR']) goEnvironment[name] = process.env[name];
run(
  'go',
  ['build', '-trimpath', '-ldflags', `-s -w -X main.version=${version}`, '-o', join(out, 'walleterm'), '.'],
  goEnvironment,
);
writeFileSync(join(out, 'NOTICES.txt'), notices());
console.log(`Built walleterm ${version} in ${out}.`);

// List every package that can reach the bridge or the demo browser files.
function notices() {
  const sections = new Map<string, string>();
  const visit = (name: string, from: string) => {
    const dir = [join(from, 'node_modules', name), join(root, 'node_modules', name)].find((path) =>
      existsSync(join(path, 'package.json')),
    );
    if (!dir) throw Error(`The production package ${name} is missing. Run bun install.`);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const key = `${manifest.name} ${manifest.version}`;
    if (sections.has(key)) return;
    const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name));
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${manifest.license}`;
    sections.set(key, `== ${key} (${manifest.license}) ==\n\n${text}`);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) visit(dependency, dir);
  };
  const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  // The demo bundles some development packages, such as its syntax highlighter. Skip tools that ship no code.
  for (const dependency of Object.keys({ ...app.dependencies, ...app.devDependencies }))
    if (!/^(@types\/|typescript$|prettier$)/.test(dependency)) visit(dependency, root);
  const syntax = readFileSync(join(root, 'demo/site/vendor/syntax.LICENSE'), 'utf8').trim();
  return (
    [
      'walleterm includes the following third-party software.',
      'walleterm-bridge includes the Bun runtime. See https://github.com/oven-sh/bun/blob/main/LICENSE.md.',
      'walleterm includes the Go runtime and standard library. See https://go.dev/LICENSE.',
      `== demo syntax highlighter (demo/site/vendor) ==\n\n${syntax}`,
      ...[...sections.keys()].sort().map((key) => sections.get(key)),
    ].join('\n\n') + '\n'
  );
}
