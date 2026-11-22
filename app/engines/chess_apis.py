
import math
import random

import chess
import httpx

_HTTP_CLIENT = httpx.AsyncClient(
    timeout=httpx.Timeout(1.8, connect=1.0),
    limits=httpx.Limits(
        max_connections=20,
        max_keepalive_connections=10,
    ),
)
async def query_stockfish_api(fen: str, depth: int = 10) -> dict:

    try:
        async with _HTTP_CLIENT as client:
            res = await client.get(
                "https://stockfish.online/api/s/v2.php",
                params={"fen": fen, "depth": depth},
            )

            if res.status_code == 200:
                data = res.json()
                parts = data.get("bestmove", "").split()

                uci = (
                    parts[1].lower()
                    if len(parts) >= 2 and parts[0] == "bestmove"
                    else None
                )

                if data.get("success") and uci:
                    return {
                        "evaluation": data.get("evaluation"),
                        "mate": data.get("mate"),
                        "bestmove": uci,
                        "depth": depth,
                        "source": "stockfish.online",
                    }

    except Exception:
        pass

    try:
        async with _HTTP_CLIENT as client:
            res = await client.post(
                "https://chess-api.com/v1",
                json={"fen": fen, "depth": depth},
            )

            if res.status_code == 200:
                data = res.json()

                if data.get("move"):
                    return {
                        "evaluation": data.get("eval"),
                        "mate": data.get("mate"),
                        "bestmove": str(data["move"]).lower(),
                        "depth": data.get("depth", depth),
                        "source": "chess-api.com",
                    }

    except Exception:
        pass

    board = chess.Board(fen)
    legal = list(board.legal_moves)

    best = legal[0].uci() if legal else None

    return {
        "evaluation": 0.0,
        "mate": None,
        "bestmove": best,
        "depth": 1,
        "source": "local-fallback",
    }


async def query_maia_move(
    fen: str,
    level: str = "intermediate"
) -> dict | None:

    board = chess.Board(fen)
    legal = list(board.legal_moves)

    if not legal:
        return None

    if level == "beginner":
        elo = 1100
    elif level == "intermediate":
        elo = 1500
    else:
        elo = 1900

    candidates = []
    source = f"maia-{elo}-policy"

    try:
        async with _HTTP_CLIENT as client:
            res = await client.get(
                "https://lichess.org/api/cloud-eval",
                params={"fen": fen, "multiPv": 5},
            )

            if res.status_code == 200:
                pvs = res.json().get("pvs", [])

                for pv in pvs:
                    moves_str = pv.get("moves", "")
                    first_uci = moves_str.split(" ")[0] if moves_str else ""

                    if len(first_uci) >= 4:
                        cp = pv.get("cp")

                        if cp is None:
                            mate = pv.get("mate")
                            cp = (
                                9000 if mate > 0 else -9000
                            ) if mate is not None else 0

                        cp_oriented = cp if board.turn == chess.WHITE else -cp

                        candidates.append((first_uci, int(cp_oriented)))

                if candidates:
                    source = f"maia-{elo}+lichess-pv"

    except Exception:
        pass

    if not candidates:
        candidates = [(m.uci(), 0) for m in legal[:5]]

    candidates.sort(key=lambda x: x[1], reverse=True)

    if elo == 1100:
        max_pool = 4
        temperature = 180
    elif elo == 1500:
        max_pool = 3
        temperature = 90
    else:
        max_pool = 2
        temperature = 35

    pool = candidates[:max_pool]
    best_cp = pool[0][1]

    weights = [
        math.exp((cp - best_cp) / temperature)
        for _, cp in pool
    ]

    chosen_uci, chosen_cp = random.choices(
        pool,
        weights=weights,
        k=1
    )[0]

    try:
        move = chess.Move.from_uci(chosen_uci)

        if move not in board.legal_moves:
            move = legal[0]

    except ValueError:
        move = legal[0]

    return {
        "move": move,
        "elo": elo,
        "eval_snapshot": {
            "evaluation": round(
                (chosen_cp if board.turn == chess.WHITE else -chosen_cp) / 100.0,
                2
            ),
            "mate": None,
            "bestmove": move.uci(),
            "depth": None,
            "source": source,
        },
    }
