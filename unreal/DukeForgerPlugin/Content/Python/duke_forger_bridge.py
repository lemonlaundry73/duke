"""Duke Forger bridge, running inside the Unreal Editor.

The Duke Forger worker on this PC writes JSON commands into <Project>/Saved/DukeForger/inbox and reads the
answers from <Project>/Saved/DukeForger/outbox. Commands run on the editor's main thread (from a Slate tick),
so they can safely change levels, assets and actors, and drive Play-In-Editor (PIE) tests across frames.

Command file:  {"id": "abc", "cmd": "python" | "run_test" | ..., "args": {...}}
Answer file:   {"id": "abc", "ok": true, "result": {...}} or {"id": "abc", "ok": false, "error": "...", "trace": "..."}
"""
import glob
import io
import json
import os
import sys
import time
import traceback

import unreal

SAVED = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_saved_dir())
BASE = os.path.join(SAVED, 'DukeForger')
INBOX = os.path.join(BASE, 'inbox')
OUTBOX = os.path.join(BASE, 'outbox')
EVIDENCE = os.path.join(BASE, 'evidence')
HEARTBEAT = os.path.join(BASE, 'heartbeat.json')
VERSION = '1.0.0'
CUBE = '/Engine/BasicShapes/Cube.Cube'
PLANE = '/Engine/BasicShapes/Plane.Plane'
SPHERE = '/Engine/BasicShapes/Sphere.Sphere'
CYLINDER = '/Engine/BasicShapes/Cylinder.Cylinder'

_state = {'handle': None, 'job': None, 'beat': 0.0}


# ---------------------------------------------------------------- lifecycle
def start():
    for d in (INBOX, OUTBOX, EVIDENCE):
        os.makedirs(d, exist_ok=True)
    if _state['handle'] is None:
        _state['handle'] = unreal.register_slate_post_tick_callback(_tick)
    _beat(force=True)
    unreal.log('Duke Forger bridge %s ready: %s' % (VERSION, BASE))


def _beat(force=False):
    now = time.time()
    if not force and now - _state['beat'] < 1.0:
        return
    _state['beat'] = now
    try:
        info = {'time': now, 'pid': os.getpid(), 'version': VERSION, 'pie': in_pie(), 'busy': _state['job'] is not None,
                'map': _editor_world_path(), 'engine': unreal.SystemLibrary.get_engine_version(),
                'project': unreal.Paths.get_base_filename(unreal.Paths.get_project_file_path())}
        tmp = HEARTBEAT + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(info, f)
        os.replace(tmp, HEARTBEAT)
    except Exception:
        pass


def _tick(delta):
    _beat()
    job = _state['job']
    if job is not None:
        _step(job)
        return
    files = sorted(glob.glob(os.path.join(INBOX, '*.json')), key=os.path.getmtime)
    if not files:
        return
    path = files[0]
    try:
        with open(path) as f:
            msg = json.load(f)
    except Exception:
        return  # still being written; try next tick
    try:
        os.remove(path)
    except OSError:
        pass
    fn = COMMANDS.get(msg.get('cmd'))
    if fn is None:
        return _answer(msg.get('id'), False, error='Unknown command: %s' % msg.get('cmd'))
    try:
        out = fn(**(msg.get('args') or {}))
    except Exception as e:
        return _answer(msg.get('id'), False, error=str(e), trace=traceback.format_exc())
    if hasattr(out, 'send'):  # a multi-frame command (generator)
        _state['job'] = {'id': msg.get('id'), 'gen': out, 'wake': 0.0}
        _step(_state['job'])
    else:
        _answer(msg.get('id'), True, result=out)


def _step(job):
    if time.time() < job['wake']:
        return
    try:
        wait = next(job['gen'])
        job['wake'] = time.time() + float(wait or 0)
    except StopIteration as stop:
        _state['job'] = None
        _answer(job['id'], True, result=stop.value)
    except Exception as e:
        _state['job'] = None
        _answer(job['id'], False, error=str(e), trace=traceback.format_exc())


def _answer(mid, ok, **kw):
    data = dict(kw, id=mid, ok=ok)
    path = os.path.join(OUTBOX, '%s.json' % mid)
    with open(path + '.tmp', 'w') as f:
        json.dump(_jsonable(data), f)
    os.replace(path + '.tmp', path)


def _jsonable(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if isinstance(v, unreal.Vector):
        return [round(v.x, 3), round(v.y, 3), round(v.z, 3)]
    if isinstance(v, unreal.Rotator):
        return {'pitch': round(v.pitch, 3), 'yaw': round(v.yaw, 3), 'roll': round(v.roll, 3)}
    if isinstance(v, unreal.Object):
        return v.get_path_name()
    return str(v)


# ---------------------------------------------------------------- editor helpers
def _les():
    return unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)


def _eas():
    return unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def _ues():
    return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem)


def in_pie():
    try:
        return bool(_les().is_in_play_in_editor())
    except Exception:
        return False


def pie_world():
    try:
        return _ues().get_game_world()
    except Exception:
        return None


def editor_world():
    return _ues().get_editor_world()


def _editor_world_path():
    try:
        w = editor_world()
        return w.get_path_name() if w else None
    except Exception:
        return None


def new_level(path):
    les = _les()
    try:
        ok = les.new_level(path, False)
    except TypeError:
        ok = les.new_level(path)
    if not ok:
        raise RuntimeError('Could not create level ' + path)
    return path


def load_level(path):
    if not _les().load_level(path):
        raise RuntimeError('Could not load level ' + path)
    return path


def save_all():
    _les().save_current_level()
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    return True


def actors_with_tag(tag, world=None):
    return list(unreal.GameplayStatics.get_all_actors_with_tag(world or editor_world(), unreal.Name(tag)))


def clear_tag(tag):
    gone = 0
    for a in actors_with_tag(tag):
        _eas().destroy_actor(a)
        gone += 1
    return gone


def _rot(yaw=0.0, pitch=0.0, roll=0.0):
    return unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw)


def _tag(actor, tags, label):
    actor.set_actor_label(label)
    actor.set_editor_property('tags', [unreal.Name(t) for t in tags])
    return actor


def spawn_mesh(label, loc, scale=(1, 1, 1), yaw=0.0, mesh=CUBE, material=None, tags=('Duke',)):
    a = _eas().spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(*loc), _rot(yaw))
    smc = a.static_mesh_component
    smc.set_static_mesh(unreal.load_asset(mesh))
    if material:
        smc.set_material(0, unreal.load_asset(material))
    a.set_actor_scale3d(unreal.Vector(*scale))
    return _tag(a, tags, label)


def spawn_class(label, class_path, loc, yaw=0.0, props=None, tags=('Duke',)):
    cls = unreal.load_class(None, class_path)
    if cls is None:
        raise RuntimeError('Class not found: %s (did the code compile?)' % class_path)
    a = _eas().spawn_actor_from_class(cls, unreal.Vector(*loc), _rot(yaw))
    for k, v in (props or {}).items():
        a.set_editor_property(k, v)
    return _tag(a, tags, label)


def spawn_point_light(label, loc, intensity=5000.0, radius=1500.0, color=(1, 0.95, 0.85), tags=('Duke',)):
    a = spawn_class(label, '/Script/Engine.PointLight', loc, tags=tags)
    comp = a.get_component_by_class(unreal.PointLightComponent)
    comp.set_editor_property('intensity', float(intensity))
    comp.set_editor_property('attenuation_radius', float(radius))
    comp.set_editor_property('light_color', unreal.Color(r=int(color[0] * 255), g=int(color[1] * 255), b=int(color[2] * 255), a=255))
    return a


def color_material(name, rgb, folder='/Game/DukeForger/Materials'):
    """A material instance of the engine's basic shape material in a solid color."""
    path = '%s/%s' % (folder, name)
    lib = unreal.MaterialEditingLibrary
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        mi = unreal.load_asset(path)
    else:
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, folder, unreal.MaterialInstanceConstant,
                                                                     unreal.MaterialInstanceConstantFactoryNew())
    lib.set_material_instance_parent(mi, unreal.load_asset('/Engine/BasicShapes/BasicShapeMaterial'))
    lib.set_material_instance_vector_parameter_value(mi, 'Color', unreal.LinearColor(rgb[0], rgb[1], rgb[2], 1.0))
    got = lib.get_material_instance_vector_parameter_value(mi, 'Color')
    if abs(got.r - rgb[0]) > 0.01 or abs(got.g - rgb[1]) > 0.01 or abs(got.b - rgb[2]) > 0.01:
        raise RuntimeError('The engine basic material has no Color parameter in this Unreal version')
    unreal.EditorAssetLibrary.save_loaded_asset(mi)
    return path


def describe(tag='Duke'):
    out = []
    for a in actors_with_tag(tag):
        out.append({'label': a.get_actor_label(), 'class': a.get_class().get_name(), 'location': _jsonable(a.get_actor_location()),
                    'scale': _jsonable(a.get_actor_scale3d()), 'tags': [str(t) for t in a.tags]})
    return out


def set_default_maps(map_path):
    """Makes the map the editor startup map and the game's default map (written to the project's config)."""
    settings = unreal.get_default_object(unreal.GameMapsSettings)
    soft = unreal.SoftObjectPath(map_path)
    settings.set_editor_property('editor_startup_map', soft)
    settings.set_editor_property('game_default_map', soft)
    return map_path


# ---------------------------------------------------------------- commands
def cmd_ping():
    return {'version': VERSION, 'pie': in_pie(), 'map': _editor_world_path(), 'engine': unreal.SystemLibrary.get_engine_version()}


def cmd_python(code, **_):
    g = {'unreal': unreal, 'bridge': sys.modules[__name__], 'result': None, '__name__': '__duke__'}
    buf, old = io.StringIO(), sys.stdout
    sys.stdout = buf
    try:
        exec(compile(code, '<duke-forger>', 'exec'), g)
    finally:
        sys.stdout = old
    return {'result': _jsonable(g.get('result')), 'stdout': buf.getvalue()[-20000:]}


def cmd_save_all():
    return save_all()


def cmd_describe(tag='Duke'):
    return describe(tag)


def cmd_pie_start():
    if not in_pie():
        _les().editor_request_begin_play()
    t0 = time.time()
    while time.time() - t0 < 60:
        w = pie_world()
        if w and unreal.GameplayStatics.get_player_pawn(w, 0):
            return {'pie': True, 'seconds': round(time.time() - t0, 2)}
        yield 0.2
    raise RuntimeError('Play-In-Editor did not start within 60 seconds')


def cmd_pie_stop():
    if in_pie():
        _les().editor_request_end_play()
    t0 = time.time()
    while in_pie() and time.time() - t0 < 30:
        yield 0.2
    return {'pie': in_pie()}


def _screenshot(name, world):
    """HighResShot of the active viewport (the PIE view while playing). Returns the saved PNG path."""
    shots = os.path.join(SAVED, 'Screenshots')
    before = set(glob.glob(os.path.join(shots, '**', '*.png'), recursive=True))
    unreal.SystemLibrary.execute_console_command(world, 'HighResShot 1280x720')
    t0 = time.time()
    while time.time() - t0 < 15:
        new = [p for p in glob.glob(os.path.join(shots, '**', '*.png'), recursive=True) if p not in before]
        if new:
            src = max(new, key=os.path.getmtime)
            yield 0.5  # let the file finish writing
            dest = os.path.join(EVIDENCE, '%s_%d.png' % (name, int(time.time())))
            with open(src, 'rb') as a, open(dest, 'wb') as b:
                b.write(a.read())
            return dest
        yield 0.25
    return None


def cmd_screenshot(name='editor'):
    w = pie_world() or editor_world()
    path = yield from _screenshot(name, w)
    if not path:
        raise RuntimeError('No screenshot was written')
    return {'path': path}


def cmd_run_test(name, steps, asserts=(), **_):
    """A scripted runtime test. Steps run across frames; values saved by steps can be checked by asserts.

    steps: [{"op": "start_pie"}, {"op": "wait", "s": 2}, {"op": "find", "tag": "Door", "save": "door"},
            {"op": "get", "actor": "door", "prop": "open_alpha", "save": "before"},
            {"op": "teleport_player", "near": "door", "offset": [-150, 0, 0]}, {"op": "screenshot", "name": "door"},
            {"op": "stop_pie"}]
    asserts: ["before < 0.1", "after > 0.9"]
    """
    vars_, actors, log, shots = {}, {}, [], []
    pie = {'started': False}

    def world():
        return pie_world() or editor_world()

    try:
        for i, s in enumerate(steps):
            op = s.get('op')
            log.append('%d. %s' % (i + 1, json.dumps(s)))
            if op == 'start_pie':
                r = yield from cmd_pie_start()
                pie['started'] = True
                log.append('   PIE running after %ss' % r['seconds'])
            elif op == 'stop_pie':
                yield from cmd_pie_stop()
                pie['started'] = False
            elif op == 'wait':
                yield float(s.get('s', 1))
            elif op == 'find':
                found = actors_with_tag(s['tag'], world())
                if not found:
                    raise RuntimeError('No actor tagged %s in %s' % (s['tag'], 'PIE' if in_pie() else 'the editor'))
                actors[s['save']] = found[0]
                vars_[s['save'] + '_count'] = len(found)
                log.append('   found %d actor(s) tagged %s' % (len(found), s['tag']))
            elif op == 'get':
                v = actors[s['actor']].get_editor_property(s['prop'])
                vars_[s['save']] = _jsonable(v)
                log.append('   %s.%s = %s' % (s['actor'], s['prop'], vars_[s['save']]))
            elif op == 'location':
                vars_[s['save']] = _jsonable(actors[s['actor']].get_actor_location())
            elif op == 'teleport_player':
                w = world()
                pawn = unreal.GameplayStatics.get_player_pawn(w, 0)
                if pawn is None:
                    raise RuntimeError('No player pawn: is PIE running and is there a Player Start?')
                if 'near' in s:
                    base = actors[s['near']].get_actor_location()
                    off = s.get('offset', [0, 0, 0])
                    target = unreal.Vector(base.x + off[0], base.y + off[1], base.z + off[2])
                else:
                    target = unreal.Vector(*s['to'])
                pawn.set_actor_location(target, False, True)
                log.append('   player moved to %s' % _jsonable(pawn.get_actor_location()))
            elif op == 'player_location':
                pawn = unreal.GameplayStatics.get_player_pawn(world(), 0)
                vars_[s['save']] = _jsonable(pawn.get_actor_location()) if pawn else None
            elif op == 'screenshot':
                p = yield from _screenshot(s.get('name', name), world())
                if p:
                    shots.append(p)
                log.append('   screenshot: %s' % p)
            else:
                raise RuntimeError('Unknown test step: %s' % op)
    finally:
        if pie['started'] and in_pie():
            _les().editor_request_end_play()
    checks = []
    for expr in asserts:
        try:
            ok = bool(eval(expr, {'__builtins__': {}, 'abs': abs, 'min': min, 'max': max}, dict(vars_)))
        except Exception as e:
            ok = False
            log.append('   assert error in %s: %s' % (expr, e))
        checks.append({'expr': expr, 'ok': ok})
    return {'name': name, 'passed': all(c['ok'] for c in checks) if checks else True, 'checks': checks, 'vars': vars_,
            'screenshots': shots, 'log': log}


def cmd_quit():
    unreal.SystemLibrary.quit_editor()
    return True


COMMANDS = {
    'ping': cmd_ping,
    'python': cmd_python,
    'save_all': cmd_save_all,
    'describe': cmd_describe,
    'pie_start': cmd_pie_start,
    'pie_stop': cmd_pie_stop,
    'screenshot': cmd_screenshot,
    'run_test': cmd_run_test,
    'quit': cmd_quit,
}
