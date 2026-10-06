"""Build reviewed allowlist archives without local tools or user data."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['version']
assert VERSION == json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
OUT = ROOT / 'dist'
OUT.mkdir(exist_ok=True)

def tree(folder, extensions):
    return [p for p in (ROOT / folder).rglob('*') if p.is_file() and (p.suffix.lower() in extensions or p.name == 'COPYING')]

runtime = [ROOT / n for n in ('manifest.json', 'index.html', 'inspector.html', 'central.html', 'logo.png', 'README.md', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md')]
runtime += tree('js', {'.js', '.cjs'}) + tree('css', {'.css'}) + tree('assets', {'.svg', '.md', '.png'})
runtime += tree('shortcuts', {'.html', '.json', '.png'}) + tree('docs', {'.md'})
source = runtime + [ROOT / 'package.json', ROOT / '.gitignore'] + tree('scripts', {'.py'}) + tree('tests', {'.cjs', '.zip'})

def build(name, files):
    entries = sorted(set(p.relative_to(ROOT).as_posix() for p in files))
    for entry in entries:
        p = ROOT / entry
        assert p.is_file() and not p.is_symlink(), entry
        assert p.resolve().is_relative_to(ROOT), entry
        assert not any(part.lower() in {'everything', 'tools', 'node_modules', '.git', 'dist'} for part in p.relative_to(ROOT).parts), entry
        assert p.suffix.lower() not in {'.exe', '.dll', '.db', '.ini'}, entry
    dest = OUT / name
    with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for entry in entries:
            info = zipfile.ZipInfo(entry, date_time=(2026, 10, 6, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / entry).read_bytes())
    with zipfile.ZipFile(dest) as archive:
        assert archive.testzip() is None
        assert archive.namelist() == entries
        assert json.loads(archive.read('manifest.json'))['version'] == VERSION
    return {'file': name, 'bytes': dest.stat().st_size, 'sha256': hashlib.sha256(dest.read_bytes()).hexdigest(), 'entries': entries}

prefix = 'Eagle-AssetLink-' + VERSION
report = [build(prefix + '.eagleplugin', runtime), build(prefix + '.zip', runtime), build(prefix + '-source.zip', source)]
(OUT / 'SHA256SUMS.txt').write_text(''.join(row['sha256'] + '  ' + row['file'] + '\n' for row in report), encoding='utf-8')
(OUT / 'package-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for row in report:
    print(f"{row['file']}: {row['bytes']} bytes, {len(row['entries'])} files; no bundled Everything")
