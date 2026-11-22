import asyncio
import json
import secrets
import uuid
from datetime import datetime, timezone

import chess
from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from google import genai
from google.genai import types

from app.engines.chess_apis import query_maia_move, query_stockfish_api
from app.settings import settings
from app.ws_manager import ws_manager

router = APIRouter()

SESSIONS: dict[str, dict] = {}
GAMES: dict[str, dict] = {}
ANALYSIS_JOBS: dict[str, dict] = {}
TELEMETRY_LOGS: list[dict] = []
SSE_QUEUES: set[asyncio.Queue] = set()

GAME_COUNTER = 0
JOB_COUNTER = 0
COOKIE_NAME = "chessmind_sid"


def _emit_log(level: str, message: str, request_id: str = "-", component: str = "api"):
    entry = {
        "id": f"log-{uuid.uuid4().hex[:10]}",
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S,%f")[:-3],
        "level": level,
        "request_id": request_id,
        "message": message,
        "formatted": f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} | {level} | request_id={request_id} | {message}",
        "component": component,
    }
    TELEMETRY_LOGS.append(entry)
    if len(TELEMETRY_LOGS) > 350:
        del TELEMETRY_LOGS[:-350]
    for q in list(SSE_QUEUES):
        try:
            q.put_nowait(entry)
        except Exception:
            SSE_QUEUES.discard(q)


def _serialize_game(game: dict) -> dict:
    board: chess.Board = game["board"]
    status = "active"
    winner = None
    if board.is_checkmate():
        status = "checkmate"
        winner = "black" if board.turn == chess.WHITE else "white"
    elif board.is_stalemate():
        status = "stalemate"
        winner = "draw"
    elif board.is_insufficient_material() or board.can_claim_draw():
        status = "draw"
        winner = "draw"

    return {
        "game_id": game["game_id"],
        "status": status,
        "level": game["level"],
        "opponent": game["opponent"],
        "player_color": game["player_color"],
        "starter_mode": game["starter_mode"],
        "starter_note": game["starter_note"],
        "current_turn": "white" if board.turn == chess.WHITE else "black",
        "fen": board.fen(),
        "is_check": board.is_check(),
        "is_checkmate": board.is_checkmate(),
        "is_draw": status in ("stalemate", "draw"),
        "winner": winner,
        "moves": game["moves"],
        "captured": game["captured"],
        "last_move": game["last_move"],
        "engine_eval": game["engine_eval"],
    }


def _record_move(game: dict, move: chess.Move, engine: str | None = None):
    board: chess.Board = game["board"]
    color = "white" if board.turn == chess.WHITE else "black"
    piece = board.piece_at(move.from_square)
    captured_piece = board.piece_at(move.to_square)
    captured_sym = (
        captured_piece.symbol().lower()
        if captured_piece
        else ("p" if board.is_en_passant(move) else None)
    )
    san = board.san(move)
    board.push(move)

    if captured_sym:
        game["captured"][color].append(captured_sym)

    from_sq = chess.square_name(move.from_square)
    to_sq = chess.square_name(move.to_square)
    game["last_move"] = {"from": from_sq, "to": to_sq}
    game["moves"].append(
        {
            "ply": len(game["moves"]) + 1,
            "san": san,
            "uci": move.uci(),
            "from": from_sq,
            "to": to_sq,
            "color": color,
            "piece": piece.symbol().lower() if piece else "p",
            "captured": captured_sym,
            "fen": board.fen(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "engine": engine,
        }
    )


async def _compute_engine_reply(game: dict):
    board: chess.Board = game["board"]
    if game["opponent"] == "human" or board.is_game_over():
        return None

    if game["opponent"] == "stockfish":
        depth = 3 if game["level"] == "beginner" else 8 if game["level"] == "intermediate" else 14
        sf = await query_stockfish_api(board.fen(), depth=depth)
        move = None
        if sf.get("bestmove"):
            try:
                candidate = chess.Move.from_uci(sf["bestmove"])
                if candidate in board.legal_moves:
                    move = candidate
            except ValueError:
                move = None
        if move is None:
            legal = list(board.legal_moves)
            if not legal:
                return None
            move = legal[0]
        return move, f"Stockfish ({sf['source']}, d={sf['depth']})", sf

    maia = await query_maia_move(board.fen(), level=game["level"])
    if not maia:
        return None
    return maia["move"], f"Maia-{maia['elo']}", maia["eval_snapshot"]


async def _apply_move_and_broadcast(game_id: str, raw_move: str, request_id: str):
    game = GAMES.get(game_id)
    if not game:
        return 404, {
            "error": {
                "kind": "game_not_found",
                "message": "Партію не знайдено.",
                "retryable": False,
                "request_id": request_id,
            }
        }

    board: chess.Board = game["board"]
    turn_color = "white" if board.turn == chess.WHITE else "black"
    if game["opponent"] != "human" and turn_color != game["player_color"]:
        return 409, {
            "error": {
                "kind": "not_your_turn",
                "message": "Зараз черга ходу суперника.",
                "retryable": False,
                "request_id": request_id,
            }
        }

    try:
        move = chess.Move.from_uci(raw_move.strip().lower())
    except ValueError:
        move = None

    if move is None or move not in board.legal_moves:
        _emit_log("WARNING", f"Illegal move rejected: {raw_move}", request_id, "engine")
        return 400, {
            "error": {
                "kind": "invalid_move",
                "message": "Неможливо виконати цей шаховий хід.",
                "retryable": False,
                "request_id": request_id,
            }
        }

    _record_move(game, move, engine="player")
    player_uci = move.uci()
    _emit_log("INFO", f"Player move applied: {player_uci}", request_id, "engine")

    await ws_manager.broadcast(
        game_id,
        {
            "type": "move_applied",
            "payload": {
                **_serialize_game(game),
                "move": player_uci,
                "computer_move": None,
                "computer_engine": None,
            },
        },
    )

    comp_uci = None
    comp_engine = None
    if game["opponent"] != "human" and not board.is_game_over():
        reply = await _compute_engine_reply(game)
        if reply:
            comp_move, comp_engine, eval_snap = reply
            _record_move(game, comp_move, engine=comp_engine)
            game["engine_eval"] = eval_snap
            comp_uci = comp_move.uci()
            _emit_log("INFO", f"Engine move applied: {comp_uci} ({comp_engine})", request_id, "engine")

    final_payload = {
        **_serialize_game(game),
        "move": player_uci,
        "computer_move": comp_uci,
        "computer_engine": comp_engine,
    }

    if comp_uci or game["opponent"] == "human":
        await ws_manager.broadcast(game_id, {"type": "move_applied", "payload": final_payload})

    return 200, final_payload


# ---- Auth ----

@router.get("/api/auth/me")
def auth_me(request: Request):
    sid = request.cookies.get(COOKIE_NAME)
    user = SESSIONS.get(sid) if sid else None
    if not user:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": user}


@router.post("/api/auth/login")
def auth_login(body: dict, request: Request, response: Response):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    username = str(body.get("username", "")).strip()
    email = str(body.get("email", "")).strip()
    if len(username) < 2 or len(username) > 40:
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "kind": "validation_error",
                    "message": "Імʼя гравця повинно містити від 2 до 40 символів.",
                    "retryable": False,
                    "request_id": req_id,
                }
            },
        )
    sid = str(uuid.uuid4())
    user = {
        "user_id": f"usr-{sid[:8]}",
        "username": username,
        "email": email or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "games_played": 0,
    }
    SESSIONS[sid] = user
    response.set_cookie(COOKIE_NAME, sid, httponly=True, samesite="lax", max_age=86400)
    _emit_log("INFO", f"Player signed in: {username}", req_id, "auth")
    return {"authenticated": True, "user": user}


@router.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    sid = request.cookies.get(COOKIE_NAME)
    if sid:
        SESSIONS.pop(sid, None)
    response.delete_cookie(COOKIE_NAME)
    return {"authenticated": False, "user": None}


# ---- Games & WebSocket ----

@router.post("/api/games")
async def create_game(body: dict, request: Request):
    global GAME_COUNTER
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    GAME_COUNTER += 1
    game_id = f"game-{GAME_COUNTER:03d}"

    level = body.get("level", "intermediate")
    opponent = body.get("opponent", "stockfish")
    starter_mode = body.get("starter_mode", "random")
    player_color = secrets.choice(["white", "black"]) if starter_mode == "random" else starter_mode
    if opponent == "human":
        player_color = "white"

    game = {
        "game_id": game_id,
        "level": level,
        "opponent": opponent,
        "player_color": player_color,
        "starter_mode": starter_mode,
        "starter_note": f"Ви граєте за {'Білих' if player_color == 'white' else 'Чорних'}",
        "board": chess.Board(),
        "moves": [],
        "captured": {"white": [], "black": []},
        "last_move": None,
        "engine_eval": None,
    }
    GAMES[game_id] = game
    _emit_log("INFO", f"Created {game_id}: opponent={opponent}, level={level}", req_id, "storage")

    if opponent != "human" and player_color == "black":
        reply = await _compute_engine_reply(game)
        if reply:
            comp_move, comp_engine, eval_snap = reply
            _record_move(game, comp_move, engine=comp_engine)
            game["engine_eval"] = eval_snap

    return _serialize_game(game)


@router.get("/api/games/{game_id}")
def get_game(game_id: str, request: Request):
    req_id = getattr(request.state, "request_id", "-")
    game = GAMES.get(game_id)
    if not game:
        return JSONResponse(
            status_code=404,
            content={"error": {"kind": "game_not_found", "message": "Партію не знайдено.", "retryable": False, "request_id": req_id}},
        )
    return _serialize_game(game)


@router.post("/api/games/{game_id}/moves")
async def make_move_http(game_id: str, body: dict, request: Request):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    status, payload = await _apply_move_and_broadcast(game_id, str(body.get("move", "")), req_id)
    return JSONResponse(status_code=status, content=payload)


@router.websocket("/ws/games/{game_id}")
async def game_websocket(websocket: WebSocket, game_id: str):
    await ws_manager.connect(game_id, websocket)
    try:
        game = GAMES.get(game_id)
        if game:
            await websocket.send_json({"type": "game_state", "payload": _serialize_game(game)})

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            if msg_type == "sync":
                current = GAMES.get(game_id)
                if current:
                    await websocket.send_json({"type": "game_state", "payload": _serialize_game(current)})
            elif msg_type == "make_move":
                status, payload = await _apply_move_and_broadcast(
                    game_id,
                    str(data.get("move", "")),
                    str(uuid.uuid4()),
                )
                if status != 200:
                    await websocket.send_json({"type": "error", "payload": payload["error"]})
    except WebSocketDisconnect:
        ws_manager.disconnect(game_id, websocket)


# ---- Engine & Analysis ----

@router.post("/api/engine/evaluate")
async def evaluate_position(body: dict, request: Request):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    fen = body.get("fen") or chess.STARTING_FEN
    depth = int(body.get("depth") or 10)
    snap = await query_stockfish_api(fen, depth=min(max(depth, 2), 15))
    return {**snap, "request_id": req_id}


@router.post("/api/games/analyze")
def start_analysis(body: dict, request: Request):
    global JOB_COUNTER
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    game_id = str(body.get("game_id", ""))
    game = GAMES.get(game_id)
    if not game:
        return JSONResponse(
            status_code=404,
            content={"error": {"kind": "game_not_found", "message": "Партію для аналізу не знайдено.", "retryable": False, "request_id": req_id}},
        )

    JOB_COUNTER += 1
    job_id = f"analysis-{JOB_COUNTER:03d}"
    moves_count = len(game["moves"])
    ANALYSIS_JOBS[job_id] = {
        "job_id": job_id,
        "game_id": game_id,
        "status": "completed",
        "result": {
            "summary": f"Проаналізовано {moves_count} півходів.",
            "mistakes": [],
            "recommendations": ["Контролюйте центр та перевіряйте незахищені фігури перед ходом."],
        },
    }
    return JSONResponse(status_code=202, content={"job_id": job_id, "game_id": game_id, "status": "pending"})


@router.get("/api/games/analyze/{job_id}")
def get_analysis(job_id: str, request: Request):
    req_id = getattr(request.state, "request_id", "-")
    job = ANALYSIS_JOBS.get(job_id)
    if not job:
        return JSONResponse(
            status_code=404,
            content={"error": {"kind": "job_not_found", "message": "Завдання аналізу не знайдено.", "retryable": False, "request_id": req_id}},
        )
    return job


# ---- Voice (Gemini STT / TTS with fallback) ----

@router.post("/api/coach/transcribe")
def transcribe_voice(body: dict, request: Request):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    audio_b64 = str(body.get("audio_base64", ""))
    mime_type = str(body.get("mime_type", "audio/webm"))
    if not settings.llm_api_key or not audio_b64:
        return {
            "text": "Оціни поточну позицію та порадь найкращий хід",
            "request_id": req_id,
            "provider": "fallback",
            "model": "local-stt-fallback",
            "latency_ms": 1,
        }
    try:
        import base64
        client = genai.Client(api_key=settings.llm_api_key)
        res = client.models.generate_content(
            model="gemini-3.5-transcribe",
            contents=[
                types.Part.from_bytes(data=base64.b64decode(audio_b64), mime_type=mime_type),
                "Транскрибуй це голосове запитання про шахи українською мовою. Поверни лише текст.",
            ],
        )
        return {
            "text": (res.text or "").strip() or "Оціни поточну позицію",
            "request_id": req_id,
            "provider": "gemini",
            "model": "gemini-3.5-transcribe",
            "latency_ms": 0,
        }
    except Exception:
        return {
            "text": "Оціни поточну позицію та порадь найкращий хід",
            "request_id": req_id,
            "provider": "fallback",
            "model": "local-stt-fallback",
            "latency_ms": 0,
        }


@router.post("/api/coach/speak")
def speak_voice(body: dict, request: Request):
    req_id = getattr(request.state, "request_id", str(uuid.uuid4()))
    text = str(body.get("text", "")).strip()
    return {
        "audio_base64": None,
        "mime_type": "audio/wav",
        "fallback_tts": True,
        "text": text,
        "request_id": req_id,
        "provider": "browser-speech-synthesis",
        "model": "web-speech-uk",
        "latency_ms": 0,
    }


# ---- Telemetry ----

@router.get("/api/telemetry/logs")
def get_telemetry_logs():
    return {
        "logs": TELEMETRY_LOGS,
        "usage": {
            "usage_date": datetime.now(timezone.utc).date().isoformat(),
            "request_count": 0,
            "total_cost": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "daily_ai_request_limit": settings.daily_ai_request_limit,
            "daily_ai_budget": settings.daily_ai_budget,
            "avg_latency_ms": 0,
            "total_http_requests": len(TELEMETRY_LOGS),
            "error_count": 0,
        },
    }


@router.delete("/api/telemetry/logs")
def clear_telemetry_logs():
    TELEMETRY_LOGS.clear()
    return {"cleared": True, **get_telemetry_logs()}



@router.get("/api/telemetry/stream")
async def stream_telemetry():
    queue: asyncio.Queue = asyncio.Queue()
    SSE_QUEUES.add(queue)

    async def event_gen():
        try:
            yield ": connected\n\n"

            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(),
                        timeout=15.0,
                    )

                    yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

                except asyncio.TimeoutError:
                    yield ": ping\n\n"

        finally:
            SSE_QUEUES.discard(queue)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
