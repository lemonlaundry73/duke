# Run on the Windows PC that has Unreal Engine 5 and Visual Studio (the Duke build agent's machine):
#   python tools/unreal/build_characters.py --ue "C:/Program Files/Epic Games/UE_5.4" --project "D:/Games/DukeGame"
# 1. copies the character packs (Empire trooper, Alliance trooper, Jedi) and the current Duke C++ / import scripts into the project
# 2. compiles DukeGameEditor (Build.bat)            3. imports each pack (duke_trooper_import.py, headless editor)
# 4. runs the automation test DukeForge.Characters  5. writes build_characters_report.json + the logs next to it
import argparse, glob, json, os, shutil, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
PACKS = ['clone_trooper', 'ally_trooper', 'jedi']
ap = argparse.ArgumentParser(); ap.add_argument('--ue', required=True); ap.add_argument('--project', required=True); ap.add_argument('--skip-build', action='store_true')
a = ap.parse_args()
proj = a.project if os.path.isdir(a.project) else os.path.dirname(a.project)
uproject = next(iter(glob.glob(os.path.join(proj, '*.uproject'))), None)
if not uproject: sys.exit('no .uproject in ' + proj)
editor = os.path.join(a.ue, 'Engine', 'Binaries', 'Win64', 'UnrealEditor-Cmd.exe'); build_bat = os.path.join(a.ue, 'Engine', 'Build', 'BatchFiles', 'Build.bat')
for f in (editor, build_bat):
    if not os.path.isfile(f): sys.exit('not found: ' + f)
out = os.path.join(proj, 'Saved', 'DukeForge', time.strftime('characters_%Y%m%d_%H%M%S')); os.makedirs(out, exist_ok=True)
report = {'project': uproject, 'steps': []}
def step(name, cmd):
    log = os.path.join(out, name + '.log'); t0 = time.time()
    with open(log, 'w', encoding='utf-8', errors='replace') as fh:
        rc = subprocess.call(cmd, stdout=fh, stderr=subprocess.STDOUT)
    text = open(log, encoding='utf-8', errors='replace').read()
    errors = [l.strip() for l in text.splitlines() if (' error ' in l.lower() or 'error:' in l.lower() or 'Error: ' in l) and 'warning' not in l.lower()][:40]
    report['steps'].append({'step': name, 'exit_code': rc, 'seconds': round(time.time() - t0), 'log': log, 'errors': errors})
    print(f'{name}: exit {rc}, {len(errors)} error lines')
    return rc, text
# 1. sources and packs
src_cpp = os.path.join(REPO, 'src', 'unreal', 'template', 'Source', 'DukeGame'); dst_cpp = os.path.join(proj, 'Source', 'DukeGame'); os.makedirs(dst_cpp, exist_ok=True)
for f in glob.glob(os.path.join(src_cpp, '*.*')): shutil.copy2(f, dst_cpp)
dst_py = os.path.join(proj, 'Content', 'Python'); os.makedirs(dst_py, exist_ok=True)
for f in glob.glob(os.path.join(REPO, 'src', 'unreal', 'template', 'Content', 'Python', '*.py')): shutil.copy2(f, dst_py)
for p in PACKS:
    d = os.path.join(proj, 'Import', 'characters', p)
    for sub in ('Unreal', 'Audio'):
        s = os.path.join(REPO, 'assets', 'characters', p, sub)
        if os.path.isdir(s): shutil.copytree(s, os.path.join(d, sub), dirs_exist_ok=True)
report['copied'] = {'cpp': dst_cpp, 'packs': PACKS}
# 2. compile
if not a.skip_build:
    rc, _ = step('compile', [build_bat, 'DukeGameEditor', 'Win64', 'Development', '-Project=' + uproject, '-WaitMutex', '-NoHotReload'])
    if rc != 0: json.dump(report, open(os.path.join(out, 'build_characters_report.json'), 'w'), indent=1); sys.exit('compile failed: see ' + out)
# 3. import each pack
script = os.path.join(dst_py, 'duke_trooper_import.py')
for p in PACKS:
    step('import_' + p, [editor, uproject, '-run=pythonscript', '-script=' + script + ' ' + os.path.join(proj, 'Import', 'characters', p), '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'])
# 4. automation test
rc, text = step('test', [editor, uproject, '-ExecCmds=Automation RunTests DukeForge;Quit', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput', '-testexit=Automation Test Queue Empty'])
report['test_passed'] = 'Result={Success}' in text and 'Result={Fail}' not in text
json.dump(report, open(os.path.join(out, 'build_characters_report.json'), 'w'), indent=1)
print('report:', os.path.join(out, 'build_characters_report.json'), '| test passed:', report['test_passed'])
