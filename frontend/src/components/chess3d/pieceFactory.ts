import * as THREE from 'three';

export type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
export type PieceColor = 'w' | 'b';

export interface PieceMaterials {
  whitePrimary: THREE.MeshPhysicalMaterial;
  whiteAccent: THREE.MeshStandardMaterial;
  blackPrimary: THREE.MeshPhysicalMaterial;
  blackAccent: THREE.MeshStandardMaterial;
  feltBase: THREE.MeshStandardMaterial;
}

export function createPieceMaterials(): PieceMaterials {
  return {
    whitePrimary: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#E8D3A2'),
      metalness: 0.48,
      roughness: 0.24,
      clearcoat: 0.72,
      clearcoatRoughness: 0.16,
      envMapIntensity: 1.15,
    }),
    whiteAccent: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#B5893E'),
      metalness: 0.85,
      roughness: 0.28,
      envMapIntensity: 1.1,
    }),
    blackPrimary: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#272E3B'),
      metalness: 0.34,
      roughness: 0.34,
      clearcoat: 0.65,
      clearcoatRoughness: 0.22,
      envMapIntensity: 1.15,
    }),
    blackAccent: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#64748B'),
      metalness: 0.82,
      roughness: 0.22,
      envMapIntensity: 1.1,
    }),
    feltBase: new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1A2E22'),
      metalness: 0.0,
      roughness: 0.92,
    }),
  };
}

function makeLathe(points: Array<[number, number]>, segments = 24): THREE.LatheGeometry {
  const vecs = points.map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(vecs, segments);
  geo.computeVertexNormals();
  return geo;
}

export interface SharedPieceGeometries {
  feltPad: THREE.CylinderGeometry;
  pawnBody: THREE.LatheGeometry;
  pawnHead: THREE.SphereGeometry;
  rookBody: THREE.LatheGeometry;
  rookBattlement: THREE.BoxGeometry;
  rookRing: THREE.TorusGeometry;
  knightBody: THREE.LatheGeometry;
  knightHead: THREE.ExtrudeGeometry;
  knightEar: THREE.ConeGeometry;
  bishopBody: THREE.LatheGeometry;
  bishopMiter: THREE.LatheGeometry;
  bishopFinial: THREE.SphereGeometry;
  bishopCollar: THREE.TorusGeometry;
  queenBody: THREE.LatheGeometry;
  queenCoronet: THREE.CylinderGeometry;
  queenPoint: THREE.ConeGeometry;
  queenOrb: THREE.SphereGeometry;
  kingBody: THREE.LatheGeometry;
  kingCrown: THREE.CylinderGeometry;
  kingCrossVert: THREE.BoxGeometry;
  kingCrossHoriz: THREE.BoxGeometry;
}

export function createSharedPieceGeometries(): SharedPieceGeometries {
  // Knight silhouette profile extruded with smooth bevels
  const knightShape = new THREE.Shape();
  knightShape.moveTo(-0.14, 0.0);
  knightShape.lineTo(0.15, 0.0);
  knightShape.quadraticCurveTo(0.18, 0.18, 0.11, 0.34);
  knightShape.quadraticCurveTo(0.22, 0.42, 0.24, 0.49);
  knightShape.quadraticCurveTo(0.21, 0.56, 0.1, 0.57);
  knightShape.lineTo(0.03, 0.67);
  knightShape.quadraticCurveTo(-0.04, 0.65, -0.07, 0.57);
  knightShape.quadraticCurveTo(-0.2, 0.44, -0.18, 0.2);
  knightShape.quadraticCurveTo(-0.17, 0.08, -0.14, 0.0);

  const knightHead = new THREE.ExtrudeGeometry(knightShape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.02,
    bevelSegments: 3,
    curveSegments: 10,
  });
  knightHead.translate(0, 0, -0.06);
  knightHead.computeVertexNormals();

  return {
    feltPad: new THREE.CylinderGeometry(0.32, 0.33, 0.02, 24),
    pawnBody: makeLathe([
      [0.0, 0.02],
      [0.31, 0.02],
      [0.31, 0.09],
      [0.24, 0.13],
      [0.26, 0.17],
      [0.18, 0.21],
      [0.12, 0.42],
      [0.09, 0.52],
      [0.16, 0.56],
      [0.08, 0.6],
      [0.0, 0.6],
    ]),
    pawnHead: new THREE.SphereGeometry(0.145, 22, 18),

    rookBody: makeLathe([
      [0.0, 0.02],
      [0.34, 0.02],
      [0.34, 0.1],
      [0.27, 0.15],
      [0.22, 0.22],
      [0.18, 0.62],
      [0.25, 0.7],
      [0.26, 0.84],
      [0.16, 0.84],
      [0.16, 0.77],
      [0.0, 0.77],
    ]),
    rookBattlement: new THREE.BoxGeometry(0.11, 0.12, 0.09),
    rookRing: new THREE.TorusGeometry(0.22, 0.022, 10, 24),

    knightBody: makeLathe([
      [0.0, 0.02],
      [0.34, 0.02],
      [0.34, 0.1],
      [0.27, 0.16],
      [0.28, 0.21],
      [0.21, 0.27],
      [0.0, 0.27],
    ]),
    knightHead,
    knightEar: new THREE.ConeGeometry(0.035, 0.11, 8),

    bishopBody: makeLathe([
      [0.0, 0.02],
      [0.33, 0.02],
      [0.33, 0.1],
      [0.26, 0.15],
      [0.27, 0.19],
      [0.17, 0.25],
      [0.12, 0.54],
      [0.18, 0.6],
      [0.11, 0.65],
      [0.0, 0.65],
    ]),
    bishopMiter: makeLathe([
      [0.0, 0.65],
      [0.12, 0.66],
      [0.17, 0.78],
      [0.13, 0.92],
      [0.05, 1.01],
      [0.0, 1.03],
    ]),
    bishopFinial: new THREE.SphereGeometry(0.055, 16, 14),
    bishopCollar: new THREE.TorusGeometry(0.155, 0.02, 10, 24),

    queenBody: makeLathe([
      [0.0, 0.02],
      [0.36, 0.02],
      [0.36, 0.11],
      [0.28, 0.17],
      [0.3, 0.22],
      [0.19, 0.29],
      [0.13, 0.68],
      [0.19, 0.78],
      [0.14, 0.85],
      [0.0, 0.85],
    ]),
    queenCoronet: new THREE.CylinderGeometry(0.22, 0.14, 0.16, 20),
    queenPoint: new THREE.ConeGeometry(0.038, 0.12, 8),
    queenOrb: new THREE.SphereGeometry(0.065, 16, 14),

    kingBody: makeLathe([
      [0.0, 0.02],
      [0.37, 0.02],
      [0.37, 0.12],
      [0.29, 0.18],
      [0.31, 0.24],
      [0.2, 0.31],
      [0.14, 0.76],
      [0.21, 0.86],
      [0.16, 0.93],
      [0.0, 0.93],
    ]),
    kingCrown: new THREE.CylinderGeometry(0.22, 0.16, 0.18, 22),
    kingCrossVert: new THREE.BoxGeometry(0.06, 0.22, 0.06),
    kingCrossHoriz: new THREE.BoxGeometry(0.17, 0.06, 0.06),
  };
}

export function disposeSharedPieceGeometries(geos: SharedPieceGeometries) {
  Object.values(geos).forEach((g) => g.dispose());
}

export function disposePieceMaterials(mats: PieceMaterials) {
  Object.values(mats).forEach((m) => m.dispose());
}

export function buildChessPieceGroup(
  type: PieceType,
  color: PieceColor,
  geos: SharedPieceGeometries,
  mats: PieceMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const primaryMat = color === 'w' ? mats.whitePrimary : mats.blackPrimary;
  const accentMat = color === 'w' ? mats.whiteAccent : mats.blackAccent;

  // Grounded felt pad at y = 0.01 (sits flush at y = 0)
  const felt = new THREE.Mesh(geos.feltPad, mats.feltBase);
  felt.position.y = 0.01;
  felt.receiveShadow = true;
  group.add(felt);

  const addMesh = (geo: THREE.BufferGeometry, mat: THREE.Material, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  if (type === 'p') {
    addMesh(geos.pawnBody, primaryMat);
    addMesh(geos.pawnHead, primaryMat, 0.71);
    const collar = addMesh(geos.bishopCollar, accentMat, 0.56);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(0.85);
  } else if (type === 'r') {
    addMesh(geos.rookBody, primaryMat);
    const ring = addMesh(geos.rookRing, accentMat, 0.65);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const merlon = new THREE.Mesh(geos.rookBattlement, primaryMat);
      merlon.position.set(Math.cos(angle) * 0.2, 0.89, Math.sin(angle) * 0.2);
      merlon.rotation.y = -angle;
      merlon.castShadow = true;
      merlon.receiveShadow = true;
      group.add(merlon);
    }
  } else if (type === 'n') {
    addMesh(geos.knightBody, primaryMat);
    const collar = addMesh(geos.rookRing, accentMat, 0.27);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(0.95);

    const head = new THREE.Mesh(geos.knightHead, primaryMat);
    head.position.y = 0.25;
    // Rotate knight to face opponent side
    head.rotation.y = color === 'w' ? -Math.PI / 2 : Math.PI / 2;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    for (const side of [-0.045, 0.045]) {
      const ear = new THREE.Mesh(geos.knightEar, accentMat);
      ear.position.set(side, 0.93, color === 'w' ? -0.02 : 0.02);
      ear.castShadow = true;
      group.add(ear);
    }
  } else if (type === 'b') {
    addMesh(geos.bishopBody, primaryMat);
    addMesh(geos.bishopMiter, primaryMat);
    const collar = addMesh(geos.bishopCollar, accentMat, 0.6);
    collar.rotation.x = Math.PI / 2;
    addMesh(geos.bishopFinial, accentMat, 1.07);
  } else if (type === 'q') {
    addMesh(geos.queenBody, primaryMat);
    addMesh(geos.queenCoronet, primaryMat, 0.93);
    const collar = addMesh(geos.rookRing, accentMat, 0.84);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(0.82);

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const point = new THREE.Mesh(geos.queenPoint, accentMat);
      point.position.set(Math.cos(angle) * 0.18, 1.04, Math.sin(angle) * 0.18);
      point.castShadow = true;
      group.add(point);
    }
    addMesh(geos.queenOrb, accentMat, 1.08);
  } else if (type === 'k') {
    addMesh(geos.kingBody, primaryMat);
    addMesh(geos.kingCrown, primaryMat, 1.01);
    const collar = addMesh(geos.rookRing, accentMat, 0.92);
    collar.rotation.x = Math.PI / 2;
    collar.scale.setScalar(0.88);
    addMesh(geos.kingCrossVert, accentMat, 1.2);
    addMesh(geos.kingCrossHoriz, accentMat, 1.23);
  }

  group.userData = { pieceType: type, pieceColor: color };
  return group;
}
