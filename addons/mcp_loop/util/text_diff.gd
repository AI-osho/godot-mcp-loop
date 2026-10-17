@tool
extends RefCounted
## Line-based unified diff (LCS) used for dry-run previews of script writes.

const CONTEXT := 3
## Above this many cells the LCS table gets too big; fall back to a summary.
const MAX_CELLS := 4_000_000


static func _lines(text: String) -> PackedStringArray:
	if text == "":
		return PackedStringArray()
	var t := text
	if t.ends_with("\n"):
		t = t.substr(0, t.length() - 1)
	return t.split("\n")


## Returns a list of ops: [kind, line] where kind is " ", "-" or "+".
static func _ops(a: PackedStringArray, b: PackedStringArray) -> Array:
	var n := a.size()
	var m := b.size()
	# Trim common prefix/suffix to keep the table small.
	var pre := 0
	while pre < n and pre < m and a[pre] == b[pre]:
		pre += 1
	var suf := 0
	while suf < n - pre and suf < m - pre and a[n - 1 - suf] == b[m - 1 - suf]:
		suf += 1
	var ops: Array = []
	for i in pre:
		ops.append([" ", a[i]])
	var a_mid := a.slice(pre, n - suf)
	var b_mid := b.slice(pre, m - suf)
	var an := a_mid.size()
	var bn := b_mid.size()
	if an * bn > MAX_CELLS:
		for line in a_mid:
			ops.append(["-", line])
		for line in b_mid:
			ops.append(["+", line])
	else:
		# lcs[i][j] = LCS length of a_mid[i:] and b_mid[j:]
		var lcs: Array[PackedInt32Array] = []
		lcs.resize(an + 1)
		for i in an + 1:
			var row := PackedInt32Array()
			row.resize(bn + 1)
			lcs[i] = row
		for i in range(an - 1, -1, -1):
			for j in range(bn - 1, -1, -1):
				if a_mid[i] == b_mid[j]:
					lcs[i][j] = lcs[i + 1][j + 1] + 1
				else:
					lcs[i][j] = max(lcs[i + 1][j], lcs[i][j + 1])
		var i := 0
		var j := 0
		while i < an and j < bn:
			if a_mid[i] == b_mid[j]:
				ops.append([" ", a_mid[i]])
				i += 1
				j += 1
			elif lcs[i + 1][j] >= lcs[i][j + 1]:
				ops.append(["-", a_mid[i]])
				i += 1
			else:
				ops.append(["+", b_mid[j]])
				j += 1
		while i < an:
			ops.append(["-", a_mid[i]])
			i += 1
		while j < bn:
			ops.append(["+", b_mid[j]])
			j += 1
	for k in range(n - suf, n):
		ops.append([" ", a[k]])
	return ops


static func stats(old_text: String, new_text: String) -> Dictionary:
	var added := 0
	var removed := 0
	for op in _ops(_lines(old_text), _lines(new_text)):
		if op[0] == "+":
			added += 1
		elif op[0] == "-":
			removed += 1
	return {"added": added, "removed": removed}


static func unified(old_text: String, new_text: String, path: String) -> String:
	var ops := _ops(_lines(old_text), _lines(new_text))
	var changed: Array[int] = []
	for k in ops.size():
		if ops[k][0] != " ":
			changed.append(k)
	if changed.is_empty():
		return ""

	# Group changes into hunks separated by more than 2*CONTEXT unchanged lines.
	var groups: Array = []
	var start := changed[0]
	var end := changed[0]
	for k in range(1, changed.size()):
		if changed[k] - end > 2 * CONTEXT:
			groups.append([start, end])
			start = changed[k]
		end = changed[k]
	groups.append([start, end])

	# Precompute old/new line numbers at each op index.
	var old_no: Array[int] = []
	var new_no: Array[int] = []
	var o := 0
	var nn := 0
	for op in ops:
		old_no.append(o)
		new_no.append(nn)
		if op[0] != "+":
			o += 1
		if op[0] != "-":
			nn += 1

	var out := "--- a/%s\n+++ b/%s\n" % [path, path]
	for g in groups:
		var lo: int = max(0, g[0] - CONTEXT)
		var hi: int = min(ops.size() - 1, g[1] + CONTEXT)
		var old_count := 0
		var new_count := 0
		var body := ""
		for k in range(lo, hi + 1):
			var kind: String = ops[k][0]
			body += kind + ops[k][1] + "\n"
			if kind != "+":
				old_count += 1
			if kind != "-":
				new_count += 1
		var old_start := old_no[lo] + 1 if old_count > 0 else old_no[lo]
		var new_start := new_no[lo] + 1 if new_count > 0 else new_no[lo]
		out += "@@ -%d,%d +%d,%d @@\n" % [old_start, old_count, new_start, new_count]
		out += body
	return out
