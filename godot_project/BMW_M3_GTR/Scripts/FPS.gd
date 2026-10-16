extends Control

# Refresh the label twice a second instead of every frame, so it doesn't
# rebuild its text (and force a redraw) on every frame.
const UPDATE_INTERVAL: float = 0.5

var _elapsed: float = UPDATE_INTERVAL

func _process(delta: float) -> void:
	_elapsed += delta
	if _elapsed < UPDATE_INTERVAL:
		return
	_elapsed = 0.0

	# Retrieve performance stats
	var fps: int = Engine.get_frames_per_second()

	# Update the label text with the stats
	$Label.text = "FPS: %d\n" % fps
