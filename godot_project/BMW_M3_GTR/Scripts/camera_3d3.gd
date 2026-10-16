extends Camera3D

@export var orbit_target: Node3D = null
@export var distance: float = 4.0
@export var zoom_speed: float = 1.0
@export var rotation_speed: float = 0.005
@export var min_distance: float = 2.5
@export var max_distance: float = 6.0
@export var zoom_slider: Slider = null
@export var rotate_around_x_axis: bool = true
@export var rotate_around_y_axis: bool = true
@export var rotate_around_z_axis: bool = false
@export var rotation_lerp_speed: float = 4.0

var azimuth: float = 0.0
var elevation: float = 0.0
var target_azimuth: float = 0.0
var target_elevation: float = 0.0
var left_mouse_pressed: bool = false
var touch_events: Dictionary = {}
var last_distance: float = 0.0
var zooming: bool = false
var camera_dirty: bool = true
var is_initialized: bool = false
var first_drag_frame: bool = true # NEW: Prevents the "jump" on first click

# First-person "inside the car" mode: the camera sits at interior_anchor and
# looks around freely (including up) instead of orbiting the car.
const LOOK_PITCH_LIMIT: float = deg_to_rad(85.0)
const INTERIOR_FOV_MIN: float = 60.0
const INTERIOR_FOV_MAX: float = 110.0
const INTERIOR_FOV_STEP: float = 4.0
var interior_mode: bool = false
var interior_anchor: Vector3 = Vector3.ZERO
var look_yaw: float = 0.0
var look_pitch: float = 0.0
var target_yaw: float = 0.0
var target_pitch: float = 0.0
var _outside_fov: float = 45.0

func _ready() -> void:
	current = true
	if orbit_target == null:
		push_error("No orbit target assigned! Please assign a Node3D object to orbit around.")
		return
	
	# Defer initialization to ensure scene is loaded
	_initialize_camera.call_deferred()

func _initialize_camera() -> void:
	if not is_instance_valid(orbit_target):
		return

	var offset: Vector3 = global_transform.origin - orbit_target.global_transform.origin
	distance = offset.length()
	
	azimuth = atan2(offset.x, offset.z)
	elevation = atan2(-offset.y, sqrt(offset.x * offset.x + offset.z * offset.z))
	
	target_azimuth = azimuth
	target_elevation = elevation
	
	if zoom_slider:
		zoom_slider.value_changed.connect(_on_slider_zoom)
		zoom_slider.min_value = 0
		zoom_slider.max_value = 100
		zoom_slider.value = map_range(distance, min_distance, max_distance, 0, 100)

	update_camera_position()
	is_initialized = true

func enter_interior(anchor: Vector3, yaw: float, interior_fov: float) -> void:
	interior_mode = true
	interior_anchor = anchor
	look_yaw = yaw
	target_yaw = yaw
	look_pitch = 0.0
	target_pitch = 0.0
	_outside_fov = fov
	fov = interior_fov
	left_mouse_pressed = false
	_apply_look()

func exit_interior() -> void:
	interior_mode = false
	fov = _outside_fov
	left_mouse_pressed = false
	camera_dirty = true

func _apply_look() -> void:
	global_position = interior_anchor
	global_basis = Basis.from_euler(Vector3(look_pitch, look_yaw, 0.0))

func _interior_process(delta: float) -> void:
	var weight: float = minf(delta, 0.05) * rotation_lerp_speed
	var yaw_prev: float = look_yaw
	var pitch_prev: float = look_pitch
	look_yaw = lerpf(look_yaw, target_yaw, weight)
	look_pitch = lerpf(look_pitch, target_pitch, weight)
	if absf(look_yaw - yaw_prev) > 0.00005 or absf(look_pitch - pitch_prev) > 0.00005:
		_apply_look()

func _interior_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			left_mouse_pressed = event.pressed
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
			fov = clampf(fov - INTERIOR_FOV_STEP, INTERIOR_FOV_MIN, INTERIOR_FOV_MAX)
		elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			fov = clampf(fov + INTERIOR_FOV_STEP, INTERIOR_FOV_MIN, INTERIOR_FOV_MAX)
	elif event is InputEventMouseMotion and left_mouse_pressed:
		target_yaw -= event.relative.x * rotation_speed
		target_pitch = clampf(target_pitch - event.relative.y * rotation_speed, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT)

func _process(delta: float) -> void:
	if not is_initialized: return
	if interior_mode:
		_interior_process(delta)
		return

	# Clamp delta to prevent math explosions during lag spikes
	var safe_delta: float = minf(delta, 0.05)

	var az_prev: float = azimuth
	var el_prev: float = elevation

	azimuth = lerpf(azimuth, target_azimuth, safe_delta * rotation_lerp_speed)
	elevation = lerpf(elevation, target_elevation, safe_delta * rotation_lerp_speed)

	if absf(azimuth - az_prev) > 0.0001 or absf(elevation - el_prev) > 0.0001:
		camera_dirty = true

	if camera_dirty:
		update_camera_position()
		camera_dirty = false

func _input(event: InputEvent) -> void:
	if not is_initialized: return
	if interior_mode:
		_interior_input(event)
		return

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_LEFT:
			left_mouse_pressed = event.pressed
			if left_mouse_pressed:
				first_drag_frame = true # Reset the drag frame check on new click
		
		if not left_mouse_pressed:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				distance -= zoom_speed
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				distance += zoom_speed
			distance = clampf(distance, min_distance, max_distance)
			camera_dirty = true
			update_slider()

	if event is InputEventMouseMotion and left_mouse_pressed and not zooming:
		# FIX: Ignore the very first frame of movement.
		# Often the delta on the first frame is erratic/large.
		if first_drag_frame:
			first_drag_frame = false
			return

		if rotate_around_y_axis:
			target_azimuth -= event.relative.x * rotation_speed
		if rotate_around_x_axis:
			target_elevation -= event.relative.y * rotation_speed
			target_elevation = clampf(target_elevation, -PI / 2 + 0.1, 0.0)
		camera_dirty = true

	# ... (Touch logic remains the same) ...
	if event is InputEventScreenTouch:
		if event.pressed:
			touch_events[event.index] = event.position
		else:
			touch_events.erase(event.index)
			if touch_events.size() < 2:
				last_distance = 0.0
				zooming = false

	if event is InputEventScreenDrag:
		touch_events[event.index] = event.position
		if touch_events.size() == 2:
			var points: Array[Vector2] = []
			for key in touch_events:
				points.append(touch_events[key])
			if points.size() < 2: return
			
			var current_distance: float = points[0].distance_to(points[1])
			if last_distance > 0.0:
				var delta_dist: float = current_distance - last_distance
				adjust_zoom(delta_dist)
			last_distance = current_distance
			zooming = true
		else:
			zooming = false

func adjust_zoom(delta: float) -> void:
	var direction: float = -delta * zoom_speed * 0.005
	distance += direction
	distance = clampf(distance, min_distance, max_distance)
	camera_dirty = true
	update_slider()

func _on_slider_zoom(value: float) -> void:
	var new_distance: float = map_range(value, 0, 100, min_distance, max_distance)
	if absf(distance - new_distance) > 0.01:
		distance = new_distance
		camera_dirty = true

func update_slider() -> void:
	if zoom_slider:
		var new_val: float = map_range(distance, min_distance, max_distance, 0, 100)
		if absf(zoom_slider.value - new_val) > 0.5:
			zoom_slider.set_value_no_signal(new_val)

func update_camera_position() -> void:
	if orbit_target:
		var x: float = orbit_target.global_transform.origin.x + distance * cos(elevation) * sin(azimuth)
		var y: float = orbit_target.global_transform.origin.y - distance * sin(elevation)
		var z: float = orbit_target.global_transform.origin.z + distance * cos(elevation) * cos(azimuth)
		
		global_transform.origin = Vector3(x, maxf(y, orbit_target.global_transform.origin.y + 0.1), z)
		look_at(orbit_target.global_transform.origin)

func map_range(value: float, in_min: float, in_max: float, out_min: float, out_max: float) -> float:
	return out_min + (value - in_min) * (out_max - out_min) / (in_max - in_min)
