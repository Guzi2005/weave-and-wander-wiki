extends SceneTree
## Refines the accepted f2f7efe long chemise, keeping its silhouette and rig.
## Run with Godot 4.7, --path pointing to the sibling game (shader dependencies):
## --script THIS_FILE -- SOURCE_TSCN OUTPUT_DIRECTORY
## Input must be the original, never the output of this script.

const WHITE := Color(.86, .82, .73)
const NECK := [[.24,.70,.10,-.11],[.62,.52,.12,.12],[1.04,.80,.14,.18],
 [1.53,.39,.11,-.09],[2.06,.63,.13,-.16],[2.61,.78,.14,.10],
 [3.16,.56,.12,-.12],[3.72,.72,.14,.13],[4.21,.44,.12,-.16],
 [4.83,.73,.14,-.10],[5.38,.57,.12,.13],[5.94,.81,.11,.10]]
const CUFF := [[.19,.70,.17,.17],[1.17,.46,.19,-.16],[2.21,.59,.18,.21],
 [3.05,.81,.20,-.13],[4.22,.54,.17,.15],[5.27,.73,.21,-.17]]

func _initialize() -> void: run.call_deferred()
func smooth(t: float) -> float:
	var f := clampf(t,0,1)
	return f*f*(3-2*f)

func folds(angle: float, distance: float, anchors: Array, depth: float) -> float:
	var value := 0.0
	for fold in anchors:
		var t: float = distance/float(fold[1])
		if t >= 1: continue
		var delta := wrapf(angle-float(fold[0])-float(fold[3])*t,-PI,PI)
		var across: float = delta/(float(fold[2])*(1+.8*t))
		value += depth*(.42*exp(-pow((across-1.15)/1.35,2))-exp(-across*across))*(1-smooth(t))
	return value

func hanging(angle: float, t: float) -> float:
	# Broad, irregular folds retain their grain; free cloth relaxes towards hem.
	return (.0065*sin(7*angle+.30*sin(3*angle)+.18*t)+.003*sin(11*angle-.35+.10*t))*(1-.38*t)

func tint(depth: float, amplitude: float) -> Color:
	var value := clampf(.97+depth/amplitude*.18,.82,1.0)
	return Color(WHITE.r*value,WHITE.g*value,WHITE.b*value,1)

func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size()!=2:
		push_error("Expected SOURCE_TSCN OUTPUT_DIRECTORY")
		quit(1)
		return
	var packed := load(args[0]) as PackedScene
	assert(packed != null)
	var model := packed.instantiate()
	root.add_child(model)
	var parts := model.find_children("*","MeshInstance3D",true,false)
	for part: MeshInstance3D in parts:
		var old := part.mesh as ArrayMesh
		var arrays := old.surface_get_arrays(0)
		var original: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX].duplicate()
		var vertices: PackedVector3Array = original.duplicate()
		var colors: PackedColorArray = arrays[Mesh.ARRAY_COLOR].duplicate()
		match str(part.name):
			"UkrShirt":
				assert(vertices.size()==12895,"Use the accepted old long-shirt asset")
				for i in 45:
					var t := i/44.0
					for j in 145:
						var u := j/144.0
						var gap := .045*smooth((t-.87)/.13)
						var a := gap+u*(TAU-2*gap)
						var d := folds(a,1-t,NECK,.015)*smooth((1-t)/.06)
						d += hanging(a,0)*(1-smooth(t/.58))
						var rx := .304-.142*smooth((t-.57)/.43)+.018*sin(PI*t)
						var rz := .229-.102*smooth((t-.60)/.40)+.016*sin(PI*t)
						# Match the lower panel instead of a scalloped floating overlap.
						rx += .0113*(1-smooth(t/.24))
						rz += .0064*(1-smooth(t/.24))
						var y := lerpf(1.405,1.927,t)-.012*smooth((t-.82)/.18)*pow(maxf(0,cos(a)),6)
						var k := i*145+j
						vertices[k] = Vector3(sin(a)*(rx+d),y,cos(a)*(rz+d))
						colors[k] = tint(d,.015)
				for side_index in 2:
					var side := -1.0 if side_index==0 else 1.0
					for i in 49:
						var t := i/48.0
						for j in 65:
							var a := j/64.0*TAU
							var center := side*(.30-.145*smooth((t-.55)/.45)+.043*sin(PI*t))
							var r := .060+.080*pow(sin(PI*t),.65)
							var d := folds(a,t,CUFF,.013)*smooth(t/.055)
							d += folds(a,1-t,NECK,.006)*smooth((1-t)/.08)
							var blend := 1-smooth(t/.12)
							var rx := r+d+.005*blend
							var rz := r*1.03+d+.0072*blend
							var k := 6525+side_index*3185+i*65+j
							vertices[k] = Vector3(center+cos(a)*rx,lerpf(1.178,1.855,t),.012+sin(a)*rz)
							colors[k] = tint(d,.013)
			"UkrUnderskirt":
				assert(vertices.size()==3751)
				for i in 31:
					var t := i/30.0
					for j in 121:
						var a := j/120.0*TAU
						var d := hanging(a,t)
						var k := i*121+j
						vertices[k] = Vector3((.3153+.0227*t+d)*sin(a),lerpf(1.405,.18,t),(.2354+.0326*t+d)*cos(a))
						colors[k] = tint(d,.015)
			"UkrCuffs":
				assert(vertices.size()==780)
				for k in vertices.size():
					colors[k] = WHITE
			"UkrShirtCollar":
				assert(vertices.size()==774)
				for i in 6:
					var t := i/5.0
					for j in 129:
						var a := .045+j/128.0*(TAU-.09)
						var k := i*129+j
						vertices[k] = Vector3(sin(a)*(.163-.003*t),1.922+.014*t-.012*pow(maxf(0,cos(a)),6),cos(a)*(.129-.003*t))
						colors[k] = WHITE
			"UkrNeckBow":
				# Move each whole cord cross-section, avoiding flattened string.
				for start in range(0,vertices.size(),7):
					var center := Vector3.ZERO
					for j in 7: center+=vertices[start+j]/7.0
					var t := clampf((center.y-1.405)/.522,0,1)
					var rx := .304-.142*smooth((t-.57)/.43)+.018*sin(PI*t)
					var rz := .229-.102*smooth((t-.60)/.40)+.016*sin(PI*t)
					var angle := asin(clampf(center.x/rx,-1,1))
					var d := folds(angle,1-t,NECK,.015)*smooth((1-t)/.06)
					var lift := maxf(0,cos(angle)*(rz+d)+.006-center.z)
					for j in 7: vertices[start+j].z+=lift
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_COLOR] = colors
		# Native rest-pose shapes receive the same local delta; rig is unchanged.
		var shapes := old.surface_get_blend_shape_arrays(0)
		for shape in shapes:
			var points: PackedVector3Array = shape[Mesh.ARRAY_VERTEX]
			for k in points.size(): points[k] += vertices[k]-original[k]
			shape[Mesh.ARRAY_VERTEX] = points
			shape[Mesh.ARRAY_NORMAL] = normals(points,arrays[Mesh.ARRAY_INDEX])
		arrays[Mesh.ARRAY_NORMAL] = normals(vertices,arrays[Mesh.ARRAY_INDEX])
		arrays[Mesh.ARRAY_TANGENT] = null
		for shape in shapes: shape[Mesh.ARRAY_TANGENT] = null
		if part.name in ["UkrCuffs","UkrShirtCollar"]:
			add_facing(arrays,part.name=="UkrCuffs")
		var mesh := ArrayMesh.new()
		mesh.blend_shape_mode = old.blend_shape_mode
		for i in old.get_blend_shape_count(): mesh.add_blend_shape(old.get_blend_shape_name(i))
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays,shapes)
		part.mesh = mesh
		part.set_meta("source_geometry","Accepted long chemise / seam-led folds and open facings v1")
		print(part.name," vertices=",arrays[Mesh.ARRAY_VERTEX].size()," shapes=",shapes.size())
	var output := args[1]
	DirAccess.make_dir_recursive_absolute(output)
	var native := PackedScene.new()
	assert(native.pack(model)==OK)
	assert(ResourceSaver.save(native,output.path_join("ukrainian_undershirt_001.tscn"))==OK)
	for part: MeshInstance3D in parts:
		var source := part.material_override as ShaderMaterial
		var material := StandardMaterial3D.new()
		material.albedo_color = source.get_shader_parameter("pigment")
		material.vertex_color_use_as_albedo = true
		if source.get_shader_parameter("use_pigment_map") == true:
			material.albedo_texture = source.get_shader_parameter("pigment_map")
		material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
		part.material_override = material
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	assert(doc.append_from_scene(model,state)==OK)
	assert(doc.write_to_filesystem(state,output.path_join("ukrainian_undershirt_001.glb"))==OK)
	print("UNDERSHIRT_REFINEMENT_PASS")
	quit()

func normals(vertices: PackedVector3Array, indices: PackedInt32Array) -> PackedVector3Array:
	var result := PackedVector3Array()
	result.resize(vertices.size())
	for i in range(0,indices.size(),3):
		var a := indices[i]
		var b := indices[i+1]
		var c := indices[i+2]
		var normal := (vertices[c]-vertices[a]).cross(vertices[b]-vertices[a])
		result[a]+=normal
		result[b]+=normal
		result[c]+=normal
	for i in result.size(): result[i]=result[i].normalized()
	return result

func add_facing(arrays: Array, cuffs: bool) -> void:
	# Duplicate only the narrow binding inwards, bridge its free edge, never cap
	# the neck/wrist aperture. Copy skin weights so facings follow every pose.
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var count := verts.size()
	var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var old_indices := indices.duplicate()
	for i in count:
		var p := verts[i]
		var center := Vector3((-0.30 if i<390 else .30) if cuffs else 0,p.y,.012 if cuffs else 0)
		var inner := p-(p-center).normalized()*.0035
		if cuffs:
			var t := clampf((p.y-1.135)/.045,0,1)
			inner.y+=.055*t
			inner-=(p-center).normalized()*.004*t
		else:
			var t := 1-float(i/129)/5.0
			inner.y-=.055*t
			inner-=(p-center).normalized()*.010*t
		verts.append(inner)
	for slot in [Mesh.ARRAY_COLOR,Mesh.ARRAY_TEX_UV,Mesh.ARRAY_BONES,Mesh.ARRAY_WEIGHTS]:
		var data = arrays[slot]
		if data==null: continue
		var copy = data.duplicate()
		if slot==Mesh.ARRAY_COLOR:
			for i in copy.size(): copy[i]=Color(WHITE.r*.55,WHITE.g*.55,WHITE.b*.55,1)
		data.append_array(copy)
		arrays[slot]=data
	for i in range(0,old_indices.size(),3):
		indices.append_array(PackedInt32Array([old_indices[i]+count,old_indices[i+2]+count,old_indices[i+1]+count]))
	var cols := 64 if cuffs else 128
	var groups := 2 if cuffs else 1
	for group in groups:
		# Cuffs: wrist rim at row zero. Collar: top rim at row five.
		var offset := group*390 if cuffs else 5*129
		for j in cols:
			var a := offset+j
			var b := a+1
			indices.append_array(PackedInt32Array([a,a+count,b+count,a,b+count,b]))
	arrays[Mesh.ARRAY_VERTEX]=verts
	arrays[Mesh.ARRAY_INDEX]=indices
	arrays[Mesh.ARRAY_NORMAL]=normals(verts,indices)
