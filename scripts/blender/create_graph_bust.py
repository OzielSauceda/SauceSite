"""
Clean wireframe bust generator.

Goal: one clean low/medium-density wireframe object built from the paid AI bust
named `ThreeDee`. No node spheres. No point clouds. No vertex dots. Just
wireframe topology lines.

Pipeline:
    1. Delete leftover generated objects from earlier experiments.
    2. Keep `ThreeDee` untouched.
    3. Duplicate it ONCE.
    4. Voxel remesh -> fuses the noisy iso-surface bumps into one skin.
    5. Decimate -> target 2,000-6,000 faces.
    6. Apply a Wireframe modifier so the GLB IS literal wireframe geometry.
    7. Assign a light-gray material (no orange default).
    8. Rename the result `oziel_clean_wireframe_bust`.
    9. Hide `ThreeDee` (preserved, not deleted).
   10. Export GLB to public/models/oziel_wireframe_bust.glb.

Run from Blender 5.1:
    blender "C:/Users/oziel/OneDrive/Desktop/Untitled.blend" \
        --background \
        --python scripts/blender/create_graph_bust.py

Or open the .blend and run inside the Scripting workspace.
"""

import os

import bpy

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SOURCE_NAME = "ThreeDee"
RESULT_NAME = "oziel_clean_wireframe_bust"

# Voxel size fuses bumpy noise. Bigger = smoother (loses detail), smaller =
# keeps detail (keeps some lumps). 0.015 is a balanced starting point.
VOXEL_SIZE = 0.015

# Final face count target before the wireframe modifier. Aim 2k-6k.
TARGET_FACES = 4000

# Wireframe modifier tube thickness (in object units).
WIRE_THICKNESS = 0.004

# Light gray, slightly emissive-looking line color (no orange).
LINE_COLOR = (0.85, 0.85, 0.85, 1.0)

# Hard-pin to the TheSauceSite project. Do NOT derive from the .blend file
# location -- the .blend lives on the Desktop, the project does not.
PROJECT_DIR = r"C:\Users\oziel\OneDrive\Desktop\TheSauceSite"
EXPORT_PATH = os.path.join(PROJECT_DIR, "public", "models", "oziel_wireframe_bust.glb")

# Objects/prefixes to wipe before building anew.
CLEANUP_EXACT = {
    "GraphBust_NodePr",
    "GraphBust_NodeProto",
    "GraphBust_Nodes",
    "GraphBust_Edg",
    "GraphBust_Edges",
    "Bust_Clean",
    "ThreeDee_2",
    "ThreeDee_graph_base",
    RESULT_NAME,
}
CLEANUP_PREFIXES = (
    "GraphBust",
    "Bust_Clean",
    "ThreeDee_2",
    "ThreeDee_graph",
    f"{RESULT_NAME}.",  # e.g. .001, .002 from re-runs
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print(f"[wireframe_bust] {msg}")


def deselect_all() -> None:
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    bpy.context.view_layer.objects.active = None


def activate(obj: bpy.types.Object) -> None:
    deselect_all()
    obj.hide_set(False)
    obj.hide_viewport = False
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def should_delete(name: str) -> bool:
    if name == SOURCE_NAME:
        return False
    if name in CLEANUP_EXACT:
        return True
    return any(name.startswith(p) for p in CLEANUP_PREFIXES)


def cleanup_scene() -> None:
    victims = [o for o in bpy.data.objects if should_delete(o.name)]
    if not victims:
        log("Cleanup: nothing to delete.")
        return
    deselect_all()
    for obj in victims:
        try:
            obj.hide_set(False)
        except Exception:
            pass
        obj.select_set(True)
    bpy.ops.object.delete()
    log(f"Cleanup: deleted {len(victims)} stale objects: {[o.name for o in victims]}")

    # Purge orphan data so they don't haunt re-exports.
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def find_source() -> bpy.types.Object:
    obj = bpy.data.objects.get(SOURCE_NAME)
    if obj and obj.type == "MESH":
        return obj
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh objects found (expected '{SOURCE_NAME}').")
    biggest = max(meshes, key=lambda o: len(o.data.polygons))
    log(f"'{SOURCE_NAME}' not found; using largest mesh: {biggest.name}")
    return biggest


def make_line_material() -> bpy.types.Material:
    mat = bpy.data.materials.get("WireframeBust_LineMat")
    if mat is None:
        mat = bpy.data.materials.new("WireframeBust_LineMat")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = LINE_COLOR
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = 0.5
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = LINE_COLOR
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = 0.2
    return mat


def apply_modifier(obj: bpy.types.Object, mod_name: str) -> None:
    activate(obj)
    bpy.ops.object.modifier_apply(modifier=mod_name)


def voxel_remesh(obj: bpy.types.Object) -> None:
    activate(obj)
    mod = obj.modifiers.new("VoxelFuse", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = VOXEL_SIZE
    mod.use_smooth_shade = True
    apply_modifier(obj, mod.name)
    log(f"Voxel remesh ({VOXEL_SIZE}): {len(obj.data.polygons)} faces")


def decimate_to_target(obj: bpy.types.Object, target: int) -> None:
    current = len(obj.data.polygons)
    if current <= target:
        log(f"Decimate skipped (already {current} <= {target})")
        return
    ratio = max(0.001, min(1.0, target / current))
    activate(obj)
    mod = obj.modifiers.new("ToTarget", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    apply_modifier(obj, mod.name)
    log(f"Decimate ratio={ratio:.4f}: {len(obj.data.polygons)} faces")


def add_wireframe(obj: bpy.types.Object) -> None:
    activate(obj)
    mod = obj.modifiers.new("Wireframe", "WIREFRAME")
    mod.thickness = WIRE_THICKNESS
    mod.use_replace = True
    mod.use_even_offset = True
    mod.use_relative_offset = False
    mod.use_boundary = True
    apply_modifier(obj, mod.name)
    log(f"Wireframe modifier applied @ {WIRE_THICKNESS}")


def assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def export_glb(obj: bpy.types.Object) -> None:
    os.makedirs(os.path.dirname(EXPORT_PATH), exist_ok=True)
    activate(obj)
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    log(f"Exported -> {EXPORT_PATH}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # 1. Wipe stale generated objects.
    cleanup_scene()

    # 2. Locate original; do not modify it.
    src = find_source()
    log(f"Source preserved: {src.name} ({len(src.data.polygons)} faces)")

    # 3. Duplicate ONCE.
    activate(src)
    bpy.ops.object.duplicate(linked=False)
    work = bpy.context.active_object
    work.name = "__wireframe_work_tmp"
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # 4. Voxel remesh -> 5. Decimate to target -> 6. Wireframe modifier.
    voxel_remesh(work)
    decimate_to_target(work, TARGET_FACES)
    add_wireframe(work)

    # 7. Light gray material.
    assign_material(work, make_line_material())

    # 8. Final name.
    work.name = RESULT_NAME
    work.data.name = RESULT_NAME

    # 9. Hide original (do NOT delete).
    src.hide_set(True)
    src.hide_render = True

    # 10. Export.
    export_glb(work)
    log(f"Done. Result object: {RESULT_NAME}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        log(f"FAILED: {exc}")
        raise
