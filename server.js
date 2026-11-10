const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const port = Number(process.env.PORT) || 3000;
const rooms = new Map();
const colors = ['#a9f36b', '#65b8ff', '#ff786d', '#e8b75d'];
const code = () => Math.random().toString(36).slice(2, 6).toUpperCase();
const roomView = room => ({ code: room.code, started: room.started, players: room.players.map(({ id, name, slot }) => ({ id, name, slot, color: colors[slot] })) });

app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, game: 'iron-front', rooms: rooms.size }));
app.use(express.static(__dirname, { extensions: ['html'], maxAge: '1h' }));
app.get('*path', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', socket => {
  socket.on('room:create', ({ name } = {}) => {
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    const room = { code: roomCode, host: socket.id, started: false, players: [] };
    rooms.set(roomCode, room);
    addPlayer(socket, room, name);
  });
  socket.on('room:join', ({ code: requested, name } = {}) => {
    const room = rooms.get(String(requested || '').trim().toUpperCase());
    if (!room) return socket.emit('room:error', '방 코드를 찾을 수 없습니다.');
    if (room.started) return socket.emit('room:error', '이미 시작한 게임입니다.');
    if (room.players.length >= 4) return socket.emit('room:error', '방이 가득 찼습니다.');
    addPlayer(socket, room, name);
  });
  socket.on('game:start', () => {
    const room = findRoom(socket.id);
    if (!room || room.host !== socket.id || room.started || room.players.length < 2) return;
    room.started = true;
    io.to(room.code).emit('game:start', roomView(room));
  });
  socket.on('game:command', command => {
    const room = findRoom(socket.id);
    if (room?.started) io.to(room.host).emit('game:command', { playerId: socket.id, command });
  });
  socket.on('game:state', state => {
    const room = findRoom(socket.id);
    if (room?.started && room.host === socket.id) {
      room.state = state;
      socket.to(room.code).emit('game:state', state);
    }
  });
  socket.on('disconnect', () => {
    const room = findRoom(socket.id);
    if (!room) return;
    const departed = room.players.find(p => p.id === socket.id);
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.state && departed) {
      const playerState = room.state.players.find(p => p.id === socket.id);
      if (playerState) playerState.hp = 0;
    }
    if (!room.players.length) rooms.delete(room.code);
    else {
      const hostLeft = room.host === socket.id;
      if (hostLeft) room.host = room.players[0].id;
      io.to(room.code).emit('room:update', roomView(room));
      if (room.started) {
        io.to(room.code).emit('game:notice', '플레이어 연결이 끊겼습니다.');
        if (hostLeft && room.state) io.to(room.host).emit('game:resume', room.state);
      }
    }
  });
});

function findRoom(id) { return [...rooms.values()].find(room => room.players.some(player => player.id === id)); }
function addPlayer(socket, room, name) {
  const used = new Set(room.players.map(player => player.slot));
  const slot = [0, 1, 2, 3].find(index => !used.has(index));
  room.players.push({ id: socket.id, name: String(name || `사령관 ${slot + 1}`).trim().slice(0, 14), slot });
  socket.join(room.code);
  socket.emit('room:joined', { ...roomView(room), playerId: socket.id, host: room.host === socket.id });
  io.to(room.code).emit('room:update', roomView(room));
}

server.listen(port, '0.0.0.0', () => console.log(`IRON FRONT listening on port ${port}`));
