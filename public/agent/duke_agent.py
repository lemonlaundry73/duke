#!/usr/bin/env python3
"""
Duke Forger build agent — runs on your Windows PC next to Unreal Engine 5.

It connects to your Duke Forger server, picks up build jobs, writes the Unreal project,
imports your Meshy assets, compiles the C++ code, cooks and packages a playable Windows game,
uploads it back to Duke, and (optionally) publishes it to itch.io with butler.

Usage:
    python duke_agent.py --server https://your-duke-server --token YOUR_TOKEN
    python duke_agent.py --check            # only check this PC (Unreal, Visual Studio)

Only the Python standard library is used.
"""
import argparse, base64, ctypes, traceback, http.server, io, ctypes.wintypes, glob, urllib.parse, json, os, platform, re, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request, zipfile

VERSION = '4.0.0'
# Filled in when you download DukeForger.py from your Duke Forger studio, so a double-click is enough.
DEFAULT_SERVER = ''
DEFAULT_TOKEN = ''
WORK = os.path.join(os.path.expanduser('~'), 'DukeForgeBuilds')


# ---------------------------------------------------------------- environment detection
def find_engines(override=None):
    """Return [{'version': '5.6', 'path': 'C:/Program Files/Epic Games/UE_5.6'}] for installed UE5 engines."""
    found = {}
    candidates = []
    if override:
        candidates.append(override)
    if os.environ.get('UE_ROOT'):
        candidates.append(os.environ['UE_ROOT'])
    # Epic Games Launcher install manifest
    launcher = os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'), 'Epic', 'UnrealEngineLauncher', 'LauncherInstalled.dat')
    try:
        with open(launcher, encoding='utf-8') as f:
            for item in json.load(f).get('InstallationList', []):
                if str(item.get('AppName', '')).startswith('UE_5'):
                    candidates.append(item.get('InstallLocation', ''))
    except Exception:
        pass
    for root in [os.environ.get('ProgramFiles', r'C:\Program Files'), r'C:\Program Files', r'D:\Program Files', r'C:\Epic Games', r'D:\Epic Games', r'E:\Epic Games']:
        candidates += glob.glob(os.path.join(root, 'Epic Games', 'UE_5*')) + glob.glob(os.path.join(root, 'UE_5*'))
    for c in candidates:
        if not c:
            continue
        editor = os.path.join(c, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe')
        if os.path.exists(editor):
            m = re.search(r'5\.\d+', os.path.basename(os.path.normpath(c))) or re.search(r'5\.\d+', c)
            version = m.group(0) if m else 'custom'
            found[os.path.normpath(c)] = {'version': version, 'path': os.path.normpath(c)}
    return sorted(found.values(), key=lambda e: e['version'], reverse=True)


def has_visual_studio():
    vswhere = os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'), 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    if not os.path.exists(vswhere):
        return False
    try:
        out = subprocess.run([vswhere, '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
                             capture_output=True, text=True, timeout=30)
        return bool(out.stdout.strip())
    except Exception:
        return False


def _run(cmd, timeout=20):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding='utf-8', errors='replace')
        return out.stdout.strip() if out.returncode == 0 else ''
    except Exception:
        return ''


def machine_info():
    """CPU, memory and graphics cards, so Duke can check the PC against Unreal's needs."""
    info = {'cpu': platform.processor(), 'cpuCores': os.cpu_count(), 'ramGB': None, 'gpus': []}
    if platform.system() == 'Windows':
        # Memory from Windows itself, processor name from the registry.
        try:
            class MEM(ctypes.Structure):
                _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong),
                            ('ullAvailPhys', ctypes.c_ulonglong), ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong),
                            ('ullTotalVirtual', ctypes.c_ulonglong), ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
            m = MEM()
            m.dwLength = ctypes.sizeof(MEM)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
                info['ramGB'] = round(m.ullTotalPhys / 1024 ** 3)
        except Exception:
            pass
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'HARDWARE\DESCRIPTION\System\CentralProcessor\0') as k:
                info['cpu'] = str(winreg.QueryValueEx(k, 'ProcessorNameString')[0]).strip() or info['cpu']
        except Exception:
            pass
        # Video memory: the driver registry key is accurate above 4 GB (WMI's AdapterRAM is not).
        try:
            import winreg
            root = r'SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, root) as k:
                for i in range(64):
                    try:
                        sub = winreg.EnumKey(k, i)
                    except OSError:
                        break
                    if not sub.isdigit():
                        continue
                    try:
                        with winreg.OpenKey(k, sub) as g:
                            name = winreg.QueryValueEx(g, 'DriverDesc')[0]
                            try:
                                mem = winreg.QueryValueEx(g, 'HardwareInformation.qwMemorySize')[0]
                            except OSError:
                                mem = 0
                            if isinstance(mem, bytes):
                                mem = int.from_bytes(mem, 'little')
                            if name and 'Basic' not in name and 'Virtual' not in name:
                                info['gpus'].append({'name': name, 'vramGB': round(int(mem or 0) / 1024 ** 3, 1)})
                    except OSError:
                        continue
        except Exception:
            pass
    if not info['gpus'] and shutil.which('nvidia-smi'):
        for line in _run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits']).splitlines():
            if ',' in line:
                n, m = line.rsplit(',', 1)
                info['gpus'].append({'name': n.strip(), 'vramGB': round(float(m) / 1024, 1)})
    if info['ramGB'] is None and hasattr(os, 'sysconf'):
        try:
            info['ramGB'] = round(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / 1024 ** 3)
        except Exception:
            pass
    return info


def find_tools():
    """Character Creator 5, Headshot, Blender, Git and Git LFS."""
    pf = [os.environ.get('ProgramFiles', r'C:\Program Files'), r'C:\Program Files', r'D:\Program Files']
    tools = {}
    cc = [d for r in pf for d in glob.glob(os.path.join(r, 'Reallusion', 'Character Creator 5*'))]
    tools['cc5'] = cc[0] if cc else None
    hs = [d for r in pf for d in glob.glob(os.path.join(r, 'Reallusion', '**', '*Headshot*'), recursive=True)][:1]
    tools['headshot'] = hs[0] if hs else None
    blender = shutil.which('blender')
    if not blender:
        found = sorted(d for r in pf for d in glob.glob(os.path.join(r, 'Blender Foundation', 'Blender*', 'blender.exe')))
        blender = found[-1] if found else None
    tools['blender'] = (os.path.basename(os.path.dirname(blender)) if blender and 'Blender Foundation' in blender else blender)
    tools['git'] = _run(['git', '--version']) or None
    tools['lfs'] = _run(['git', 'lfs', 'version']) or None
    return tools


def inspect_project(duke, project_id, path):
    """Checks a linked Unreal project: plugins, content folders, Git/LFS, and syncs Duke's design into it."""
    path = os.path.normpath(os.path.expandvars(os.path.expanduser(path.strip().strip('"'))))
    uproject = path if path.lower().endswith('.uproject') else next(iter(glob.glob(os.path.join(path, '*.uproject'))), path)
    report = {'projectId': project_id, 'path': uproject, 'exists': os.path.isfile(uproject)}
    if report['exists']:
        root = os.path.dirname(uproject)
        report['name'] = os.path.splitext(os.path.basename(uproject))[0]
        try:
            data = json.load(open(uproject, encoding='utf-8-sig'))
            report['engine'] = str(data.get('EngineAssociation', ''))
            report['plugins'] = [p.get('Name') for p in data.get('Plugins', []) if p.get('Enabled')]
        except Exception:
            report['plugins'] = []
        content = os.path.join(root, 'Content')
        report['folders'] = [d for d in os.listdir(content) if os.path.isdir(os.path.join(content, d))] if os.path.isdir(content) else []
        git_root = root
        while git_root and not os.path.isdir(os.path.join(git_root, '.git')):
            parent = os.path.dirname(git_root)
            git_root = None if parent == git_root else parent
        report['git'] = bool(git_root)
        attrs = os.path.join(git_root, '.gitattributes') if git_root else ''
        report['lfs'] = bool(attrs and os.path.exists(attrs) and 'filter=lfs' in open(attrs, encoding='utf-8', errors='ignore').read())
        try:
            design = duke._req('GET', '/api/agent/projects/%s/design.json' % project_id)
            out = os.path.join(content, 'DukeForge')
            os.makedirs(out, exist_ok=True)
            with open(os.path.join(out, 'design.json'), 'w', encoding='utf-8') as f:
                json.dump(design, f, indent=2)
            report['synced'] = True
        except Exception as e:
            print('  (design sync failed: %s)' % e)
        try:
            sync_team_files(duke, project_id, root)
        except Exception as e:
            print('  (AI Team file sync failed: %s)' % e)
    duke.post('/api/agent/inspect', report)
    return report


TEAM_PREFIXES = ('Source/', 'Config/DukeForge/', 'Content/DukeForge/', 'Docs/')


def sync_team_files(duke, project_id, root):
    """Writes files the AI Team produced into the linked project (only under safe folders)."""
    manifest_path = os.path.join(root, 'Content', 'DukeForge', 'team_versions.json')
    try:
        have = json.load(open(manifest_path, encoding='utf-8'))
    except Exception:
        have = {}
    listing = duke._req('GET', '/api/agent/projects/%s/workspace' % project_id)
    changed = 0
    for f in listing.get('files', []):
        rel = f['path']
        if '..' in rel or rel.startswith('/') or not rel.startswith(TEAM_PREFIXES) or have.get(rel) == f['version']:
            continue
        data = duke._req('GET', '/api/agent/projects/%s/workspace?path=%s' % (project_id, urllib.parse.quote(rel)))
        dest = os.path.join(root, *rel.split('/'))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, 'w', encoding='utf-8') as out:
            out.write(data.get('content', ''))
        have[rel] = f['version']
        changed += 1
    if changed:
        os.makedirs(os.path.dirname(manifest_path), exist_ok=True)
        json.dump(have, open(manifest_path, 'w', encoding='utf-8'), indent=2)
        print('  AI Team: wrote %d file(s) into your project' % changed)


def find_butler():
    return shutil.which('butler') or (os.path.exists(os.path.join(WORK, 'butler', 'butler.exe')) and os.path.join(WORK, 'butler', 'butler.exe')) or None


# ---------------------------------------------------------------- server API
class Duke:
    def __init__(self, server, token):
        self.server = server.rstrip('/')
        self.token = token

    def _req(self, method, path, body=None, raw=None, ctype='application/json', timeout=120):
        data = None
        headers = {'x-duke-agent': self.token}
        if raw is not None:
            data = raw
            headers['content-type'] = ctype
        elif body is not None:
            data = json.dumps(body).encode('utf-8')
            headers['content-type'] = 'application/json'
        req = urllib.request.Request(self.server + path, data=data, method=method, headers=headers)
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            # The site moved (for example dukeforger.com -> www.dukeforger.com): follow it once and remember it.
            loc = e.headers.get('location') if e.code in (301, 302, 303, 307, 308) else None
            if not loc:
                raise
            u = urllib.parse.urlparse(urllib.parse.urljoin(self.server + path, loc))
            self.server = '%s://%s' % (u.scheme, u.netloc)
            req = urllib.request.Request(self.server + path, data=data, method=method, headers=headers)
            r = urllib.request.urlopen(req, timeout=timeout)
        with r:
            payload = r.read()
            if 'application/json' in (r.headers.get('content-type') or ''):
                return json.loads(payload.decode('utf-8') or '{}')
            return payload

    def post(self, path, body=None):
        return self._req('POST', path, body or {})

    def download(self, path, dest):
        req = urllib.request.Request(self.server + path, headers={'x-duke-agent': self.token})
        with urllib.request.urlopen(req, timeout=600) as r, open(dest, 'wb') as f:
            shutil.copyfileobj(r, f, 1024 * 1024)

    def upload(self, path, file):
        size = os.path.getsize(file)
        with open(file, 'rb') as f:
            req = urllib.request.Request(self.server + path, data=f, method='POST',
                                         headers={'x-duke-agent': self.token, 'content-type': 'application/zip', 'content-length': str(size)})
            with urllib.request.urlopen(req, timeout=3600) as r:
                return json.loads(r.read().decode('utf-8') or '{}')


class BuildLog:
    """Buffers log lines and streams them to Duke every couple of seconds."""
    def __init__(self, duke, build_id):
        self.duke, self.bid = duke, build_id
        self.lines, self.lock = [], threading.Lock()
        self.phase, self.progress, self.canceled = None, None, False
        self.tail = []

    def add(self, line, echo=True):
        line = line.rstrip()
        if not line:
            return
        if echo:
            print(line)
        with self.lock:
            self.lines.append(line[:1000])
            self.tail = (self.tail + [line])[-80:]

    def set(self, phase, progress):
        self.phase, self.progress = phase, progress
        self.add('== ' + phase)
        self.flush()

    def flush(self):
        with self.lock:
            lines, self.lines = self.lines[-200:], []
        try:
            r = self.duke.post('/api/agent/builds/%s/log' % self.bid, {'lines': lines, 'phase': self.phase, 'progress': self.progress})
            if isinstance(r, dict) and r.get('canceled'):
                self.canceled = True
        except Exception as e:
            print('  (could not send log: %s)' % e)


def run(cmd, log, cwd=None, important=None, timeout=4 * 3600):
    """Run a command, stream interesting output to Duke, raise on failure."""
    log.add('> ' + ' '.join('"%s"' % c if ' ' in c else c for c in cmd))
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
    last = time.time()
    start = time.time()
    for line in p.stdout:
        keep = important is None or any(k in line for k in important) or 'error' in line.lower() or 'warning C' in line
        log.add(line, echo=True) if keep else print(line.rstrip())
        if time.time() - last > 3:
            log.flush(); last = time.time()
            if log.canceled:
                p.kill(); raise RuntimeError('Build canceled from Duke Forger')
        if time.time() - start > timeout:
            p.kill(); raise RuntimeError('Timed out: ' + cmd[0])
    p.wait()
    log.flush()
    if p.returncode != 0:
        raise RuntimeError('%s exited with code %s' % (os.path.basename(cmd[0]), p.returncode))


def zip_dir(src, dest):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, _, files in os.walk(src):
            for f in files:
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, src))


# ---------------------------------------------------------------- the build
def build(duke, job, engines, args):
    bid = job['id']
    log = BuildLog(duke, bid)
    try:
        engines = find_engines(args.engine) or engines  # pick up engines installed since the agent started
        want = (job.get('engineVersion') or '').strip()
        engine = next((e for e in engines if e['version'] == want), None) if want else None
        engine = engine or (engines[0] if engines else None)
        if not engine:
            raise RuntimeError('Unreal Engine 5 was not found on this PC. Install it from the Epic Games Launcher or pass --engine "C:/Program Files/Epic Games/UE_5.x".')
        log.add('Using Unreal Engine %s at %s' % (engine['version'], engine['path']))
        ue = engine['path']
        editor = os.path.join(ue, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe')
        build_bat = os.path.join(ue, 'Engine', 'Build', 'BatchFiles', 'Build.bat')
        uat = os.path.join(ue, 'Engine', 'Build', 'BatchFiles', 'RunUAT.bat')

        if job.get('localProject'):
            return build_local(duke, job, ue, uat, log)

        # 1. project
        log.set('Downloading your Unreal project from Duke', 5)
        jobdir = os.path.join(WORK, bid)
        if os.path.exists(jobdir):
            shutil.rmtree(jobdir, ignore_errors=True)
        os.makedirs(jobdir, exist_ok=True)
        zpath = os.path.join(jobdir, 'project.zip')
        duke.download('/api/agent/builds/%s/project.zip' % bid, zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(jobdir)
        projdir = next(os.path.join(jobdir, d) for d in os.listdir(jobdir) if os.path.isdir(os.path.join(jobdir, d)))
        uproject = os.path.join(projdir, 'DukeGame.uproject')
        log.add('Project ready: ' + projdir)

        # 2. compile editor module (needed to run the import script)
        log.set('Compiling game code (C++)', 15)
        run([build_bat, 'DukeGameEditor', 'Win64', 'Development', '-Project=' + uproject, '-WaitMutex', '-NoHotReload'], log,
            important=['error', 'Building', 'Compil', 'Total time'])

        # 3. import Meshy assets + create materials
        log.set('Importing your 3D models and animations', 35)
        script = os.path.join(projdir, 'Content', 'Python', 'duke_import.py')
        run([editor, uproject, '-run=pythonscript', '-script=' + script, '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'], log,
            important=['[Duke]', 'Error', 'Python'])
        report = os.path.join(projdir, 'Saved', 'DukeImport.json')
        if os.path.exists(report):
            r = json.load(open(report, encoding='utf-8'))
            for e in r.get('errors', []):
                log.add('Import warning: ' + e)
            if r.get('status') != 'ok':
                raise RuntimeError('Asset import script failed — see the log above')

        # 4. cook + package
        log.set('Cooking and packaging the game (this takes a while the first time)', 50)
        archive = os.path.join(jobdir, 'Build')
        config = 'Shipping' if job.get('config', 'Shipping') == 'Shipping' else 'Development'
        run([uat, 'BuildCookRun', '-project=' + uproject, '-noP4', '-platform=Win64', '-clientconfig=' + config, '-build', '-cook', '-stage', '-pak', '-iostore',
             '-prereqs', '-archive', '-archivedirectory=' + archive, '-utf8output', '-unattended'], log,
            important=['BUILD SUCCESSFUL', 'BUILD FAILED', 'Error', 'Cook', 'Stage', 'Package', 'Archive', 'LogCook: Display: Cooked'])
        packaged = next((os.path.join(archive, d) for d in ('Windows', 'WindowsNoEditor', 'Win64') if os.path.isdir(os.path.join(archive, d))), archive)

        # 5. upload
        log.set('Uploading your playable build to Duke', 90)
        out_zip = os.path.join(jobdir, 'game.zip')
        zip_dir(packaged, out_zip)
        duke.upload('/api/agent/builds/%s/artifact' % bid, out_zip)

        # 6. publish (optional)
        itch_url = None
        if job.get('publish') and job['publish'].get('itch'):
            butler = find_butler()
            if butler:
                log.set('Publishing to itch.io', 95)
                run([butler, 'push', packaged, job['publish']['itch'], '--userversion', time.strftime('%Y.%m.%d.%H%M')], log)
                user_game = job['publish']['itch'].split(':')[0].split('/')
                itch_url = 'https://%s.itch.io/%s' % (user_game[0], user_game[1])
            else:
                log.add('itch.io publishing skipped: install butler (https://itch.io/docs/butler/) and run "butler login" once.')
        log.flush()
        duke.post('/api/agent/builds/%s/finish' % bid, {'status': 'succeeded', 'itchUrl': itch_url, 'lines': ['Playable build at ' + packaged]})
        print('\nBuild %s succeeded. Game folder: %s\n' % (bid, packaged))
    except Exception as e:
        log.add('BUILD FAILED: %s' % e)
        log.flush()
        try:
            duke.post('/api/agent/builds/%s/finish' % bid, {'status': 'failed', 'error': str(e), 'lines': log.tail[-30:]})
        except Exception:
            pass
        print('\nBuild %s failed: %s\n' % (bid, e))


def build_local(duke, job, ue, uat, log):
    """Packages the creator's own Unreal project in place (the one linked in step 11)."""
    bid = job['id']
    uproject = job['localProject']
    if not uproject.lower().endswith('.uproject'):
        uproject = next(iter(glob.glob(os.path.join(uproject, '*.uproject'))), uproject)
    if not os.path.isfile(uproject):
        raise RuntimeError('Your Unreal project was not found at %s' % uproject)
    log.add('Packaging your project: ' + uproject)
    jobdir = os.path.join(WORK, bid)
    os.makedirs(jobdir, exist_ok=True)
    archive = os.path.join(jobdir, 'Build')
    config = 'Shipping' if job.get('config', 'Shipping') == 'Shipping' else 'Development'
    log.set('Compiling, cooking and packaging your project', 20)
    run([uat, 'BuildCookRun', '-project=' + uproject, '-noP4', '-platform=Win64', '-clientconfig=' + config, '-build', '-cook', '-stage', '-pak', '-iostore',
         '-prereqs', '-archive', '-archivedirectory=' + archive, '-utf8output', '-unattended'], log,
        important=['BUILD SUCCESSFUL', 'BUILD FAILED', 'Error', 'Cook', 'Stage', 'Package', 'Archive', 'LogCook: Display: Cooked'])
    packaged = next((os.path.join(archive, d) for d in ('Windows', 'WindowsNoEditor', 'Win64') if os.path.isdir(os.path.join(archive, d))), archive)
    log.set('Uploading your playable build to Duke', 90)
    out_zip = os.path.join(jobdir, 'game.zip')
    zip_dir(packaged, out_zip)
    duke.upload('/api/agent/builds/%s/artifact' % bid, out_zip)
    log.flush()
    duke.post('/api/agent/builds/%s/finish' % bid, {'status': 'succeeded', 'lines': ['Playable build at ' + packaged]})
    print('\nBuild %s succeeded. Game folder: %s\n' % (bid, packaged))


def report(duke, hello, engines_arg):
    """Sends hardware/tools to Duke and inspects every project Duke asks about."""
    engines = find_engines(engines_arg)
    hello.update({'engines': [e['version'] for e in engines], 'visualStudio': has_visual_studio(), 'tools': find_tools()})
    hello.update(machine_info())
    r = duke.post('/api/agent/hello', hello)
    for w in (r or {}).get('watch', []) or []:
        try:
            inspect_project(duke, w['projectId'], w['path'])
        except Exception as e:
            print('  (could not inspect %s: %s)' % (w.get('path'), e))
    return engines


# ---------------------------------------------------------------- Duke Link (your tools, live inside Duke)
EXPORTS_DIR = os.path.join(os.path.expanduser('~'), 'DukeForger', 'Exports')
UE_IMPORT = '''import unreal
t = unreal.AssetImportTask()
t.filename = r"%s"
t.destination_path = "/Game/DukeForge/Imports/%s"
t.automated = True
t.save = True
t.replace_existing = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([t])
print(", ".join(str(x) for x in t.imported_object_paths) or "no assets")'''


def probe_pixel_streaming():
    """Finds Epic's Pixel Streaming player started by the Unreal editor on this PC."""
    for port in (80, 8080, 81, 88, 8888):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/' % port, timeout=1.5) as r:
                body = r.read(20000).decode('utf-8', 'ignore').lower()
                if 'pixel' in body or 'webrtc' in body or 'epic' in body:
                    return {'url': 'http://127.0.0.1:%d' % port}
        except Exception:
            continue
    return None


NOT_TOOLS = {'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'opera_gx.exe', 'arc.exe', 'vivaldi.exe', 'explorer.exe',
             'cursor.exe', 'code.exe', 'notepad.exe', 'python.exe', 'pythonw.exe', 'py.exe', 'windowsterminal.exe', 'powershell.exe', 'pwsh.exe',
             'cmd.exe', 'conhost.exe', 'claude.exe', 'discord.exe', 'slack.exe', 'spotify.exe'}
TOOL_TITLES = [('ue', ('Unreal Editor',)), ('cc5', ('Character Creator',)), ('blender', ('Blender',)), ('vs', ('Microsoft Visual Studio',))]
VK = {'Enter': 0x0D, 'Escape': 0x1B, 'Backspace': 0x08, 'Tab': 0x09, 'Space': 0x20, ' ': 0x20, 'Delete': 0x2E, 'Insert': 0x2D, 'Home': 0x24, 'End': 0x23,
      'PageUp': 0x21, 'PageDown': 0x22, 'ArrowLeft': 0x25, 'ArrowUp': 0x26, 'ArrowRight': 0x27, 'ArrowDown': 0x28, 'Shift': 0x10, 'Control': 0x11, 'Alt': 0x12,
      'CapsLock': 0x14, 'Meta': 0x5B}
UE_SNIPPETS = {
    'ue_save_all': "import unreal\nunreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)\nprint('Saved')",
    'ue_play': "import unreal\nunreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_begin_play()\nprint('Playing')",
    'ue_stop': "import unreal\nunreal.get_editor_subsystem(unreal.LevelEditorSubsystem).editor_request_end_play()\nprint('Stopped')",
    'ue_blockout_room': """import unreal
cube = unreal.EditorAssetLibrary.load_asset('/Engine/BasicShapes/Cube')
sub = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
def box(name, loc, scale):
    a = sub.spawn_actor_from_object(cube, unreal.Vector(*loc))
    a.set_actor_scale3d(unreal.Vector(*scale)); a.set_actor_label('Duke_Blockout_' + name); a.set_folder_path('DukeBlockout')
box('Floor', (0, 0, -10), (20, 20, 0.2))
box('WallN', (0, 1000, 150), (20, 0.4, 3))
box('WallE', (1000, 0, 150), (0.4, 20, 3))
box('WallW', (-1000, 0, 150), (0.4, 20, 3))
box('WallS_L', (-600, -1000, 150), (12, 0.4, 3))
box('WallS_R', (700, -1000, 150), (6, 0.4, 3))
print('Gray test room added in the DukeBlockout folder')""",
}


def _user32():
    return ctypes.windll.user32 if platform.system() == 'Windows' else None


class Link:
    """Streams the chosen tool window to Duke and applies the creator's input and actions."""
    def __init__(self, duke, args):
        self.duke, self.args = duke, args
        self.hwnd, self.title, self.watch = None, None, False
        self.control = None if not args.no_control else False
        self.project = ''
        self.u = _user32()
        self.pil = None
        if self.u:
            try:
                ctypes.windll.shcore.SetProcessDpiAwareness(2)
            except Exception:
                pass
        try:
            from PIL import ImageGrab, Image  # noqa
            self.pil = (ImageGrab, Image)
        except Exception:
            print('Duke Link: installing Pillow for the live view...')
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--user', '--quiet', '--disable-pip-version-check', 'pillow'], timeout=300)
            try:
                # A fresh install lands in a folder Python only looks at from its next start: add it now.
                import importlib, site
                for d in [site.getusersitepackages()] + (site.getsitepackages() if hasattr(site, 'getsitepackages') else []):
                    if os.path.isdir(d) and d not in sys.path:
                        site.addsitedir(d)
                importlib.invalidate_caches()
                from PIL import ImageGrab, Image  # noqa
                self.pil = (ImageGrab, Image)
            except Exception:
                print('Duke Link: live view is starting next time. Press Ctrl+C and run Duke again once.')

    def start(self):
        self.exports, self.pixel = [], None
        os.makedirs(EXPORTS_DIR, exist_ok=True)
        self.guide, self.seen, self.blender_seen = {}, {}, 0
        self.started = time.time()
        for fn in (self.poll_loop, self.state_loop, self.capture_loop, self.watch_loop, self.guide_loop, self.hd_loop, self.local_server):
            threading.Thread(target=fn, daemon=True).start()
        threading.Thread(target=install_blender_addon, args=(self.duke.server,), daemon=True).start()

    # -- never hunt for files: newest 3D exports and images in the usual places
    def watch_loop(self):
        while True:
            try:
                home = os.path.expanduser('~')
                places = [(EXPORTS_DIR, 'Duke exports', 3), (os.path.join(home, 'Desktop'), 'Desktop', 1), (os.path.join(home, 'Downloads'), 'Downloads', 1),
                          (os.path.join(home, 'Documents'), 'Documents', 2), (os.path.join(home, 'Documents', 'Reallusion'), 'Character Creator', 5),
                          (os.path.join(home, 'Documents', 'Blender'), 'Blender', 4)]
                found, cutoff = {}, time.time() - 3 * 86400
                for root, label, depth in places:
                    if not os.path.isdir(root):
                        continue
                    base = root.rstrip(os.sep).count(os.sep)
                    for dirpath, dirs, files in os.walk(root):
                        if dirpath.count(os.sep) - base >= depth:
                            dirs[:] = []
                        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', 'Intermediate', 'Saved', 'DerivedDataCache', 'Binaries')]
                        for f in files:
                            ext = os.path.splitext(f)[1].lower()
                            if ext in ('.fbx', '.glb') or (ext in ('.png', '.jpg', '.jpeg') and label == 'Duke exports'):
                                full = os.path.join(dirpath, f)
                                try:
                                    st = os.stat(full)
                                except OSError:
                                    continue
                                if st.st_mtime >= cutoff and full not in found:
                                    found[full] = {'path': full, 'name': f, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000), 'kind': ext[1:], 'from': label}
                for f in found.values():
                    prev = self.seen.get(f['path'])
                    if prev and prev.get('mtime') == f['mtime']:
                        f['imported'], f['proof'] = prev.get('imported'), prev.get('proof')
                    elif f['mtime'] / 1000 > self.started and f['kind'] in ('fbx', 'glb'):
                        self.auto_pickup(f)
                    self.seen[f['path']] = f
                self.exports = sorted(found.values(), key=lambda x: -x['mtime'])[:30]
                self.pixel = probe_pixel_streaming()
            except Exception:
                pass
            time.sleep(6)

    # -- windows
    def windows(self):
        if not self.u:
            return []
        out = []
        PROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def cb(h, _):
            if self.u.IsWindowVisible(h):
                n = self.u.GetWindowTextLengthW(h)
                if n:
                    buf = ctypes.create_unicode_buffer(n + 1)
                    self.u.GetWindowTextW(h, buf, n + 1)
                    t = buf.value
                    for tool, keys in TOOL_TITLES:
                        if any(k in t for k in keys):
                            if self.exe_of(h) not in NOT_TOOLS:
                                out.append({'id': str(h), 'title': t, 'tool': tool})
                            break
            return True
        self.u.EnumWindows(PROC(cb), 0)
        return out

    def exe_of(self, h):
        try:
            k = ctypes.windll.kernel32
            k.OpenProcess.restype = ctypes.c_void_p
            k.QueryFullProcessImageNameW.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)]
            k.CloseHandle.argtypes = [ctypes.c_void_p]
            pid = ctypes.c_ulong()
            self.u.GetWindowThreadProcessId(ctypes.c_void_p(h), ctypes.byref(pid))
            hp = k.OpenProcess(0x1000, False, pid.value)
            if not hp:
                return ''
            try:
                buf, n = ctypes.create_unicode_buffer(520), ctypes.c_ulong(520)
                if k.QueryFullProcessImageNameW(hp, 0, buf, ctypes.byref(n)):
                    return os.path.basename(buf.value).lower()
            finally:
                k.CloseHandle(hp)
        except Exception:
            pass
        return ''

    def window_image(self, hwnd):
        """The window's own pixels, even when other windows (like the browser showing Duke) are on top of it.
        Grabbing the screen instead would photograph Duke itself and repeat forever like two facing mirrors."""
        Image = self.pil[1]
        u, g = self.u, ctypes.windll.gdi32
        vp = ctypes.c_void_p
        u.GetWindowDC.restype, u.GetWindowDC.argtypes = vp, [vp]
        u.ReleaseDC.argtypes = [vp, vp]
        u.PrintWindow.argtypes = [vp, vp, ctypes.c_uint]
        g.CreateCompatibleDC.restype, g.CreateCompatibleDC.argtypes = vp, [vp]
        g.CreateCompatibleBitmap.restype, g.CreateCompatibleBitmap.argtypes = vp, [vp, ctypes.c_int, ctypes.c_int]
        g.SelectObject.restype, g.SelectObject.argtypes = vp, [vp, vp]
        g.DeleteObject.argtypes = [vp]
        g.DeleteDC.argtypes = [vp]
        g.GetDIBits.argtypes = [vp, vp, ctypes.c_uint, ctypes.c_uint, vp, vp, ctypes.c_uint]
        r = ctypes.wintypes.RECT()
        if not u.GetWindowRect(vp(hwnd), ctypes.byref(r)) or u.IsIconic(vp(hwnd)):
            return None
        w, h = r.right - r.left, r.bottom - r.top
        if w < 50 or h < 50:
            return None

        class BIH(ctypes.Structure):
            _fields_ = [('biSize', ctypes.c_uint32), ('biWidth', ctypes.c_int32), ('biHeight', ctypes.c_int32), ('biPlanes', ctypes.c_uint16),
                        ('biBitCount', ctypes.c_uint16), ('biCompression', ctypes.c_uint32), ('biSizeImage', ctypes.c_uint32),
                        ('biXPelsPerMeter', ctypes.c_int32), ('biYPelsPerMeter', ctypes.c_int32), ('biClrUsed', ctypes.c_uint32), ('biClrImportant', ctypes.c_uint32)]
        wdc = u.GetWindowDC(vp(hwnd))
        mdc = g.CreateCompatibleDC(wdc)
        bmp = g.CreateCompatibleBitmap(wdc, w, h)
        old = g.SelectObject(mdc, bmp)
        img = None
        try:
            if u.PrintWindow(vp(hwnd), mdc, 2):  # 2 = PW_RENDERFULLCONTENT, works for DirectX/OpenGL apps
                bi = BIH(ctypes.sizeof(BIH), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
                buf = ctypes.create_string_buffer(w * h * 4)
                if g.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0) == h:
                    img = Image.frombuffer('RGB', (w, h), buf, 'raw', 'BGRX', 0, 1)
        finally:
            g.SelectObject(mdc, old)
            g.DeleteObject(bmp)
            g.DeleteDC(mdc)
            u.ReleaseDC(vp(hwnd), wdc)
        if img is not None and img.getbbox() is None:
            img = None  # all black: this app can't be copied this way
        if img is None and u.GetForegroundWindow() == hwnd:
            img = self.pil[0].grab(bbox=(r.left, r.top, r.right, r.bottom), all_screens=True).convert('RGB')
        return img

    def rect(self):
        r = ctypes.wintypes.RECT()
        if not self.hwnd or not self.u.GetWindowRect(ctypes.c_void_p(self.hwnd), ctypes.byref(r)):
            return None
        return (r.left, r.top, r.right, r.bottom)

    def state_loop(self):
        while True:
            try:
                wins = self.windows()
                if self.hwnd and not any(w['id'] == str(self.hwnd) for w in wins):
                    self.hwnd = None
                if not self.hwnd and wins:
                    self.hwnd, self.title = int(wins[0]['id']), wins[0]['title']
                r = self.duke.post('/api/agent/link/state', {'windows': wins, 'window': self.title if self.hwnd else None, 'control': self.control, 'capture': bool(self.pil),
                                                             'exports': getattr(self, 'exports', []), 'pixel': getattr(self, 'pixel', None),
                                                             'blender': {'installed': os.path.exists(ADDON_MARK), 'seen': int(self.blender_seen * 1000)}})
                self.watch = bool(r.get('watch'))
            except Exception:
                pass
            time.sleep(3)

    def capture_loop(self):
        import io
        while True:
            if not (self.watch and self.hwnd and self.pil and self.u):
                time.sleep(0.5)
                continue
            t0 = time.time()
            try:
                img = self.window_image(self.hwnd)
                if img is not None:
                    sig = img.resize((48, 27)).tobytes()
                    if sig == getattr(self, 'last_sig', None) and time.time() - getattr(self, 'last_sent', 0) < 2:
                        time.sleep(0.05)
                        continue
                    self.last_sig, self.last_sent = sig, time.time()
                    if img.width > 1280:
                        img = img.resize((1280, int(img.height * 1280 / img.width)))
                    b = io.BytesIO()
                    img.save(b, 'JPEG', quality=70)
                    data = b.getvalue()
                    req = urllib.request.Request(self.duke.server + '/api/agent/link/frame', data=data, method='POST',
                                                 headers={'x-duke-agent': self.duke.token, 'content-type': 'image/jpeg', 'x-frame-w': str(img.width),
                                                          'x-frame-h': str(img.height), 'x-window': (self.title or '')[:150].encode('ascii', 'ignore').decode()})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        self.watch = bool(json.loads(resp.read() or b'{}').get('watch'))
            except Exception:
                time.sleep(1)
            time.sleep(max(0.0, 0.08 - (time.time() - t0)))

    def poll_loop(self):
        while True:
            try:
                r = self.duke._req('POST', '/api/agent/link/poll', {}, timeout=40)
                self.watch = bool(r.get('watch'))
                for c in r.get('commands', []):
                    threading.Thread(target=self.run, args=(c,), daemon=True).start() if c['type'] in ('action', 'python', 'launch') else self.run(c)
            except Exception:
                time.sleep(3)

    def result(self, cid, ok, output):
        try:
            self.duke.post('/api/agent/link/result', {'id': cid, 'ok': ok, 'output': output, 'control': self.control})
        except Exception:
            pass

    def allowed(self):
        """Asks once on this PC (a box that stays on top) and remembers the answer, without blocking anything."""
        if self.control is None and os.path.exists(CONTROL_FILE):
            self.control = open(CONTROL_FILE).read().strip() == 'allow'
        if self.control is None and self.u and not getattr(self, 'asking', False):
            self.asking = True

            def ask():
                ans = self.u.MessageBoxW(None, 'Let Duke Forger use your Unreal, Blender, Character Creator and Visual Studio windows '
                                               'from Duke in your browser (mouse, keyboard and one-tap actions)?\n\n'
                                               'Duke remembers your answer. Delete DukeForger\\.control to be asked again.', 'Duke Link', 0x4 | 0x20 | 0x40000 | 0x10000)
                self.control = (ans == 6)
                try:
                    with open(CONTROL_FILE, 'w') as f:
                        f.write('allow' if self.control else 'deny')
                except OSError:
                    pass
                self.asking = False
                self.result('control', self.control, 'allowed' if self.control else 'declined')
            threading.Thread(target=ask, daemon=True).start()
        return bool(self.control)

    def bring_to_front(self, hwnd):
        """Windows refuses focus changes from background programs; this is the standard way through."""
        u, k = self.u, ctypes.windll.kernel32
        vp = ctypes.c_void_p
        if u.GetForegroundWindow() == hwnd:
            return
        if u.IsIconic(vp(hwnd)):
            u.ShowWindow(vp(hwnd), 9)
        fg = u.GetForegroundWindow()
        me = k.GetCurrentThreadId()
        other = u.GetWindowThreadProcessId(vp(fg), None) if fg else 0
        target = u.GetWindowThreadProcessId(vp(hwnd), None)
        try:
            for t in {other, target} - {0, me}:
                u.AttachThreadInput(me, t, True)
            u.keybd_event(0x12, 0, 0, 0)  # a tap of Alt unlocks SetForegroundWindow
            u.keybd_event(0x12, 0, 2, 0)
            u.BringWindowToTop(vp(hwnd))
            u.SetForegroundWindow(vp(hwnd))
            u.SetFocus(vp(hwnd))
        finally:
            for t in {other, target} - {0, me}:
                u.AttachThreadInput(me, t, False)

    # -- commands
    def run(self, c):
        cid = c.get('id')
        try:
            t = c['type']
            if t == 'focus':
                if any(w['id'] == c['window'] for w in self.windows()):
                    self.hwnd = int(c['window'])
                    self.title = next(w['title'] for w in self.windows() if w['id'] == c['window'])
                    if self.allowed():
                        self.bring_to_front(self.hwnd)
                return self.result(cid, True, 'Showing ' + (self.title or ''))
            if t == 'hd_http':
                return self.hd_http(c)
            if t == 'input':
                if self.allowed():
                    self.input(c['e'])
                return
            if not self.allowed():
                return self.result(cid, False, 'Control was declined on your PC. Restart the Duke agent to be asked again.')
            if t == 'launch':
                return self.result(cid, True, self.launch(c['tool'], c.get('project', '')))
            if t == 'action':
                return self.result(cid, True, self.action(c['action'], c.get('project', '')))
            if t == 'python':
                return self.result(cid, True, ue_python(c['code']))
            if t == 'import':
                return self.result(cid, True, self.import_file(c))
        except Exception as e:
            self.result(cid, False, str(e))

    def input(self, e):
        u = self.u
        if not (u and self.hwnd):
            return
        box = self.rect()
        if not box:
            return
        if u.GetForegroundWindow() != self.hwnd:
            self.bring_to_front(self.hwnd)
        k = e['k']
        if k in ('move', 'down', 'up', 'wheel'):
            x = int(box[0] + e['x'] * (box[2] - box[0]))
            y = int(box[1] + e['y'] * (box[3] - box[1]))
            u.SetCursorPos(x, y)
            flags = {('down', 'left'): 0x2, ('up', 'left'): 0x4, ('down', 'right'): 0x8, ('up', 'right'): 0x10, ('down', 'middle'): 0x20, ('up', 'middle'): 0x40}
            if k == 'wheel':
                u.mouse_event(0x800, 0, 0, ctypes.c_uint32(int(-e['d'] * 120) & 0xffffffff).value, 0)
            elif (k, e['b']) in flags:
                u.mouse_event(flags[(k, e['b'])], 0, 0, 0, 0)
        elif k == 'key':
            vk = VK.get(e['key'])
            code = e.get('code', '')
            if vk is None and len(e['key']) == 1:
                vk = u.VkKeyScanW(ord(e['key'])) & 0xff
            if vk is None and code.startswith('F') and code[1:].isdigit():
                vk = 0x6F + int(code[1:])
            if vk is not None:
                u.keybd_event(vk, 0, 0 if e['down'] else 0x2, 0)
        elif k == 'text':
            for ch in e['text']:
                vk = u.VkKeyScanW(ord(ch))
                if vk == -1:
                    continue
                shift = (vk >> 8) & 1
                if shift:
                    u.keybd_event(0x10, 0, 0, 0)
                u.keybd_event(vk & 0xff, 0, 0, 0)
                u.keybd_event(vk & 0xff, 0, 2, 0)
                if shift:
                    u.keybd_event(0x10, 0, 2, 0)

    def launch(self, tool, project):
        if tool == 'ue':
            engines = find_engines(self.args.engine)
            if not engines:
                raise RuntimeError('Unreal Engine 5 is not installed yet. Install it from the Epic Games Launcher.')
            exe = os.path.join(engines[0]['path'], 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
            subprocess.Popen([exe] + ([project] if project and os.path.exists(project) else []))
            return 'Opening Unreal Engine %s%s' % (engines[0]['version'], ' with your project' if project and os.path.exists(project) else '')
        tools = find_tools()
        if tool == 'blender':
            exe = shutil.which('blender') or next(iter(sorted(glob.glob(os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), 'Blender Foundation', 'Blender*', 'blender.exe')))[-1:]), None)
            if not exe:
                raise RuntimeError('Blender is not installed yet. Get it free from blender.org.')
            subprocess.Popen([exe])
            return 'Opening Blender'
        if tool == 'cc5':
            exe = tools.get('cc5') and next(iter(glob.glob(os.path.join(tools['cc5'], '**', 'CharacterCreator*.exe'), recursive=True)), None)
            if not exe:
                raise RuntimeError('Character Creator 5 was not found. Install it from Reallusion Hub.')
            subprocess.Popen([exe])
            return 'Opening Character Creator 5'
        if tool == 'vs':
            vswhere = os.path.join(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'), 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
            exe = _run([vswhere, '-latest', '-property', 'productPath']) if os.path.exists(vswhere) else ''
            if not exe:
                raise RuntimeError('Visual Studio was not found.')
            subprocess.Popen([exe])
            return 'Opening Visual Studio'
        raise RuntimeError('Unknown tool')

    def action(self, name, project):
        root = os.path.dirname(project) if project.lower().endswith('.uproject') else project
        need = name in ('ue_enable_remote', 'ue_enable_plugins', 'ue_make_folders', 'ue_git_init', 'git_commit')
        if need and not (project and os.path.isfile(project)):
            raise RuntimeError('Add your .uproject path in step 11 first.')
        if name == 'ue_enable_remote':
            ini = os.path.join(root, 'Config', 'DefaultEngine.ini')
            os.makedirs(os.path.dirname(ini), exist_ok=True)
            text = open(ini, encoding='utf-8', errors='ignore').read() if os.path.exists(ini) else ''
            if 'bRemoteExecution=True' not in text:
                with open(ini, 'a', encoding='utf-8') as f:
                    f.write('\n[/Script/PythonScriptPlugin.PythonScriptPluginSettings]\nbRemoteExecution=True\n')
            return 'Remote control is on. Restart Unreal once, then the Unreal buttons in Duke work.'
        if name == 'ue_enable_plugins':
            data = json.load(open(project, encoding='utf-8-sig'))
            plugins = data.setdefault('Plugins', [])
            for n in ('PCG', 'MassGameplay', 'MassCrowd', 'StateTree', 'PythonScriptPlugin'):
                hit = next((p for p in plugins if p.get('Name') == n), None)
                if hit:
                    hit['Enabled'] = True
                else:
                    plugins.append({'Name': n, 'Enabled': True})
            json.dump(data, open(project, 'w', encoding='utf-8'), indent='\t')
            return 'Plugins turned on: PCG, Mass Crowd, State Tree, Python. Open Unreal again; it may ask to rebuild, say Yes.'
        if name == 'ue_make_folders':
            for f in ('Characters', 'Environments', 'Gameplay', 'Maps', 'Animation', 'Audio', 'UI'):
                os.makedirs(os.path.join(root, 'Content', f), exist_ok=True)
            return 'Made the 7 folders in Content.'
        if name == 'ue_git_init':
            if not os.path.isdir(os.path.join(root, '.git')):
                _run(['git', 'init', root])
            _run(['git', '-C', root, 'lfs', 'install'])
            attrs = os.path.join(root, '.gitattributes')
            if not os.path.exists(attrs):
                open(attrs, 'w').write(''.join('*.%s filter=lfs diff=lfs merge=lfs -text\n' % e for e in ('uasset', 'umap', 'fbx', 'png', 'jpg', 'tga', 'wav', 'mp3', 'blend', 'ccProject', 'exr', 'psd')))
            ign = os.path.join(root, '.gitignore')
            if not os.path.exists(ign):
                open(ign, 'w').write('Binaries/\nIntermediate/\nSaved/\nDerivedDataCache/\n.vs/\n*.sln\n')
            return self.commit(root, 'First snapshot from Duke Forger') or 'Version control is on.'
        if name == 'git_commit':
            return self.commit(root, 'Snapshot from Duke Forger ' + time.strftime('%Y-%m-%d %H:%M'))
        if name == 'blender_new':
            return self.launch('blender', '')
        if name in ('agent_autostart_on', 'agent_autostart_off'):
            startup = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Duke Forger.cmd')
            if name == 'agent_autostart_off':
                if os.path.exists(startup):
                    os.remove(startup)
                return 'Duke will no longer start by itself. Double-click DukeForger.py when you want it.'
            me = os.path.abspath(sys.argv[0])
            py = sys.executable.replace('python.exe', 'pythonw.exe') if sys.executable.lower().endswith('python.exe') else sys.executable
            with open(startup, 'w') as f:
                f.write('@echo off\r\nstart "" "%s" "%s" --server %s --token %s\r\n' % (py, me, self.duke.server, self.duke.token))
            return 'Duke will start by itself when you sign in to Windows.'
        if name == 'blender_connect':
            return install_blender_addon(self.duke.server, force=True)
        if name == 'open_exports':
            os.makedirs(EXPORTS_DIR, exist_ok=True)
            os.startfile(EXPORTS_DIR) if hasattr(os, 'startfile') else None
            return 'Opened ' + EXPORTS_DIR
        if name == 'ue_pixel_streaming':
            if not (project and os.path.isfile(project)):
                raise RuntimeError('Add your .uproject path in step 11 first.')
            engines = find_engines(self.args.engine)
            if not engines:
                raise RuntimeError('Unreal Engine 5 is not installed.')
            media = os.path.join(engines[0]['path'], 'Engine', 'Plugins', 'Media')
            name = 'PixelStreaming2' if os.path.isdir(os.path.join(media, 'PixelStreaming2')) else 'PixelStreaming'
            data = json.load(open(project, encoding='utf-8-sig'))
            plugins = data.setdefault('Plugins', [])
            hit = next((p for p in plugins if p.get('Name') == name), None)
            if hit:
                hit['Enabled'] = True
            else:
                plugins.append({'Name': name, 'Enabled': True})
            json.dump(data, open(project, 'w', encoding='utf-8'), indent='\t')
            exe = os.path.join(engines[0]['path'], 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
            # Both spellings: Unreal ignores the arguments of the plugin version it does not have.
            subprocess.Popen([exe, project, '-EditorPixelStreamingStartOnLaunch=true', '-EditorPixelStreamingUseRemoteSignallingServer=false',
                              '-EditorPixelStreamingSource=Editor', '-EditorPixelStreamingRes=1920x1080',
                              '-EditorPixelStreaming2StartOnLaunch=true', '-EditorPixelStreaming2UseRemoteSignallingServer=false', '-EditorPixelStreaming2Source=Editor'])
            return 'Pixel Streaming is on. Unreal is reopening in HD mode: close the old Unreal window if one is still open. HD mode appears in Duke Link in a minute.'
        if name in UE_SNIPPETS:
            return ue_python(UE_SNIPPETS[name])
        raise RuntimeError('Unknown action')

    # -- never hunt for files: a new export goes straight into the Unreal project, and counts as proof
    def guide_loop(self):
        while True:
            try:
                self.guide = self.duke._req('GET', '/api/agent/guide', timeout=20) or {}
            except Exception:
                pass
            time.sleep(10)

    def auto_pickup(self, f):
        g = self.guide or {}
        if g.get('autoImport') is False:
            return
        proj = ((g.get('project') or {}).get('path')) or ''
        time.sleep(2)  # let the exporting app finish writing
        try:
            if proj and os.path.isfile(proj):
                f['imported'] = self.import_file({'path': f['path'], 'projectPath': proj})[:200]
        except Exception as e:
            f['imported'] = None
            print('  (could not bring %s into Unreal: %s)' % (f['name'], e))
        # A Character Creator or Blender export during a step that needs screenshots: save one automatically.
        step = (g.get('step') or {})
        nxt = g.get('nextProof')
        tool = 'cc5' if 'Reallusion' in f['path'] or f['from'] == 'Character Creator' else 'blender' if f['from'] in ('Blender',) else ''
        if nxt and step.get('tool') in ('cc5', 'blender') and (not tool or tool == step.get('tool')):
            win = next((w for w in self.windows() if w['tool'] == step.get('tool')), None)
            if win and self.save_window_proof(int(win['id']), nxt['key'], 'Auto: ' + f['name']):
                f['proof'] = True

    def save_window_proof(self, hwnd, key, label):
        if not (self.pil and self.u):
            return False
        img = self.window_image(hwnd)
        if img is None:
            return False
        b = io.BytesIO()
        img.save(b, 'PNG')
        return bool(self.upload_proof(b.getvalue(), key, label, 'duke-agent'))

    def upload_proof(self, data, key, label, source):
        g = self.guide or {}
        pid = (g.get('project') or {}).get('id')
        if not (pid and key):
            return None
        req = urllib.request.Request(self.duke.server + '/api/agent/proof', data=data, method='POST', headers={
            'x-duke-agent': self.duke.token, 'content-type': 'application/octet-stream', 'x-project': pid, 'x-key': key,
            'x-label': urllib.parse.quote(label[:80]), 'x-source': source})
        with urllib.request.urlopen(req, timeout=120) as r:
            out = json.loads(r.read() or b'{}')
        if out.get('guide'):
            self.guide = out['guide']
        return out

    # -- local link for the Blender add-on (this PC only, needs the key in ~/DukeForger/.local_key)
    def local_server(self):
        link = self
        key = local_key()

        class H(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def reply(self, code, obj):
                b = json.dumps(obj).encode()
                self.send_response(code)
                self.send_header('content-type', 'application/json')
                self.send_header('content-length', str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def ok(self):
                if self.headers.get('x-duke-local') != key or self.headers.get('origin'):
                    self.reply(403, {'error': 'forbidden'})
                    return False
                link.blender_seen = time.time()
                return True

            def do_GET(self):
                if not self.ok():
                    return
                if self.path == '/guide':
                    return self.reply(200, link.guide or {})
                self.reply(404, {'error': 'not found'})

            def do_POST(self):
                if not self.ok():
                    return
                n = min(int(self.headers.get('content-length') or 0), 20 * 1024 * 1024)
                body = self.rfile.read(n)
                try:
                    if self.path == '/proof':
                        nxt = (link.guide or {}).get('nextProof') or {}
                        k = self.headers.get('x-key') or nxt.get('key')
                        if not k:
                            return self.reply(200, {'ok': False, 'message': 'This step does not need screenshots.'})
                        out = link.upload_proof(body, k, urllib.parse.unquote(self.headers.get('x-label') or 'Blender'), 'blender')
                        return self.reply(200, {'ok': True, 'completed': (out or {}).get('completed') or []})
                    if self.path == '/exported':
                        path = json.loads(body or b'{}').get('path', '')
                        if os.path.isfile(path) and os.path.abspath(path).startswith(os.path.abspath(EXPORTS_DIR)):
                            st = os.stat(path)
                            f = {'path': path, 'name': os.path.basename(path), 'size': st.st_size, 'mtime': int(st.st_mtime * 1000), 'kind': 'fbx', 'from': 'Blender'}
                            link.auto_pickup(f)
                            link.seen[path] = f
                            return self.reply(200, {'ok': True, 'imported': f.get('imported')})
                        return self.reply(400, {'error': 'file not found'})
                except Exception as e:
                    return self.reply(500, {'error': str(e)})
                self.reply(404, {'error': 'not found'})

        try:
            http.server.ThreadingHTTPServer(('127.0.0.1', LOCAL_PORT), H).serve_forever()
        except OSError as e:
            print('Duke Link: Blender connection unavailable (%s)' % e)

    # -- HD mode: tunnel Epic's Pixel Streaming player and signalling through Duke
    def hd_http(self, c):
        px = getattr(self, 'pixel', None)
        path = c.get('path') or '/'
        status, ctype, data = 502, 'text/plain', b'Pixel Streaming is not running'
        if px and path.startswith('/') and '..' not in path and '://' not in path:
            try:
                with urllib.request.urlopen(px['url'].rstrip('/') + path, timeout=15) as r:
                    status, ctype, data = r.status, r.headers.get('content-type') or 'application/octet-stream', r.read(30 * 1024 * 1024)
            except urllib.error.HTTPError as e:
                status, ctype, data = e.code, 'text/plain', b''
            except Exception as e:
                data = str(e).encode()
        req = urllib.request.Request(self.duke.server + '/api/agent/link/hd/http/' + c['id'], data=data, method='POST', headers={
            'x-duke-agent': self.duke.token, 'content-type': 'application/octet-stream', 'x-status': str(status), 'x-type': ctype})
        try:
            urllib.request.urlopen(req, timeout=60).read()
        except Exception:
            pass

    def hd_loop(self):
        chans = {}
        while True:
            try:
                r = self.duke._req('POST', '/api/agent/link/hdws/poll', {}, timeout=40)
            except Exception:
                time.sleep(3)
                continue
            for m in r.get('msgs', []):
                ch = m.get('chan')
                try:
                    if m.get('open'):
                        px = getattr(self, 'pixel', None)
                        if not px:
                            self.hd_send([{'chan': ch, 'close': True}])
                            continue
                        u = urllib.parse.urlparse(px['url'])
                        ws = LocalWS(u.hostname or '127.0.0.1', u.port or 80)
                        chans[ch] = ws
                        threading.Thread(target=self.hd_pump, args=(ch, ws, chans), daemon=True).start()
                    elif m.get('close'):
                        ws = chans.pop(ch, None)
                        if ws:
                            ws.close()
                    elif ch in chans:
                        if 'data' in m:
                            chans[ch].send(m['data'].encode('utf-8'), 1)
                        elif 'b64' in m:
                            chans[ch].send(base64.b64decode(m['b64']), 2)
                except Exception:
                    ws = chans.pop(ch, None)
                    if ws:
                        ws.close()
                    self.hd_send([{'chan': ch, 'close': True}])

    def hd_pump(self, ch, ws, chans):
        try:
            while True:
                op, data = ws.recv()
                if op == 8:
                    break
                self.hd_send([{'chan': ch, 'data': data.decode('utf-8', 'replace')} if op == 1 else {'chan': ch, 'b64': base64.b64encode(data).decode()}])
        except Exception:
            pass
        if chans.pop(ch, None):
            self.hd_send([{'chan': ch, 'close': True}])

    def hd_send(self, msgs):
        try:
            self.duke.post('/api/agent/link/hdws/send', {'msgs': msgs})
        except Exception:
            pass

    def import_file(self, c):
        src = c['path']
        if not os.path.isfile(src):
            raise RuntimeError('That file was moved or deleted.')
        notes = []
        if c.get('collection') and c.get('entityId'):
            with open(src, 'rb') as f:
                data = f.read()
            req = urllib.request.Request(self.duke.server + '/api/agent/link/upload', data=data, method='POST', headers={
                'x-duke-agent': self.duke.token, 'content-type': 'application/octet-stream', 'x-project': c['projectId'], 'x-collection': c['collection'],
                'x-entity': c['entityId'], 'x-slot': c.get('slot', 'model'), 'x-filename': urllib.parse.quote(os.path.basename(src))})
            with urllib.request.urlopen(req, timeout=600) as r:
                json.loads(r.read() or b'{}')
            notes.append('Added to Duke Forger')
        proj = c.get('projectPath') or ''
        if proj and os.path.isfile(proj):
            stem = re.sub(r'[^A-Za-z0-9_]', '_', os.path.splitext(os.path.basename(src))[0]) or 'Import'
            try:
                out = ue_python(UE_IMPORT % (src.replace('\\', '/'), stem))
                notes.append('Imported into Unreal: ' + out.strip()[:120])
            except Exception:
                dest = os.path.join(os.path.dirname(proj), 'Content', 'DukeForge', 'Imports', os.path.basename(src))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(src, dest)
                notes.append('Copied into your project (Content/DukeForge/Imports). Unreal offers to import it when it next opens.')
        return '. '.join(notes) or 'Nothing to do'

    def commit(self, root, msg):
        _run(['git', '-C', root, 'add', '-A'], timeout=600)
        out = _run(['git', '-C', root, '-c', 'user.name=Duke Forger creator', '-c', 'user.email=creator@dukeforge.local', 'commit', '-m', msg], timeout=600)
        return 'Snapshot saved.' if out else 'Nothing new to save.'


LOCAL_PORT = 47811
CONTROL_FILE = os.path.join(os.path.expanduser('~'), 'DukeForger', '.control')
LOCAL_KEY = os.path.join(os.path.expanduser('~'), 'DukeForger', '.local_key')
ADDON_MARK = os.path.join(os.path.expanduser('~'), 'DukeForger', '.blender_addon')


def local_key():
    os.makedirs(os.path.dirname(LOCAL_KEY), exist_ok=True)
    if not os.path.exists(LOCAL_KEY):
        with open(LOCAL_KEY, 'w') as f:
            f.write(base64.urlsafe_b64encode(os.urandom(24)).decode())
    return open(LOCAL_KEY).read().strip()


def blender_exe():
    found = shutil.which('blender')
    if found:
        return found
    pf = [os.environ.get('ProgramFiles', r'C:\Program Files'), r'C:\Program Files', r'D:\Program Files']
    hits = sorted(d for r in pf for d in glob.glob(os.path.join(r, 'Blender Foundation', 'Blender*', 'blender.exe')))
    return hits[-1] if hits else None


def install_blender_addon(server, force=False):
    """Puts the Duke Forger panel into Blender (sidebar, Duke tab). Runs once per Blender version."""
    exe = blender_exe()
    if not exe:
        return 'Blender is not installed.'
    mark = '%s|%s' % (exe, VERSION)
    if not force and os.path.exists(ADDON_MARK) and open(ADDON_MARK).read() == mark:
        return 'The Duke panel is already in Blender.'
    src = os.path.join(tempfile.gettempdir(), 'duke_forger_blender.py')
    with urllib.request.urlopen(server.rstrip('/') + '/agent/duke_blender_addon.py', timeout=60) as r, open(src, 'wb') as f:
        f.write(r.read())
    script = ("import bpy, shutil, os, addon_utils\n"
              "d = bpy.utils.user_resource('SCRIPTS', path='addons', create=True)\n"
              "shutil.copy(r'%s', os.path.join(d, 'duke_forger.py'))\n"
              "addon_utils.enable('duke_forger', default_set=True, persistent=True)\n"
              "bpy.ops.wm.save_userpref()\n") % src
    subprocess.run([exe, '-b', '--factory-startup', '--python-expr', script], timeout=180, capture_output=True)
    with open(ADDON_MARK, 'w') as f:
        f.write(mark)
    return 'The Duke panel is in Blender: press N in the 3D view and open the Duke tab. Restart Blender if it was open.'


class LocalWS:
    """A tiny WebSocket client for the Pixel Streaming signalling server on this PC."""
    def __init__(self, host, port, path='/'):
        self.s = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
                        'Sec-WebSocket-Version: 13\r\nOrigin: http://%s:%d\r\n\r\n' % (path, host, port, key, host, port)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.s.recv(4096)
            if not chunk:
                raise ConnectionError('signalling server closed')
            buf += chunk
        head, self.rest = buf.split(b'\r\n\r\n', 1)
        if b' 101' not in head.split(b'\r\n')[0]:
            raise ConnectionError('signalling server refused: ' + head.split(b'\r\n')[0].decode('latin-1'))
        self.s.settimeout(None)
        self.lock = threading.Lock()

    def _n(self, n):
        while len(self.rest) < n:
            c = self.s.recv(65536)
            if not c:
                raise EOFError()
            self.rest += c
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def recv(self):
        parts, first = [], None
        while True:
            b0, b1 = self._n(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = int.from_bytes(self._n(2), 'big')
            elif n == 127:
                n = int.from_bytes(self._n(8), 'big')
            mask = self._n(4) if b1 & 0x80 else None
            data = self._n(n)
            if mask:
                data = bytes(x ^ mask[i % 4] for i, x in enumerate(data))
            if op == 9:
                self.send(data, 10)
                continue
            if op == 10:
                continue
            if op == 8:
                return 8, data
            if op != 0:
                first = op
            parts.append(data)
            if b0 & 0x80:
                return first or 1, b''.join(parts)

    def send(self, data, op=1):
        n = len(data)
        head = bytes([0x80 | op])
        head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + n.to_bytes(2, 'big') if n < 65536 else bytes([0x80 | 127]) + n.to_bytes(8, 'big')
        mask = os.urandom(4)
        with self.lock:
            self.s.sendall(head + mask + bytes(x ^ mask[i % 4] for i, x in enumerate(data)))

    def close(self):
        try:
            self.send(b'', 8)
            self.s.close()
        except Exception:
            pass


# ---------------------------------------------------------------- Duke Forger V1 worker
# Runs the orchestrator's job steps on this PC for real: creates the Unreal project, compiles it with
# Unreal Build Tool, runs the Unreal Editor with the Duke Forger plugin (the automation bridge), drives
# Play-In-Editor tests, commits with Git, packages with AutomationTool, and serves the File Vault.
FORGE_ROOT = os.path.join(os.path.expanduser('~'), 'DukeForger', 'Projects')
SKIP_DIRS = {'.git', 'Intermediate', 'Binaries', 'DerivedDataCache', '.vs', '__pycache__'}
TEXT_EXT = {'.cpp', '.h', '.hpp', '.inl', '.cs', '.ini', '.json', '.uproject', '.uplugin', '.py', '.md', '.txt', '.log', '.csv', '.xml', '.yaml', '.yml',
            '.usf', '.ush', '.gitignore', '.gitattributes', '.bat', '.sh', '.html', '.css', '.js'}
ERR_RE = re.compile(r'(error [A-Z]{1,4}\d{3,5}|: error|error LNK\d+|\bERROR:|Error: |Fatal error|LogPython: Error|Unhandled Exception)', re.I)


def _pid_alive(pid):
    if not pid:
        return False
    if platform.system() != 'Windows':
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    k = ctypes.windll.kernel32
    k.OpenProcess.restype = ctypes.c_void_p
    h = k.OpenProcess(0x1000, False, int(pid))
    if not h:
        return False
    code = ctypes.c_ulong()
    k.GetExitCodeProcess(ctypes.c_void_p(h), ctypes.byref(code))
    k.CloseHandle(ctypes.c_void_p(h))
    return code.value == 259


class StepFailed(Exception):
    pass


class Forge:
    def __init__(self, duke, args):
        self.duke, self.args = duke, args
        self.editors = {}  # uproject -> Popen we started

    def start(self):
        os.makedirs(FORGE_ROOT, exist_ok=True)
        threading.Thread(target=self.loop, daemon=True).start()

    def engine(self):
        e = find_engines(self.args.engine)
        if not e:
            raise StepFailed('Unreal Engine 5 is not installed on this PC. Install it from the Epic Games Launcher.')
        return e[0]

    # ---- the polling loop: RPCs (File Vault) run at once, job steps one at a time in the background
    def loop(self):
        boot, busy = True, threading.Event()
        while True:
            try:
                body = {'boot': boot}
                if boot:
                    e = find_engines(self.args.engine)
                    body['hello'] = {'version': VERSION, 'engine': e[0]['version'] if e else '', 'root': FORGE_ROOT}
                r = self.duke._req('POST', '/api/agent/forge/poll', body, timeout=45)
                boot = False
                for c in r.get('rpc', []):
                    threading.Thread(target=self.do_rpc, args=(c,), daemon=True).start()
                if r.get('step') and not busy.is_set():
                    busy.set()

                    def run(st):
                        try:
                            self.do_step(st)
                        finally:
                            busy.clear()
                    threading.Thread(target=run, args=(r['step'],), daemon=True).start()
            except urllib.error.HTTPError as e:
                time.sleep(5 if e.code != 401 else 30)
            except Exception:
                time.sleep(5)

    # ---- job steps
    def do_step(self, st):
        ctx = {'log': [], 'evidence': [], 'last': time.time(), 'st': st}
        proj = dict(st.get('project') or {})
        out = {'ok': False}
        try:
            fn = getattr(self, 'step_' + st['kind'].replace('.', '_'))
            res = fn(st.get('args') or {}, proj, ctx)
            out = {'ok': True, 'result': res}
            if isinstance(res, dict) and res.get('summary'):
                out['summary'] = res['summary']
        except StepFailed as e:
            out = {'ok': False, 'error': str(e)}
        except Exception as e:
            out = {'ok': False, 'error': '%s: %s' % (type(e).__name__, e)}
            ctx['log'].append(traceback.format_exc()[-3000:])
        out.update({'log': ctx['log'][-300:], 'evidence': ctx['evidence'], 'project': {k: proj.get(k) for k in ('root', 'uproject', 'engine') if proj.get(k)}})
        for attempt in range(20):
            try:
                self.duke.post('/api/agent/forge/step/%s/%s' % (st['jobId'], st['stepId']), out)
                return
            except Exception:
                time.sleep(10)

    def log(self, ctx, line):
        ctx['log'].append(str(line)[:2000])
        if time.time() - ctx['last'] > 8:
            ctx['last'] = time.time()
            st = ctx['st']
            try:
                self.duke.post('/api/agent/forge/step/%s/%s' % (st['jobId'], st['stepId']), {'progress': True, 'log': ctx['log'][-30:]})
                ctx['log'] = ctx['log'][-30:] if len(ctx['log']) > 300 else ctx['log']
            except Exception:
                pass

    def need(self, proj):
        if not proj.get('uproject') or not os.path.isfile(proj['uproject']):
            raise StepFailed('The project files are not on this PC yet: %s' % proj.get('uproject'))
        return proj['root'], proj['uproject'], proj['name']

    def run_logged(self, cmd, ctx, cwd=None, timeout=4 * 3600):
        self.log(ctx, '> ' + ' '.join('"%s"' % c if ' ' in c else c for c in cmd))
        p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', bufsize=1)
        errors, t0 = [], time.time()
        for line in p.stdout:
            line = line.rstrip()
            if not line:
                continue
            if ERR_RE.search(line):
                errors.append(line[:600])
            self.log(ctx, line)
            if time.time() - t0 > timeout:
                p.kill()
                raise StepFailed('Timed out after %d minutes' % (timeout // 60))
        p.wait()
        return p.returncode, errors

    def git(self, root, *a, check=True):
        r = subprocess.run(['git', '-C', root, '-c', 'user.name=Duke Forger', '-c', 'user.email=forge@dukeforger.com', '-c', 'core.autocrlf=false'] + list(a),
                           capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)
        if check and r.returncode != 0:
            raise StepFailed('git %s failed: %s' % (a[0], (r.stderr or r.stdout).strip()[-800:]))
        return r.stdout

    def step_kit_install(self, args, proj, ctx):
        name = re.sub(r'[^A-Za-z0-9]', '', args.get('name') or proj.get('name') or 'DukeGame')[:30]
        eng = self.engine()
        root = os.path.join(FORGE_ROOT, name)
        uproject = os.path.join(root, name + '.uproject')
        if os.path.isfile(uproject):
            self.log(ctx, 'Project already exists at ' + root)
        else:
            tmp = os.path.join(tempfile.gettempdir(), 'duke_forger_kit.zip')
            self.duke.download('/api/agent/forge/kit.zip', tmp)
            with zipfile.ZipFile(tmp) as z:
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    if info.filename.startswith('template/'):
                        rel = info.filename[len('template/'):].replace('__NAME__', name)
                        dest = os.path.join(root, rel)
                    elif info.filename.startswith('plugin/'):
                        dest = os.path.join(root, 'Plugins', 'DukeForger', info.filename[len('plugin/'):])
                    else:
                        continue
                    data = z.read(info)
                    if os.path.splitext(dest)[1].lower() in TEXT_EXT or os.path.basename(dest).startswith('.'):
                        data = data.decode('utf-8').replace('__NAME__', name).replace('__ENGINE__', eng['version']).encode('utf-8')
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    with open(dest, 'wb') as f:
                        f.write(data)
            for d in ('Content', 'Concepts', 'RawAssets', 'Docs'):
                os.makedirs(os.path.join(root, d), exist_ok=True)
                keep = os.path.join(root, d, '.gitkeep')
                if not os.listdir(os.path.join(root, d)):
                    open(keep, 'w').close()
            self.log(ctx, 'Created ' + uproject)
        # Pixel Streaming for Live Unreal, editor only (never inside the packaged game)
        ps = 'PixelStreaming2' if os.path.isdir(os.path.join(eng['path'], 'Engine', 'Plugins', 'Media', 'PixelStreaming2')) else (
            'PixelStreaming' if os.path.isdir(os.path.join(eng['path'], 'Engine', 'Plugins', 'Media', 'PixelStreaming')) else None)
        data = json.load(open(uproject, encoding='utf-8-sig'))
        if ps and not any(p.get('Name') == ps for p in data.get('Plugins', [])):
            data.setdefault('Plugins', []).append({'Name': ps, 'Enabled': True, 'TargetAllowList': ['Editor']})
            json.dump(data, open(uproject, 'w', encoding='utf-8'), indent='\t')
            self.log(ctx, 'Enabled %s for Live Unreal (editor only)' % ps)
        proj.update(root=root, uproject=uproject, engine=eng['version'])
        return {'root': root, 'uproject': uproject, 'engine': eng['version'], 'pixelStreaming': ps, 'summary': 'Unreal %s project at %s' % (eng['version'], root)}

    def step_git_init(self, args, proj, ctx):
        root, _, _ = self.need(proj)
        if not os.path.isdir(os.path.join(root, '.git')):
            self.git(root, 'init', '-b', 'main')
        lfs = subprocess.run(['git', '-C', root, 'lfs', 'install', '--local'], capture_output=True, text=True)
        self.log(ctx, 'Git LFS: ' + ('on' if lfs.returncode == 0 else 'not available (%s)' % lfs.stderr.strip()[:200]))
        self.git(root, 'add', '-A')
        if self.git(root, 'status', '--porcelain').strip():
            self.git(root, 'commit', '-m', 'Duke Forger: project created from template')
        return {'sha': self.git(root, 'rev-parse', 'HEAD').strip(), 'lfs': lfs.returncode == 0}

    # ---- Unreal Editor session with the Duke Forger bridge
    def bridge_dir(self, root):
        return os.path.join(root, 'Saved', 'DukeForger')

    def heartbeat(self, root):
        try:
            hb = json.load(open(os.path.join(self.bridge_dir(root), 'heartbeat.json')))
            if time.time() - hb.get('time', 0) < 10 and _pid_alive(hb.get('pid')):
                return hb
        except Exception:
            pass
        return None

    def editor_log(self, root, name, lines=60):
        f = os.path.join(root, 'Saved', 'Logs', name + '.log')
        try:
            with open(f, encoding='utf-8', errors='replace') as fh:
                return fh.readlines()[-lines:]
        except OSError:
            return []

    def step_editor_start(self, args, proj, ctx):
        root, uproject, name = self.need(proj)
        hb = self.heartbeat(root)
        if hb:
            return {'pid': hb['pid'], 'map': hb.get('map'), 'summary': 'Unreal Editor already running'}
        eng = self.engine()
        exe = os.path.join(eng['path'], 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe')
        cmd = [exe, uproject, '-NoSplash']
        if args.get('pixel', True):
            cmd += ['-EditorPixelStreamingStartOnLaunch=true', '-EditorPixelStreamingUseRemoteSignallingServer=false', '-EditorPixelStreamingSource=Editor',
                    '-EditorPixelStreaming2StartOnLaunch=true', '-EditorPixelStreaming2UseRemoteSignallingServer=false', '-EditorPixelStreaming2Source=Editor',
                    '-PixelStreamingURL=ws://127.0.0.1:8888']
        try:
            os.remove(os.path.join(self.bridge_dir(root), 'heartbeat.json'))
        except OSError:
            pass
        self.log(ctx, 'Starting Unreal Editor (the first start compiles shaders and can take 10 to 40 minutes)')
        p = subprocess.Popen(cmd)
        self.editors[uproject] = p
        t0, last = time.time(), ''
        while time.time() - t0 < 110 * 60:
            hb = self.heartbeat(root)
            if hb:
                self.log(ctx, 'Unreal Editor is up (%s), Duke Forger bridge %s' % (hb.get('engine'), hb.get('version')))
                return {'pid': hb['pid'], 'engine': hb.get('engine'), 'map': hb.get('map'), 'summary': 'Unreal Editor running with the Duke Forger bridge'}
            if p.poll() is not None:
                tail = ''.join(self.editor_log(root, name, 80))
                raise StepFailed('Unreal Editor closed while starting (exit code %s). Last log lines:\n%s' % (p.returncode, tail[-4000:]))
            tail = self.editor_log(root, name, 3)
            if tail and tail[-1] != last:
                last = tail[-1]
                self.log(ctx, last.strip()[:300])
            time.sleep(3)
        raise StepFailed('Unreal Editor did not finish starting in 110 minutes')

    def step_editor_stop(self, args, proj, ctx):
        root, uproject, _ = self.need(proj)
        return {'summary': 'Unreal Editor closed' if self.stop_editor(root, uproject, ctx) else 'Unreal Editor was not running'}

    def stop_editor(self, root, uproject, ctx):
        hb = self.heartbeat(root)
        if not hb:
            return False
        self.log(ctx, 'Closing Unreal Editor')
        try:
            self.bridge(root, 'quit', {}, timeout=20)
        except Exception:
            pass
        mine = self.editors.get(uproject)

        def alive():
            return mine.poll() is None if mine is not None and mine.pid == hb['pid'] else _pid_alive(hb['pid'])
        t0 = time.time()
        while alive() and time.time() - t0 < 90:
            time.sleep(1)
        if alive():
            self.log(ctx, 'Unreal Editor did not close by itself; ending it')
            if platform.system() == 'Windows':
                subprocess.run(['taskkill', '/PID', str(hb['pid']), '/F'], capture_output=True)
            else:
                os.kill(hb['pid'], 9)
            time.sleep(3)
        try:
            os.remove(os.path.join(self.bridge_dir(root), 'heartbeat.json'))
        except OSError:
            pass
        return True

    def bridge(self, root, cmd, args, timeout=600):
        if not self.heartbeat(root):
            raise StepFailed('Unreal Editor is not running with the Duke Forger plugin')
        mid = uuid_hex()
        inbox = os.path.join(self.bridge_dir(root), 'inbox')
        os.makedirs(inbox, exist_ok=True)
        tmp = os.path.join(inbox, mid + '.tmp')
        with open(tmp, 'w') as f:
            json.dump({'id': mid, 'cmd': cmd, 'args': args}, f)
        os.replace(tmp, os.path.join(inbox, mid + '.json'))
        out = os.path.join(self.bridge_dir(root), 'outbox', mid + '.json')
        t0 = time.time()
        while time.time() - t0 < timeout:
            if os.path.exists(out):
                time.sleep(0.05)
                with open(out) as f:
                    ans = json.load(f)
                os.remove(out)
                if not ans.get('ok'):
                    raise StepFailed('%s\n%s' % (ans.get('error'), (ans.get('trace') or '')[-2500:]))
                return ans.get('result')
            if not self.heartbeat(root):
                time.sleep(3)
                if not self.heartbeat(root):
                    raise StepFailed('Unreal Editor stopped while running "%s"' % cmd)
            time.sleep(0.2)
        raise StepFailed('Unreal Editor did not answer "%s" within %d seconds' % (cmd, timeout))

    def step_bridge(self, args, proj, ctx):
        root, _, name = self.need(proj)
        before = len(self.editor_log(root, name, 100000))
        try:
            res = self.bridge(root, args['cmd'], args.get('args') or {}, timeout=args.get('timeout', 900))
        finally:
            new = self.editor_log(root, name, 100000)[before:]
            errs = [l.strip() for l in new if ERR_RE.search(l)]
            for l in errs[-40:]:
                self.log(ctx, 'LOG ' + l[:500])
        if isinstance(res, dict) and res.get('stdout'):
            for l in res['stdout'].splitlines()[-60:]:
                self.log(ctx, l)
        return {'result': res, 'summary': ('%d actors' % len(res['result']['actors'])) if isinstance(res, dict) and isinstance(res.get('result'), dict) and 'actors' in res['result'] else None}

    def step_test(self, args, proj, ctx):
        root, _, name = self.need(proj)
        res = self.bridge(root, 'run_test', args, timeout=300)
        for l in res.get('log', []):
            self.log(ctx, l)
        for c in res.get('checks', []):
            self.log(ctx, '%s  %s' % ('PASS' if c['ok'] else 'FAIL', c['expr']))
        for shot in res.get('screenshots', []):
            url = self.upload(ctx, shot, 'evidence')
            if url:
                ctx['evidence'].append({'type': 'screenshot', 'url': url, 'name': os.path.basename(shot)})
        errs = [l.strip() for l in self.editor_log(root, name, 400) if ERR_RE.search(l)]
        res['logErrors'] = errs[-30:]
        res['summary'] = '%s: %d/%d checks passed' % (args.get('name'), sum(1 for c in res.get('checks', []) if c['ok']), len(res.get('checks', [])))
        return res

    def upload(self, ctx, path, kind, extra=''):
        st = ctx['st']
        try:
            q = 'job=%s&kind=%s&name=%s%s' % (st['jobId'], kind, urllib.parse.quote(os.path.basename(path)), extra)
            with open(path, 'rb') as f:
                req = urllib.request.Request(self.duke.server + '/api/agent/forge/upload?' + q, data=f, method='POST', headers={
                    'x-duke-agent': self.duke.token, 'content-type': 'application/octet-stream', 'content-length': str(os.path.getsize(path))})
                with urllib.request.urlopen(req, timeout=3600) as r:
                    out = json.loads(r.read() or b'{}')
            return out.get('url') if kind == 'evidence' else out
        except Exception as e:
            self.log(ctx, 'Upload failed: %s' % e)
            return None

    # ---- compile
    def step_ubt_build(self, args, proj, ctx):
        root, uproject, name = self.need(proj)
        was_running = self.stop_editor(root, uproject, ctx)
        eng = self.engine()
        bat = os.path.join(eng['path'], 'Engine', 'Build', 'BatchFiles', 'Build.bat')
        target = name + ('Editor' if args.get('target', 'Editor') == 'Editor' else '')
        code, errors = self.run_logged([bat, target, 'Win64', args.get('config', 'Development'), '-Project=' + uproject, '-WaitMutex', '-NoHotReloadFromIDE'], ctx, cwd=root, timeout=90 * 60)
        if code != 0:
            raise StepFailed('Compile failed (exit code %s):\n%s' % (code, '\n'.join(errors[-25:]) or 'see the log'))
        if was_running or args.get('restart'):
            self.step_editor_start({'pixel': True}, proj, ctx)
        return {'summary': 'Compiled %s Win64 %s' % (target, args.get('config', 'Development')), 'warnings': len([e for e in errors if 'warning' in e.lower()])}

    # ---- files and settings
    def safe(self, root, rel):
        rel = str(rel).replace('\\', '/').lstrip('/')
        full = os.path.normpath(os.path.join(root, rel))
        if not full.startswith(os.path.normpath(root) + os.sep) or '/.git/' in '/' + rel + '/':
            raise StepFailed('Not allowed: ' + rel)
        return full

    def step_file_write(self, args, proj, ctx):
        root, _, _ = self.need(proj)
        done = []
        for rel, text in (args.get('files') or {}).items():
            full = self.safe(root, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, 'w', encoding='utf-8', newline='\n') as f:
                f.write(text)
            done.append(rel)
            self.log(ctx, 'Wrote ' + rel)
        for e in args.get('edits') or []:
            full = self.safe(root, e['path'])
            text = open(full, encoding='utf-8').read()
            if e['from'] not in text:
                raise StepFailed('Could not find the text to change in %s' % e['path'])
            open(full, 'w', encoding='utf-8', newline='\n').write(text.replace(e['from'], e['to'], 1))
            done.append(e['path'])
            self.log(ctx, 'Edited %s: %s -> %s' % (e['path'], e['from'], e['to']))
        return {'files': done, 'summary': '%d file(s) written' % len(done)}

    def step_ini_set(self, args, proj, ctx):
        root, _, _ = self.need(proj)
        full = self.safe(root, args['file'])
        lines = open(full, encoding='utf-8').read().splitlines() if os.path.exists(full) else []
        head = '[%s]' % args['section']
        if head not in lines:
            lines += ['', head]
        i = lines.index(head) + 1
        j = i
        while j < len(lines) and not lines[j].startswith('['):
            j += 1
        sec = lines[i:j]
        for k, v in (args.get('values') or {}).items():
            sec = [l for l in sec if not re.match(r'^[+\-.!]?%s=' % re.escape(k), l)] + ['%s=%s' % (k, v)]
        for k, v in (args.get('add') or {}).items():
            if '+%s=%s' % (k, v) not in sec:
                sec.append('+%s=%s' % (k, v))
        lines[i:j] = [l for l in sec if l.strip()] + ['']
        open(full, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines).rstrip() + '\n')
        self.log(ctx, 'Updated %s [%s]' % (args['file'], args['section']))
        return {'summary': 'Updated ' + args['file']}

    def step_git_commit(self, args, proj, ctx):
        root, _, _ = self.need(proj)
        return self.commit(root, args.get('message') or 'Duke Forger change', args.get('paths'))

    def commit(self, root, message, paths=None):
        if paths:
            self.git(root, 'add', '--', *paths)
        else:
            self.git(root, 'add', '-A')
        changed = self.git(root, 'diff', '--cached', '--name-status').strip()
        if changed:
            self.git(root, 'commit', '-m', message)
        sha = self.git(root, 'rev-parse', 'HEAD').strip()
        return {'sha': sha, 'changed': changed.splitlines()[:300], 'summary': ('Committed %s' % sha[:8]) if changed else 'Nothing new to commit (%s)' % sha[:8]}

    def step_live_show(self, args, proj, ctx):
        root, _, _ = self.need(proj)
        if args.get('map'):
            self.bridge(root, 'python', {'code': 'bridge.load_level(%s)\nresult = True' % json.dumps(args['map'])}, timeout=120)
        if args.get('play'):
            self.bridge(root, 'pie_start', {}, timeout=120)
        return {'summary': 'Showing in Live Unreal' + (' (playing)' if args.get('play') else '')}

    # ---- packaging
    def step_uat_package(self, args, proj, ctx):
        root, uproject, name = self.need(proj)
        eng = self.engine()
        uat = os.path.join(eng['path'], 'Engine', 'Build', 'BatchFiles', 'RunUAT.bat')
        out_dir = os.path.join(root, 'Build')
        shutil.rmtree(out_dir, ignore_errors=True)
        cfg = args.get('config', 'Development')
        code, errors = self.run_logged([uat, 'BuildCookRun', '-project=' + uproject, '-noP4', '-platform=Win64', '-clientconfig=' + cfg, '-build', '-cook',
                                        '-stage', '-pak', '-archive', '-archivedirectory=' + out_dir, '-utf8output', '-unattended'], ctx, cwd=root, timeout=4 * 3600)
        if code != 0:
            raise StepFailed('Packaging failed (exit code %s):\n%s' % (code, '\n'.join(errors[-25:]) or 'see the log'))
        exes = glob.glob(os.path.join(out_dir, '**', '*.exe'), recursive=True)
        if not exes:
            raise StepFailed('Packaging finished but no .exe was produced in ' + out_dir)
        zpath = os.path.join(tempfile.gettempdir(), '%s-Win64-%s.zip' % (name, cfg))
        zip_dir(out_dir, zpath)
        self.log(ctx, 'Uploading %.1f MB' % (os.path.getsize(zpath) / 1048576))
        up = self.upload(ctx, zpath, 'build', '&config=' + cfg)
        if not up or not up.get('buildId'):
            raise StepFailed('The build could not be uploaded to Duke Forger')
        log_file = os.path.join(tempfile.gettempdir(), '%s-package-log.txt' % name)
        open(log_file, 'w', encoding='utf-8').write('\n'.join(ctx['log']))
        url = self.upload(ctx, log_file, 'evidence')
        if url:
            ctx['evidence'].append({'type': 'log', 'url': url, 'name': 'Packaging log'})
        return {'buildId': up['buildId'], 'size': up.get('size'), 'exe': os.path.relpath(exes[0], out_dir), 'summary': 'Packaged %s (%s)' % (os.path.basename(exes[0]), cfg)}

    # ---- RPCs for the File Vault, Source Editor, History and Live Unreal controls
    def do_rpc(self, c):
        try:
            fn = getattr(self, 'rpc_' + c['op'].replace('.', '_'))
            out = {'ok': True, 'result': fn(**(c.get('args') or {}))}
        except Exception as e:
            out = {'ok': False, 'error': str(e)[:3000]}
        try:
            self.duke.post('/api/agent/forge/rpc/' + c['id'], out)
        except Exception:
            pass

    def rpc_vault_tree(self, root):
        files = []
        for dirpath, dirs, names in os.walk(root):
            rel_dir = os.path.relpath(dirpath, root).replace('\\', '/')
            rel_dir = '' if rel_dir == '.' else rel_dir
            keep = []
            for d in dirs:
                rp = (rel_dir + '/' + d).lstrip('/')
                if d in SKIP_DIRS or rp in ('Saved/Autosaves', 'Saved/Intermediate', 'Saved/Crashes', 'Saved/ShaderDebugInfo', 'Saved/StagedBuilds', 'Saved/Cooked'):
                    continue
                keep.append(d)
            dirs[:] = keep
            for n in names:
                full = os.path.join(dirpath, n)
                try:
                    stt = os.stat(full)
                except OSError:
                    continue
                files.append({'p': (rel_dir + '/' + n).lstrip('/'), 's': stt.st_size, 'm': int(stt.st_mtime * 1000)})
                if len(files) >= 20000:
                    return {'files': files, 'truncated': True}
        return {'files': files}

    def rpc_file_read(self, root, path):
        full = self.safe(root, path)
        size = os.path.getsize(full)
        ext = os.path.splitext(full)[1].lower()
        if ext in ('.png', '.jpg', '.jpeg', '.webp') and size <= 8 * 1024 * 1024:
            return {'path': path, 'size': size, 'image': base64.b64encode(open(full, 'rb').read()).decode(), 'mime': 'image/png' if ext == '.png' else 'image/jpeg' if ext in ('.jpg', '.jpeg') else 'image/webp'}
        data = open(full, 'rb').read(2 * 1024 * 1024 + 1)
        if b'\0' in data[:8000] or len(data) > 2 * 1024 * 1024:
            return {'path': path, 'size': size, 'binary': True}
        try:
            return {'path': path, 'size': size, 'text': data.decode('utf-8'), 'editable': ext in TEXT_EXT or os.path.basename(full).startswith('.')}
        except UnicodeDecodeError:
            return {'path': path, 'size': size, 'binary': True}

    def rpc_file_write(self, root, path, content):
        full = self.safe(root, path)
        if os.path.splitext(full)[1].lower() not in TEXT_EXT and not os.path.basename(full).startswith('.'):
            raise StepFailed('Only text files can be edited in the browser')
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        return {'path': path, 'size': os.path.getsize(full), 'diff': self.git(root, 'diff', '--', path, check=False)[-200000:]}

    def rpc_git_commit(self, root, message, paths=None):
        return self.commit(root, message, paths)

    def rpc_git_status(self, root):
        return {'status': self.git(root, 'status', '--porcelain').splitlines()[:2000], 'head': self.git(root, 'rev-parse', 'HEAD', check=False).strip()}

    def rpc_git_log(self, root, path=None):
        a = ['log', '-n', '200', '--date=iso-strict', '--pretty=format:%H%x09%an%x09%ad%x09%s']
        if path:
            a += ['--', path]
        rows = [l.split('\t', 3) for l in self.git(root, *a, check=False).splitlines() if l.count('\t') >= 3]
        return {'commits': [{'sha': r[0], 'author': r[1], 'date': r[2], 'message': r[3]} for r in rows]}

    def rpc_git_diff(self, root, rev=None, path=None):
        if rev:
            a = ['show', '--stat', '--patch', '--format=%H%n%an%n%ad%n%s%n', rev]
        else:
            a = ['diff', 'HEAD']
        if path:
            a += ['--', path]
        return {'diff': self.git(root, *a, check=False)[:400000]}

    def rpc_git_rollback(self, root, rev, path=None):
        if not re.match(r'^[0-9a-f]{7,40}$', rev or ''):
            raise StepFailed('Pick a revision')
        if path:
            self.safe(root, path)
            self.git(root, 'checkout', rev, '--', path)
            return self.commit(root, 'Duke Forger: restore %s to %s' % (path, rev[:8]), [path])
        if self.git(root, 'status', '--porcelain').strip():
            self.commit(root, 'Duke Forger: save work before rollback')
        self.git(root, 'revert', '--no-edit', rev)
        return {'sha': self.git(root, 'rev-parse', 'HEAD').strip(), 'summary': 'Reverted %s' % rev[:8]}

    def rpc_logs_tail(self, root, lines=400):
        name = os.path.splitext(os.path.basename((glob.glob(os.path.join(root, '*.uproject')) or ['x'])[0]))[0]
        out = []
        for l in self.editor_log(root, name, lines):
            l = l.rstrip()
            lvl = 'CRASH' if re.search(r'Fatal|Unhandled Exception|Assertion failed', l) else 'BUILD ERROR' if re.search(r'error C\d|error LNK|: error', l) else \
                'ASSET ERROR' if re.search(r'Error:.*(asset|package|LoadPackage|Failed to load)', l, re.I) else 'RUNTIME ERROR' if 'Error:' in l else \
                'PERFORMANCE WARNING' if re.search(r'hitch|Hitch|slow frame', l) else 'WARNING' if 'Warning:' in l else 'INFO'
            out.append({'level': lvl, 'text': l[:1000]})
        return {'lines': out, 'editor': self.heartbeat(root)}

    def rpc_bridge_call(self, root, cmd, args=None):
        return self.bridge(root, cmd, args or {}, timeout=120)


def uuid_hex():
    return base64.b32encode(os.urandom(10)).decode().lower().rstrip('=')


def ue_python(code):
    """Runs Python inside the open Unreal editor through Unreal's own remote execution."""
    engines = find_engines(None)
    if not engines:
        raise RuntimeError('Unreal Engine is not installed.')
    mod = os.path.join(engines[0]['path'], 'Engine', 'Plugins', 'Experimental', 'PythonScriptPlugin', 'Content', 'Python')
    if mod not in sys.path:
        sys.path.append(mod)
    import remote_execution as rex
    r = rex.RemoteExecution()
    r.start()
    try:
        for _ in range(30):
            if r.remote_nodes:
                break
            time.sleep(0.2)
        if not r.remote_nodes:
            raise RuntimeError('Unreal is not answering. Open your project in Unreal, and press "Let Duke talk to Unreal" once, then restart Unreal.')
        r.open_command_connection(r.remote_nodes[0]['node_id'])
        res = r.run_command(code, exec_mode=rex.MODE_EXEC_FILE)
        out = '\n'.join(str(o.get('output', '')).strip() for o in res.get('output', []) if o.get('output'))
        if not res.get('success'):
            raise RuntimeError(out or str(res.get('result')))
        return out or 'Done'
    finally:
        r.stop()


def main():
    for stream in (sys.stdout, sys.stderr):  # never crash on unusual characters in the Windows console
        try:
            stream.reconfigure(errors='replace')
        except Exception:
            pass
    ap = argparse.ArgumentParser(description='Duke Forger build agent')
    ap.add_argument('--server', help='Duke Forger server URL')
    ap.add_argument('--token', help='Agent token from the Build stage')
    ap.add_argument('--engine', help='Path to a UE5 install (optional, auto-detected)')
    ap.add_argument('--check', action='store_true', help='Only check this PC and exit')
    ap.add_argument('--once', action='store_true', help='Process one build then exit')
    ap.add_argument('--no-control', action='store_true', help='Duke Link: never allow Duke to control this PC')
    ap.add_argument('--no-link', action='store_true', help='Do not show your tools live in Duke')
    args = ap.parse_args()
    args.server = args.server or DEFAULT_SERVER or None
    args.token = args.token or DEFAULT_TOKEN or None

    engines = find_engines(args.engine)
    vs = has_visual_studio()
    print('Duke Forger build agent %s on %s (%s)' % (VERSION, socket.gethostname(), platform.platform()))
    print('Unreal Engine: ' + (', '.join('%s (%s)' % (e['version'], e['path']) for e in engines) or 'NOT FOUND'))
    print('Visual Studio C++ tools: ' + ('found' if vs else 'NOT FOUND'))
    if args.check:
        sys.exit(0 if engines and vs else 1)
    if not engines or not vs:
        print('\nTo build games this PC also needs (free, from the makers\' own sites):')
        if not engines:
            print('  - Epic Games Launcher, then Unreal Engine 5:  https://store.epicgames.com/download')
        if not vs:
            print('  - Visual Studio 2022 with "Game development with C++":  https://visualstudio.microsoft.com/downloads/')
        print('Duke keeps working meanwhile, and notices them as soon as they are installed.\n')
    if not args.server or not args.token:
        ap.error('--server and --token are required (copy the command from the Build stage in Duke Forger)')
    if platform.system() != 'Windows':
        print('Warning: Duke packages Windows builds; this agent is meant to run on Windows.')

    try:  # settle on the site's final address before connecting (follows www and https redirects)
        with urllib.request.urlopen(args.server.rstrip('/') + '/api/health', timeout=20) as r:
            u = urllib.parse.urlparse(r.geturl())
            args.server = '%s://%s' % (u.scheme, u.netloc)
    except Exception:
        pass
    duke = Duke(args.server, args.token)
    hello = {'host': socket.gethostname(), 'os': platform.platform(), 'engines': [e['version'] for e in engines], 'visualStudio': vs,
             'python': platform.python_version(), 'version': VERSION}
    for attempt in range(60):
        try:
            engines = report(duke, hello, args.engine)
            break
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                print('Duke does not recognise this PC key. Download a fresh DukeForger.py from step 9 in Duke.'); sys.exit(2)
            print('Duke is busy or restarting (%s). Trying again in 10 seconds...' % e.code)
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            print('Cannot reach %s yet (%s). Check your internet. Trying again in 10 seconds...' % (duke.server, getattr(e, 'reason', e)))
        time.sleep(10)
    else:
        print('Could not connect for 10 minutes. Check your internet and run Duke again.'); sys.exit(2)
    args.server = duke.server
    print('Connected to %s. Waiting for builds... (Ctrl+C to stop)' % args.server)
    if not args.no_link and not args.once:
        Link(duke, args).start()
        print('Duke Link is on: your Unreal, Blender and Character Creator windows can appear inside Duke.')
    if not args.once:
        Forge(duke, args).start()
        print('Duke Forger worker is on: Unreal projects live in %s' % FORGE_ROOT)
    os.makedirs(WORK, exist_ok=True)
    last_hello = time.time()
    while True:
        try:
            job = duke.post('/api/agent/next').get('build')
            if job:
                print('\n=== Build %s: %s ===' % (job['id'], job.get('title')))
                build(duke, job, engines, args)
                if args.once:
                    return
            elif time.time() - last_hello > 60:
                engines = report(duke, hello, args.engine); last_hello = time.time()
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print('Duke rejected the token. Download a fresh DukeForger.py from step 9 in Duke.'); sys.exit(2)
            print('Server error %s, retrying...' % e.code)
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            print('Cannot reach Duke (%s), retrying...' % e)
        time.sleep(5)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nStopped.')
    except SystemExit:
        if len(sys.argv) == 1:
            input('\nPress Enter to close this window.')
        raise
    except Exception as e:
        print('\nDuke stopped because of an error: %s' % e)
        if len(sys.argv) == 1:
            input('Press Enter to close this window.')
