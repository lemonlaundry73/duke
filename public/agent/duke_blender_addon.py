bl_info = {
    "name": "Duke Forger",
    "author": "Duke Forger",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "3D View > Sidebar (N) > Duke",
    "description": "Your Duke Forger step beside your work, one-click Send to my game, and automatic proof screenshots",
    "category": "Import-Export",
}

# Talks only to the Duke agent on this PC (127.0.0.1), using the key the agent keeps in ~/DukeForger/.local_key.
import json
import os
import tempfile
import textwrap
import threading
import time
import urllib.request

import bpy

PORT = 47811
HOME = os.path.join(os.path.expanduser("~"), "DukeForger")
EXPORTS = os.path.join(HOME, "Exports", "Blender")
STATE = {"guide": {}, "online": False, "msg": "", "busy": False}


def _key():
    try:
        with open(os.path.join(HOME, ".local_key")) as f:
            return f.read().strip()
    except OSError:
        return ""


def _call(method, path, data=None, headers=None, timeout=5):
    h = {"x-duke-local": _key()}
    h.update(headers or {})
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def _refresh():
    try:
        STATE["guide"] = _call("GET", "/guide")
        STATE["online"] = True
    except Exception:
        STATE["online"] = False


def _poll():
    threading.Thread(target=_refresh, daemon=True).start()
    wm = getattr(bpy.context, "window_manager", None)
    for win in (wm.windows if wm else []):
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                area.tag_redraw()
    return 5.0


def _screenshot():
    path = os.path.join(tempfile.gettempdir(), "duke_proof_%d.png" % int(time.time()))
    win = bpy.context.window
    area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), None)
    if area:
        with bpy.context.temp_override(window=win, area=area):
            bpy.ops.screen.screenshot_area(filepath=path)
    else:
        bpy.ops.screen.screenshot(filepath=path)
    with open(path, "rb") as f:
        data = f.read()
    try:
        os.remove(path)
    except OSError:
        pass
    return data


def _send_proof(label):
    nxt = (STATE["guide"] or {}).get("nextProof")
    if not nxt:
        return "This step doesn't need screenshots."
    out = _call("POST", "/proof", _screenshot(), {"x-label": urllib.request.quote(label), "content-type": "application/octet-stream"}, timeout=120)
    done = out.get("completed") or []
    _refresh()
    return ("Saved. Step %s is complete!" % done[-1]) if done else "Screenshot saved as proof: %s" % nxt.get("label", "")


class DUKE_OT_send(bpy.types.Operator):
    bl_idname = "duke.send_to_game"
    bl_label = "Send to my game"
    bl_description = "Exports the selected objects (or the whole scene) for Unreal and brings them into your game"

    def execute(self, context):
        os.makedirs(EXPORTS, exist_ok=True)
        base = bpy.path.clean_name(bpy.path.display_name_from_filepath(bpy.data.filepath) or "Model")
        sel = [o for o in context.selected_objects]
        if len(sel) == 1:
            base = bpy.path.clean_name(sel[0].name)
        path = os.path.join(EXPORTS, "%s_%s.fbx" % (base, time.strftime("%Y%m%d_%H%M%S")))
        bpy.ops.export_scene.fbx(filepath=path, use_selection=bool(sel), apply_scale_options="FBX_SCALE_ALL", apply_unit_scale=True,
                                 mesh_smooth_type="FACE", add_leaf_bones=False, use_tspace=True, path_mode="COPY", embed_textures=True)
        msgs = []
        try:
            out = _call("POST", "/exported", json.dumps({"path": path}).encode(), {"content-type": "application/json"}, timeout=180)
            msgs.append("In your game: " + out["imported"] if out.get("imported") else "Exported. Add your Unreal project in Duke (step 11) to import automatically.")
        except Exception:
            msgs.append("Exported to DukeForger/Exports. Start the Duke agent to bring it in automatically.")
        try:
            if (STATE["guide"] or {}).get("nextProof"):
                msgs.append(_send_proof("Blender: " + base))
        except Exception:
            pass
        STATE["msg"] = " ".join(msgs)
        self.report({"INFO"}, STATE["msg"][:250])
        return {"FINISHED"}


class DUKE_OT_proof(bpy.types.Operator):
    bl_idname = "duke.save_proof"
    bl_label = "Save a screenshot for this step"
    bl_description = "Takes a screenshot of the 3D view and saves it in Duke as proof for your current step"

    def execute(self, context):
        try:
            STATE["msg"] = _send_proof("Blender view")
        except Exception as e:
            STATE["msg"] = "Could not reach the Duke agent: %s" % e
        self.report({"INFO"}, STATE["msg"][:250])
        return {"FINISHED"}


class DUKE_OT_refresh(bpy.types.Operator):
    bl_idname = "duke.refresh"
    bl_label = "Refresh"

    def execute(self, context):
        _refresh()
        return {"FINISHED"}


class DUKE_PT_panel(bpy.types.Panel):
    bl_label = "Duke Forger"
    bl_idname = "DUKE_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Duke"

    def draw(self, context):
        col = self.layout.column(align=False)
        g = STATE["guide"] or {}
        if not STATE["online"]:
            col.label(text="Waiting for the Duke agent...", icon="ERROR")
            col.label(text="Start it from DukeForgerSetup.cmd")
            col.operator("duke.refresh", icon="FILE_REFRESH")
            return
        if not g.get("project"):
            col.label(text="Open a game in Duke first.")
            return
        st = g.get("step") or {}
        col.label(text=g["project"].get("name") or "Your game", icon="WORLD")
        box = col.box()
        box.label(text="Step %s: %s" % (st.get("n", "?"), st.get("title", "")), icon="BOOKMARKS")
        for i, line in enumerate(st.get("how") or []):
            for j, part in enumerate(textwrap.wrap(line, 38)):
                box.label(text=("%d. " % (i + 1) if j == 0 else "    ") + part)
        chk = col.box()
        chk.label(text="To finish this step  (%s%%)" % st.get("progress", 0))
        for c in g.get("checks") or []:
            extra = " (%s/%s)" % (c.get("have") or 0, c.get("min") or 1) if c.get("t") == "proof" else ""
            chk.label(text=(c.get("label") or "")[:44] + extra, icon="CHECKMARK" if c.get("ok") else "RADIOBUT_OFF")
        col.separator()
        col.operator("duke.send_to_game", icon="EXPORT")
        if g.get("nextProof"):
            col.operator("duke.save_proof", icon="IMAGE_DATA")
        if STATE["msg"]:
            for part in textwrap.wrap(STATE["msg"], 40)[:4]:
                col.label(text=part)


CLASSES = (DUKE_OT_send, DUKE_OT_proof, DUKE_OT_refresh, DUKE_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.app.timers.register(_poll, first_interval=1.0, persistent=True)


def unregister():
    if bpy.app.timers.is_registered(_poll):
        bpy.app.timers.unregister(_poll)
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
