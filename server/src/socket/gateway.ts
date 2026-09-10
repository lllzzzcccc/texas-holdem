import type { Server, Socket } from 'socket.io';
import type {
  ApiError,
  ClientToServerEvents,
  CreateRoomOptions,
  JoinedPayload,
  RoomSummary,
  ServerToClientEvents,
} from '@th/shared';
import { EV, LOBBY_MAX_ROOMS } from '@th/shared';
import { Room } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

const LOBBY_CHANNEL = '__hall__';

interface Session {
  playerId: string;
  roomCode: string;
}

function err(message: string, code = 'ERR'): ApiError {
  return { code, message };
}

/** 把 Socket.IO 事件接到 RoomManager/Room 上 */
export function attachGateway(io: IO, manager: RoomManager): void {
  const broadcastHall = () => {
    io.to(LOBBY_CHANNEL).emit(EV.LobbyRooms, manager.listSummaries());
  };
  manager.onChange = broadcastHall;

  io.on('connection', (socket: Sock) => {
    const session = socket.data as Session;

    const roomOf = (): Room => {
      if (!session.roomCode) throw new Error('你还未加入房间');
      const room = manager.get(session.roomCode);
      if (!room) throw new Error('房间不存在或已解散');
      return room;
    };

    const wrap =
      <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => {
        try {
          fn(...args);
        } catch (e) {
          const cb = args.find((a) => typeof a === 'function') as ((r: ApiError) => void) | undefined;
          if (cb) cb(err(e instanceof Error ? e.message : '操作失败'));
        }
      };

    // ---------- 游戏大厅 ----------

    socket.on(EV.LobbyList, (_p: Record<string, never>, cb: (r: { rooms: RoomSummary[] }) => void) => {
      cb({ rooms: manager.listSummaries() });
    });

    socket.on(EV.LobbySubscribe, () => {
      socket.join(LOBBY_CHANNEL);
      socket.emit(EV.LobbyRooms, manager.listSummaries());
    });

    socket.on(EV.LobbyUnsubscribe, () => {
      socket.leave(LOBBY_CHANNEL);
    });

    // ---------- 创建 / 加入房间 ----------

    socket.on(
      EV.RoomCreate,
      wrap((p: { nickname: string; options?: CreateRoomOptions }, cb: (r: JoinedPayload | ApiError) => void) => {
        const nickname = (p?.nickname ?? '').trim();
        if (!nickname) return cb(err('请填写昵称', 'BAD_NICKNAME'));
        if (manager.size >= LOBBY_MAX_ROOMS) {
          return cb(err(`大厅已满（最多 ${LOBBY_MAX_ROOMS} 桌），请稍后再试`, 'LOBBY_FULL'));
        }
        const code = manager.generateCode();
        let roomRef!: Room;
        const hooks = makeHooks(io, () => roomRef, broadcastHall, () => manager.remove(code));
        const room = new Room(code, '__pending__', hooks, p?.options ?? {});
        roomRef = room;
        manager.add(room);
        const { player } = room.addPlayer(nickname, socket.id);
        room.hostId = player.id;
        session.playerId = player.id;
        session.roomCode = code;
        socket.join(`room:${code}`);
        cb({ playerId: player.id, roomCode: code, state: room.buildState(player.id) });
        room.notifyState();
      }),
    );

    socket.on(
      EV.RoomJoin,
      wrap(
        (
          p: { roomCode: string; nickname: string; playerId?: string; password?: string },
          cb: (r: JoinedPayload | ApiError) => void,
        ) => {
          const room = manager.get(p?.roomCode ?? '');
          if (!room) return cb(err('房间不存在，请检查房间号', 'ROOM_NOT_FOUND'));
          const nickname = (p?.nickname ?? '').trim();
          if (!nickname) return cb(err('请填写昵称', 'BAD_NICKNAME'));
          // 密码校验：本人凭 playerId 重连免密；新成员必须通过密码（若设置了）
          const isRejoin = !!p.playerId && room.hasPlayer(p.playerId);
          if (!isRejoin && !room.checkPassword(p.password)) {
            return cb(err('房间密码错误或未填写', 'WRONG_PASSWORD'));
          }
          const { player } = room.addPlayer(nickname, socket.id, p.playerId);
          session.playerId = player.id;
          session.roomCode = room.code;
          socket.join(`room:${room.code}`);
          cb({ playerId: player.id, roomCode: room.code, state: room.buildState(player.id) });
        },
      ),
    );

    socket.on(
      EV.RoomLeave,
      wrap((_: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => {
        const room = roomOf();
        room.leaveRoom(session.playerId);
        socket.leave(`room:${room.code}`);
        session.playerId = '';
        session.roomCode = '';
        cb?.({ ok: true });
      }),
    );

    socket.on(
      EV.RoomDissolve,
      wrap((_: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => {
        const room = roomOf();
        if (room.hostId !== session.playerId) throw new Error('只有房主可以解散房间');
        io.to(`room:${room.code}`).emit(EV.RoomDissolved, { message: '房主解散了房间' });
        manager.remove(room.code);
        cb?.({ ok: true });
      }),
    );

    socket.on(
      EV.RoomConfigure,
      wrap((p: { options: CreateRoomOptions }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().configure(session.playerId, p?.options ?? {});
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.RoomKick,
      wrap((p: { playerId: string }, cb: (r: { ok: true } | ApiError) => void) => {
        const room = roomOf();
        const kicked = room.kickPlayer(session.playerId, p?.playerId ?? '');
        if (kicked.socketId) {
          // 私信被踢者并把它从房间频道移除、清掉其会话，杜绝后续操作
          io.to(kicked.socketId).emit(EV.RoomKicked, { message: '你已被房主请出房间' });
          const ks = io.sockets.sockets.get(kicked.socketId);
          if (ks) {
            ks.leave(`room:${room.code}`);
            (ks.data as Session).playerId = '';
            (ks.data as Session).roomCode = '';
          }
        }
        cb({ ok: true });
      }),
    );

    // ---------- 大厅 ----------

    socket.on(
      EV.LobbyTakeSeat,
      wrap((p: { seatIndex: number; buyIn: number }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().takeSeat(session.playerId, p.seatIndex, p.buyIn);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.LobbyLeaveSeat,
      wrap((_: Record<string, never>, cb?: (r: { ok: true } | ApiError) => void) => {
        roomOf().leaveSeat(session.playerId);
        cb?.({ ok: true });
      }),
    );

    // ---------- 游戏 ----------

    socket.on(
      EV.GameStart,
      wrap((_: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().startGame(session.playerId);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.GameStop,
      wrap((_: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().stopGame(session.playerId);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.GameAction,
      wrap(
        (
          p: { action: 'fold' | 'check' | 'call' | 'raise'; amount?: number },
          cb: (r: { ok: true } | ApiError) => void,
        ) => {
          roomOf().action(session.playerId, p.action, p.amount);
          cb({ ok: true });
        },
      ),
    );

    socket.on(
      EV.GameRebuy,
      wrap((p: { amount: number }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().rebuy(session.playerId, p.amount);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.GameNextHand,
      wrap((_: Record<string, never>, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().nextHand(session.playerId);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.GameDrawCard,
      wrap((p: { deckIndex: number }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().drawCard(session.playerId, p.deckIndex);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.GameShowCard,
      wrap((p: { cardIndex: number }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().showCard(session.playerId, p.cardIndex);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.EmojiThrow,
      wrap((p: { toSeatIndex: number; emoji: string }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().throwEmoji(session.playerId, p.toSeatIndex, p.emoji);
        cb({ ok: true });
      }),
    );

    socket.on(
      EV.DanmakuSend,
      wrap((p: { text: string; style: string }, cb: (r: { ok: true } | ApiError) => void) => {
        roomOf().sendDanmaku(session.playerId, p.text, p.style);
        cb({ ok: true });
      }),
    );

    // ---------- 断线 ----------

    socket.on('disconnect', () => {
      if (!session.roomCode || !session.playerId) return;
      const room = manager.get(session.roomCode);
      if (room) room.markDisconnected(session.playerId, socket.id);
    });
  });
}

function makeHooks(io: IO, getRoom: () => Room, onRoomActivity?: () => void, destroyRoom?: () => void) {
  return {
    emitEvent: (ev: Parameters<ServerToClientEvents[typeof EV.GameEvent]>[0]) => {
      const room = getRoom();
      io.to(`room:${room.code}`).emit(EV.GameEvent, ev);
    },
    emitState: () => {
      const room = getRoom();
      for (const p of room.players.values()) {
        if (p.connected && p.socketId) {
          io.to(p.socketId).emit(EV.RoomState, room.buildState(p.id));
        }
      }
      // 房间状态变化同步刷新大厅列表
      onRoomActivity?.();
    },
    emitToPlayer: (
      playerId: string,
      payload: { holeCards?: string[]; yourTurn?: Parameters<ServerToClientEvents[typeof EV.YourTurn]>[0] },
    ) => {
      const room = getRoom();
      const p = room.players.get(playerId);
      if (!p?.socketId) return;
      if (payload.holeCards) io.to(p.socketId).emit(EV.HoleCards, { cards: payload.holeCards });
      if (payload.yourTurn) io.to(p.socketId).emit(EV.YourTurn, payload.yourTurn);
    },
    destroyRoom: () => {
      destroyRoom?.();
    },
    broadcast: (event: string, payload: unknown) => {
      const room = getRoom();
      // 事件名为运行时字符串，绕过 socket.io 的字面量类型约束
      (io.to(`room:${room.code}`) as unknown as { emit: (e: string, p: unknown) => void }).emit(event, payload);
    },
  };
}
