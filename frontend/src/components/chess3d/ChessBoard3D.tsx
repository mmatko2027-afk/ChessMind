import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Chess, type Square } from 'chess.js';
import { Eye, EyeOff, RotateCcw, RefreshCw } from 'lucide-react';
import {
  buildChessPieceGroup,
  createPieceMaterials,
  createSharedPieceGeometries,
  disposePieceMaterials,
  disposeSharedPieceGeometries,
  type PieceColor,
  type PieceType,
} from './pieceFactory';

import type { SelectedPieceInfo } from '../../utils/pieceGuides';

type CameraPreset = 'white' | 'black' | 'top' | 'iso';

interface ChessBoard3DProps {
  gameId?: string;
  fen: string;
  currentTurn: 'white' | 'black';
  playerColor: 'white' | 'black';
  opponent: 'stockfish' | 'maia' | 'human';
  starterNote?: string;
  isCheck: boolean;
  lastMove: { from: string; to: string } | null;
  hintMove?: { from: string; to: string } | null;
  disabled?: boolean;
  zenMode: boolean;
  onToggleZenMode: () => void;
  onAttemptMove: (from: string, to: string, promotion?: string) => Promise<void>;
  onSelectPiece?: (info: SelectedPieceInfo | null) => void;
  capturedWhite: string[];
  capturedBlack: string[];
  status: string;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const SQUARE_SIZE = 1.0;

function squareToWorld(square: string): [number, number] {
  const fileIdx = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rankIdx = Number(square[1]) - 1; // 0..7
  const x = (fileIdx - 3.5) * SQUARE_SIZE;
  const z = (3.5 - rankIdx) * SQUARE_SIZE;
  return [x, z];
}

function createWoodSquareTexture(isLight: boolean, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isLight ? '#DEC8A4' : '#583B28';
  ctx.fillRect(0, 0, 256, 256);

  // Procedural subtle wood grain lines
  for (let i = 0; i < 65; i++) {
    const y = (i / 65) * 256;
    ctx.strokeStyle = isLight
      ? `rgba(148, 108, 66, ${0.04 + (i % 5) * 0.015})`
      : `rgba(26, 15, 9, ${0.09 + (i % 4) * 0.025})`;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(85, y + Math.sin(i) * 4, 170, y - Math.cos(i) * 4, 256, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createBoardFrameTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#241812';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle brass inlay border
  ctx.strokeStyle = 'rgba(212, 163, 89, 0.48)';
  ctx.lineWidth = 4;
  ctx.strokeRect(52, 52, 920, 920);

  // Coordinate labels A-H and 1-8 along the wooden border
  ctx.fillStyle = '#D4A359';
  ctx.font = '600 26px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const boardPx = 880;
  const start = (1024 - boardPx) / 2;
  const step = boardPx / 8;

  for (let i = 0; i < 8; i++) {
    const fileChar = FILES[i].toUpperCase();
    const x = start + step * (i + 0.5);
    ctx.fillText(fileChar, x, 992);
    ctx.fillText(fileChar, x, 32);

    const rankChar = String(8 - i);
    const y = start + step * (i + 0.5);
    ctx.fillText(rankChar, 30, y);
    ctx.fillText(rankChar, 994, y);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

const PIECE_UNICODE: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
};

const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3(0, 0, 0);

export function ChessBoard3D({
  gameId,
  fen,
  currentTurn,
  playerColor,
  opponent,
  starterNote,
  isCheck,
  lastMove,
  hintMove = null,
  disabled = false,
  zenMode,
  onToggleZenMode,
  onAttemptMove,
  onSelectPiece,
  capturedWhite,
  capturedBlack,
  status,
}: ChessBoard3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [legalTargets, setLegalTargets] = useState<string[]>([]);
  const [captureTargets, setCaptureTargets] = useState<string[]>([]);
  const [promotionPending, setPromotionPending] = useState<{ from: string; to: string } | null>(null);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('white');
  const [autoFlip, setAutoFlip] = useState<boolean>(false);
  const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Refs to share live React props with Three.js event/render loop without rebuilding scene
  const fenRef = useRef(fen);
  const playerColorRef = useRef(playerColor);
  const opponentRef = useRef(opponent);
  const lastMoveRef = useRef(lastMove);
  const hintMoveRef = useRef(hintMove);
  const selectedRef = useRef<string | null>(null);
  const disabledRef = useRef(disabled);
  const onAttemptMoveRef = useRef(onAttemptMove);
  const onSelectPieceRef = useRef(onSelectPiece);
  const requestRenderRef = useRef<() => void>(() => {});
  const cameraAnimatingRef = useRef(false);
  const presetTargetRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 6.8, 7.6));
  const pieceAnimMapRef = useRef<
    Map<
      string,
      {
        group: THREE.Group;
        targetX: number;
        targetZ: number;
        color: PieceColor;
        type: PieceType;
      }
    >
  >(new Map());
  const syncBoardRef = useRef<() => void>(() => {});
  const updateHighlightsRef = useRef<() => void>(() => {});

  fenRef.current = fen;
  playerColorRef.current = playerColor;
  opponentRef.current = opponent;
  lastMoveRef.current = lastMove;
  hintMoveRef.current = hintMove;
  disabledRef.current = disabled;
  onAttemptMoveRef.current = onAttemptMove;
  onSelectPieceRef.current = onSelectPiece;

  // Orient camera to player's assigned color when a new game starts
  useEffect(() => {
    const nextPreset: CameraPreset = playerColor === 'black' ? 'black' : 'white';
    setCameraPreset(nextPreset);
    presetTargetRef.current.set(0, 6.8, nextPreset === 'white' ? 7.6 : -7.6);
    cameraAnimatingRef.current = true;
    requestRenderRef.current();
  }, [gameId, playerColor]);

  // Auto-flip camera when turn changes if enabled
  useEffect(() => {
    if (!autoFlip) return;
    const nextPreset: CameraPreset = currentTurn === 'white' ? 'white' : 'black';
    setCameraPreset(nextPreset);
    presetTargetRef.current.set(0, 6.8, nextPreset === 'white' ? 7.6 : -7.6);
    cameraAnimatingRef.current = true;
    requestRenderRef.current();
  }, [currentTurn, autoFlip]);

  // Keyboard shortcut 'H' for Zen mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        onToggleZenMode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggleZenMode]);

  // Clear selection when FEN changes
  useEffect(() => {
    selectedRef.current = null;
    setSelectedSquare(null);
    setLegalTargets([]);
    setCaptureTargets([]);
    onSelectPieceRef.current?.(null);
    syncBoardRef.current();
    updateHighlightsRef.current();
    requestRenderRef.current();
  }, [fen, lastMove, isCheck]);

  // Update highlights whenever selectedSquare or hintMove changes
  useEffect(() => {
    selectedRef.current = selectedSquare;
    updateHighlightsRef.current();
    requestRenderRef.current();
  }, [selectedSquare, legalTargets, captureTargets, hintMove]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Software WebGL guard (SwiftShader/llvmpipe/WARP)
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL недоступний у поточному браузері.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0B0E14');
    scene.fog = new THREE.FogExp2('#0B0E14', 0.022);

    const camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      100,
    );
    camera.position.copy(presetTargetRef.current);

    // Procedural Studio Environment Map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    // 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e1b18, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.2);
    keyLight.position.set(6, 11, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 28;
    keyLight.shadow.camera.left = -6.5;
    keyLight.shadow.camera.right = 6.5;
    keyLight.shadow.camera.top = 6.5;
    keyLight.shadow.camera.bottom = -6.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.9);
    rimLight.position.set(-7, 6, -7);
    scene.add(rimLight);

    // Subtle tabletop / studio ground plane with soft contact grounding
    const studioGroundGeo = new THREE.PlaneGeometry(60, 60);
    const studioGroundMat = new THREE.MeshStandardMaterial({
      color: '#0D1119',
      roughness: 0.92,
      metalness: 0.05,
    });
    const studioGround = new THREE.Mesh(studioGroundGeo, studioGroundMat);
    studioGround.rotation.x = -Math.PI / 2;
    studioGround.position.y = -0.34;
    studioGround.receiveShadow = true;
    scene.add(studioGround);

    // Board base frame + coordinate texture
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const frameTex = createBoardFrameTexture(maxAniso);
    const lightSqTex = createWoodSquareTexture(true, maxAniso);
    const darkSqTex = createWoodSquareTexture(false, maxAniso);

    const frameGeo = new THREE.BoxGeometry(9.2, 0.3, 9.2);
    const frameMat = new THREE.MeshStandardMaterial({
      map: frameTex,
      roughness: 0.42,
      metalness: 0.12,
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.y = -0.17;
    frameMesh.receiveShadow = true;
    frameMesh.castShadow = true;
    scene.add(frameMesh);

    // Interactive Squares + Highlight overlays
    const squareHitMeshes: THREE.Mesh[] = [];
    const squareGeo = new THREE.BoxGeometry(SQUARE_SIZE, 0.04, SQUARE_SIZE);
    const lightMat = new THREE.MeshStandardMaterial({
      map: lightSqTex,
      roughness: 0.36,
      metalness: 0.04,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      map: darkSqTex,
      roughness: 0.44,
      metalness: 0.04,
    });

    const overlayPlaneGeo = new THREE.PlaneGeometry(0.92, 0.92);
    const dotGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.025, 24);
    const ringGeo = new THREE.RingGeometry(0.32, 0.43, 32);

    const selectedOverlayMat = new THREE.MeshBasicMaterial({
      color: '#D4A359',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const lastMoveOverlayMat = new THREE.MeshBasicMaterial({
      color: '#D4A359',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const checkOverlayMat = new THREE.MeshBasicMaterial({
      color: '#EF4444',
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const hintOverlayMat = new THREE.MeshBasicMaterial({
      color: '#38BDF8',
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    const legalDotMat = new THREE.MeshBasicMaterial({
      color: '#10B981',
      transparent: true,
      opacity: 0.78,
    });
    const captureRingMat = new THREE.MeshBasicMaterial({
      color: '#EF4444',
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });

    const overlayMeshes = new Map<
      string,
      {
        plane: THREE.Mesh;
        dot: THREE.Mesh;
        ring: THREE.Mesh;
      }
    >();

    for (let rank = 1; rank <= 8; rank++) {
      for (let f = 0; f < 8; f++) {
        const sqName = `${FILES[f]}${rank}`;
        const isLight = (f + rank) % 2 === 1;
        const [wx, wz] = squareToWorld(sqName);

        const sqMesh = new THREE.Mesh(squareGeo, isLight ? lightMat : darkMat);
        sqMesh.position.set(wx, -0.02, wz);
        sqMesh.receiveShadow = true;
        sqMesh.userData = { square: sqName };
        sqMesh.layers.enable(1);
        scene.add(sqMesh);
        squareHitMeshes.push(sqMesh);

        const plane = new THREE.Mesh(overlayPlaneGeo, selectedOverlayMat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(wx, 0.005, wz);
        plane.visible = false;
        scene.add(plane);

        const dot = new THREE.Mesh(dotGeo, legalDotMat);
        dot.position.set(wx, 0.015, wz);
        dot.visible = false;
        scene.add(dot);

        const ring = new THREE.Mesh(ringGeo, captureRingMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(wx, 0.012, wz);
        ring.visible = false;
        scene.add(ring);

        overlayMeshes.set(sqName, { plane, dot, ring });
      }
    }

    // Pieces Group & Shared Geometries/Materials
    const piecesRoot = new THREE.Group();
    scene.add(piecesRoot);
    const sharedGeos = createSharedPieceGeometries();
    const pieceMats = createPieceMaterials();

    // Sync 3D piece meshes to current FEN
    const syncBoardToFen = () => {
      const chess = new Chess(fenRef.current);
      const board = chess.board();
      const desiredSquares = new Map<string, { type: PieceType; color: PieceColor }>();

      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = board[r][c];
          if (cell) {
            const sq = `${FILES[c]}${8 - r}`;
            desiredSquares.set(sq, { type: cell.type, color: cell.color });
          }
        }
      }

      // Clear and rebuild pieces cleanly when board changes, keeping smooth hop-in for moved piece
      const existingByKey = new Map<string, typeof pieceAnimMapRef.current extends Map<string, infer V> ? V[] : never>();
      for (const entry of pieceAnimMapRef.current.values()) {
        const key = `${entry.color}_${entry.type}`;
        const list = existingByKey.get(key) ?? [];
        list.push(entry);
        existingByKey.set(key, list);
      }

      const nextMap = new Map<
        string,
        {
          group: THREE.Group;
          targetX: number;
          targetZ: number;
          color: PieceColor;
          type: PieceType;
        }
      >();

      // First pass: keep pieces still on the same square
      for (const [sq, info] of desiredSquares.entries()) {
        const existing = pieceAnimMapRef.current.get(sq);
        if (existing && existing.color === info.color && existing.type === info.type) {
          const [tx, tz] = squareToWorld(sq);
          existing.targetX = tx;
          existing.targetZ = tz;
          nextMap.set(sq, existing);
          // Remove from pool
          const key = `${info.color}_${info.type}`;
          const pool = existingByKey.get(key);
          if (pool) {
            const idx = pool.indexOf(existing);
            if (idx >= 0) pool.splice(idx, 1);
          }
        }
      }

      // Second pass: reuse moved pieces of same color+type or instantiate new ones
      for (const [sq, info] of desiredSquares.entries()) {
        if (nextMap.has(sq)) continue;
        const [tx, tz] = squareToWorld(sq);
        const key = `${info.color}_${info.type}`;
        const pool = existingByKey.get(key);
        const reused = pool?.shift();

        if (reused) {
          reused.targetX = tx;
          reused.targetZ = tz;
          reused.group.userData.square = sq;
          nextMap.set(sq, reused);
        } else {
          const group = buildChessPieceGroup(info.type, info.color, sharedGeos, pieceMats);
          group.position.set(tx, 0, tz);
          group.userData.square = sq;
          piecesRoot.add(group);
          nextMap.set(sq, {
            group,
            targetX: tx,
            targetZ: tz,
            color: info.color,
            type: info.type,
          });
        }
      }

      // Remove captured/unused pieces from scene
      for (const pool of existingByKey.values()) {
        for (const leftover of pool) {
          piecesRoot.remove(leftover.group);
        }
      }

      pieceAnimMapRef.current = nextMap;
    };

    syncBoardRef.current = syncBoardToFen;
    syncBoardToFen();

    const updateHighlights = () => {
      const chess = new Chess(fenRef.current);
      const sel = selectedRef.current;

      let legalSet = new Set<string>();
      let captureSet = new Set<string>();
      if (sel) {
        const moves = chess.moves({ square: sel as Square, verbose: true });
        for (const m of moves) {
          if (m.captured) captureSet.add(m.to);
          else legalSet.add(m.to);
        }
      }

      // Find checked king square
      let checkKingSq: string | null = null;
      if (chess.isCheck()) {
        const board = chess.board();
        const turnColor = chess.turn();
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const cell = board[r][c];
            if (cell && cell.type === 'k' && cell.color === turnColor) {
              checkKingSq = `${FILES[c]}${8 - r}`;
            }
          }
        }
      }

      const curLastMove = lastMoveRef.current;
      const curHintMove = hintMoveRef.current;

      for (const [sq, nodes] of overlayMeshes.entries()) {
        nodes.dot.visible = legalSet.has(sq);
        nodes.ring.visible = captureSet.has(sq);

        if (checkKingSq === sq) {
          nodes.plane.material = checkOverlayMat;
          nodes.plane.visible = true;
        } else if (sel === sq) {
          nodes.plane.material = selectedOverlayMat;
          nodes.plane.visible = true;
        } else if (curHintMove && (curHintMove.from === sq || curHintMove.to === sq)) {
          nodes.plane.material = hintOverlayMat;
          nodes.plane.visible = true;
        } else if (curLastMove && (curLastMove.from === sq || curLastMove.to === sq)) {
          nodes.plane.material = lastMoveOverlayMat;
          nodes.plane.visible = true;
        } else {
          nodes.plane.visible = false;
        }
      }
    };

    updateHighlightsRef.current = updateHighlights;
    updateHighlights();

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 5.5;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.target.set(0, 0, 0);

    controls.addEventListener('start', () => {
      cameraAnimatingRef.current = false;
    });
    controls.addEventListener('change', () => {
      requestRenderRef.current();
    });

    // Raycasting for clicking squares & pieces
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (disabledRef.current) return;
      // Ignore drags (OrbitControls rotation)
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(squareHitMeshes, false);
      if (hits.length === 0) return;

      const clickedSquare = hits[0].object.userData.square as string;
      const chess = new Chess(fenRef.current);
      const currentSel = selectedRef.current;

      if (currentSel) {
        if (currentSel === clickedSquare) {
          setSelectedSquare(null);
          setLegalTargets([]);
          setCaptureTargets([]);
          onSelectPieceRef.current?.(null);
          return;
        }

        const legalMoves = chess.moves({ square: currentSel as Square, verbose: true });
        const matched = legalMoves.filter((m) => m.to === clickedSquare);
        if (matched.length > 0) {
          const needsPromo = matched.some((m) => Boolean(m.promotion));
          if (needsPromo) {
            setPromotionPending({ from: currentSel, to: clickedSquare });
          } else {
            onAttemptMoveRef.current(currentSel, clickedSquare);
          }
          setSelectedSquare(null);
          setLegalTargets([]);
          setCaptureTargets([]);
          onSelectPieceRef.current?.(null);
          return;
        }
      }

      // Otherwise check if user clicked one of the active side's pieces
      const piece = chess.get(clickedSquare as Square);
      const allowedColor =
        opponentRef.current === 'human'
          ? chess.turn()
          : playerColorRef.current === 'white'
            ? 'w'
            : 'b';
      if (piece && piece.color === chess.turn() && piece.color === allowedColor) {
        const moves = chess.moves({ square: clickedSquare as Square, verbose: true });
        const quiet = moves.filter((m) => !m.captured).map((m) => m.to);
        const caps = moves.filter((m) => Boolean(m.captured)).map((m) => m.to);
        setSelectedSquare(clickedSquare);
        setLegalTargets(quiet);
        setCaptureTargets(caps);
        onSelectPieceRef.current?.({
          square: clickedSquare,
          type: piece.type,
          color: piece.color,
          legalCount: quiet.length,
          captureCount: caps.length,
        });
      } else {
        setSelectedSquare(null);
        setLegalTargets([]);
        setCaptureTargets([]);
        onSelectPieceRef.current?.(null);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // Context Loss Handling
    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('Втрачено контекст WebGL. Відновлення...');
    };
    const onContextRestored = () => {
      setWebglError(null);
      requestRenderRef.current();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // On-demand render & smooth damping loop
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame((now) => {
        renderDirty = false;
        const delta = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        let needsMoreFrames = false;

        // Smooth piece movement damping
        for (const entry of pieceAnimMapRef.current.values()) {
          const dx = entry.targetX - entry.group.position.x;
          const dz = entry.targetZ - entry.group.position.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.004) {
            entry.group.position.x = THREE.MathUtils.damp(
              entry.group.position.x,
              entry.targetX,
              11,
              delta,
            );
            entry.group.position.z = THREE.MathUtils.damp(
              entry.group.position.z,
              entry.targetZ,
              11,
              delta,
            );
            // Graceful subtle hop while gliding
            entry.group.position.y = Math.min(dist * 0.25, 0.42);
            needsMoreFrames = true;
          } else {
            entry.group.position.x = entry.targetX;
            entry.group.position.z = entry.targetZ;
            entry.group.position.y = 0;
          }
        }

        // Smooth camera preset damping
        if (cameraAnimatingRef.current) {
          _targetCamPos.copy(presetTargetRef.current);
          camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 7, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 7, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 7, delta);
          controls.target.lerp(_targetLookAt, 1 - Math.exp(-7 * delta));
          if (camera.position.distanceTo(_targetCamPos) < 0.04) {
            camera.position.copy(_targetCamPos);
            cameraAnimatingRef.current = false;
          } else {
            needsMoreFrames = true;
          }
        }

        const didControlsMove = controls.update();
        if (didControlsMove && !isSoftwareGl) {
          needsMoreFrames = true;
        }

        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || needsMoreFrames) {
            requestRender();
          }
        };

        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRenderRef.current = requestRender;
    requestRender();

    const onResize = () => {
      if (!container) return;
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      requestRender();
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      controls.dispose();

      disposeSharedPieceGeometries(sharedGeos);
      disposePieceMaterials(pieceMats);
      studioGroundGeo.dispose();
      studioGroundMat.dispose();
      frameGeo.dispose();
      frameMat.dispose();
      frameTex.dispose();
      lightSqTex.dispose();
      darkSqTex.dispose();
      squareGeo.dispose();
      lightMat.dispose();
      darkMat.dispose();
      overlayPlaneGeo.dispose();
      dotGeo.dispose();
      ringGeo.dispose();
      selectedOverlayMat.dispose();
      lastMoveOverlayMat.dispose();
      checkOverlayMat.dispose();
      hintOverlayMat.dispose();
      legalDotMat.dispose();
      captureRingMat.dispose();
      envTexture.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    if (preset === 'white') presetTargetRef.current.set(0, 6.8, 7.6);
    else if (preset === 'black') presetTargetRef.current.set(0, 6.8, -7.6);
    else if (preset === 'top') presetTargetRef.current.set(0, 11.2, 0.35);
    else presetTargetRef.current.set(6.2, 6.4, 6.4);
    cameraAnimatingRef.current = true;
    requestRenderRef.current();
  };

  return (
    <div className="relative w-full h-full min-h-0 bg-[#0B0E14] overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full overflow-hidden cursor-grab active:cursor-grabbing" />

      {/* Minimal Top-Left Unboxed Turn & Starter Readout */}
      <div className="pointer-events-none absolute top-4 left-4 right-4 flex items-start justify-between gap-4">
        <div className="bg-[#121722]/85 border border-white/10 rounded-lg px-3.5 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs max-w-[75%]">
          <span className="font-medium text-white whitespace-nowrap">
            {status === 'active'
              ? currentTurn === 'white'
                ? 'Хід білих'
                : 'Хід чорних'
              : status === 'checkmate'
                ? 'Мат'
                : 'Нічия'}
          </span>
          {starterNote && (
            <>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="text-slate-300">{starterNote}</span>
            </>
          )}
          {isCheck && status === 'active' && (
            <>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-semibold text-red-400 whitespace-nowrap">Шах королю</span>
            </>
          )}
          {selectedSquare && (
            <>
              <span className="text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="font-mono text-[#D4A359] tabular-nums whitespace-nowrap">
                {selectedSquare.toUpperCase()} ({legalTargets.length + captureTargets.length} ходів)
              </span>
            </>
          )}
        </div>

        {(capturedWhite.length > 0 || capturedBlack.length > 0) && (
          <div className="bg-[#121722]/85 border border-white/10 rounded-lg px-3 py-1.5 flex items-center gap-3 text-sm">
            {capturedWhite.length > 0 && (
              <span className="text-[#E8D3A2] tracking-wider" title="Збиті білими">
                {capturedWhite.map((p) => PIECE_UNICODE[p] || p).join('')}
              </span>
            )}
            {capturedWhite.length > 0 && capturedBlack.length > 0 && (
              <span className="text-slate-600 text-xs" aria-hidden="true">
                ·
              </span>
            )}
            {capturedBlack.length > 0 && (
              <span className="text-slate-400 tracking-wider" title="Збиті чорними">
                {capturedBlack.map((p) => PIECE_UNICODE[p] || p).join('')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* WebGL Error Fallback */}
      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0B0E14]/95 p-6 text-center">
          <div className="max-w-sm border border-white/10 bg-[#121722] rounded-xl p-5">
            <p className="text-sm text-slate-200">{webglError}</p>
          </div>
        </div>
      )}

      {/* Pawn Promotion Overlay Modal */}
      {promotionPending && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="bg-[#121722] border border-white/15 rounded-xl p-5 shadow-2xl max-w-xs w-full">
            <h3 className="text-sm font-semibold text-white mb-1">Перетворення пішака</h3>
            <p className="text-xs text-slate-400 mb-4">
              Оберіть фігуру для поля {promotionPending.to.toUpperCase()}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { key: 'q', label: 'Ферзь', symbol: '♛' },
                { key: 'r', label: 'Тура', symbol: '♜' },
                { key: 'b', label: 'Слон', symbol: '♝' },
                { key: 'n', label: 'Кінь', symbol: '♞' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    const p = promotionPending;
                    setPromotionPending(null);
                    onAttemptMove(p.from, p.to, opt.key);
                  }}
                  className="flex flex-col items-center justify-center py-2.5 px-2 rounded-lg bg-[#1A2130] hover:bg-[#D4A359]/20 border border-white/10 hover:border-[#D4A359]/60 text-white transition-colors"
                >
                  <span className="text-xl leading-none mb-1">{opt.symbol}</span>
                  <span className="text-[11px] text-slate-300">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Collapsible Bottom Control Dock */}
      <div
        className={`absolute left-1/2 -translate-x-1/2 z-10 flex flex-col items-center transition-transform duration-200 ease-out ${
          controlsCollapsed ? 'bottom-0 translate-y-[calc(100%-32px)]' : 'bottom-4 translate-y-0'
        }`}
      >
        <button
          type="button"
          onClick={() => setControlsCollapsed((v) => !v)}
          className="px-3 py-1 rounded-t-lg bg-[#121722]/90 border border-b-0 border-white/10 text-[11px] font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap"
        >
          {controlsCollapsed ? '▴ Показати камеру' : '▾ Сховати камеру'}
        </button>

        <div className="bg-[#121722]/92 border border-white/10 rounded-xl px-2.5 py-2 flex items-center gap-1.5 shadow-xl max-w-[92vw] overflow-x-auto">
          {(
            [
              { id: 'white', label: 'Білі' },
              { id: 'black', label: 'Чорні' },
              { id: 'iso', label: 'Ізометрія' },
              { id: 'top', label: 'Зверху' },
            ] as const
          ).map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => applyCameraPreset(cam.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                cameraPreset === cam.id
                  ? 'bg-[#D4A359] text-[#0B0E14]'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              {cam.label}
            </button>
          ))}

          <div className="w-px h-5 bg-white/10 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() => setAutoFlip((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              autoFlip
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
            }`}
            title="Автоматично розвертати дошку під активного гравця"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Автоповорот</span>
          </button>

          <button
            type="button"
            onClick={() => applyCameraPreset(cameraPreset)}
            className="p-1.5 rounded-lg text-slate-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
            title="Скинути кут камери"
            aria-label="Скинути кут камери"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleZenMode}
            className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 text-slate-300 hover:bg-white/5 hover:text-white transition-colors whitespace-nowrap shrink-0"
            title="Перемкнути повноекранний режим (клавіша H)"
          >
            {zenMode ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{zenMode ? 'Показати панель' : 'Тільки 3D'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
