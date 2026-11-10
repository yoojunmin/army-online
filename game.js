(() => {
  'use strict';
  const socket = io();
  const canvas = document.querySelector('#battle');
  const ctx = canvas.getContext('2d');
  const W = 900, H = 640;
  const $ = s => document.querySelector(s);
  const colors = ['#a9f36b', '#65b8ff', '#ff786d', '#e8b75d'];
  const names = ['돌격 보병', '중전차', '요격 편대', '수비 분대'];
  const specs = {
    inf: { icon: '♟', cost: 55, hp: 90, speed: 36, range: 30, damage: 13, rate: .8, color: colors[0], desc: '저비용 · 전선 유지' },
    tank: { icon: '▰', cost: 125, hp: 300, speed: 21, range: 44, damage: 36, rate: 1.05, color: '#e5b95e', desc: '중장갑 · 기지 타격' },
    air: { icon: '✦', cost: 105, hp: 110, speed: 53, range: 83, damage: 24, rate: .65, color: colors[1], desc: '고속 편대 · 장거리' },
    guard: { icon: '⬟', cost: 75, hp: 180, speed: 24, range: 34, damage: 16, rate: .9, color: '#c8e897', desc: '수비 특화 · 기지 방어' }
  };
  const basesAt = [{ x: 450, y: 76 }, { x: 825, y: 320 }, { x: 450, y: 564 }, { x: 75, y: 320 }];
  let room = null, myId = null, host = false, players = [], game = null;
  let selected = 'inf', targetSlot = 1, last = 0, acc = 0, toastTimer;

  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 1900); }
  function fmt(t) { return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0'); }
  function log(msg) { if (!game) return; const row = document.createElement('div'); row.innerHTML = `<time>${fmt(game.time)}</time>${msg}`; $('#feed').prepend(row); while ($('#feed').children.length > 5) $('#feed').lastChild.remove(); }
  function renderRoom() {
    $('#lobby').classList.remove('hidden'); $('#roomCode').textContent = room.code;
    $('#createRoom').disabled = true; $('#joinRoom').disabled = true;
    $('#playerList').innerHTML = room.players.map(p => `<div class="playerpill"><i style="background:${p.color}"></i>${escapeHtml(p.name)}${p.id === hostId() ? ' · 방장' : ''}</div>`).join('') + Array.from({ length: 4 - room.players.length }, () => '<div class="playerpill" style="color:#66756f">지휘관 대기 중…</div>').join('');
    const canStart = host && room.players.length >= 2 && room.players.length <= 4;
    $('#start').disabled = !canStart; $('#start').textContent = canStart ? '전투 시작　→' : host ? '친구가 참가할 때까지 대기' : '방장이 전투를 시작할 때까지 대기';
    $('#lobbyHint').textContent = host ? '초대 코드를 친구에게 공유하세요. 2~4명이 모이면 시작할 수 있습니다.' : '방장이 게임을 시작하면 함께 전장에 배치됩니다.';
    players = room.players;
    const select = $('#targetBase'); if (select) {
      const options = players.filter(p => p.id !== myId);
      if (!options.some(p => p.slot === targetSlot) && options.length) targetSlot = options[0].slot;
      select.innerHTML = options.map(p => `<option value="${p.slot}">${escapeHtml(p.name)} 기지 공격</option>`).join('') || '<option value="0">상대 대기 중</option>';
      select.value = String(targetSlot);
    }
  }
  function hostId() { return room?.players?.[0]?.id; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function makeUnits() {
    $('#unitgrid').innerHTML = Object.entries(specs).map(([id, s]) => `<button class="unitcard ${id === selected ? 'selected' : ''}" data-unit="${id}"><span class="icon" style="color:${s.color}">${s.icon}</span><span class="cost">${s.cost} CR</span><b>${names[['inf', 'tank', 'air', 'guard'].indexOf(id)]}</b><small>${s.desc}</small></button>`).join('');
    $('#unitgrid').querySelectorAll('[data-unit]').forEach(b => b.onclick = () => { selected = b.dataset.unit; makeUnits(); renderHud(); });
  }
  function fresh(roomPlayers) {
    return { time: 0, running: true, over: false, winner: null, players: roomPlayers.map(p => ({ ...p, credits: 420, hp: 1300, maxHp: 1300, kills: 0, upgrades: { inf: 0, tank: 0, air: 0, def: 0 }, airCD: 0 })), units: [], shots: [], effects: [] };
  }
  function send(command) { if (!game?.running || game.over) return toast('전투가 진행 중일 때 사용할 수 있습니다'); socket.emit('game:command', command); }
  function act(cmd) {
    if (!game || !host) return;
    const p = game.players.find(x => x.id === cmd.playerId); if (!p || game.over) return;
    if (cmd.action === 'deploy') {
      const s = specs[cmd.type], targetSlot = Number(cmd.target), enemy = game.players.find(x => x.slot === targetSlot);
      if (!s || p.credits < s.cost || !enemy || enemy.id === p.id || enemy.hp <= 0) return;
      p.credits -= s.cost;
      const base = basesAt[p.slot];
      const hp = s.hp * (cmd.type === 'tank' ? 1 + p.upgrades.tank * .18 : 1);
      const spawnX = base.x + (p.slot === 1 ? -42 : p.slot === 3 ? 42 : 0);
      const spawnY = base.y + (p.slot === 0 ? 42 : p.slot === 2 ? -42 : 0);
      game.units.push({ id: Math.random().toString(36).slice(2), owner: p.id, slot: p.slot, type: cmd.type, x: spawnX, y: spawnY, target: targetSlot, hp, max: hp, cool: .2 });
      log(`${escapeHtml(p.name)} · ${names[['inf', 'tank', 'air', 'guard'].indexOf(cmd.type)]} 출격`);
    } else if (cmd.action === 'upgrade') {
      const key = cmd.kind, costs = { inf: 95, tank: 115, air: 120, def: 130 };
      if (!costs[key]) return; const cost = costs[key] + p.upgrades[key] * Math.round(costs[key] * .55); if (p.credits < cost) return;
      p.credits -= cost; p.upgrades[key]++;
      if (key === 'def') { p.maxHp = Math.round(p.maxHp * 1.18); p.hp = Math.min(p.maxHp, p.hp + 190); }
      toast(`${p.name} · 연구 완료`); log(`${escapeHtml(p.name)} · 전력 연구 ${key.toUpperCase()} Lv.${p.upgrades[key]}`);
    } else if (cmd.action === 'airstrike') {
      if (p.credits < 120 || p.airCD > 0) return; const target = game.players.find(x => x.slot === Number(cmd.target)); if (!target || target.id === p.id || target.hp <= 0) return;
      p.credits -= 120; p.airCD = 22; target.hp -= 145 + p.upgrades.air * 24; game.units.filter(u => u.slot === target.slot).forEach(u => u.hp -= 95);
      game.effects.push({ x: basesAt[target.slot].x, y: basesAt[target.slot].y, life: .85, kind: 'blast' }); log(`${escapeHtml(p.name)} · ${escapeHtml(target.name)} 기지에 전술 공습`);
    }
    checkVictory();
    if (game.over) socket.emit('game:state', game);
  }
  function checkVictory() {
    const active = game.players.filter(p => p.hp > 0);
    if (active.length <= 1) { game.over = true; game.running = false; game.winner = active[0]?.id || null; }
  }
  function update(dt) {
    if (!host || !game?.running) return;
    game.time += dt;
    for (const p of game.players) if (p.hp > 0) p.credits += dt * 2.6;
    for (const p of game.players) p.airCD = Math.max(0, p.airCD - dt);
    for (const u of game.units) {
      const spec = specs[u.type], owner = game.players.find(p => p.id === u.owner), target = game.players.find(p => p.slot === u.target);
      if (!owner || !target || owner.hp <= 0 || target.hp <= 0) { u.hp = 0; continue; }
      u.cool -= dt;
      const enemy = game.units.filter(v => v.owner !== u.owner && v.slot === u.target && v.hp > 0 && Math.hypot(v.x-u.x,v.y-u.y) < spec.range + (u.type === 'air' ? 45 : 0)).sort((a,b)=>Math.hypot(a.x-u.x,a.y-u.y)-Math.hypot(b.x-u.x,b.y-u.y))[0];
      const base = basesAt[target.slot], dx = base.x-u.x, dy = base.y-u.y, dist = Math.hypot(dx,dy);
      if (enemy && u.cool <= 0) {
        const power = spec.damage * (1 + (owner.upgrades[u.type] || 0) * (u.type === 'air' ? .28 : .23)); enemy.hp -= power; u.cool = spec.rate;
        game.shots.push({ x:u.x,y:u.y,tx:enemy.x,ty:enemy.y,color:owner.color,life:.18 });
      } else if (!enemy && dist < spec.range + 15 && u.cool <= 0) {
        target.hp -= spec.damage * (1 + (owner.upgrades[u.type] || 0) * .24); u.cool = spec.rate;
        game.shots.push({ x:u.x,y:u.y,tx:base.x,ty:base.y,color:owner.color,life:.2 });
        game.effects.push({ x:base.x,y:base.y,life:.17,kind:'hit' });
      } else if (!enemy && dist > spec.range + 10) { u.x += dx / dist * spec.speed * dt; u.y += dy / dist * spec.speed * dt; }
    }
    game.units = game.units.filter(u => { if (u.hp > 0) return true; const owner=game.players.find(p=>p.id===u.owner);if(owner)owner.kills++;return false; });
    game.shots.forEach(s => s.life -= dt); game.shots = game.shots.filter(s => s.life > 0);
    game.effects.forEach(f => f.life -= dt); game.effects = game.effects.filter(f => f.life > 0);
    checkVictory();
  }
  function renderHud() {
    if (!game) return;
    const me=game.players.find(p=>p.id===myId); if (!me) return;
    $('#credits').innerHTML=`${Math.floor(me.credits)}<span>CR</span>`;$('#clock').textContent=fmt(game.time);$('#kills').innerHTML=`${me.kills}<span>UNIT</span>`;$('#wave').innerHTML=`${game.players.filter(p=>p.hp>0).length}<span> / ${game.players.length} 기지 생존</span>`;
    $('#phase').textContent=game.over? (game.winner===myId?'승리 · 전장 장악':'전투 종료'):game.running?'실시간 교전 중':'전투 대기';
    $('#pauseBtn').textContent=me.name+' · '+(game.players.find(p=>p.slot===targetSlot)?.name||'목표 선택');
    $('#deploy').textContent=`${names[['inf','tank','air','guard'].indexOf(selected)]} 출격　→　${specs[selected].cost} CR`;$('#deploy').disabled=me.credits<specs[selected].cost;
    $('#airstrike').textContent=me.airCD>0?`✦ 공습 재정비 ${Math.ceil(me.airCD)}초`:'✦ 전술 공습　120 CR';$('#airstrike').disabled=me.credits<120||me.airCD>0;
    $('#ourTowers').innerHTML=game.players.map(p=>`<div class="tower"><div class="towerlabel"><span style="color:${p.color}">${escapeHtml(p.name)}${p.id===myId?' · 내 기지':''}</span><span>${Math.max(0,Math.ceil(p.hp))} / ${p.maxHp}</span></div><div class="bar ${p.id===myId?'':'enemy'}"><i style="width:${Math.max(0,p.hp/p.maxHp*100)}%;background:${p.color}"></i></div></div>`).join('');
    const upgrades=[['inf','♟','보병 교리',95],['air','✦','항공 전술',120],['tank','▰','기갑 강화',115],['def','⬡','기지 방어',130]];
    $('#upgrades').innerHTML=upgrades.map(([id,ico,title,cost])=>`<div class="upgrade"><div class="upicon">${ico}</div><div class="upcopy"><b>${title} <span style="color:var(--mint)">Lv.${me.upgrades[id]}</span></b><small>전력 향상 · 다음 ${cost+me.upgrades[id]*Math.round(cost*.55)} CR</small></div><button class="buy" data-up="${id}">연구</button></div>`).join('');$('#upgrades').querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>send({action:'upgrade',kind:b.dataset.up}));
    $('#intel').innerHTML=`내 기지 <strong style="color:${me.color}">${escapeHtml(me.name)}</strong><br>공격 목표 <strong>${escapeHtml(game.players.find(p=>p.slot===targetSlot)?.name||'선택')}</strong><br><span style="color:#74847c">지도에서 다른 기지를 눌러 목표를 변경할 수 있습니다.</span>`;
    if(game.over&&!$('#result').classList.contains('showing')) { $('#resultTitle').textContent=game.winner===myId?'전장 장악. 승리!':'기지 함락';$('#resultTitle').style.color=game.winner===myId?'var(--mint)':'var(--red)';$('#resultText').textContent=game.winner===myId?'모든 적 진영의 기지를 파괴했습니다. 전장을 차지했습니다.':'내 기지가 파괴되어 작전에서 탈락했습니다.';$('#finalKills').textContent=me.kills;$('#finalTime').textContent=fmt(game.time);$('#finalWave').textContent=game.players.filter(p=>p.hp>0).length;$('#result').classList.add('showing');$('#result').classList.remove('hidden'); }
  }
  function draw() {
    ctx.clearRect(0,0,W,H);const grad=ctx.createLinearGradient(0,0,W,H);grad.addColorStop(0,'#182a22');grad.addColorStop(.5,'#14241f');grad.addColorStop(1,'#1e2a20');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
    ctx.globalAlpha=.11;for(let i=0;i<150;i++){ctx.fillStyle=i%3?'#c1d3a5':'#769182';ctx.beginPath();ctx.arc((i*137)%W,(i*83)%H,1+i%2,0,7);ctx.fill()}ctx.globalAlpha=1;
    ctx.strokeStyle='#91a58b';ctx.globalAlpha=.12;for(let i=0;i<12;i++){ctx.beginPath();for(let x=0;x<=W;x+=20){let y=30+i*52+Math.sin(x*.017+i)*15+Math.cos(x*.033+i)*7;x?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}ctx.globalAlpha=1;
    ctx.fillStyle='#8ca28c12';ctx.beginPath();ctx.moveTo(148,112);ctx.lineTo(752,112);ctx.lineTo(752,528);ctx.lineTo(148,528);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#9bb18d36';ctx.lineWidth=2;ctx.setLineDash([5,9]);for(const p of players){const a=basesAt[p.slot];for(const q of players){if(q.slot>p.slot){const b=basesAt[q.slot];ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}}ctx.setLineDash([]);ctx.lineWidth=1;
    if(game)for(const p of game.players)drawBase(p);
    if(game)for(const u of game.units)drawUnit(u);
    if(game)for(const s of game.shots){ctx.strokeStyle=s.color;ctx.globalAlpha=.9;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.lineTo(s.tx,s.ty);ctx.stroke();ctx.lineWidth=1;ctx.globalAlpha=1}
    if(game)for(const f of game.effects){ctx.strokeStyle=f.kind==='blast'?'#ffd06a':'#fff2c2';ctx.globalAlpha=Math.max(0,f.life);ctx.beginPath();ctx.arc(f.x,f.y,(f.kind==='blast'?42:10)*(1.3-f.life),0,7);ctx.stroke();ctx.globalAlpha=1}
    ctx.fillStyle='#c8d0c3';ctx.globalAlpha=.55;ctx.font='10px IBM Plex Mono';ctx.fillText('IRON FRONT  /  FOUR CORNERS',24,620);ctx.fillText('CLICK A BASE TO SET ATTACK TARGET',650,620);ctx.globalAlpha=1;
  }
  function drawBase(p) {
    const {x,y}=basesAt[p.slot];ctx.save();ctx.translate(x,y);ctx.fillStyle=p.hp>0?p.color+'35':'#343a37';ctx.strokeStyle=p.color;ctx.lineWidth=p.id===myId?2.5:1.5;ctx.fillRect(-36,-29,72,58);ctx.strokeRect(-36,-29,72,58);
    ctx.fillStyle=p.hp>0?p.color:'#68716b';ctx.fillRect(-13,-18,26,25);ctx.fillRect(-4,-30,8,14);ctx.fillRect(-3,7,6,13);ctx.globalAlpha=.5;ctx.fillRect(-30,-5,12,10);ctx.fillRect(18,-5,12,10);ctx.globalAlpha=1;
    ctx.fillStyle='#0c1513';ctx.fillRect(-32,36,64,4);ctx.fillStyle=p.color;ctx.fillRect(-32,36,64*Math.max(0,p.hp/p.maxHp),4);ctx.textAlign='center';ctx.fillStyle=p.color;ctx.font='bold 11px Noto Sans KR';ctx.fillText(p.name+(p.id===myId?' · YOU':''),0,55);ctx.fillStyle='#9eaba1';ctx.font='9px IBM Plex Mono';ctx.fillText(`BASE ${String(p.slot+1).padStart(2,'0')} · ${Math.max(0,Math.ceil(p.hp))}`,0,69);ctx.restore();
  }
  function drawUnit(u) {
    const s=specs[u.type],owner=game.players.find(p=>p.id===u.owner);ctx.save();ctx.translate(u.x,u.y);ctx.fillStyle=owner.color;ctx.shadowColor=owner.color;ctx.shadowBlur=u.type==='air'?14:6;
    if(u.type==='tank'){ctx.fillRect(-11,-5,22,10);ctx.fillStyle='#637966';ctx.fillRect(-6,-9,12,5);ctx.fillRect(2,-11,11,2);ctx.fillStyle='#303a36';ctx.fillRect(-12,5,24,3)}else if(u.type==='air'){ctx.beginPath();ctx.moveTo(0,-11);ctx.lineTo(4,1);ctx.lineTo(14,7);ctx.lineTo(2,5);ctx.lineTo(0,12);ctx.lineTo(-2,5);ctx.lineTo(-14,7);ctx.lineTo(-4,1);ctx.closePath();ctx.fill()}else{ctx.beginPath();ctx.arc(0,-4,4,0,7);ctx.fill();ctx.fillRect(-3,0,6,10);ctx.fillRect(-6,1,3,6);ctx.fillRect(3,1,3,6);ctx.fillRect(-3,9,2,6);ctx.fillRect(1,9,2,6)}ctx.shadowBlur=0;ctx.fillStyle='#15201b';ctx.fillRect(-10,-16,20,2);ctx.fillStyle=owner.color;ctx.fillRect(-10,-16,20*Math.max(0,u.hp/u.max),2);ctx.restore();
  }
  function hostLoop(ts) { const dt=Math.min((ts-last)/1000||0,.05);last=ts;if(host&&game?.running){update(dt);acc+=dt;if(game.over||acc>.1){socket.emit('game:state',game);acc=0}}requestAnimationFrame(hostLoop); }
  function initGame(roomInfo) {
    players=roomInfo.players;game=fresh(players);$('#intro').classList.add('hidden');$('#result').classList.add('hidden');$('#result').classList.remove('showing');$('#feed').innerHTML='';targetSlot=players.find(p=>p.id!==myId)?.slot ?? 0;renderRoom();renderHud();toast('전투 시작 · 내 기지를 지키세요');
  }

  $('#createRoom').onclick=()=>{const name=$('#playerName').value.trim()||'사령관';socket.emit('room:create',{name});};
  $('#joinRoom').onclick=()=>{const name=$('#playerName').value.trim()||'사령관';socket.emit('room:join',{name,code:$('#joinCode').value});};
  $('#copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(room.code);toast('초대 코드 복사 완료')}catch{toast('초대 코드: '+room.code)}};
  $('#start').onclick=()=>socket.emit('game:start');
  $('#deploy').onclick=()=>send({action:'deploy',type:selected,target:targetSlot});
  $('#airstrike').onclick=()=>send({action:'airstrike',target:targetSlot});
  $('#targetBase').onchange=e=>{targetSlot=Number(e.target.value);renderHud();};
  $('#pauseBtn').onclick=()=>toast('멀티플레이 진행 중에는 전투를 일시 정지할 수 없습니다.');
  $('#restart').onclick=()=>location.reload();
  canvas.addEventListener('click',e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*W/r.width,y=(e.clientY-r.top)*H/r.height;let closest=null,dist=58;players.forEach(p=>{const b=basesAt[p.slot],d=Math.hypot(x-b.x,y-b.y);if(d<dist){closest=p;dist=d}});if(closest&&closest.id!==myId){targetSlot=closest.slot;$('#targetBase').value=String(targetSlot);renderHud();toast(closest.name+' 기지를 공격 목표로 지정');}});
  socket.on('room:joined',data=>{room=data;myId=data.playerId;host=data.host;$('#lobbyError').textContent='';renderRoom();});
  socket.on('room:update',data=>{if(!room)return;room={...room,...data};players=data.players;host=players[0]?.id===myId;renderRoom();});
  socket.on('room:error',message=>$('#lobbyError').textContent=message);
  socket.on('game:start',data=>{room=data;host=room.players[0]?.id===myId;initGame(data);});
  socket.on('game:command',({playerId,command})=>act({...command,playerId}));
  socket.on('game:state',snapshot=>{if(!host){game=snapshot;players=snapshot.players;renderHud();}});
  socket.on('game:resume',snapshot=>{host=true;game=snapshot;players=snapshot.players;renderHud();toast('전투 방장 권한을 이어받았습니다.');});
  socket.on('game:notice',toast);
  socket.on('connect_error',()=>$('#lobbyError').textContent='게임 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
  makeUnits();requestAnimationFrame(hostLoop);
  (function paint(){draw();requestAnimationFrame(paint)})();
  setInterval(renderHud,500);
})();
