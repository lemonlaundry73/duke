"""Duke Forge Unreal Editor bridge starter.
Run inside Unreal Editor's Python environment:
  import duke_import_manifest
  duke_import_manifest.import_manifest(r"C:/path/engine-manifest.json")
"""
import json, os
import unreal

ROOT = "/Game/DukeForge"

def _import_file(filename, destination):
    task = unreal.AssetImportTask()
    task.filename = filename
    task.destination_path = destination
    task.automated = True
    task.save = True
    task.replace_existing = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return [str(x) for x in task.imported_object_paths]

def import_manifest(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    unreal.log(f"Duke Forge: importing {manifest_path}")
    imported = []
    # Duke packages may contain remote URLs. Production Build Cloud should download
    # them into the package before this bridge runs. Local file URLs are imported now.
    for asset in manifest.get("assets", []):
        urls = asset.get("modelUrls") or {}
        source = urls.get("fbx") or urls.get("glb")
        if source and os.path.isfile(source):
            dest = f"{ROOT}/Assets/{asset.get('type','Asset').title()}"
            imported += _import_file(source, dest)
    # Persist the manifest itself in Saved for downstream PCG / Blueprint generation.
    saved = unreal.Paths.project_saved_dir()
    out_dir = os.path.join(saved, "DukeForge")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "engine-manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    unreal.log(f"Duke Forge: imported {len(imported)} assets. Manifest copied to {out}")
    return imported
