import { describe, expect, it } from "vitest";
import * as THREE from "three";
import cubeGeo from "../fixtures/cube.geo.json";
import type { BedrockGeometryFile } from "./types";
import {
  BOX_FACE_ORDER,
  bedrockEuler,
  bedrockPosition,
  boxUvRects,
  buildModel,
  isSideSheet,
  perFaceUvRects,
} from "./geometry";

const file = cubeGeo as unknown as BedrockGeometryFile;
const DEG = Math.PI / 180;

function faceUv(mesh: THREE.Mesh, face: (typeof BOX_FACE_ORDER)[number]) {
  const uv = mesh.geometry.getAttribute("uv");
  const i = BOX_FACE_ORDER.indexOf(face) * 4;
  return {
    topLeft: [uv.getX(i), uv.getY(i)],
    bottomRight: [uv.getX(i + 3), uv.getY(i + 3)],
  };
}

function build() {
  return buildModel(file, new THREE.MeshBasicMaterial());
}

describe("bedrock geometry convention", () => {
  it("mirrors X on positions and keeps Y and Z", () => {
    expect(bedrockPosition([1, 2, 3]).toArray()).toEqual([-1, 2, 3]);
  });

  it("negates X and Y rotation, keeps Z, in ZYX order and radians", () => {
    const e = bedrockEuler([10, 20, 30]);
    expect(e.order).toBe("ZYX");
    expect(e.x).toBeCloseTo(-10 * DEG);
    expect(e.y).toBeCloseTo(-20 * DEG);
    expect(e.z).toBeCloseTo(30 * DEG);
  });

  it("pitches the front of a bone down for a positive X rotation, like the game", () => {
    const g = new THREE.Group();
    g.rotation.copy(bedrockEuler([90, 0, 0]));
    const front = new THREE.Vector3(0, 0, -1).applyEuler(g.rotation);
    expect(front.x).toBeCloseTo(0);
    expect(front.y).toBeCloseTo(-1);
    expect(front.z).toBeCloseTo(0);
  });
});

describe("buildModel on the synthetic cube", () => {
  it("scales the root so 16 units are one block", () => {
    const model = build();
    expect(model.root.scale.x).toBeCloseTo(1 / 16);
    expect(model.textureWidth).toBe(64);
    expect(model.textureHeight).toBe(32);
  });

  it("places root bones at their pivot and children relative to the parent pivot", () => {
    const model = build();
    expect(model.bones.size).toBe(6);
    const body = model.bones.get("body")!;
    const head = model.bones.get("head")!;
    expect(body.parent).toBe(model.root);
    expect(head.parent).toBe(body);
    expect(body.position.toArray()).toEqual([-1, 3, 0]);
    // head pivot (0,8,-4) -> (0,8,-4); minus body pivot (-1,3,0)
    expect(head.position.toArray()).toEqual([1, 5, -4]);
  });

  it("applies the bone rotation with the convention", () => {
    const model = build();
    const head = model.bones.get("head")!;
    expect(head.rotation.order).toBe("ZYX");
    expect(head.rotation.x).toBeCloseTo(-10 * DEG);
    expect(head.rotation.y).toBeCloseTo(-20 * DEG);
    expect(head.rotation.z).toBeCloseTo(30 * DEG);
    expect(model.restPose.get("head")!.rotation.z).toBeCloseTo(30 * DEG);
  });

  it("offsets each cube from its bone pivot by the mirrored cube centre", () => {
    const model = build();
    const body = model.bones.get("body")!;
    const mesh = body.children[0] as THREE.Mesh;
    // origin (-3,3,-4) size (6,5,8) -> centre (0,5.5,0) -> mirrored (0,5.5,0); minus pivot (-1,3,0)
    expect(mesh.position.toArray()).toEqual([1, 2.5, 0]);
    const box = mesh.geometry as THREE.BoxGeometry;
    expect(box.parameters.width).toBe(6);
    expect(box.parameters.height).toBe(5);
    expect(box.parameters.depth).toBe(8);
  });

  it("grows an inflated cube on every side without moving its centre", () => {
    const model = build();
    const head = model.bones.get("head")!;
    const mesh = head.children[0] as THREE.Mesh;
    const box = mesh.geometry as THREE.BoxGeometry;
    expect(box.parameters.width).toBeCloseTo(6.5);
    expect(box.parameters.height).toBeCloseTo(6.5);
    expect(box.parameters.depth).toBeCloseTo(5.5);
    // origin (-3,7,-9) size (6,6,5) -> centre (0,10,-6.5); minus head pivot (0,8,-4)
    expect(mesh.position.toArray()).toEqual([0, 2, -2.5]);
  });

  it("lays box UV out as the Minecraft net", () => {
    const rects = boxUvRects(0, 0, 6, 5, 8, false);
    expect(rects.east).toEqual({ u0: 0, v0: 8, u1: 8, v1: 13 });
    expect(rects.north).toEqual({ u0: 8, v0: 8, u1: 14, v1: 13 });
    expect(rects.west).toEqual({ u0: 14, v0: 8, u1: 22, v1: 13 });
    expect(rects.south).toEqual({ u0: 22, v0: 8, u1: 28, v1: 13 });
    expect(rects.up).toEqual({ u0: 14, v0: 8, u1: 8, v1: 0 });
    expect(rects.down).toEqual({ u0: 20, v0: 0, u1: 14, v1: 8 });
  });

  it("writes box UV into the mesh with V measured from the top of the texture", () => {
    const model = build();
    const mesh = model.bones.get("body")!.children[0] as THREE.Mesh;
    const north = faceUv(mesh, "north");
    expect(north.topLeft[0]).toBeCloseTo(8 / 64);
    expect(north.topLeft[1]).toBeCloseTo(1 - 8 / 32);
    expect(north.bottomRight[0]).toBeCloseTo(14 / 64);
    expect(north.bottomRight[1]).toBeCloseTo(1 - 13 / 32);
    const east = faceUv(mesh, "east");
    expect(east.topLeft[0]).toBeCloseTo(0);
    expect(east.bottomRight[0]).toBeCloseTo(8 / 64);
    const up = faceUv(mesh, "up");
    expect(up.topLeft[0]).toBeCloseTo(14 / 64);
    expect(up.topLeft[1]).toBeCloseTo(1 - 8 / 32);
    expect(up.bottomRight[0]).toBeCloseTo(8 / 64);
    expect(up.bottomRight[1]).toBeCloseTo(1);
  });

  it("mirrors by swapping east and west and flipping U on every face", () => {
    const plain = boxUvRects(0, 13, 4, 3, 3, false);
    const mirrored = boxUvRects(0, 13, 4, 3, 3, true);
    expect(mirrored.east).toEqual({ u0: plain.west.u1, v0: plain.west.v0, u1: plain.west.u0, v1: plain.west.v1 });
    expect(mirrored.west).toEqual({ u0: plain.east.u1, v0: plain.east.v0, u1: plain.east.u0, v1: plain.east.v1 });
    expect(mirrored.north).toEqual({ u0: plain.north.u1, v0: plain.north.v0, u1: plain.north.u0, v1: plain.north.v1 });
    expect(mirrored.up).toEqual({ u0: plain.up.u1, v0: plain.up.v0, u1: plain.up.u0, v1: plain.up.v1 });

    const model = build();
    const tail = model.bones.get("body")!.children[1] as THREE.Mesh;
    const east = faceUv(tail, "east");
    expect(east.topLeft[0]).toBeCloseTo(mirrored.east.u0 / 64);
    expect(east.bottomRight[0]).toBeCloseTo(mirrored.east.u1 / 64);
  });

  it("uses per-face UV as given, flipping only the bottom face in V", () => {
    const rects = perFaceUvRects({
      north: { uv: [32, 16], uv_size: [6, 6] },
      down: { uv: [38, 22], uv_size: [6, 5] },
    });
    expect(rects.north).toEqual({ u0: 32, v0: 16, u1: 38, v1: 22 });
    expect(rects.down).toEqual({ u0: 38, v0: 27, u1: 44, v1: 22 });
    expect(rects.east).toBeUndefined();

    const model = build();
    const mesh = model.bones.get("head")!.children[0] as THREE.Mesh;
    const north = faceUv(mesh, "north");
    expect(north.topLeft[0]).toBeCloseTo(32 / 64);
    expect(north.topLeft[1]).toBeCloseTo(1 - 16 / 32);
    expect(north.bottomRight[0]).toBeCloseTo(38 / 64);
    expect(north.bottomRight[1]).toBeCloseTo(1 - 22 / 32);
  });

  it("adds locators as named empties", () => {
    const model = build();
    const head = model.bones.get("head")!;
    const loc = head.getObjectByName("locator:emote")!;
    expect(loc).toBeDefined();
    // (0,13.5,-6.5) -> mirrored same; minus head pivot (0,8,-4)
    expect(loc.position.toArray()).toEqual([0, 5.5, -2.5]);
  });

  it("reports bounds in blocks", () => {
    const model = build();
    expect(model.bounds.min.y).toBeCloseTo(0, 1);
    expect(model.bounds.max.y).toBeLessThan(1.2);
    expect(model.bounds.max.y).toBeGreaterThan(0.6);
  });
});

describe("side sheets", () => {
  function sheetModel(size: [number, number, number]) {
    const geo = {
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: { identifier: "geometry.sheet", texture_width: 64, texture_height: 64 },
          bones: [{ name: "tail", pivot: [0, 0, 0], cubes: [{ origin: [0, 3, 5], size, uv: [0, 0] }] }],
        },
      ],
    } as unknown as BedrockGeometryFile;
    const model = buildModel(geo, new THREE.MeshBasicMaterial());
    const mesh = model.bones.get("tail")!.children[0] as THREE.Mesh;
    return mesh.geometry.getAttribute("normal");
  }

  it("recognises a cube with no thickness along X", () => {
    expect(isSideSheet([0, 5, 6])).toBe(true);
    expect(isSideSheet([4, 5, 0])).toBe(false);
    expect(isSideSheet([3, 0, 6])).toBe(false);
    expect(isSideSheet([0, 0, 0])).toBe(false);
  });

  it("lights a side sheet from the front on both of its faces", () => {
    const normal = sheetModel([0, 5, 6]);
    for (let i = 0; i < normal.count; i++) {
      expect(normal.getX(i)).toBe(0);
      expect(normal.getY(i)).toBe(0);
      expect(normal.getZ(i)).toBe(-1);
    }
  });

  it("leaves a box's east and west normals alone", () => {
    const normal = sheetModel([2, 5, 6]);
    const east = BOX_FACE_ORDER.indexOf("east") * 4;
    const west = BOX_FACE_ORDER.indexOf("west") * 4;
    expect(normal.getX(east)).toBe(1);
    expect(normal.getX(west)).toBe(-1);
  });
});
