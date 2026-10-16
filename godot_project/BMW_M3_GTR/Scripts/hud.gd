extends Node
# Builds the extra HUD in code (title bar, info tab, option panel, view bar,
# live stats) plus floating billboard labels pinned to car parts. Everything
# lives in one CanvasLayer below the CRT overlay, so it gets the CRT look too.

const TITLE := "BMW M3 GTR  E46"
# Edit these to match the real car: [label, metric text, imperial text].
const SPECS := [
	["ENGINE", "4.0L V8", "244 CU IN V8"],
	["POWER", "-- HP", "-- HP"],
	["TORQUE", "-- NM", "-- LB-FT"],
	["0-100 KM/H", "-- S", "0-60 MPH -- S"],
	["DRIVETRAIN", "RWD", "RWD"],
	["WEIGHT", "-- KG", "-- LB"],
]
# Floating labels: [label, node under the car root whose centre it follows].
const HOTSPOTS := [
	["ENGINE", "FBX_ m3_fbx_engine"],
	["COCKPIT", "FBX_ m3_fbx_interior_gauge_noshadow"],
]
const CAR_ROOT := "FBX_ m3_fbx"
const VIEW_STEP := PI * 0.5
const AUTO_ROTATE_SPEED: float = 0.3
const STARTUP_VEIL_FRAMES := 8
const STATS_INTERVAL: float = 0.5
const INFO_PANEL_WIDTH: float = 240.0
# Keep clear of the edges: the CRT overlay crops and curves them.
const SAFE_X: float = 56.0
const SAFE_TOP: float = 40.0
const SAFE_BOTTOM: float = 36.0
const REF_SIZE := Vector2(1280, 720) # layout is designed for this, then scaled
const MIN_SCALE: float = 0.6
const MAX_SCALE: float = 2.0

const PAINT_NODES: Array[String] = ["FBX_ m3_fbx_CarPaint", "DOOR_L/DOOR_L_CarPaint", "DOOR_R/DOOR_R_CarPaint"]
const PAINT_COLORS: Array[Color] = [Color("d9d9d9"), Color("111111"), Color("b01020"), Color("1f4fb0"), Color("e0a010"), Color("2f7a3f")]
# Finish presets: [name, roughness, metallic].
const FINISHES := [["GLOSS", 0.15, 0.0], ["MATTE", 0.85, 0.0], ["METALLIC", 0.3, 0.9]]
# Rim and caliper presets: [name, colour].
const RIMS := [["CHROME", Color("ffffff")], ["BLACK", Color("1a1a1a")], ["GOLD", Color("d4a017")]]
const CALIPERS := [["RED", Color("c01010")], ["YELLOW", Color("e0c010")], ["BLUE", Color("1040c0")]]
# Paint = the car's paint texture (white body, navy stripes) with the body and
# stripe colours swapped by a small shader, so each can be changed on its own.
const PAINT_SHADER := """
shader_type spatial;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 body_color : source_color = vec3(1.0);
uniform vec3 stripe_color : source_color = vec3(0.0, 0.04, 0.23);
uniform int stripe_style = 0; // 0 original, 1 none, 2 centre, 3 dual, 4 original + centre
uniform float metallic_amount = 0.44;
uniform float roughness_amount = 0.59;
void fragment() {
	vec3 t = texture(albedo_tex, UV).rgb;
	// The texture is a top-down unwrap centred on U = 0.5, so a vertical band
	// there runs along the hood, roof and boot.
	float painted = step(0.01, max(t.r, max(t.g, t.b)));
	// Stripe pixels are navy: blue clearly above red and green, however dark.
	float original = smoothstep(1.0, 1.8, t.b / max(max(t.r, t.g), 0.002)) * step(0.002, t.b);
	float across = abs(UV.x - 0.5);
	float centre = step(across, 0.055) * painted;
	float dual = step(abs(across - 0.07), 0.018) * painted;
	float keep_original = (stripe_style == 0 || stripe_style == 4) ? 1.0 : 0.0;
	vec3 base = mix(t, vec3(0.95), original * (1.0 - keep_original));
	float stripe = original * keep_original;
	if (stripe_style == 2 || stripe_style == 4) stripe = max(stripe, centre);
	if (stripe_style == 3) stripe = dual;
	ALBEDO = mix(base * body_color, stripe_color, stripe);
	METALLIC = metallic_amount;
	ROUGHNESS = roughness_amount;
}
"""
const STRIPE_STYLES := [["ORIGINAL"], ["NONE"], ["CENTRE"], ["DUAL"], ["ORIGINAL+CENTRE"]]
const FILTERS := [["CRT"], ["OFF"], ["NOIR"], ["WARM"], ["CINEMA"], ["VIVID"]]
const FILTER_SHADER := """
shader_type canvas_item;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform int mode = 0; // 0 noir, 1 warm, 2 cinema, 3 vivid
void fragment() {
	vec3 c = texture(screen_tex, SCREEN_UV).rgb;
	float luma = dot(c, vec3(0.299, 0.587, 0.114));
	float vignette = 1.0 - smoothstep(0.35, 0.95, distance(SCREEN_UV, vec2(0.5)));
	if (mode == 0) {
		c = (vec3(luma) - 0.5) * 1.25 + 0.5;
		c *= mix(0.55, 1.0, vignette);
	} else if (mode == 1) {
		c = mix(vec3(luma), c, 1.1) * vec3(1.12, 1.0, 0.82);
		c *= mix(0.8, 1.0, vignette);
	} else if (mode == 2) {
		c = mix(vec3(luma), c, 0.85);
		c = mix(c * vec3(0.85, 0.97, 1.12), c * vec3(1.12, 1.0, 0.88), smoothstep(0.2, 0.8, luma));
		c = (c - 0.5) * 1.1 + 0.5;
		c *= mix(0.6, 1.0, vignette);
	} else {
		c = mix(vec3(luma), c, 1.5);
		c = (c - 0.5) * 1.1 + 0.5;
	}
	COLOR = vec4(clamp(c, 0.0, 1.0), 1.0);
}
"""
const STRIPES := [["ORIGINAL", Color(0.0, 0.04, 0.23)], ["BLACK", Color("111111")], ["RED", Color("b01020")], ["WHITE", Color("e8e8e8")], ["GOLD", Color("d4a017")]]
# Wheel parts that are merged across all four wheels; the front two are split
# out at startup so they can steer.
const WHEEL_PARTS: Array[String] = ["FBX_ m3_fbx_tire", "FBX_ m3_fbx_rimbadge", "FBX_ m3_fbx_rotor", "FBX_ m3_fbx_caliper"]
# Interior view: first-person from the driver's seat, wide field of view.
const INTERIOR_NODE := "FBX_ m3_fbx_int_seat_noshadow"
# Driver's eye relative to the seat mesh's centre, in the car's own units:
# x is toward the driver's (left) side, y up, z forward.
const INTERIOR_HEAD_OFFSET := Vector3(0.3, 0.35, 0.0)
const INTERIOR_FOV: float = 90.0
const WHEEL_REFERENCE := "FBX_ m3_fbx_tire"
# Parts matching this are never split (glass, and the doors' pivots are not meshes).
const WHEEL_SKIP_PATTERN := "(glass|window|interior|_int_)"
# How far from the wheel centre a triangle may be to move with the wheel,
# relative to the tire radius: the listed wheel parts get the whole tire, any
# other part (rim spokes, hubs) only the inner area so the body isn't dragged along.
const WHEEL_PART_RADIUS: float = 1.1
const OTHER_PART_RADIUS: float = 0.8
const MAX_STEER_DEG: float = 35.0
const STEER_STEP_DEG: float = 15.0
const STEER_TIME: float = 0.25
const MESH_STRIDES := {
	Mesh.ARRAY_VERTEX: 1, Mesh.ARRAY_NORMAL: 1, Mesh.ARRAY_TANGENT: 4,
	Mesh.ARRAY_COLOR: 1, Mesh.ARRAY_TEX_UV: 1, Mesh.ARRAY_TEX_UV2: 1,
}
const LIGHT_NODE := "FBX_ m3_fbx_light"
const RIM_NODE := "FBX_ m3_fbx_rimbadge"
const CALIPER_NODE := "FBX_ m3_fbx_caliper"
const WINDOW_NODES: Array[String] = ["DOOR_L/DOOR_L_gls_window", "DOOR_R/DOOR_R_gls_window"]
const HEADLIGHT_GLOW := Color(1.0, 0.95, 0.8)
const HEADLIGHT_ENERGY: float = 3.0

const OrbitCameraScript := preload("res://Scripts/camera_3d3.gd")

@export var camera: OrbitCameraScript = null

var _layer: CanvasLayer
var _root: Control
var _tab_panel: PanelContainer
var _pages: VBoxContainer
var _tab_buttons: Array[Button] = []
var _title: Label
var _info_panel: PanelContainer
var _stats_label: Label
var _spec_values: Array[Label] = []
var _hotspots: Array[Label3D] = []
var _elapsed: float = STATS_INTERVAL
var _view_index: int = 0
var _auto_rotate: bool = false
var _imperial: bool = false
var _light_theme: bool = false
var _headlights_on: bool = false
var _windows_down: bool = false
var _filter_rect: ColorRect
var _paint: ShaderMaterial
var _wheel_pieces: Dictionary = {} # part path -> Array of split-off MeshInstance3D
var _front_pivots: Array[Node3D] = []
var _steer_current: float = 0.0
var _steer_tween: Tween
var _inside: bool = false
var _labels_were_visible: bool = true
var _front_sign: float = 1.0 # +1 when the car's front is along local +Z
var _light_materials: Array[StandardMaterial3D] = []
var _rim_materials: Array[StandardMaterial3D] = []
var _caliper_materials: Array[StandardMaterial3D] = []


func _ready() -> void:
	if camera == null:
		camera = get_viewport().get_camera_3d() as OrbitCameraScript
	_build_ui()
	_apply_theme()
	_setup_front_wheels()
	_build_hotspots()
	_hide_startup_hitch()


func _process(delta: float) -> void:
	if _auto_rotate and camera != null:
		camera.target_azimuth += delta * AUTO_ROTATE_SPEED
		camera.camera_dirty = true
	_elapsed += delta
	if _elapsed < STATS_INTERVAL or not _info_panel.visible:
		return
	_elapsed = 0.0
	_stats_label.text = "FPS %d\nDRAW CALLS %d\nVRAM %.0f MB" % [
		Engine.get_frames_per_second(),
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0,
	]


# --- UI construction -------------------------------------------------------

func _build_ui() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 0 # under the CRT ColorRect (layer 1)
	add_child(_layer)

	_root = Control.new()
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_layer.add_child(_root)

	_build_filter_overlay()
	_build_title()
	_build_info_tab()
	_build_tabs()
	_build_filter_button()

	# The old FPS label and buttons are replaced by this HUD.
	for path in ["Control", "reset_scene", "rotate_objects"]:
		var old := get_node_or_null("../CanvasLayer/" + path) as CanvasItem
		if old:
			old.visible = false

	get_viewport().size_changed.connect(_update_scale)
	_update_scale()


# Scales the whole HUD with the window so it reads the same on any screen.
func _update_scale() -> void:
	var size := get_viewport().get_visible_rect().size
	var factor := clampf(minf(size.x / REF_SIZE.x, size.y / REF_SIZE.y), MIN_SCALE, MAX_SCALE)
	_layer.scale = Vector2(factor, factor)
	_root.position = Vector2.ZERO
	_root.size = size / factor


func _build_title() -> void:
	_title = Label.new()
	_title.text = TITLE
	_title.add_theme_font_size_override("font_size", 28)
	_title.add_theme_constant_override("outline_size", 6)
	_title.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_title.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_title.offset_top = SAFE_TOP
	_title.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(_title)


func _build_info_tab() -> void:
	var tab := VBoxContainer.new()
	tab.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	tab.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	tab.offset_top = SAFE_TOP
	tab.offset_right = -SAFE_X
	tab.custom_minimum_size.x = INFO_PANEL_WIDTH
	_root.add_child(tab)

	var toggle := Button.new()
	toggle.text = "INFO"
	toggle.toggle_mode = true
	toggle.button_pressed = true
	toggle.action_mode = BaseButton.ACTION_MODE_BUTTON_PRESS
	toggle.toggled.connect(func(on: bool) -> void: _info_panel.visible = on)
	tab.add_child(toggle)

	_info_panel = PanelContainer.new()
	tab.add_child(_info_panel)
	var margin := _margin_box(12)
	_info_panel.add_child(margin)
	var box := VBoxContainer.new()
	margin.add_child(box)

	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 16)
	box.add_child(grid)
	for row: Array in SPECS:
		var key := Label.new()
		key.text = row[0]
		key.modulate = Color(1, 1, 1, 0.6)
		key.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		grid.add_child(key)
		var value := Label.new()
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		grid.add_child(value)
		_spec_values.append(value)
	_refresh_specs()

	box.add_child(HSeparator.new())
	_stats_label = Label.new()
	_stats_label.modulate = Color(0.6, 1.0, 0.7)
	box.add_child(_stats_label)


# Bottom tab bar: one tab opens one small row of controls above it, so the
# screen stays clear and nothing needs scrolling.
func _build_tabs() -> void:
	var dock := VBoxContainer.new()
	dock.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	dock.grow_vertical = Control.GROW_DIRECTION_BEGIN
	dock.offset_left = SAFE_X
	dock.offset_right = -SAFE_X
	dock.offset_bottom = -SAFE_BOTTOM
	dock.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(dock)

	_tab_panel = PanelContainer.new()
	_tab_panel.visible = false
	dock.add_child(_tab_panel)
	var margin := _margin_box(8)
	_tab_panel.add_child(margin)
	_pages = VBoxContainer.new() # one row per tab; only the open one is visible
	margin.add_child(_pages)

	var bar := HBoxContainer.new()
	bar.alignment = BoxContainer.ALIGNMENT_CENTER
	bar.add_theme_constant_override("separation", 6)
	dock.add_child(bar)

	_add_tab(bar, "PAINT", func(row: Container) -> void:
		for color in PAINT_COLORS:
			row.add_child(_swatch(color))
		_add_cycle_button(row, "FINISH", FINISHES, _apply_finish)
		_add_cycle_button(row, "STRIPE STYLE", STRIPE_STYLES, _apply_stripe_style)
		_add_cycle_button(row, "STRIPE COLOUR", STRIPES, _apply_stripes))
	_add_tab(bar, "WHEELS", func(row: Container) -> void:
		_add_cycle_button(row, "RIM", RIMS, _apply_rim)
		_add_cycle_button(row, "CALIPER", CALIPERS, _apply_caliper)
		_add_button(row, "STEER LEFT", _steer.bind(STEER_STEP_DEG))
		_add_button(row, "CENTER", _steer_center)
		_add_button(row, "STEER RIGHT", _steer.bind(-STEER_STEP_DEG)))
	_add_tab(bar, "CAR", func(row: Container) -> void:
		_add_button(row, "HEADLIGHTS", _toggle_headlights)
		_add_button(row, "DOORS", _toggle_doors)
		_add_button(row, "WINDOWS", _toggle_windows))
	_add_tab(bar, "VIEW", func(row: Container) -> void:
		_add_button(row, "<", func() -> void: _step_view(-1))
		_add_button(row, ">", func() -> void: _step_view(1))
		_add_button(row, "TOP", func() -> void: _set_elevation(-1.4))
		_add_button(row, "LOW", func() -> void: _set_elevation(-0.05))
		var inside := _add_button(row, "INTERIOR", Callable())
		inside.pressed.connect(func() -> void:
			inside.text = "EXTERIOR" if _toggle_interior() else "INTERIOR")
		_add_button(row, "AUTO", func() -> void: _auto_rotate = not _auto_rotate)
		_add_button(row, "LABELS", _toggle_hotspots)
		_add_button(row, "SHOT", _screenshot))
	_add_tab(bar, "SETTINGS", func(row: Container) -> void:
		_add_button(row, "UNITS", _toggle_units)
		_add_button(row, "THEME", _toggle_theme)
		_add_button(row, "RESET SCENE", _reset_scene))


func _add_tab(bar: Container, caption: String, fill: Callable) -> void:
	var row := HFlowContainer.new()
	row.alignment = FlowContainer.ALIGNMENT_CENTER
	row.visible = false
	_pages.add_child(row)
	fill.call(row)

	var tab := _add_button(bar, caption, Callable())
	tab.toggle_mode = true
	tab.toggled.connect(func(on: bool) -> void:
		if on:
			for other: Button in _tab_buttons:
				if other != tab:
					other.set_pressed_no_signal(false)
			for page: CanvasItem in _pages.get_children():
				page.visible = page == row
		_tab_panel.visible = on)
	_tab_buttons.append(tab)


func _swatch(color: Color) -> Button:
	var swatch := Button.new()
	swatch.custom_minimum_size = Vector2(40, 40)
	swatch.action_mode = BaseButton.ACTION_MODE_BUTTON_PRESS
	var style := StyleBoxFlat.new()
	style.bg_color = color
	for state in ["normal", "hover", "pressed"]:
		swatch.add_theme_stylebox_override(state, style)
	swatch.pressed.connect(_set_paint.bind(color))
	return swatch


func _reset_scene() -> void:
	var button := get_node_or_null("../CanvasLayer/reset_scene") as Button
	if button:
		button.pressed.emit()
	else:
		get_tree().reload_current_scene()


func _build_filter_overlay() -> void:
	var shader := Shader.new()
	shader.code = FILTER_SHADER
	var material := ShaderMaterial.new()
	material.shader = shader
	_filter_rect = ColorRect.new()
	_filter_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_filter_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_filter_rect.material = material
	_filter_rect.visible = false
	_root.add_child(_filter_rect)


# The screen filter selector sits on its own in the corner, not inside a tab.
func _build_filter_button() -> void:
	var button := _add_cycle_button(_root, "FILTER", FILTERS, _apply_filter)
	button.position = Vector2(SAFE_X, SAFE_TOP)


func _margin_box(amount: int) -> MarginContainer:
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, amount)
	return margin


func _heading(text: String) -> Label:
	var label := Label.new()
	label.text = text
	label.modulate = Color(1, 1, 1, 0.6)
	return label


func _add_button(parent: Control, text: String, on_press: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.action_mode = BaseButton.ACTION_MODE_BUTTON_PRESS
	if on_press.is_valid():
		button.pressed.connect(on_press)
	parent.add_child(button)
	return button


# A button that steps through presets and shows the current one as its text.
func _add_cycle_button(parent: Control, caption: String, presets: Array, apply: Callable) -> Button:
	var index := [0]
	var button := _add_button(parent, "%s: %s" % [caption, presets[0][0]], Callable())
	button.pressed.connect(func() -> void:
		index[0] = (index[0] + 1) % presets.size()
		button.text = "%s: %s" % [caption, presets[index[0]][0]]
		apply.call(index[0]))
	return button


# --- Theme -----------------------------------------------------------------

func _apply_theme() -> void:
	var light := _light_theme
	var fg := Color(0.08, 0.08, 0.08) if light else Color.WHITE
	var theme := Theme.new()

	var panel := StyleBoxFlat.new()
	panel.bg_color = Color(1, 1, 1, 0.85) if light else Color(0, 0, 0, 0.55)
	panel.set_corner_radius_all(6)
	theme.set_stylebox("panel", "PanelContainer", panel)

	for state in ["normal", "hover", "pressed", "focus"]:
		var style := StyleBoxFlat.new()
		var base := Color(0.9, 0.9, 0.9) if light else Color(0.15, 0.15, 0.15)
		style.bg_color = base.lightened(0.15) if state == "hover" else base
		if state == "pressed":
			style.bg_color = Color(0.6, 0.75, 1.0) if light else Color(0.25, 0.35, 0.55)
		style.set_corner_radius_all(4)
		style.content_margin_left = 8.0
		style.content_margin_right = 8.0
		style.content_margin_top = 4.0
		style.content_margin_bottom = 4.0
		theme.set_stylebox(state, "Button", style)
	for color_name in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
		theme.set_color(color_name, "Button", fg)
	theme.set_color("font_color", "Label", fg)

	_root.theme = theme
	_title.add_theme_color_override("font_outline_color", Color.WHITE if light else Color.BLACK)


func _toggle_theme() -> void:
	_light_theme = not _light_theme
	_apply_theme()


# Filters other than CRT are a full-screen overlay at the bottom of the HUD, so
# they grade the 3D scene while the HUD widgets stay sharp. CRT is the scene's
# own overlay.
func _apply_filter(index: int) -> void:
	var crt := get_node_or_null("../CanvasLayer/ColorRect") as CanvasItem
	if crt:
		crt.visible = index == 0
	_filter_rect.visible = index >= 2
	if index >= 2:
		(_filter_rect.material as ShaderMaterial).set_shader_parameter("mode", index - 2)


# --- Units -----------------------------------------------------------------

func _toggle_units() -> void:
	_imperial = not _imperial
	_refresh_specs()


func _refresh_specs() -> void:
	for i in SPECS.size():
		_spec_values[i].text = SPECS[i][2] if _imperial else SPECS[i][1]


# --- Car materials ---------------------------------------------------------

func _car() -> Node3D:
	return get_node_or_null("../" + CAR_ROOT) as Node3D


func _part(path: String) -> MeshInstance3D:
	var car := _car()
	return car.get_node_or_null(NodePath(path)) as MeshInstance3D if car else null


func _parts_of(path: String) -> Array[MeshInstance3D]:
	var list: Array[MeshInstance3D] = []
	var main := _part(path)
	if main:
		list.append(main)
	for extra: MeshInstance3D in _wheel_pieces.get(path, []):
		list.append(extra)
	return list


# Gives a part (and any wheel pieces split from it) its own copy of each surface
# material, shared across the pieces, so the original materials are untouched.
func _own_materials(path: String) -> Array[StandardMaterial3D]:
	var result: Array[StandardMaterial3D] = []
	var copies: Dictionary = {}
	for part in _parts_of(path):
		if part.mesh == null:
			continue
		for surface in part.mesh.get_surface_count():
			var source := part.mesh.surface_get_material(surface) as StandardMaterial3D
			if source == null:
				continue
			if not copies.has(source):
				var copy := source.duplicate() as StandardMaterial3D
				copies[source] = copy
				result.append(copy)
			part.set_surface_override_material(surface, copies[source])
	return result


func _set_paint(color: Color) -> void:
	if _ensure_paint():
		_paint.set_shader_parameter("body_color", color)


func _ensure_paint() -> bool:
	if _paint != null:
		return true
	var first := _part(PAINT_NODES[0])
	var source: StandardMaterial3D = null
	if first and first.mesh:
		source = first.mesh.surface_get_material(0) as StandardMaterial3D
	if source == null:
		return false
	var shader := Shader.new()
	shader.code = PAINT_SHADER
	_paint = ShaderMaterial.new()
	_paint.shader = shader
	_paint.set_shader_parameter("albedo_tex", source.albedo_texture)
	_paint.set_shader_parameter("metallic_amount", source.metallic)
	_paint.set_shader_parameter("roughness_amount", source.roughness)
	# One material shared by body and doors.
	for path in PAINT_NODES:
		var part := _part(path)
		if part:
			part.set_surface_override_material(0, _paint)
	return true


func _apply_stripe_style(index: int) -> void:
	if _ensure_paint():
		_paint.set_shader_parameter("stripe_style", index)


func _apply_stripes(index: int) -> void:
	if _ensure_paint():
		_paint.set_shader_parameter("stripe_color", STRIPES[index][1])


func _apply_finish(index: int) -> void:
	if not _ensure_paint():
		return
	_paint.set_shader_parameter("roughness_amount", FINISHES[index][1])
	_paint.set_shader_parameter("metallic_amount", FINISHES[index][2])


func _apply_rim(index: int) -> void:
	if _rim_materials.is_empty():
		_rim_materials = _own_materials(RIM_NODE)
	for material in _rim_materials:
		material.albedo_color = RIMS[index][1]


func _apply_caliper(index: int) -> void:
	if _caliper_materials.is_empty():
		_caliper_materials = _own_materials(CALIPER_NODE)
	for material in _caliper_materials:
		material.albedo_color = CALIPERS[index][1]


func _toggle_headlights() -> void:
	if _light_materials.is_empty():
		_light_materials = _own_materials(LIGHT_NODE)
	_headlights_on = not _headlights_on
	for material in _light_materials:
		material.emission_enabled = _headlights_on
		material.emission = HEADLIGHT_GLOW
		material.emission_energy_multiplier = HEADLIGHT_ENERGY


func _toggle_windows() -> void:
	# The door glass is a separate mesh, so "window down" hides it.
	_windows_down = not _windows_down
	for path in WINDOW_NODES:
		var glass := _part(path)
		if glass:
			glass.visible = not _windows_down


func _toggle_doors() -> void:
	# The scene's (hidden) doors button owns the swing; make sure it drives both doors.
	var button := get_node_or_null("../CanvasLayer/rotate_objects") as Button
	var car := _car()
	if button == null or car == null:
		return
	var right := car.get_node_or_null("DOOR_R") as Node3D
	if right and not button.objects_to_rotate.has(right):
		var degrees: float = -button.rotation_values[0] if not button.rotation_values.is_empty() else 45.0
		button.add_object(right, degrees, "y")
	button.pressed.emit()


# --- Camera ----------------------------------------------------------------

func _step_view(direction: int) -> void:
	if camera == null:
		return
	_view_index += direction
	camera.target_azimuth = _view_index * VIEW_STEP
	camera.camera_dirty = true


func _set_elevation(value: float) -> void:
	if camera == null:
		return
	camera.target_elevation = value
	camera.camera_dirty = true


func _part_center(part: MeshInstance3D) -> Vector3:
	return part.global_transform * part.get_aabb().get_center()


# --- Interior view ---------------------------------------------------------

# Switches between the outside orbit view and a first-person view from the
# driver's seat. Returns true when the camera is now inside.
func _toggle_interior() -> bool:
	if camera == null:
		return false
	if camera.interior_mode:
		camera.exit_interior()
		_set_hotspots_visible(_labels_were_visible)
		return false
	var car := _car()
	var seats := _part(INTERIOR_NODE)
	if car == null or seats == null:
		return false
	var head := seats.get_aabb().get_center() + Vector3(INTERIOR_HEAD_OFFSET.x * _front_sign, INTERIOR_HEAD_OFFSET.y, INTERIOR_HEAD_OFFSET.z * _front_sign)
	var forward: Vector3 = car.global_basis * Vector3(0.0, 0.0, _front_sign)
	camera.enter_interior(car.to_global(head), atan2(-forward.x, -forward.z), INTERIOR_FOV)
	_labels_were_visible = not _hotspots.is_empty() and _hotspots[0].visible
	_set_hotspots_visible(false)
	return true


func _set_hotspots_visible(on: bool) -> void:
	for label in _hotspots:
		label.visible = on


# --- Front wheel steering --------------------------------------------------

func _steer(delta_deg: float) -> void:
	_steer_to(clampf(_steer_current + delta_deg, -MAX_STEER_DEG, MAX_STEER_DEG))


func _steer_center() -> void:
	_steer_to(0.0)


func _steer_to(degrees: float) -> void:
	if _front_pivots.is_empty():
		return
	if _steer_tween:
		_steer_tween.kill()
	_steer_tween = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_steer_tween.tween_method(_apply_steer, _steer_current, degrees, STEER_TIME)


func _apply_steer(degrees: float) -> void:
	_steer_current = degrees
	for pivot in _front_pivots:
		pivot.rotation.y = deg_to_rad(degrees)


# The four wheels are merged into one mesh per part. Find the front wheels from
# the tire mesh, cut their triangles out of each wheel part, and re-parent them
# on a pivot at each wheel's centre so they can turn.
func _setup_front_wheels() -> void:
	var car := _car()
	var tire := _part(WHEEL_REFERENCE)
	if car == null or tire == null or tire.mesh == null:
		return
	var wheels := _find_front_wheels(car, tire)
	if wheels.size() != 2:
		return
	for wheel: Dictionary in wheels:
		var pivot := Node3D.new()
		pivot.name = "FrontWheelPivot"
		pivot.position = wheel.center
		car.add_child(pivot)
		_front_pivots.append(pivot)
	var skip := RegEx.create_from_string(WHEEL_SKIP_PATTERN)
	for child in car.get_children():
		var part := child as MeshInstance3D
		if part == null or not part.mesh is ArrayMesh or skip.search(String(part.name)):
			continue
		if not part.transform.is_equal_approx(Transform3D.IDENTITY):
			continue
		var radius_scale := WHEEL_PART_RADIUS if WHEEL_PARTS.has(String(part.name)) else OTHER_PART_RADIUS
		_split_wheel_part(String(part.name), part, wheels, radius_scale)


# Returns [{center, radius, half_width}, ...] for the two front wheels, or [].
func _find_front_wheels(car: Node3D, tire: MeshInstance3D) -> Array[Dictionary]:
	var middle := tire.get_aabb().get_center()
	var bounds: Dictionary = {} # quadrant key -> AABB
	for surface in tire.mesh.get_surface_count():
		for vertex: Vector3 in tire.mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]:
			var key := Vector2i(int(vertex.x >= middle.x), int(vertex.z >= middle.z))
			if bounds.has(key):
				bounds[key] = (bounds[key] as AABB).expand(vertex)
			else:
				bounds[key] = AABB(vertex, Vector3.ZERO)
	if bounds.size() != 4:
		return []
	# The door hinges are at the front of the doors, which tells us which end is the front.
	var hinge := car.get_node_or_null("DOOR_L") as Node3D
	var front_is_positive_z: bool = hinge == null or hinge.position.z > middle.z
	_front_sign = 1.0 if front_is_positive_z else -1.0
	var result: Array[Dictionary] = []
	for key: Vector2i in bounds:
		if (key.y == 1) != front_is_positive_z:
			continue
		var box: AABB = bounds[key]
		result.append({
			"center": box.get_center(),
			"radius": maxf(box.size.y, box.size.z) * 0.5,
			"half_width": box.size.x * 0.5,
		})
	return result


func _split_wheel_part(path: String, part: MeshInstance3D, wheels: Array[Dictionary], radius_scale: float) -> void:
	var source := part.mesh as ArrayMesh
	var all_arrays: Array = []
	var all_groups: Array = []
	var found := false
	for surface in source.get_surface_count():
		var arrays := source.surface_get_arrays(surface)
		var groups := _partition_triangles(arrays, wheels, radius_scale)
		for group in range(1, groups.size()):
			found = found or not groups[group].is_empty()
		all_arrays.append(arrays)
		all_groups.append(groups)
	if not found:
		return # nothing of this part is inside a wheel; leave it untouched
	var remainder := ArrayMesh.new()
	var targets: Array[ArrayMesh] = [remainder]
	for i in wheels.size():
		targets.append(ArrayMesh.new())
	for surface in source.get_surface_count():
		var arrays: Array = all_arrays[surface]
		var material := source.surface_get_material(surface)
		var groups: Array = all_groups[surface]
		for group in groups.size():
			if groups[group].is_empty():
				continue
			var target := targets[group]
			target.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, _subset(arrays, groups[group]))
			target.surface_set_material(target.get_surface_count() - 1, material)
	var pieces: Array[MeshInstance3D] = []
	for i in wheels.size():
		var piece := MeshInstance3D.new()
		piece.mesh = targets[i + 1]
		piece.position = -_front_pivots[i].position
		piece.cast_shadow = part.cast_shadow
		_front_pivots[i].add_child(piece)
		pieces.append(piece)
	part.mesh = remainder
	_wheel_pieces[path] = pieces


# Sorts triangle indices into [rest, wheel 0, wheel 1, ...] by where each
# triangle's centre lies (inside a wheel's cylinder or not).
func _partition_triangles(arrays: Array, wheels: Array[Dictionary], radius_scale: float) -> Array[PackedInt32Array]:
	var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var indices := PackedInt32Array()
	if arrays[Mesh.ARRAY_INDEX] != null:
		indices = arrays[Mesh.ARRAY_INDEX]
	if indices.is_empty():
		indices.resize(vertices.size())
		for i in vertices.size():
			indices[i] = i
	var groups: Array[PackedInt32Array] = []
	for i in wheels.size() + 1:
		groups.append(PackedInt32Array())
	for t in range(0, indices.size() - 2, 3):
		var centre := (vertices[indices[t]] + vertices[indices[t + 1]] + vertices[indices[t + 2]]) / 3.0
		var group := 0
		for w in wheels.size():
			var wheel: Dictionary = wheels[w]
			var offset: Vector3 = centre - wheel.center
			if absf(offset.x) <= wheel.half_width * 1.15 and Vector2(offset.y, offset.z).length() <= wheel.radius * radius_scale:
				group = w + 1
				break
		groups[group].append(indices[t])
		groups[group].append(indices[t + 1])
		groups[group].append(indices[t + 2])
	return groups


# A copy of the surface arrays holding only the vertices `indices` use.
func _subset(arrays: Array, indices: PackedInt32Array) -> Array:
	var remap: Dictionary = {}
	var order := PackedInt32Array()
	var new_indices := PackedInt32Array()
	new_indices.resize(indices.size())
	for i in indices.size():
		var old := indices[i]
		var mapped: int = remap.get(old, -1)
		if mapped == -1:
			mapped = order.size()
			remap[old] = mapped
			order.append(old)
		new_indices[i] = mapped
	var result: Array = []
	result.resize(Mesh.ARRAY_MAX)
	for key: int in MESH_STRIDES:
		var source: Variant = arrays[key]
		if source == null or source.is_empty():
			continue
		var stride: int = MESH_STRIDES[key]
		var copy: Variant = source.duplicate()
		copy.resize(order.size() * stride)
		for j in order.size():
			for k in stride:
				copy[j * stride + k] = source[order[j] * stride + k]
		result[key] = copy
	result[Mesh.ARRAY_INDEX] = new_indices
	return result



# --- Floating labels -------------------------------------------------------

func _build_hotspots() -> void:
	for entry: Array in HOTSPOTS:
		var part := _part(entry[1])
		if part:
			_add_hotspot(entry[0], _part_center(part))
	if not _front_pivots.is_empty():
		_add_hotspot("WHEEL", _front_pivots[0].global_position)


func _add_hotspot(text: String, world_position: Vector3) -> void:
	var label := Label3D.new()
	label.text = "● " + text
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.fixed_size = true # same on-screen size at any zoom
	label.pixel_size = 0.0007
	label.no_depth_test = true
	label.shaded = false
	label.outline_size = 8
	label.font_size = 28
	label.modulate = Color(1.0, 0.85, 0.3)
	add_child(label)
	label.global_position = world_position
	_hotspots.append(label)


func _toggle_hotspots() -> void:
	for label in _hotspots:
		label.visible = not label.visible


# --- Misc ------------------------------------------------------------------

func _screenshot() -> void:
	var image := get_viewport().get_texture().get_image()
	var path := "user://m3_%d.png" % Time.get_unix_time_from_system()
	image.save_png(path)
	print("Saved ", ProjectSettings.globalize_path(path))


# The first rendered frames compile shaders, build the sky radiance map and
# upload textures, which shows up as one big frame-time spike. Hide it behind
# a black veil and fade it out once rendering has settled.
func _hide_startup_hitch() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	var veil := ColorRect.new()
	veil.color = Color.BLACK
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(veil)
	for i in STARTUP_VEIL_FRAMES:
		await get_tree().process_frame
	var tween := create_tween()
	tween.tween_property(veil, "color:a", 0.0, 0.4)
	tween.finished.connect(layer.queue_free)
