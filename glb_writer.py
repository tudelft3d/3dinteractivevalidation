import numpy as np
from cjio import cityjson
from shapely.geometry import Polygon
from pygltflib import GLTF2, Scene, Node, Mesh, Primitive, Buffer, BufferView, Accessor
import earcut.earcut
from typing import List, Tuple
import json

class GLBWriter:
    @staticmethod
    def create_glb(city_objects: List[str], cm: cityjson.CityJSON, transformer) -> Tuple[GLTF2, List[float], List[float]]:
        # GLTF oluştur
        gltf = GLTF2()
        mesh = Mesh()
        vertices = []
        indices = []
        vertex_map = {}
        feature_ids = []
        feature_id = 0

        # Collect all attributes first
        features_attrs = []
        for obj_id in city_objects:
            attrs = cm.get_cityobjects()[obj_id].attributes.copy()
            attrs["OBJ_ID"] = obj_id
            features_attrs.append(attrs)

        # Find unique keys and infer types
        unique_keys = set()
        for attrs in features_attrs:
            unique_keys.update(attrs.keys())
        unique_keys = sorted(unique_keys)

        prop_configs = {}
        for key in unique_keys:
            values = [attrs.get(key) for attrs in features_attrs]  # Use None for missing
            values = [v for v in values if v is not None]
            if not values:
                continue
            sample = values[0]
            if isinstance(sample, (list, dict)):
                # Treat complex types as JSON strings
                ptype = "STRING"
                default = ""
            elif all(isinstance(v, bool) for v in values):
                ptype = "BOOLEAN"
                ctype = None
                ccode = 5121  # UNSIGNED_BYTE for BOOLEAN
                default = False
            elif all(isinstance(v, int) for v in values):
                ptype = "SCALAR"
                ctype = "INT32"
                ccode = 5124
                default = 0
            elif all(isinstance(v, (int, float)) for v in values):
                ptype = "SCALAR"
                ctype = "FLOAT32"
                ccode = 5126
                default = 0.0
            else:
                ptype = "STRING"
                ctype = None
                ccode = None
                default = ""
            prop_configs[key] = {"ptype": ptype, "ctype": ctype, "ccode": ccode, "default": default}

        # First pass: Collect vertices and build triangles
        for obj_id in city_objects:
            city_obj = cm.get_cityobjects()[obj_id]
            if not city_obj.geometry:
                feature_id += 1
                continue
                
            geometry = city_obj.geometry[0]

            for surface in geometry.boundaries:
                shapely_poly = Polygon(surface[0])
                coords = list(shapely_poly.exterior.coords)
                vertex_count = len(shapely_poly.exterior.coords)

                # Her vertex için aynı feature ID'yi ekle
                feature_ids.extend([feature_id] * vertex_count)

                ecef_coords = [transformer.transform(x, y, z) for x, y, z in coords]
                flat_coords = [coord for point in ecef_coords for coord in point]
                
                triangles = earcut.earcut.earcut(flat_coords, None, 3)
                start_index = len(vertices) // 3
                indices.extend([i + start_index for i in triangles])
                vertices.extend(flat_coords)

                # Calculate triangle normals
                for i in range(0, len(triangles), 3):
                    v0 = np.array(ecef_coords[triangles[i]])
                    v1 = np.array(ecef_coords[triangles[i + 1]])
                    v2 = np.array(ecef_coords[triangles[i + 2]])
                    
                    edge1 = v1 - v0
                    edge2 = v2 - v0
                    normal = np.cross(edge1, edge2)
                    norm_length = np.linalg.norm(normal)
                    if norm_length > 0:
                        normal = normal / norm_length
                    else:
                        normal = np.array([0.0, 0.0, 1.0])
                    
                    for j in range(3):
                        vert_idx = start_index + triangles[i + j]
                        if vert_idx not in vertex_map:
                            vertex_map[vert_idx] = []
                        vertex_map[vert_idx].append(normal)

            feature_id += 1

        # Second pass: Average normals for all vertices
        num_vertices = len(vertices) // 3
        vertex_normals = np.zeros((num_vertices, 3), dtype=np.float32)
        for vert_idx, normals in vertex_map.items():
            if normals:
                avg_normal = np.mean(normals, axis=0)
                norm_length = np.linalg.norm(avg_normal)
                if norm_length > 0:
                    vertex_normals[vert_idx] = avg_normal / norm_length
                else:
                    vertex_normals[vert_idx] = [0.0, 0.0, 1.0]
            else:
                vertex_normals[vert_idx] = [0.0, 0.0, 1.0]

        # Convert to numpy arrays
        vertices = np.array(vertices, dtype=np.float32)
        indices = np.array(indices, dtype=np.uint32)
        normals = vertex_normals.flatten()
        feature_ids = np.array(feature_ids, dtype=np.uint32)  # Feature ID’ler için uint32

        # Calculate min/max values
        min_vals = vertices.reshape(-1, 3).min(axis=0).tolist()
        max_vals = vertices.reshape(-1, 3).max(axis=0).tolist()
        normal_min = normals.reshape(-1, 3).min(axis=0).tolist()
        normal_max = normals.reshape(-1, 3).max(axis=0).tolist()

        # Prepare fixed data
        vertex_data = vertices.tobytes()
        feature_id_data = feature_ids.tobytes()
        normal_data = normals.tobytes()
        index_data = indices.tobytes()

        # Start collecting buffer datas with fixed ones
        buffer_datas = [vertex_data, feature_id_data, normal_data, index_data]

        # Data indices for attributes
        data_indices = {}  # key: (str_data_idx, off_data_idx) or (val_data_idx,)

        # Collect attribute data
        for key in unique_keys:
            config = prop_configs.get(key)
            if not config:
                continue
            default = config["default"]
            values = []
            for fa in features_attrs:
                v = fa.get(key, default)
                if config["ptype"] == "STRING" and not isinstance(v, str):
                    v = json.dumps(v) if isinstance(v, (list, dict)) else str(v)
                values.append(v)

            if config["ptype"] == "STRING":
                str_data = "".join(values).encode("utf-8")
                buffer_datas.append(str_data)
                str_data_idx = len(buffer_datas) - 1

                offsets = [0]
                curr_off = 0
                for v in values:
                    curr_off += len(v.encode("utf-8"))
                    offsets.append(curr_off)

                # Check if needs UINT64
                offset_type = "UINT32"
                off_dtype = np.uint32
                if curr_off > 4294967295:
                    offset_type = "UINT64"
                    off_dtype = np.uint64

                off_arr = np.array(offsets, dtype=off_dtype)
                off_data = off_arr.tobytes()
                buffer_datas.append(off_data)
                off_data_idx = len(buffer_datas) - 1

                data_indices[key] = (str_data_idx, off_data_idx, offset_type)
            else:  # SCALAR or BOOLEAN
                if config["ptype"] == "BOOLEAN":
                    arr = np.array([1 if v else 0 for v in values], dtype=np.uint8)
                elif config["ccode"] == 5126:
                    arr = np.array(values, dtype=np.float32)
                elif config["ccode"] == 5124:
                    arr = np.array(values, dtype=np.int32)
                else:
                    continue
                val_data = arr.tobytes()
                buffer_datas.append(val_data)
                val_data_idx = len(buffer_datas) - 1
                data_indices[key] = (val_data_idx,)

        # Now compute cumulative offsets
        cum_offsets = [0]
        for bd in buffer_datas:
            cum_offsets.append(cum_offsets[-1] + len(bd))
        cum_offsets = cum_offsets[:-1]  # remove last

        # Buffer oluştur
        total_length = sum(len(bd) for bd in buffer_datas)
        buffer = Buffer(uri=None, byteLength=total_length)
        gltf.buffers.append(buffer)

        # Add fixed bufferViews and accessors
        gltf.bufferViews = []
        gltf.accessors = []

        # Vertex
        gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[0], byteLength=len(buffer_datas[0]), target=34962))
        gltf.accessors.append(Accessor(bufferView=0, byteOffset=0, componentType=5126, count=len(vertices) // 3, type="VEC3", max=max_vals, min=min_vals))

        # Feature ID
        gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[1], byteLength=len(buffer_datas[1]), target=34962))
        gltf.accessors.append(Accessor(bufferView=1, byteOffset=0, componentType=5125, count=len(feature_ids), type="SCALAR", max=[int(feature_ids.max())], min=[int(feature_ids.min())]))

        # Normal
        gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[2], byteLength=len(buffer_datas[2]), target=34962))
        gltf.accessors.append(Accessor(bufferView=2, byteOffset=0, componentType=5126, count=len(normals) // 3, type="VEC3", max=normal_max, min=normal_min))

        # Index
        gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[3], byteLength=len(buffer_datas[3]), target=34963))
        gltf.accessors.append(Accessor(bufferView=3, byteOffset=0, componentType=5125, count=len(indices), type="SCALAR", max=[int(indices.max())], min=[int(indices.min())]))

        # Current indices
        bv_idx = 4

        # Schema and property table props
        schema_props = {}
        prop_table_props = {}

        # Add attribute bufferViews (no accessors for metadata)
        for key in unique_keys:
            config = prop_configs.get(key)
            if not config:
                continue
            if config["ptype"] == "STRING":
                str_data_idx, off_data_idx, offset_type = data_indices[key]
                # String data BufferView (no target)
                gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[str_data_idx], byteLength=len(buffer_datas[str_data_idx])))
                str_bv_idx = bv_idx
                bv_idx += 1

                # Offsets BufferView (no target)
                gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[off_data_idx], byteLength=len(buffer_datas[off_data_idx])))
                off_bv_idx = bv_idx
                bv_idx += 1

                schema_props[key] = {"type": "STRING"}
                prop_table_props[key] = {"values": str_bv_idx, "stringOffsets": off_bv_idx, "stringOffsetType": offset_type}
            else:
                val_data_idx, = data_indices[key]
                # Value BufferView (no target)
                gltf.bufferViews.append(BufferView(buffer=0, byteOffset=cum_offsets[val_data_idx], byteLength=len(buffer_datas[val_data_idx])))
                val_bv_idx = bv_idx
                bv_idx += 1

                if config["ptype"] == "BOOLEAN":
                    schema_props[key] = {"type": "BOOLEAN"}
                else:
                    schema_props[key] = {"type": "SCALAR", "componentType": config["ctype"]}
                prop_table_props[key] = {"values": val_bv_idx}

        # Primitive oluştur
        primitive = Primitive(
            attributes={"POSITION": 0, "_FEATURE_ID_0": 1, "NORMAL": 2},
            indices=3,
            extensions={"EXT_mesh_features": {"featureIds": [{"featureCount": len(city_objects), "attribute": 0, "propertyTable": 0}]}}
        )
        mesh.primitives.append(primitive)
        gltf.meshes.append(mesh)
        # Scene ve Node oluştur
        node = Node(mesh=0)
        gltf.nodes.append(node)
        scene = Scene(nodes=[0])
        gltf.scenes.append(scene)
        gltf.scene = 0

        gltf.extensionsUsed = ["EXT_mesh_features", "EXT_structural_metadata"]

        # Extensions
        gltf.extensions = {
            "EXT_structural_metadata": {
                "schema": {
                    "id": "CityJSON Attributes",
                    "classes": {
                        "exampleMetadataClass": {
                            "properties": schema_props
                        }
                    }
                },
                "propertyTables": [{
                    "name": "Attributes",
                    "class": "exampleMetadataClass",
                    "count": len(city_objects),
                    "properties": prop_table_props
                }]
            }
        }

        # GLB dosyasını kaydet
        gltf.set_binary_blob(b''.join(buffer_datas))
        
        return gltf, min_vals, max_vals