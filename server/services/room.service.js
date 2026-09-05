const crypto = require("crypto");
const rooms = new Map();
const playerRooms = new Map();
const ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_PLAYERS = 2;
const AVATARS = ["🧑","👩","👨","🧑‍💻","👩‍💻","👨‍💻","🦊","🐼","🐱","🐸","🐵","🐨"];
function clean(value, fallback) { return String(value || fallback).trim().replace(/[<>]/g, "").slice(0, 18) || fallback; }
function avatar(value) { return AVATARS.includes(value) ? value : AVATARS[0]; }
function code() { let c; do c = String(Math.floor(1000 + Math.random() * 9000)); while (rooms.has(c)); return c; }
function cleanup() { const now = Date.now(); for (const [c, room] of rooms) if (now - room.updatedAt > ROOM_TTL_MS) { room.players.forEach(p => playerRooms.delete(p.id)); rooms.delete(c); } }
function publicRoom(room, playerId) { return { code: room.code, status: room.players.length === 2 ? "ready" : "waiting", players: room.players.map(p => ({ id: p.id, nickname: p.nickname, avatar: p.avatar, ready: p.id === playerId || p.ready })), hostId: room.hostId }; }
function createPlayer(nickname, avatarChoice) { return { id: crypto.randomUUID(), nickname: clean(nickname, "Jugador"), avatar: avatar(avatarChoice), ready: false, joinedAt: Date.now() }; }
function create(nickname, avatarChoice) { cleanup(); const player = createPlayer(nickname, avatarChoice), room = { code: code(), hostId: player.id, players: [player], createdAt: Date.now(), updatedAt: Date.now(), game: null }; rooms.set(room.code, room); playerRooms.set(player.id, room.code); return { playerId: player.id, room: publicRoom(room, player.id) }; }
function join(roomCode, nickname, avatarChoice) { cleanup(); const room = rooms.get(String(roomCode).trim()); if (!room) throw Object.assign(new Error("No existe una sala con ese código."), { status: 404 }); if (room.players.length >= MAX_PLAYERS) throw Object.assign(new Error("La sala ya está llena."), { status: 409 }); const player = createPlayer(nickname, avatarChoice); room.players.push(player); room.updatedAt = Date.now(); playerRooms.set(player.id, room.code); return { playerId: player.id, room: publicRoom(room, player.id) }; }
function get(playerId) { cleanup(); const room = rooms.get(playerRooms.get(playerId)); if (!room) throw Object.assign(new Error("La sala ya no existe."), { status: 404 }); room.updatedAt = Date.now(); return publicRoom(room, playerId); }
function getByCode(roomCode) { cleanup(); const room = rooms.get(String(roomCode || "").trim()); if (!room) throw Object.assign(new Error("La sala ya no existe."), { status: 404 }); room.updatedAt = Date.now(); return publicRoom(room); }
function leave(playerId) { const code = playerRooms.get(playerId), room = rooms.get(code); if (!room) return; room.players = room.players.filter(p => p.id !== playerId); playerRooms.delete(playerId); room.updatedAt = Date.now(); if (!room.players.length) rooms.delete(code); else room.hostId = room.players[0].id; }
function leaveByCode(roomCode) { const room = rooms.get(String(roomCode || "").trim()); if (!room) return; room.players.forEach(p => playerRooms.delete(p.id)); rooms.delete(room.code); }
function playerInRoom(playerId) { const code = playerRooms.get(playerId); return code ? rooms.get(code) : null; }
module.exports = { AVATARS, create, join, get, getByCode, leave, leaveByCode, playerInRoom, publicRoom };
