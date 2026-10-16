extends Button

# Objects to swing open/closed, with the angle (degrees) and the axis ("x", "y"
# or "z", in the object's parent space) for each. Add more with add_object().
@export var objects_to_rotate: Array[Node3D] = []
@export var rotation_values: Array[float] = []
@export var rotation_axes: Array[String] = []
# Higher is faster (exponential easing).
@export var rotation_speed: float = 2.0

var are_rotated: bool = false

var _closed: Array[Basis] = []
var _open: Array[Basis] = []
var _progress: float = 0.0
var _goal: float = 0.0
var _is_rotating: bool = false


func _ready() -> void:
	for i in objects_to_rotate.size():
		_register(i)
	pressed.connect(_on_Button_pressed)
	# has_singleton first: get_singleton logs an engine error when it's missing (e.g. on web).
	var appPlugin: Object = Engine.get_singleton("AppPlugin") if Engine.has_singleton("AppPlugin") else null
	if appPlugin:
		print("App plugin is available")

		# Signal fired from the app logic to update the gltf model being shown
		appPlugin.connect("toggle_door", _toggle_door_function)
	else:
		print("App plugin is not available")


func add_object(obj: Node3D, degrees: float, axis: String) -> void:
	objects_to_rotate.append(obj)
	rotation_values.append(degrees)
	rotation_axes.append(axis)
	_register(objects_to_rotate.size() - 1)


# Remembers the object's own rest pose and works out its open pose, so closing
# returns it exactly to where it started (a pivot may carry its own rotation).
func _register(index: int) -> void:
	var closed: Basis = objects_to_rotate[index].basis
	var degrees: float = rotation_values[index] if index < rotation_values.size() else 1.0
	var axis_name: String = rotation_axes[index] if index < rotation_axes.size() else "y"
	var axis := Vector3.UP
	match axis_name:
		"x":
			axis = Vector3.RIGHT
		"z":
			axis = Vector3.BACK
	_closed.append(closed)
	_open.append(Basis(axis, deg_to_rad(degrees)) * closed)


func _on_Button_pressed() -> void:
	if objects_to_rotate.is_empty():
		return
	are_rotated = not are_rotated
	_goal = 1.0 if are_rotated else 0.0
	_is_rotating = true


func _process(delta: float) -> void:
	if not _is_rotating:
		return
	_progress = lerpf(_progress, _goal, 1.0 - exp(-rotation_speed * delta))
	if absf(_progress - _goal) < 0.001:
		_progress = _goal
		_is_rotating = false
	for i in objects_to_rotate.size():
		objects_to_rotate[i].basis = _closed[i].slerp(_open[i], _progress)


func _toggle_door_function() -> void:
	_on_Button_pressed()
