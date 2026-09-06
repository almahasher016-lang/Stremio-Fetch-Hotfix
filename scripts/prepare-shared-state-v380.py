from pathlib import Path
import json

ROOT = Path('.')

pkg_path = ROOT / 'package.json'
pkg = json.loads(pkg_path.read_text())
pkg['version'] = '3.8.0'
pkg.setdefault('dependencies', {})['pg'] = '8.23.0'
pkg.setdefault('devDependencies', {})['@types/pg'] = '8.23.1'
pkg_path.write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')

release = ROOT / 'src/release.js'
text = release.read_text()
if "RELEASE_VERSION = '3.7.0'" not in text:
    raise SystemExit('unexpected release version')
release.write_text(text.replace("RELEASE_VERSION = '3.7.0'", "RELEASE_VERSION = '3.8.0'", 1))

server = ROOT / 'src/serverCore.js'
text = server.read_text()
needle = "import { getTelemetryStatus } from './telemetry.js';\n"
insert = needle + "import { closePostgres, getDatabaseStatus, pingDatabase } from './storage/postgres.js';\n"
if needle not in text or "getDatabaseStatus" in text:
    raise SystemExit('server import anchor mismatch')
text = text.replace(needle, insert, 1)
needle = "      telemetry: getTelemetryStatus(),\n"
replace = needle + "      database: { ...getDatabaseStatus(), live: await pingDatabase() },\n"
if needle not in text:
    raise SystemExit('admin health anchor mismatch')
text = text.replace(needle, replace, 1)
needle = "      await Promise.all([flushVaultWrites(), versionRegistry.flush(), closeRedis()]);"
replace = "      await Promise.all([flushVaultWrites(), versionRegistry.flush(), closeRedis(), closePostgres()]);"
if needle not in text:
    raise SystemExit('shutdown anchor mismatch')
text = text.replace(needle, replace, 1)
server.write_text(text)

env_path = ROOT / '.env.example'
env = env_path.read_text()
append = []
if 'DATABASE_URL=' not in env:
    append.append('DATABASE_URL=')
if 'POSTGRES_POOL_MAX=' not in env:
    append.append('POSTGRES_POOL_MAX=6')
if append:
    env_path.write_text(env.rstrip() + '\n\n# Shared durable state (production / HA)\n' + '\n'.join(append) + '\n')

readme = ROOT / 'README.md'
text = readme.read_text()
text = text.replace('# m7md Arabic Resolver v3.7.0', '# m7md Arabic Resolver v3.8.0', 1)
marker = '## ما الجديد في 3.7.0\n'
section = '''## ما الجديد في 3.8.0\n\n- Shared durable state: Personal Vault uses PostgreSQL when `DATABASE_URL` is configured.\n- Version Registry writes are serialized with PostgreSQL row locks for safe multi-replica operation.\n- Existing JSON files remain a local-development fallback and one-time migration source.\n- Admin health now reports PostgreSQL pool/connectivity status without exposing credentials.\n\n'''
if marker not in text:
    raise SystemExit('README release marker missing')
text = text.replace(marker, section + marker, 1)
readme.write_text(text)

changelog = ROOT / 'CHANGELOG.md'
text = changelog.read_text()
marker = '# Changelog\n\n'
section = '''## 3.8.0 - Shared Durable State\n\n- Add private PostgreSQL-backed Personal Vault storage with local JSON migration fallback.\n- Move Version Registry shared state to PostgreSQL transactions with `SELECT ... FOR UPDATE` serialization.\n- Add PostgreSQL lifecycle and admin health visibility.\n- Keep local-file storage as a development fallback when `DATABASE_URL` is absent.\n\n'''
if not text.startswith(marker):
    raise SystemExit('CHANGELOG header mismatch')
changelog.write_text(marker + section + text[len(marker):])
