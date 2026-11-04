extends Node

var streams: Dictionary = {"place":preload("res://assets/place.wav"),"shot":preload("res://assets/shot.wav"),"mist":preload("res://assets/mist.wav"),"kill":preload("res://assets/kill.wav"),"base_hit":preload("res://assets/base_hit.wav"),"victory":preload("res://assets/victory.wav"),"defeat":preload("res://assets/defeat.wav"),"click":preload("res://assets/click.wav")}
var players: Array[AudioStreamPlayer] = []
var counts: Dictionary = {}
var cursor := 0
var recorder: AudioEffectRecord = null
var recorder_index := -1

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for i in range(12):
		var p := AudioStreamPlayer.new()
		p.volume_db = -10.0
		p.bus = "Master"
		add_child(p)
		players.append(p)

func play(key: String) -> void:
	if not streams.has(key) or players.is_empty():
		return
	var p := players[cursor]
	cursor = (cursor+1)%players.size()
	p.stream = streams[key]
	p.play()
	counts[key] = counts.get(key,0)+1

func summary() -> Dictionary:
	var active := 0
	for p in players:
		if p.playing:
			active += 1
	var paths: Dictionary = {}
	for key in streams:
		paths[key] = streams[key].resource_path
	return {"played_counts":counts.duplicate(true),"stream_paths":paths,"active_voices":active,"master_volume_db":AudioServer.get_bus_volume_db(0),"mix_rate":AudioServer.get_mix_rate()}

# Labelled audio-only diagnostics: these never change the game model.
func begin_capture() -> Dictionary:
	_clear_recorder()
	recorder = AudioEffectRecord.new()
	recorder.format = AudioStreamWAV.FORMAT_16_BITS
	recorder_index = AudioServer.get_bus_effect_count(0)
	AudioServer.add_bus_effect(0,recorder)
	recorder.set_recording_active(true)
	return {"recording":true,"bus":"Master","mix_rate":AudioServer.get_mix_rate()}

func finish_capture(label: String) -> Dictionary:
	if recorder == null or not label.is_valid_identifier() or label.length() > 64:
		return {"saved":false}
	recorder.set_recording_active(false)
	var recording: AudioStreamWAV = recorder.get_recording()
	DirAccess.make_dir_recursive_absolute("res://qa/audio")
	var ignore := FileAccess.open("res://qa/audio/.gdignore",FileAccess.WRITE)
	ignore.store_string("")
	ignore.close()
	var path := "res://qa/audio/%s.wav" % label
	var result := recording.save_to_wav(path)
	var seconds := recording.get_length()
	_clear_recorder()
	return {"saved":result == OK,"path":path,"seconds":seconds,"error":result}

func _clear_recorder() -> void:
	if recorder != null:
		recorder.set_recording_active(false)
		if recorder_index >= 0 and recorder_index < AudioServer.get_bus_effect_count(0):
			AudioServer.remove_bus_effect(0,recorder_index)
		recorder = null
		recorder_index = -1

func shutdown() -> void:
	_clear_recorder()
	for p in players:
		p.stop()
	# Normal real-time quit drains the native mix thread before resources leave.
	await get_tree().create_timer(0.18).timeout

func _exit_tree() -> void:
	_clear_recorder()
