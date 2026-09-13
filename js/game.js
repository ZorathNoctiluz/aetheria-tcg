import { supabase,typeNames,phaseNames,escapeHtml } from './config.js'
import { initShell,loadCatalog,invokeFunction,getOpenMatch,showError } from './common.js'

let catalog=null,session=null,match=null,players=[],poller=null
const $=s=>document.querySelector(s)
const roomParam=new URLSearchParams(location.search).get('room')

function cardFromVersion(id){ const version=catalog.cardVersions.find(v=>v.id===id); const card=catalog.cards.find(c=>c.id===version?.card_id); return {version,card} }
function phaseActionLabel(m){
  if(m.phase==='awakening') return 'Resolver Despertar'
  if(m.phase==='resonance') return 'Resolver Ressonância'
  if(m.phase==='preparation'){
    const skip=Number(m.turn_number)===1 && m.active_player_id===m.public_state?.first_player_id
    return skip?'Encerrar Preparação':'Ir para Confronto'
  }
  if(m.phase==='confrontation') return 'Encerrar Confronto'
  if(m.phase==='twilight') return 'Encerrar turno'
  return 'Avançar fase'
}

async function findMatch(){
  if(roomParam){
    const {data,error}=await supabase.from('matches').select('*').eq('room_code',roomParam.toUpperCase()).single(); if(!error&&data)return data
  }
  return getOpenMatch()
}

async function refresh(){
  if(!session||!catalog)return
  const base=await findMatch(); if(!base){ $('#gameRoot').innerHTML='<div class="notice">Nenhuma partida ativa. <a href="./lobby.html">Ir ao lobby</a>.</div>'; return }
  if(base.status!=='active'&&base.status!=='finished'){ location.href='./lobby.html'; return }
  const {data:full,error}=await supabase.from('matches').select('*').eq('id',base.id).single(); if(error)return
  const {data:ps,error:pErr}=await supabase.from('match_players').select('*').eq('match_id',base.id).order('seat'); if(pErr)return
  match=full; players=ps||[]
  await render()
}

async function render(){
  const own=players.find(p=>p.user_id===session.user.id),opp=players.find(p=>p.user_id!==session.user.id); if(!own)return
  const ownHero=catalog.heroes.find(h=>h.id===own.hero_id),oppHero=catalog.heroes.find(h=>h.id===opp?.hero_id)
  $('#roomTitle').textContent=`Sala ${match.room_code}`
  $('#turnNumber').textContent=match.turn_number
  $('#phaseName').textContent=phaseNames[match.phase]||match.phase
  $('#selfHeroName').textContent=ownHero?.name||'—'; $('#selfLife').textContent=own.life; $('#selfShield').textContent=own.shield; $('#selfEther').textContent=`${own.ether_available}/${own.ether_capacity}`; $('#selfReserve').textContent=own.reserve
  $('#oppHeroName').textContent=oppHero?.name||'—'; $('#oppLife').textContent=opp?.life??25; $('#oppShield').textContent=opp?.shield??0; $('#oppHand').textContent=opp?.hand_count??0
  const myTurn=match.active_player_id===session.user.id
  $('#turnOwner').textContent=myTurn?'Seu turno':'Turno do adversário'
  const btn=$('#advancePhaseBtn'); btn.textContent=phaseActionLabel(match); btn.disabled=!myTurn||match.status!=='active'; btn.classList.toggle('hidden',match.status!=='active')
  $('#surrenderBtn').classList.toggle('hidden',match.status!=='active')
  $('#leaveGameBtn').classList.toggle('hidden',match.status!=='finished')
  if(match.status==='finished'){
    const won=match.winner_id===session.user.id
    $('#turnOwner').textContent=won?'Vitória':'Derrota'
    $('#phaseName').textContent='Partida encerrada'
    $('#phaseHelp').textContent=match.public_state?.finish_reason==='surrender'?(won?'O adversário se rendeu.':'Você se rendeu.'):'A partida foi encerrada.'
  }
  $('#phaseHelp').textContent=myTurn?phaseHelp(match.phase):'Aguardando o adversário concluir a fase.'

  const {data:zone}=await supabase.from('match_private_zones').select('*').eq('match_id',match.id).eq('user_id',session.user.id).single()
  renderHand(Array.isArray(zone?.hand)?zone.hand:[])
  $('#deckCount').textContent=own.deck_count
  $('#rearEtherText').textContent=zone?.rear_ether_available?(zone.rear_ether_unlocked?'✨ Ether de Retaguarda desbloqueado':'✨ Ether de Retaguarda reservado — libera na 2ª Ressonância'):''
  await renderEvents()
}

function phaseHelp(p){
  if(p==='awakening')return 'Resolva a compra de 1 carta. Se o deck estiver vazio, Esgotamento será aplicado.'
  if(p==='resonance')return 'Sua capacidade de Ether aumenta em +1 e o Ether normal é recarregado.'
  if(p==='preparation')return 'Fase principal. Invocação e uso de cartas serão liberados na próxima implementação.'
  if(p==='confrontation')return 'Fase de ataques. O combate será habilitado na próxima implementação.'
  if(p==='twilight')return 'Efeitos finais são resolvidos e o turno passa ao adversário.'
  return ''
}

function renderHand(hand){
  const grid=$('#handGrid');grid.innerHTML='';$('#handCount').textContent=hand.length
  for(const id of hand){const {version,card}=cardFromVersion(id);if(!version||!card)continue;const a=document.createElement('article');a.className='hand-card';a.innerHTML=`<div class="hand-card-art"><strong>${card.code}</strong><strong>◈ ${version.ether_cost}</strong></div><div class="hand-card-body"><span class="hand-meta">${typeNames[card.card_type]}</span><h4>${escapeHtml(card.name)}</h4><div class="hand-stats">${card.card_type==='unit'?`ATQ ${version.attack} • VIDA ${version.health}`:''}</div><p>${escapeHtml(version.rules_text)}</p></div>`;grid.appendChild(a)}
}

async function renderEvents(){
  const {data}=await supabase.from('match_events').select('*').eq('match_id',match.id).order('sequence_no',{ascending:false}).limit(8)
  const list=$('#eventLog');list.innerHTML=''
  for(const e of data||[]){const li=document.createElement('li');li.textContent=eventText(e);list.appendChild(li)}
}
function eventText(e){
  if(e.event_type==='draw')return `Compra realizada • mão ${e.payload?.hand_count} • deck ${e.payload?.deck_count}`
  if(e.event_type==='resonance')return `Ressonância • capacidade de Ether ${e.payload?.ether_capacity}`
  if(e.event_type==='turn_ended')return `Turno encerrado • próximo turno ${e.payload?.next_turn_number}`
  if(e.event_type==='fatigue')return `Esgotamento causou ${e.payload?.damage} de dano.`
  if(e.event_type==='surrender')return e.actor_user_id===session?.user?.id?'Você se rendeu.':'O adversário se rendeu.'
  return `${e.event_type}: ${phaseNames[e.payload?.to]||e.payload?.to||''}`
}

$('#advancePhaseBtn').addEventListener('click',async()=>{
  if(!match)return
  const btn=$('#advancePhaseBtn');btn.disabled=true
  try{await invokeFunction('game-action',{action:'advance_phase',room_code:match.room_code});await refresh()}catch(e){$('#gameMessage').textContent=e.message}finally{btn.disabled=false}
})


$('#surrenderBtn').addEventListener('click',async()=>{
  if(!match||match.status!=='active')return
  if(!confirm('Render-se desta partida? Isso encerra a partida imediatamente e concede a vitória ao adversário.'))return
  const btn=$('#surrenderBtn');btn.disabled=true
  try{
    await invokeFunction('room-control',{action:'surrender',room_code:match.room_code})
    await refresh()
  }catch(e){$('#gameMessage').textContent=e.message}finally{btn.disabled=false}
})

function startPolling(){if(poller)clearInterval(poller);refresh();poller=setInterval(refresh,1800)}
await initShell({requireAuth:true,onAuthChange:s=>{session=s;if(s&&catalog)startPolling()}})
try{catalog=await loadCatalog();$('#versionBadge').textContent=catalog.gameVersion?.name||'Playtest';const {data:{session:s}}=await supabase.auth.getSession();session=s;if(s)startPolling()}catch(e){showError('#gameRoot',e)}
