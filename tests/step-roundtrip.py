"""Optional independent CAD round-trip. Requires OCP (Open CASCADE Python bindings).
Run node tests/exchange.mjs first, then python3 tests/step-roundtrip.py.
"""
import json
import math
import sys
from pathlib import Path
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID, TopAbs_VERTEX, TopAbs_FACE, TopAbs_IN, TopAbs_OUT
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.gp import gp_Pnt

folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'build/exchange-fixtures'
expected = json.loads((folder / 'expected.json').read_text())

def load(path):
    reader = STEPControl_Reader()
    assert reader.ReadFile(str(path)) == IFSelect_RetDone, f'Cannot read {path}'
    assert reader.TransferRoots() > 0, f'Cannot transfer {path}'
    shape = reader.OneShape()
    assert not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(), f'Invalid CAD shape: {path}'
    return shape

def count(shape, kind):
    explorer, result = TopExp_Explorer(shape, kind), 0
    while explorer.More():
        result += 1
        explorer.Next()
    return result

for index, source in enumerate(expected):
    shape = load(folder / f'shape-{index}.step')
    assert count(shape, TopAbs_SOLID) == 1, f'{source["name"]}: must be a solid'
    assert count(shape, TopAbs_FACE) == source['faces'], f'{source["name"]}: lost original faces'
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    assert math.isclose(props.Mass(), source['volume'], abs_tol=1e-5), f'{source["name"]}: changed volume {props.Mass()} vs {source["volume"]}'
    points = []
    explorer = TopExp_Explorer(shape, TopAbs_VERTEX)
    while explorer.More():
        point = BRep_Tool.Pnt_s(TopoDS.Vertex_s(explorer.Current()))
        points.append((point.X(), point.Y(), point.Z()))
        explorer.Next()
    for point in source['points']:
        assert any(math.dist(point, actual) < 1e-6 for actual in points), f'{source["name"]}: lost transformed vertex or mm units'
    if index == 1:
        assert BRepClass3d_SolidClassifier(shape, gp_Pnt(-20, 5, 3), 1e-7).State() == TopAbs_OUT, 'Through hole was filled'
        assert BRepClass3d_SolidClassifier(shape, gp_Pnt(-14, 5, 3), 1e-7).State() == TopAbs_IN, 'Through-hole wall lost'
    if index == 2:
        assert BRepClass3d_SolidClassifier(shape, gp_Pnt(0, 0, 8), 1e-7).State() == TopAbs_OUT, 'Sealed cavity was filled'
        assert BRepClass3d_SolidClassifier(shape, gp_Pnt(6, 0, 8), 1e-7).State() == TopAbs_IN, 'Cavity wall lost'
    print(f'CAD round-trip passed: {source["name"]} | {source["faces"]} faces | {props.Mass():.6f} mm^3')
assembly = load(folder / 'assembly.step')
assert count(assembly, TopAbs_SOLID) == len(expected), 'Separate objects were lost'
print(f'CAD assembly round-trip passed: {len(expected)} separate solids')

# Independent product-name decoding, including apostrophes and Unicode escape runs.
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.TDF import TDF_LabelSequence
from OCP.TDataStd import TDataStd_Name
reader = STEPCAFControl_Reader()
reader.SetNameMode(True)
document = TDocStd_Document(TCollection_ExtendedString('XCAF'))
assert reader.ReadFile(str(folder / 'assembly.step')) == IFSelect_RetDone
assert reader.Transfer(document)
shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
labels, names = TDF_LabelSequence(), []
shape_tool.GetFreeShapes(labels)
for index in range(1, labels.Length() + 1):
    attribute = TDataStd_Name()
    assert labels.Value(index).FindAttribute(TDataStd_Name.GetID_s(), attribute)
    names.append(attribute.Get().ToExtString())
assert sorted(names) == sorted(source['name'] for source in expected), 'CAD import lost Unicode product names'
print('CAD product-name round-trip passed, including Unicode')
