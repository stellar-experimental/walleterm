import json, pathlib, re, shutil, subprocess, tempfile

SOURCE = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
with tempfile.TemporaryDirectory(prefix='walleterm-product-sdk-', dir='/private/tmp') as temp:
    root = pathlib.Path(temp)
    shutil.copytree(SOURCE/'dist/sdk', root/'sdk-only')
    shutil.copytree(SOURCE/'dist', root/'complete')
    rows = []
    for name, entry in [('sdk-only', root/'sdk-only/connect.js'), ('complete', root/'complete/sdk/connect.js')]:
        result = subprocess.run(['bun', '-e', 'await import(process.argv[1]);', str(entry)], text=True, capture_output=True)
        rows.append({'layout': name, 'exit': result.returncode, 'stderr': result.stderr.strip()})
    assert rows[0]['exit'] != 0 and rows[1]['exit'] == 0, rows
    print(json.dumps({'status': 'reproduced', 'source_instruction': 'docs/CONNECTION-UI.md:19', 'rows': rows}, indent=2))
