import json, os, pathlib, shutil, subprocess, tempfile

SOURCE = pathlib.Path('/private/tmp/walleterm-audit-40d6cca9db73')
BUN = shutil.which('bun')
results = []
with tempfile.TemporaryDirectory(prefix='walleterm-product-install-', dir='/private/tmp') as temp:
    root = pathlib.Path(temp)
    tools = root/'tools'
    tools.mkdir()
    (tools/'go').write_text('''#!/bin/sh
if [ "$1" = version ]; then exit 0; fi
if [ "$FAIL_STAGE" = go ]; then exit 21; fi
printf 'new binary' > "$4"
''')
    (tools/'bun').write_text('''#!/bin/sh
if [ "$1" = --version ]; then exit 0; fi
if [ "$1" = install ]; then
  case "$*" in
    *--production*) [ "$FAIL_STAGE" != production ] || exit 24 ;;
    *) [ "$FAIL_STAGE" != dependencies ] || exit 22 ;;
  esac
fi
if [ "$1" = run ]; then
  [ "$FAIL_STAGE" != build ] || exit 23
  cp -R "$ASSETS" dist
fi
''')
    for p in tools.iterdir(): p.chmod(0o700)
    for failure in ['go', 'dependencies', 'build', 'production', 'none']:
        prefix = root/('prefix with spaces '+failure)
        old = prefix/'share/walleterm/releases/old/bin'
        old.mkdir(parents=True)
        (old/'walleterm').write_text('old binary')
        bin_dir = prefix/'bin'
        bin_dir.mkdir()
        (bin_dir/'walleterm').symlink_to(old/'walleterm')
        (bin_dir/'stellar-walleterm').symlink_to('walleterm')
        env = dict(os.environ, PATH=str(tools)+os.pathsep+os.environ['PATH'], FAIL_STAGE=failure, ASSETS=str(SOURCE/'dist'))
        proc = subprocess.run([BUN, str(SOURCE/'scripts/install.ts'), str(prefix)], env=env, text=True, capture_output=True)
        versions = prefix/'share/walleterm/releases'
        before_unchanged = (old/'walleterm').read_text() == 'old binary'
        expected = 'new binary' if failure == 'none' else 'old binary'
        assert proc.returncode == (0 if failure == 'none' else 1), proc.stderr
        assert (bin_dir/'walleterm').read_text() == expected
        assert (bin_dir/'stellar-walleterm').read_text() == expected
        assert before_unchanged
        assert not list(versions.glob('.install-*'))
        result = {'stage': failure, 'exit': proc.returncode, 'old_release_unchanged': before_unchanged, 'both_commands': expected, 'stage_cleanup': True, 'stderr': proc.stderr.strip()}
        if failure == 'none':
            release = (bin_dir/'walleterm').resolve().parent.parent
            assert (release/'bridge/entry.ts').is_file()
            assert (release/'demo/entry.ts').is_file()
            assert (release/'dist/sdk/connect.js').is_file()
            assert not (release/'.env').exists()
            proc2 = subprocess.run([BUN, str(SOURCE/'scripts/install.ts'), str(prefix)], env=env, text=True, capture_output=True)
            assert proc2.returncode == 0, proc2.stderr
            assert len(list(versions.iterdir())) == 2
            result['repeat_install_same_release'] = True
        results.append(result)
print(json.dumps({'status': 'passed', 'cases': results, 'temporary_prefixes_removed': True, 'real_installs': 0}, indent=2))
