from fastapi import WebSocket


class GameConnectionManager:

    def __init__(self):
        self.rooms: dict[str, set[WebSocket]] = {}

    async def connect(self, game_id: str, websocket: WebSocket):
        await websocket.accept()

        self.rooms.setdefault(game_id, set()).add(websocket)

    def disconnect(self, game_id: str, websocket: WebSocket):
        room = self.rooms.get(game_id)

        if not room:
            return

        room.discard(websocket)

        if not room:
            self.rooms.pop(game_id, None)

    async def broadcast(self, game_id: str, message: dict):
        room = list(self.rooms.get(game_id, set()))

        for ws in room:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(game_id, ws)


ws_manager = GameConnectionManager()