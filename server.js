const express=require('express');
const path=require('path');
const crypto=require('crypto');
const http=require('http');
const {WebSocketServer,WebSocket}=require('ws');

const app=express();
const PORT=process.env.PORT||3000;
const server=http.createServer(app);
const wss=new WebSocketServer({noServer:true});

app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

const players=new Map();
const waiting=[];
let tournament=null;
const sockets=new Map();
const MOVES=['piedra','papel','tijera'];
const id=()=>crypto.randomBytes(12).toString('hex');

function cleanNickname(value){return String(value||'').trim().replace(/\s+/g,' ').slice(0,20)}
function playerByToken(token){return players.get(token)}
function activePlayers(){
  const now=Date.now();
  return [...players.values()].filter(p=>now-p.lastSeen<=30000).length;
}
function publicPlayer(p){return {id:p.id,nickname:p.nickname,wins:p.wins,losses:p.losses}}
function broadcast(){
  for(const [token,ws] of sockets){
    if(ws.readyState===WebSocket.OPEN) sendState(token,ws);
  }
}
function sendState(token,ws){
  const p=playerByToken(token);
  if(!p)return;
  p.lastSeen=Date.now();
  ws.send(JSON.stringify({type:'state',data:buildState(p)}));
}
function buildState(p){
  const active=activePlayers();
  if(!tournament||!tournament.players.includes(p.id)){
    return {phase:waiting.includes(p.id)?'waiting':'idle',waiting:waiting.length,activePlayers:active,me:publicPlayer(p)};
  }
  const current=tournament.matches.find(m=>m.winner===null&&(m.a===p.id||m.b===p.id));
  const me=publicPlayer(p);
  const standings=tournament.players.map(x=>publicPlayer(players.get(x))).sort((a,b)=>(b.wins-a.wins)||(a.losses-b.losses));
  if(tournament.phase==='final'&&tournament.matches[0].winner){
    tournament.champion=tournament.matches[0].winner;
    tournament.phase='champion';
  }
  return {
    phase:tournament.phase,
    round:tournament.roundIndex+1,
    me,standings,activePlayers:active,
    current:current?{
      id:current.id,
      opponent:players.get(current.a===p.id?current.b:current.a).nickname,
      chosen:Boolean(current.moves[p.id]),
      opponentChosen:Boolean(current.moves[current.a===p.id?current.b:current.a])
    }:null,
    champion:tournament.champion?players.get(tournament.champion).nickname:null,
    finalists:tournament.phase==='final'?[players.get(tournament.matches[0].a).nickname,players.get(tournament.matches[0].b).nickname]:null,
    waiting:waiting.length
  };
}
function makeRound(t){
  const schedule=[[[0,1],[2,3]],[[0,2],[1,3]],[[0,3],[1,2]]];
  t.matches=schedule[t.roundIndex].map((pair,index)=>({
    id:id(),round:t.roundIndex+1,a:t.players[pair[0]],b:t.players[pair[1]],moves:{},winner:null,draws:0,createdAt:Date.now(),index
  }));
}
function result(a,b){
  if(a===b)return 0;
  if((a==='piedra'&&b==='tijera')||(a==='papel'&&b==='piedra')||(a==='tijera'&&b==='papel'))return 1;
  return 2;
}
function startTournament(){
  if(tournament||waiting.length<4)return;
  const ids=waiting.splice(0,4);
  tournament={id:id(),players:ids,roundIndex:0,matches:[],phase:'round',champion:null,createdAt:Date.now()};
  ids.forEach((pid,i)=>{
    const p=players.get(pid);
    p.tournamentId=tournament.id;p.seed=i;p.wins=0;p.losses=0;p.lastMatch=null;
  });
  makeRound(tournament);
  broadcast();
}
function finishMatch(m){
  const r=result(m.moves[m.a],m.moves[m.b]);
  if(r===0){m.moves={};m.draws++;broadcast();return}
  m.winner=r===1?m.a:m.b;
  const loser=r===1?m.b:m.a;
  players.get(m.winner).wins++;
  players.get(loser).losses++;
  players.get(m.a).lastMatch={opponent:players.get(m.b).nickname,result:m.winner===m.a?'win':'loss'};
  players.get(m.b).lastMatch={opponent:players.get(m.a).nickname,result:m.winner===m.b?'win':'loss'};
  if(tournament.matches.every(x=>x.winner)){
    if(tournament.roundIndex<2){
      tournament.roundIndex++;
      makeRound(tournament);
    }else{
      const ranked=tournament.players.slice().sort((x,y)=>{
        const a=players.get(x),b=players.get(y);
        return (b.wins-a.wins)||(a.losses-b.losses)||(a.seed-b.seed);
      });
      tournament.phase='final';
      tournament.matches=[{id:id(),round:4,a:ranked[0],b:ranked[1],moves:{},winner:null,draws:0,createdAt:Date.now(),index:0}];
    }
  }
  broadcast();
}

function cleanup(){
  const now=Date.now();
  for(const [token,p] of players){
    if(now-p.lastSeen>60000&&(!tournament||!tournament.players.includes(p.id))){
      const i=waiting.indexOf(p.id);if(i>=0)waiting.splice(i,1);
      players.delete(token);
      sockets.get(token)?.close();
      sockets.delete(token);
    }
  }
  broadcast();
}
setInterval(cleanup,15000);

app.post('/api/login',(req,res)=>{
  const nickname=cleanNickname(req.body&&req.body.nickname);
  if(nickname.length<2)return res.status(400).json({error:'El nickname debe tener al menos 2 caracteres.'});
  const taken=[...players.values()].some(p=>p.nickname.toLowerCase()===nickname.toLowerCase());
  if(taken)return res.status(409).json({error:'Ese nickname ya está en uso.'});
  const token=id();
  players.set(token,{id:id(),nickname,tournamentId:null,seed:null,wins:0,losses:0,lastSeen:Date.now(),lastMatch:null});
  res.json({token,nickname});
});

app.post('/api/queue',(req,res)=>{
  const p=playerByToken(req.body&&req.body.token);
  if(!p)return res.status(401).json({error:'Sesión no válida.'});
  p.lastSeen=Date.now();
  if(p.tournamentId)return res.json({status:'in_game'});
  if(!waiting.includes(p.id))waiting.push(p.id);
  startTournament();
  res.json({status:tournament&&tournament.players.includes(p.id)?'matched':'waiting',position:waiting.indexOf(p.id)+1,waiting:waiting.length,activePlayers:activePlayers()});
  broadcast();
});

app.post('/api/ping',(req,res)=>{
  const p=playerByToken(req.body&&req.body.token);
  if(p)p.lastSeen=Date.now();
  res.json({ok:true,activePlayers:activePlayers()});
});

app.post('/api/move',(req,res)=>{
  const p=playerByToken(req.body&&req.body.token);
  const move=String(req.body&&req.body.move||'').toLowerCase();
  if(!p)return res.status(401).json({error:'Sesión no válida.'});
  p.lastSeen=Date.now();
  if(!MOVES.includes(move))return res.status(400).json({error:'Movimiento no válido.'});
  if(!tournament||!tournament.players.includes(p.id))return res.status(400).json({error:'No estás en una partida.'});
  const m=tournament.matches.find(x=>x.winner===null&&(x.a===p.id||x.b===p.id));
  if(!m)return res.status(400).json({error:'No tienes una partida pendiente.'});
  if(m.moves[p.id])return res.status(400).json({error:'Ya elegiste tu movimiento.'});
  m.moves[p.id]=move;
  if(m.moves[m.a]&&m.moves[m.b])finishMatch(m);
  else broadcast();
  res.json({ok:true});
});

app.get('/api/state',(req,res)=>{
  const p=playerByToken(req.query.token);
  if(!p)return res.status(401).json({error:'Sesión no válida.'});
  res.json(buildState(p));
});

app.post('/api/leave',(req,res)=>{
  const p=playerByToken(req.body&&req.body.token);
  if(!p)return res.status(401).json({error:'Sesión no válida.'});
  if(tournament&&tournament.phase==='champion'){
    tournament.players.forEach(pid=>{
      const x=[...players.values()].find(v=>v.id===pid);
      if(x)x.tournamentId=null;
    });
    tournament=null;
  }
  p.tournamentId=null;
  res.json({ok:true});
  broadcast();
});
app.get('/api/health',(_req,res)=>res.json({ok:true,players:players.size,activePlayers:activePlayers(),waiting:waiting.length,tournament:Boolean(tournament)}));

server.on('upgrade',(req,socket,head)=>{
  if(req.url.startsWith('/ws')){
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  }else socket.destroy();
});
wss.on('connection',(ws,req)=>{
  const url=new URL(req.url,'http://localhost');
  const token=url.searchParams.get('token');
  if(!playerByToken(token)){ws.close(1008,'Sesión no válida');return}
  sockets.set(token,ws);
  sendState(token,ws);
  ws.on('close',()=>{if(sockets.get(token)===ws)sockets.delete(token)});
  ws.on('message',raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.type==='ping'){
        const p=playerByToken(token);
        if(p){p.lastSeen=Date.now();ws.send(JSON.stringify({type:'pong',activePlayers:activePlayers()}))}
      }
    }catch{}
  });
});

app.get('{*splat}',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log('Server running on '+PORT+' with WebSocket real-time'));
