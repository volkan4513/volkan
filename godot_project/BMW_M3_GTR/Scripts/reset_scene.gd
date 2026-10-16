extends Button

func _ready() -> void:
	connect("pressed", Callable(self, "_on_button_pressed"))
	
	# has_singleton first: get_singleton logs an engine error when it's missing (e.g. on web).
	var appPlugin: Object = Engine.get_singleton("AppPlugin") if Engine.has_singleton("AppPlugin") else null
	if appPlugin:
		print("App plugin is available")

		# Signal fired from the app logic to update the gltf model being shown
		appPlugin.connect("reset_scene", _reset_scene_function)
	else:
		print("App plugin is not available")

func _on_button_pressed() -> void:
	get_tree().reload_current_scene()

func _reset_scene_function() -> void:
	_on_button_pressed()
