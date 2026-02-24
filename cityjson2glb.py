import numpy as np
from cjio import cityjson
from shapely.geometry import Polygon
from pygltflib import GLTF2, Scene, Node, Mesh, Primitive, Buffer, BufferView, Accessor
import earcut.earcut
from typing import List, Tuple
import json
from glb_writer import GLBWriter
import pyproj

def cityjson_to_glb(city_objects: List[str], cm: cityjson.CityJSON, transformer, output_path: str) -> GLTF2:
    try:
        gltf, _, _ = GLBWriter.create_glb(city_objects, cm, transformer)
        gltf.save_binary(output_path)
        print(f"GLB file saved to {output_path}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error converting CityJSON to GLB: {str(e)}")

if __name__ == "__main__":
    # Example usage

    temp_file_path = "data/cityjson/Lisboa_v3.json"
    cm = cityjson.load(temp_file_path)
    print(cm.get_epsg())
    transformer = pyproj.Transformer.from_crs(cm.get_epsg(), "EPSG:4978", always_xy=True)
    print(cm)
    output_path = "output_model.glb"
    
    city_objects = list(cm.get_cityobjects().keys())
    glb = cityjson_to_glb(city_objects, cm, transformer, output_path)