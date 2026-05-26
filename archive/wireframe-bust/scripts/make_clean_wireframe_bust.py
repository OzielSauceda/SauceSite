"""
Make a single clean wireframe version of the ThreeDee bust.

Final result: one object named 'oziel_clean_wireframe_bust'
Exported to: <project>/public/models/oziel_wireframe_bust.glb

Handles the case where 'ThreeDee' is an Empty / collection-instance and the
actual mesh is one of its (possibly nested) children.
"""

import bpy
import os

SOURCE_NAME = "ThreeDee"
TARGET_NAME = "oziel_clean_wireframe_bust"

PROJECT_DIR = r"C:\Users\oziel\OneDrive\Desktop\TheSauceSite"
EXPORT_PATH = os.path.join(PROJECT_DIR, "public", "models", "oziel_wireframe_bust.glb")


def log(msg):
    print(f"[wireframe_bust] {msg}")


def deselect_all():
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = None


def remove_if_exists(name):
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)


def find_mesh_descendant(obj):
    """Return obj if it is a mesh, else the first MESH found among its descendants."""
    if obj.type == "MESH" and obj.data is not None:
        return obj
    stack = list(obj.children)
    while stack:
        child = stack.pop(0)
        if child.type == "MESH" and child.data is not None:
            return child
        stack.extend(child.children)
    return None


def find_source_mesh():
    """Locate the actual mesh to work from.

    Priority:
      1. Object literally named SOURCE_NAME if it is a mesh.
      2. A mesh descendant of an object named SOURCE_NAME (Empty/instance case).
      3. The largest mesh in the scene as a last resort.
    """
    named = bpy.data.objects.get(SOURCE_NAME)
    if named is not None:
        m = find_mesh_descendant(named)
        if m is not None:
            if m is not named:
                log(f"'{SOURCE_NAME}' is a {named.type}; using mesh child '{m.name}'.")
            return named, m

    # Fall back: largest mesh
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.data is not None]
    if not meshes:
        raise RuntimeError(
            f"Could not find object '{SOURCE_NAME}' (or any mesh). "
            f"Open the original bust file first."
        )
    biggest = max(meshes, key=lambda o: len(o.data.polygons))
    log(f"'{SOURCE_NAME}' not found; falling back to largest mesh '{biggest.name}'.")
    return biggest, biggest


def main():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # 1. Find the original container and its actual mesh
    original_top, src_mesh = find_source_mesh()

    # 2. Clean up previous attempts so we end with exactly ONE final object
    for stale in [TARGET_NAME, "Bust_Clean", "GraphBust", "oziel_wireframe_bust"]:
        remove_if_exists(stale)

    # 3. Duplicate the MESH (not the empty wrapper)
    deselect_all()
    src_mesh.hide_set(False)
    src_mesh.hide_viewport = False
    bpy.context.view_layer.objects.active = src_mesh
    src_mesh.select_set(True)
    bpy.ops.object.duplicate(linked=False)
    dup = bpy.context.active_object

    if dup is None or dup.type != "MESH" or dup.data is None:
        raise RuntimeError(
            "Duplication did not produce a mesh. Active object after duplicate is "
            f"{dup!r}. Try selecting the bust mesh manually before running."
        )

    # Sever parenting so transforms are clean and standalone
    if dup.parent is not None:
        mw = dup.matrix_world.copy()
        dup.parent = None
        dup.matrix_world = mw

    dup.name = TARGET_NAME
    dup.data.name = TARGET_NAME + "_mesh"

    # Make sure the duplicate is visible
    dup.hide_set(False)
    dup.hide_render = False
    dup.hide_viewport = False

    # 4. Apply any existing modifiers on the duplicate (clean slate)
    deselect_all()
    bpy.context.view_layer.objects.active = dup
    dup.select_set(True)
    for m in list(dup.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception:
            dup.modifiers.remove(m)

    # 5. Decimate -- two passes for a clean readable topology
    planar = dup.modifiers.new(name="Decimate_Planar", type='DECIMATE')
    planar.decimate_type = 'DISSOLVE'
    planar.angle_limit = 0.2618  # ~15 degrees -> simplifies flat areas (shoulders) more
    bpy.ops.object.modifier_apply(modifier=planar.name)

    collapse = dup.modifiers.new(name="Decimate_Collapse", type='DECIMATE')
    collapse.decimate_type = 'COLLAPSE'
    collapse.ratio = 0.08  # ~8% of remaining tris
    bpy.ops.object.modifier_apply(modifier=collapse.name)

    # 6. Wireframe modifier (thin tubes) -> clean vector head look
    wf = dup.modifiers.new(name="Wireframe", type='WIREFRAME')
    wf.thickness = 0.0025
    wf.use_replace = True
    wf.use_even_offset = True
    wf.use_relative_offset = False
    wf.use_boundary = True
    bpy.ops.object.modifier_apply(modifier=wf.name)

    # 7. Light-gray emissive material (no orange, no node spheres, no dots)
    mat = bpy.data.materials.get("OzielWireframeMat")
    if mat is None:
        mat = bpy.data.materials.new(name="OzielWireframeMat")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.92, 0.92, 0.92, 1.0)
    emit.inputs["Strength"].default_value = 1.2
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])

    dup.data.materials.clear()
    dup.data.materials.append(mat)

    # 8. Hide the original (whole top-level group, so nothing leaks into render)
    def hide_recursive(o):
        try:
            o.hide_set(True)
        except Exception:
            pass
        o.hide_render = True
        for c in o.children:
            hide_recursive(c)

    hide_recursive(original_top)

    # 9. Export ONLY the final object as GLB
    os.makedirs(os.path.dirname(EXPORT_PATH), exist_ok=True)
    deselect_all()
    bpy.context.view_layer.objects.active = dup
    dup.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=EXPORT_PATH,
        use_selection=True,
        export_format='GLB',
        export_apply=True,
        export_yup=True,
    )

    log(f"OK -- created '{TARGET_NAME}' and exported -> {EXPORT_PATH}")


main()
