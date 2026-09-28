import hashlib, json, pathlib, re

ROOT = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
OUT = pathlib.Path(__file__).parent
RESEARCH = OUT.parent.parent / 'research/08-product-astra'
docs = sorted(p for p in ROOT.rglob('*.md') if not any(x in p.parts for x in ['node_modules', 'target', 'dist', '.git']))
inventory = []
links = []
for p in docs:
    text = p.read_text()
    inventory.append({'file': str(p.relative_to(ROOT)), 'lines': len(text.splitlines()), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})
    for m in re.finditer(r'\[[^\]]*\]\(([^)]+)\)', text):
        dest = m.group(1).split('#')[0]
        if not dest or '://' in dest or dest.startswith('mailto:'): continue
        q = p.parent / dest
        if not q.exists(): links.append({'file': str(p.relative_to(ROOT)), 'line': text[:m.start()].count('\n') + 1, 'target': dest})
lock = json.loads(re.sub(r',\s*([}\]])', r'\1', (ROOT/'bun.lock').read_text()))
deps = []
for key, v in lock['packages'].items():
    name, version = v[0].rsplit('@', 1)
    installed = ROOT/'node_modules'/name/'package.json'
    actual = json.loads(installed.read_text())['version'] if installed.exists() else None
    deps.append({'name': name, 'version': version, 'installed_version': actual, 'metadata': v[2]})
cargo = {}
for p in sorted(ROOT.glob('fixtures/**/Cargo.lock')):
    for block in p.read_text().split('[[package]]')[1:]:
        n = re.search(r'^name = "([^"]+)"', block, re.M)
        v = re.search(r'^version = "([^"]+)"', block, re.M)
        if not n or not v or 'source = "registry+' not in block: continue
        pair = (n[1], v[1])
        cargo.setdefault(pair, []).append(str(p.relative_to(ROOT)))
queries = [{'package': {'ecosystem': 'crates.io', 'name': n}, 'version': v} for n,v in sorted(cargo)]
(RESEARCH/'osv-request.json').write_text(json.dumps({'queries': queries}))
(OUT/'cargo-inventory.json').write_text(json.dumps([{'name': n, 'version': v, 'locks': cargo[(n,v)]} for n,v in sorted(cargo)], indent=2)+'\n')
(OUT/'document-inventory.json').write_text(json.dumps(inventory, indent=2)+'\n')
(OUT/'missing-local-links.json').write_text(json.dumps(links, indent=2)+'\n')
(OUT/'npm-inventory.json').write_text(json.dumps(deps, indent=2)+'\n')
print(json.dumps({'documents': len(docs), 'missing_local_links': len(links), 'skill_missing_links': [x for x in links if x['file'].startswith('.agents/')], 'npm_packages': len(deps), 'installed_version_mismatches': [x for x in deps if x['installed_version'] and x['installed_version'] != x['version']], 'rust_registry_versions': len(cargo)}, indent=2))
