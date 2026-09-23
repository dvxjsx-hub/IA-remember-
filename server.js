const express=require('express');
const path=require('path');
const crypto=require('crypto');
const http=require('http');
const {WebSocketServer,WebSocket}=require('ws');

const app=express();
const PORT=process.env.PORT||3000;
const server=http.createServer(app);
const wss=new WebSocketServer({server,path:'/ws'});

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

function safeSend(ws,payload){
  try{
    if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(payload));
  }catch(err){
    console.error('WebSocket send error:',err.message);
    try{ws.close()}catch{}
  }
}
function sendState(token,ws){
  const p=playerByToken(token);
  if(!p)return;
  p.lastSeen=Date.now();
  safeSend(ws,{type:'state',data:buildState(p)});
}
function broadcast(){
  for(const [token,ws] of sockets){
    try{
      if(ws.readyState===WebSocket.OPEN)sendState(token,ws);
      else sockets.delete(token);
    }catch(err){
      console.error('Broadcast error:',err.message);
      sockets.delete(token);
    }
  }
}

function buildState(p){
  const active=activePlayers();
  if(!tournament||!tournament.players.includes(p.id)){
    return {phase:waiting.includes(p.id)?'waiting':'idle',waiting:waiting.length,activePlayers:active,me:publicPlayer(p)};
  }
  const current=tournament.matches.find(m=>m.winner===null&&(m.a===p.id||m.b===p.id));
  const me=publicPlayer(p);
  const standings=tournament.players
    .map(x=>players.get(x))
    .filter(Boolean)
    .map(publicPlayer)
    .sort((a,b)=>(b.wins-a.wins)||(a.losses-b.losses));
  if(tournament.phase==='final'&&tournament.matches[0]&&tournament.matches[0].winner){
    tournament.champion=tournament.matches[0].winner;
    tournament.phase='champion';
  }
  const finalMatch=tournament.matches[0];
  return {
    phase:tournament.phase,
    round:tournament.roundIndex+1,
    me,standings,activePlayers:active,
    current:current?{
      id:current.id,
      opponent:players.get(current.a===p.id?current.b:current.a)?.nickname||'Rival',
      chosen:Boolean(current.moves[p.id]),
      opponentChosen:Boolean(current.moves[current.a===p.id?current.b:current.a])
    }:null,
    champion:tournament.champion?players.get(tournament.champion)?.nickname:null,
    finalists:tournament.phase==='final'&&finalMatch
      ?[players.get(finalMatch.a)?.nickname||'Jugador',players.get(finalMatch.b)?.nickname||'Jugador']:null,
    waiting:waiting.length
  };
}

function makeRound(t){
  const schedule=[[[0,1],[2,3]],[[0,2],[1,3]],[[0,3],[1,2]]];
  const pairs=schedule[t.roundIndex];
  t.matches=pairs.map((pair,index)=>({
    id:id(),round:t.roundIndex+1,a:t.players[pair[0]],b:t.players[pair[1]],
    moves:{},winner:null,draws:0,createdAt:Date.now(),index
  }));
}

function result(a,b){
  if(a===b)return 0;
  if((a==='piedra'&&b==='tijera')||(a==='papel'&&b==='piedra')||(a==='tijera'&&b==='papel'))return 1;
  return 2;
}

function startTournament(){
  if(tournament||waiting.length<4)return false;
  const ids=waiting.splice(0,4);
  if(ids.length!==4)return false;
  tournament={id:id(),players:ids,roundIndex:0,matches:[],phase:'round',champion:null,createdAt:Date.now()};
  for(let i=0;i<ids.length;i++){
    const p=players.get(ids[i]);
    if(!p){
      console.error('Tournament start aborted: player session missing');
      tournament=null;
      waiting.unshift(...ids.filter(x=>players.has(x)));
      return false;
    }
    p.tournamentId=tournament.id;
    p.seed=i;
    p.wins=0;
    p.losses=0;
    p.lastMatch=null;
  }
  makeRound(tournament);
  console.log('Tournament started:',tournament.id,'players:',ids.length);
  broadcast();
  return true;
}

function finishMatch(m){
  if(!tournament||!m)return;
  const a=players.get(m.a),b=players.get(m.b);
  if(!a||!b)return;
  const r=result(m.moves[m.a],m.moves[m.b]);
  if(r===0){m.moves={};m.draws++;broadcast();return}
  m.winner=r===1?m.a:m.b;
  const loser=r===1?m.b:m.a;
  players.get(m.winner).wins++;
  players.get(loser).losses++;
  a.lastMatch={opponent:b.nickname,result:m.winner===m.a?'win':'loss'};
  b.lastMatch={opponent:a.nickname,result:m.winner===m.b?'win':'loss'};

  if(tournament.matches.every(x=>x.winner)){
    if(tournament.roundIndex<2){
      tournament.roundIndex++;
      makeRound(tournament);
    }else{
      const ranked=tournament.players.slice().sort((x,y)=>{
        const px=players.get(x),py=players.get(y);
        return (py.wins-px.wins)||(px.losses-py.losses)||(px.seed-py.seed);
      });
      tournament.phase='final';
      tournament.matches=[{
        id:id(),round:4,a:ranked[0],b:ranked[1],moves:{},winner:null,draws:0,createdAt:Date.now(),index:0
      }];
    }
  }
  broadcast();
}

function cleanup(){
  const now=Date.now();
  for(const [token,p] of players){
    if(now-p.lastSeen>60000&&(!tournament||!tournament.players.includes(p.id))){
      const i=waiting.indexOf(p.id);
      if(i>=0)waiting.splice(i,1);
      players.delete(token);
      const ws=sockets.get(token);
      sockets.delete(token);
      try{ws?.close()}catch{}
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
  if(p.tournamentId)return res.json({status:'in_game',waiting:waiting.length,activePlayers:activePlayers()});
  if(!waiting.includes(p.id))waiting.push(p.id);
  const started=startTournament();
  const matched=Boolean(tournament&&tournament.players.includes(p.id));
  res.json({
    status:matched?'matched':'waiting',
    position:matched?0:waiting.indexOf(p.id)+1,
    waiting:waiting.length,
    activePlayers:activePlayers(),
    started
  });
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

app.get('/api/health',(_req,res)=>res.json({
  ok:true,players:players.size,activePlayers:activePlayers(),waiting:waiting.length,tournament:Boolean(tournament)
}));

wss.on('connection',(ws,req)=>{
  const url=new URL(req.url,'http://localhost');
  const token=url.searchParams.get('token');
  const p=playerByToken(token);
  if(!p){try{ws.close(1008,'Sesión no válida')}catch{};return}
  const old=sockets.get(token);
  if(old&&old!==ws){try{old.close()}catch{}}
  sockets.set(token,ws);
  sendState(token,ws);
  ws.on('error',err=>console.error('WebSocket client error:',err.message));
  ws.on('close',()=>{if(sockets.get(token)===ws)sockets.delete(token)});
  ws.on('message',raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.type==='ping'){
        const current=playerByToken(token);
        if(current){
          current.lastSeen=Date.now();
          safeSend(ws,{type:'pong',activePlayers:activePlayers()});
        }
      }
    }catch(err){console.error('WebSocket message error:',err.message)}
  });
});

process.on('uncaughtException',err=>console.error('Uncaught exception:',err));
process.on('unhandledRejection',err=>console.error('Unhandled rejection:',err));

app.get('{*splat}',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,()=>console.log('Server running on '+PORT+' with WebSocket real-time'));
