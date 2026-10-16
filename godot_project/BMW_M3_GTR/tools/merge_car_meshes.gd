extends SceneTree
# Merges the BMW car's MeshInstance3D parts into one mesh per material, so the
# car costs ~30 draw calls instead of ~195. The doors are merged separately and
# stay under their DOOR_L / DOOR_R pivots so they can still swing open.
# Merged meshes get LODs and a position-only shadow mesh, like the scene
# importer generates.
#
# Run from the project folder (overwrites the scene, back it up first):
#   godot --headless --path . --script res://tools/merge_car_meshes.gd
# Nothing is saved if any error is found.

const SCENE_PATH := "res://SceneFIles/BMW_M3_GTR_SCENE_02.tscn"
const CAR_ROOT := "FBX_ m3_fbx"
const MOVABLE_PARTS: Array[String] = ["DOOR_L", "DOOR_R"]
# Empty leftover nodes to delete from the scene.
const LEFTOVER_NODES: Array[String] = ["Sketchfab_Scene"]
# Interior parts sit inside the car body, so their shadows are never visible.
const NO_SHADOW_PATTERN := "(_interior|_int_(carbon|plastic|leather|seat|metal_blk)_|^RPM_|^LED_|^GAUGE_)"
const OPTIONAL_ATTRIBUTES: Array[int] = [Mesh.ARRAY_NORMAL, Mesh.ARRAY_TANGENT, Mesh.ARRAY_COLOR,
	Mesh.ARRAY_TEX_UV, Mesh.ARRAY_TEX_UV2]
const UNSUPPORTED_ATTRIBUTES: Array[int] = [Mesh.ARRAY_BONES, Mesh.ARRAY_WEIGHTS]
# CUSTOM0-3 (leftover extra UV sets from the FBX) are dropped: only custom
# shaders can read them, and the car uses StandardMaterial3D only.

var _no_shadow := RegEx.create_from_string(NO_SHADOW_PATTERN)
var _errors: PackedStringArray = []


func _initialize() -> void:
	var scene: Node = (load(SCENE_PATH) as PackedScene).instantiate()
	var car := scene.get_node(CAR_ROOT) as Node3D

	var before := _count_mesh_instances(car)
	var movable: Array[Node3D] = []
	for part_name in MOVABLE_PARTS:
		movable.append(car.get_node(part_name) as Node3D)

	_merge_children(car, scene, movable)
	var nothing_to_keep: Array[Node3D] = []
	for part in movable:
		_merge_children(part, scene, nothing_to_keep)

	for leftover in LEFTOVER_NODES:
		var node := scene.get_node_or_null(leftover)
		if node:
			node.get_parent().remove_child(node)
			node.free()

	var after := _count_mesh_instances(car)
	if not _errors.is_empty():
		printerr("MERGE aborted, scene not saved:\n  " + "\n  ".join(_errors))
		scene.free()
		quit(1)
		return

	var packed := PackedScene.new()
	var err := packed.pack(scene)
	if err == OK:
		err = ResourceSaver.save(packed, SCENE_PATH)
	print("MERGE car mesh instances: %d -> %d, save: %s" % [before, after, error_string(err)])
	scene.free()
	quit(0 if err == OK else 1)


# Replaces every mesh below `container` (except the `keep` subtrees) with one
# MeshInstance3D per (material, shadow casting) pair.
func _merge_children(container: Node3D, owner: Node, keep: Array[Node3D]) -> void:
	var groups := {}  # key -> {material, cast, name, parts: [[arrays, Transform3D]], flags}
	var order: Array[String] = []
	for mi in _find_mesh_instances(container, keep):
		var xform := _transform_relative_to(mi, container)
		var cast := mi.cast_shadow
		if _no_shadow.search(mi.name):
			cast = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var mesh := mi.mesh
		for s in mesh.get_surface_count():
			if mesh.surface_get_primitive_type(s) != Mesh.PRIMITIVE_TRIANGLES:
				_errors.append("%s surface %d is not triangles" % [mi.name, s])
				continue
			var arrays := mesh.surface_get_arrays(s)
			for t in UNSUPPORTED_ATTRIBUTES:
				if _has(arrays, t):
					_errors.append("%s surface %d has custom/skinning data (array %d)" % [mi.name, s, t])
			var material := mi.get_surface_override_material(s)
			if material == null:
				material = mi.material_override
			if material == null:
				material = mesh.surface_get_material(s)
			if not (material is StandardMaterial3D or material is ORMMaterial3D):
				_errors.append("%s surface %d uses %s; it may read the dropped CUSTOM data" % [mi.name, s, material])
			var key := "%d|%d" % [material.get_instance_id() if material else 0, cast]
			if not groups.has(key):
				groups[key] = {"material": material, "cast": cast, "name": mesh.surface_get_name(s),
					"parts": [], "flags": Mesh.ARRAY_FLAG_COMPRESS_ATTRIBUTES}
				order.append(key)
			groups[key].parts.append([arrays, xform])
			if not (mesh.surface_get_format(s) & Mesh.ARRAY_FLAG_COMPRESS_ATTRIBUTES):
				groups[key].flags = 0

	if not _errors.is_empty():
		return

	for child in container.get_children():
		if child not in keep:
			container.remove_child(child)
			child.free()

	for key in order:
		var g: Dictionary = groups[key]
		var arrays := _combine(g.parts)
		var im := ImporterMesh.new()
		im.add_surface(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, g.material, g.name, g.flags)
		im.generate_lods(25.0, 60.0, [])
		var lods := {}  # LOD size -> indices, reused for the shadow mesh
		for l in im.get_surface_lod_count(0):
			lods[im.get_surface_lod_size(0, l)] = im.get_surface_lod_indices(0, l)
		var mesh := im.get_mesh()
		mesh.shadow_mesh = _make_shadow_mesh(arrays, lods, g.flags)
		var mi := MeshInstance3D.new()
		mi.name = "%s_%s" % [container.name, g.name]
		if g.cast == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			mi.name += "_noshadow"
		mi.mesh = mesh
		mi.cast_shadow = g.cast
		container.add_child(mi, true)
		mi.owner = owner


# Bakes each part's transform into its vertices and concatenates them.
func _combine(parts: Array) -> Array:
	var present := {}
	for t in OPTIONAL_ATTRIBUTES:
		present[t] = false
		for p in parts:
			if _has(p[0], t):
				present[t] = true

	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var tangents := PackedFloat32Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	var uv2s := PackedVector2Array()
	var indices := PackedInt32Array()

	for p in parts:
		var a: Array = p[0]
		var xf: Transform3D = p[1]
		var src_verts: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var n := src_verts.size()
		var base := verts.size()
		var mirrored := xf.basis.determinant() < 0.0
		var normal_basis := xf.basis.inverse().transposed()

		verts.append_array(xf * src_verts)

		if present[Mesh.ARRAY_NORMAL]:
			var src: PackedVector3Array = a[Mesh.ARRAY_NORMAL] if _has(a, Mesh.ARRAY_NORMAL) else PackedVector3Array()
			for i in n:
				normals.append((normal_basis * src[i]).normalized() if i < src.size() else Vector3.UP)

		if present[Mesh.ARRAY_TANGENT]:
			var src: PackedFloat32Array = a[Mesh.ARRAY_TANGENT] if _has(a, Mesh.ARRAY_TANGENT) else PackedFloat32Array()
			for i in n:
				if i * 4 + 3 < src.size():
					var t := (xf.basis * Vector3(src[i * 4], src[i * 4 + 1], src[i * 4 + 2])).normalized()
					var w := src[i * 4 + 3]
					tangents.append_array([t.x, t.y, t.z, -w if mirrored else w])
				else:
					tangents.append_array([1.0, 0.0, 0.0, 1.0])

		if present[Mesh.ARRAY_COLOR]:
			if _has(a, Mesh.ARRAY_COLOR):
				colors.append_array(a[Mesh.ARRAY_COLOR])
			else:
				for i in n:
					colors.append(Color.WHITE)

		var zeros := PackedVector2Array()
		zeros.resize(n)
		if present[Mesh.ARRAY_TEX_UV]:
			uvs.append_array(a[Mesh.ARRAY_TEX_UV] if _has(a, Mesh.ARRAY_TEX_UV) else zeros)
		if present[Mesh.ARRAY_TEX_UV2]:
			uv2s.append_array(a[Mesh.ARRAY_TEX_UV2] if _has(a, Mesh.ARRAY_TEX_UV2) else zeros)

		var src_idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if _has(a, Mesh.ARRAY_INDEX) else PackedInt32Array(range(n))
		for i in range(0, src_idx.size(), 3):
			# A mirrored transform flips triangle winding, so swap two corners back.
			if mirrored:
				indices.append_array([base + src_idx[i], base + src_idx[i + 2], base + src_idx[i + 1]])
			else:
				indices.append_array([base + src_idx[i], base + src_idx[i + 1], base + src_idx[i + 2]])

	var out := []
	out.resize(Mesh.ARRAY_MAX)
	out[Mesh.ARRAY_VERTEX] = verts
	out[Mesh.ARRAY_INDEX] = indices
	if present[Mesh.ARRAY_NORMAL]:
		out[Mesh.ARRAY_NORMAL] = normals
	if present[Mesh.ARRAY_TANGENT]:
		out[Mesh.ARRAY_TANGENT] = tangents
	if present[Mesh.ARRAY_COLOR]:
		out[Mesh.ARRAY_COLOR] = colors
	if present[Mesh.ARRAY_TEX_UV]:
		out[Mesh.ARRAY_TEX_UV] = uvs
	if present[Mesh.ARRAY_TEX_UV2]:
		out[Mesh.ARRAY_TEX_UV2] = uv2s
	return out


# Position-only copy with shared vertices welded, used for the shadow pass.
# It must have the same LOD levels as the visible mesh: the renderer picks the
# shadow mesh LOD by the visible mesh's LOD index, and crashes if it's missing.
func _make_shadow_mesh(arrays: Array, lods: Dictionary, flags: int) -> ArrayMesh:
	var src_verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var src_idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var welded := {}
	var verts := PackedVector3Array()
	var remap := PackedInt32Array()
	remap.resize(src_verts.size())
	for i in src_verts.size():
		var v := src_verts[i]
		if not welded.has(v):
			welded[v] = verts.size()
			verts.append(v)
		remap[i] = welded[v]
	var shadow_lods := {}
	for size in lods:
		shadow_lods[size] = _remap_indices(lods[size], remap)
	var out := []
	out.resize(Mesh.ARRAY_MAX)
	out[Mesh.ARRAY_VERTEX] = verts
	out[Mesh.ARRAY_INDEX] = _remap_indices(src_idx, remap)
	var shadow := ArrayMesh.new()
	shadow.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, out, [], shadow_lods, flags)
	return shadow


func _remap_indices(indices: PackedInt32Array, remap: PackedInt32Array) -> PackedInt32Array:
	var out := PackedInt32Array()
	out.resize(indices.size())
	for i in indices.size():
		out[i] = remap[indices[i]]
	return out


func _find_mesh_instances(node: Node, keep: Array[Node3D]) -> Array[MeshInstance3D]:
	var found: Array[MeshInstance3D] = []
	for child in node.get_children():
		if child in keep:
			continue
		if not (child.get_class() == "Node3D" or child is MeshInstance3D):
			_errors.append("unexpected node type under the car: %s (%s)" % [child.name, child.get_class()])
			continue
		if not (child as Node3D).visible:
			_errors.append("hidden part would become visible: %s" % child.name)
		if child is MeshInstance3D and child.mesh:
			found.append(child)
		found.append_array(_find_mesh_instances(child, keep))
	return found


func _transform_relative_to(node: Node3D, ancestor: Node3D) -> Transform3D:
	var xf := node.transform
	var parent := node.get_parent() as Node3D
	while parent != ancestor:
		xf = parent.transform * xf
		parent = parent.get_parent() as Node3D
	return xf


func _has(arrays: Array, type: int) -> bool:
	return arrays[type] != null and arrays[type].size() > 0


func _count_mesh_instances(node: Node) -> int:
	var count := 1 if node is MeshInstance3D else 0
	for child in node.get_children():
		count += _count_mesh_instances(child)
	return count
