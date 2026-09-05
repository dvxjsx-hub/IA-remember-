const roomService = require("../services/room.service");
function fail(res, err) { res.status(err.status || 500).json({ error: err.message || "Error de sala." }); }
function create(req, res) { try { res.json(roomService.create(req.body?.nickname, req.body?.avatar)); } catch (e) { fail(res, e); } }
function join(req, res) { try { res.json(roomService.join(req.body?.code, req.body?.nickname, req.body?.avatar)); } catch (e) { fail(res, e); } }
function state(req, res) { try { const room = req.query.playerId ? roomService.get(req.query.playerId) : roomService.getByCode(req.query.code); res.json(room); } catch (e) { fail(res, e); } }
function leave(req, res) { try { if (req.body?.playerId) roomService.leave(req.body.playerId); else if (req.body?.code) roomService.leaveByCode(req.body.code); res.json({ ok: true }); } catch (e) { fail(res, e); } }
module.exports = { create, join, state, leave };
