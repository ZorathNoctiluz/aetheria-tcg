import { supabase,icons,escapeHtml } from './config.js'
import { initShell,loadCatalog,invokeFunction,getOpenMatch,showError } from './common.js'

let catalog=null,selectedHero=null,session=null,activeRoom=null,poller=null
const $=s=>document.querySelector(s)

function status(msg,code=''){ $('#lobbyStatusTitle').textContent=msg; $('#roomCodeDisplay').textContent=code; $('#copyRoomBtn').classList.toggle('hidden',!code) }
function updateButtons(){ const ready=Boolean(session&&selectedHero&&!activeRoom); $('#createRoomBtn').disabled=!ready; $('#joinRoomBtn').disabled=!ready }

function renderHeroes(){
  const grid=$('#heroesGrid'); grid.innerHTML=''
  for(const hero of catalog.heroes){
    const rec=catalog.receptacles.find(r=>r.id===hero.receptacle_id)
    const b=document.createElement('button'); b.className='hero-choice'; b.dataset.id=hero.id
    b.innerHTML=`<span>${icons[rec?.slug]||'✦'}</span><strong>${escapeHtml(hero.name)}</strong><small>${escapeHtml(rec?.name||'')}</small>`
    b.addEventListener('click',()=>{ selectedHero=hero; document.querySelectorAll('.hero-choice').forEach(x=>x.classList.toggle('selected',x===b)); status(`Pronto: ${hero.name} selecionado.`); updateButtons() })
    grid.appendChild(b)
  }
}

async function restore(){
  if(!session||activeRoom) return
  const match=await getOpenMatch()
  if(!match) return
  activeRoom={match_id:match.id,room_code:match.room_code,status:match.status,seat:match.seat}
  startPolling()
}

async function checkRoom(){
  if(!activeRoom||!session) return
  const {data:match,error}=await supabase.from('matches').select('*').eq('id',activeRoom.match_id).single(); if(error||!match) return
  const {data:players}=await supabase.from('match_players').select('*').eq('match_id',match.id).order('seat')
  const own=players?.find(p=>p.user_id===session.user.id); if(own) activeRoom.seat=own.seat
  $('#startMatchBtn').classList.add('hidden')
  if(match.status==='waiting'){ status('Sala criada. Aguardando o segundo jogador...',match.room_code); return }
  if(match.status==='ready'){
    if(own?.seat===1){ status('Segundo jogador entrou. Sala pronta.',match.room_code); $('#startMatchBtn').classList.remove('hidden') }
    else status('Sala pronta. Aguardando o host iniciar.',match.room_code)
    return
  }
  if(match.status==='active'){ stopPolling(); location.href=`./game.html?room=${encodeURIComponent(match.room_code)}` }
}
function startPolling(){ stopPolling(); checkRoom(); poller=setInterval(checkRoom,1800); updateButtons() }
function stopPolling(){ if(poller){clearInterval(poller);poller=null} }

$('#createRoomBtn').addEventListener('click',async()=>{
  status('Criando sala...')
  try{ const d=await invokeFunction('lobby',{action:'create_room',hero_slug:selectedHero.slug}); activeRoom={...d,seat:1}; status(`Sala criada com ${d.hero}.`,d.room_code); startPolling() }catch(e){status(`Erro: ${e.message}`)}
})
$('#joinRoomBtn').addEventListener('click',async()=>{
  const room=$('#roomCodeInput').value.trim().toUpperCase(); if(!room){status('Digite o código.');return}
  status('Entrando na sala...')
  try{ const d=await invokeFunction('lobby',{action:'join_room',hero_slug:selectedHero.slug,room_code:room}); activeRoom={...d,seat:2}; status(`Você entrou com ${d.hero}.`,d.room_code); startPolling() }catch(e){status(`Erro: ${e.message}`)}
})
$('#startMatchBtn').addEventListener('click',async()=>{
  if(!activeRoom)return
  status('Iniciando partida...',activeRoom.room_code)
  try{ await invokeFunction('start-match',{room_code:activeRoom.room_code}); await checkRoom() }catch(e){status(`Erro: ${e.message}`,activeRoom.room_code)}
})
$('#copyRoomBtn').addEventListener('click',async()=>{const c=$('#roomCodeDisplay').textContent;if(c){await navigator.clipboard.writeText(c);$('#copyRoomBtn').textContent='Copiado!';setTimeout(()=>$('#copyRoomBtn').textContent='Copiar',1000)}})
$('#roomCodeInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,''))

await initShell({requireAuth:true,onAuthChange:s=>{session=s;updateButtons();if(s)restore()}})
try{ catalog=await loadCatalog(); $('#versionBadge').textContent=catalog.gameVersion?.name||'Playtest'; renderHeroes() }catch(e){showError('#heroesGrid',e)}
