import { supabase,typeNames,phaseNames,escapeHtml } from './config.js'
import { initShell,loadCatalog,invokeFunction,getOpenMatch,showError } from './common.js'

let catalog=null,session=null,match=null,players=[],boardRows=[],poller=null,currentZone=null
let selectedPlacement=null,selectedAttacker=null,actionBusy=false
const $=s=>document.querySelector(s)
const roomParam=new URLSearchParams(location.search).get('room')

function cardFromVersion(id){
  const version=catalog.cardVersions.find(v=>v.id===id)
  const card=catalog.cards.find(c=>c.id===version?.card_id)
  return {version,card}
}
function keywordValue(keywords,key){
  if(!Array.isArray(keywords))return 0
  for(const item of keywords){
    if(typeof item==='string'&&item===key)return 1
    if(item&&typeof item==='object'&&item.key===key)return Number(item.value??1)
  }
  return 0
}
function keywordBadgesFromVersion(version){
  if(!version)return ''
  const badges=[]
  if(keywordValue(version.keywords,'guardiao'))badges.push('<span class="keyword-badge guardiao">🛡 Guardião</span>')
  if(keywordValue(version.keywords,'impeto'))badges.push('<span class="keyword-badge impeto">⚡ Ímpeto</span>')
  const regen=keywordValue(version.keywords,'regeneracao')
  if(regen)badges.push(`<span class="keyword-badge regeneracao">♻ Regeneração ${regen}</span>`)
  return badges.join('')
}
function keywordBadgesFromBoard(row,version,hero){
  const state=row?.state||{}
  const badges=[]
  const guardiao=Boolean(state.has_guardiao)||keywordValue(version?.keywords,'guardiao')>0
  const impeto=Boolean(state.has_impeto)||keywordValue(version?.keywords,'impeto')>0||hero?.ability_spec?.keywords?.includes?.('impeto')
  const regen=Number(state.regeneration??keywordValue(version?.keywords,'regeneracao')??0)
  if(guardiao)badges.push('<span class="keyword-badge guardiao">🛡 Guardião</span>')
  if(impeto)badges.push('<span class="keyword-badge impeto">⚡ Ímpeto</span>')
  if(regen)badges.push(`<span class="keyword-badge regeneracao">♻ Regeneração ${regen}</span>`)
  if(regen&&state.regen_eligible)badges.push('<span class="keyword-badge ready">Pronta para regenerar</span>')
  return badges.join('')
}
function entryEffectSummary(effects=[]){
  const parts=[]
  for(const effect of effects||[]){
    if(effect.effect==='grant_shield'){
      const bonus=Number(effect.passive_bonus||0)
      parts.push(`+${Number(effect.gained||0)} Escudo${bonus?` (Voto +${bonus})`:''}`)
    }
    if(effect.effect==='heal_receptacle')parts.push(`+${Number(effect.healed||0)} Vida`)
  }
  return parts.filter(x=>!x.startsWith('+0 ')).join(' • ')
}
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
    const {data,error}=await supabase.from('matches').select('*').eq('room_code',roomParam.toUpperCase()).single()
    if(!error&&data)return data
  }
  return getOpenMatch()
}

async function refresh(){
  if(!session||!catalog)return
  const base=await findMatch()
  if(!base){ $('#gameRoot').innerHTML='<div class="notice">Nenhuma partida ativa. <a href="./lobby.html">Ir ao lobby</a>.</div>'; return }
  if(base.status!=='active'&&base.status!=='finished'){ location.href='./lobby.html'; return }
  const [matchRes,playersRes,boardRes]=await Promise.all([
    supabase.from('matches').select('*').eq('id',base.id).single(),
    supabase.from('match_players').select('*').eq('match_id',base.id).order('seat'),
    supabase.from('match_board_cards').select('*').eq('match_id',base.id).order('slot_index')
  ])
  if(matchRes.error||playersRes.error||boardRes.error)return
  match=matchRes.data; players=playersRes.data||[]; boardRows=boardRes.data||[]
  await render()
}

async function render(){
  const own=players.find(p=>p.user_id===session.user.id)
  const opp=players.find(p=>p.user_id!==session.user.id)
  if(!own)return
  const ownHero=catalog.heroes.find(h=>h.id===own.hero_id)
  const oppHero=catalog.heroes.find(h=>h.id===opp?.hero_id)
  if(match.phase!=='confrontation'||match.status!=='active')selectedAttacker=null

  $('#roomTitle').textContent=`Sala ${match.room_code}`
  $('#turnNumber').textContent=match.turn_number
  $('#phaseName').textContent=phaseNames[match.phase]||match.phase
  $('#selfHeroName').textContent=ownHero?.name||'—'
  $('#selfLife').textContent=`${own.life}/${own.max_life??25}`
  $('#selfShield').textContent=own.shield
  $('#selfEther').textContent=`${own.ether_available}/${own.ether_capacity}`
  $('#selfReserve').textContent=own.reserve
  $('#oppHeroName').textContent=oppHero?.name||'—'
  $('#oppLife').textContent=`${opp?.life??25}/${opp?.max_life??25}`
  $('#oppShield').textContent=opp?.shield??0
  $('#oppHand').textContent=opp?.hand_count??0

  const myTurn=match.active_player_id===session.user.id
  $('#turnOwner').textContent=myTurn?'Seu turno':'Turno do adversário'
  const btn=$('#advancePhaseBtn')
  btn.textContent=phaseActionLabel(match)
  btn.disabled=!myTurn||match.status!=='active'||actionBusy
  btn.classList.toggle('hidden',match.status!=='active')
  $('#surrenderBtn').classList.toggle('hidden',match.status!=='active')
  $('#leaveGameBtn').classList.toggle('hidden',match.status!=='finished')

  if(match.status==='finished'){
    const won=match.winner_id===session.user.id
    $('#turnOwner').textContent=won?'Vitória':'Derrota'
    $('#phaseName').textContent='Partida encerrada'
    $('#phaseHelp').textContent=match.public_state?.finish_reason==='surrender'?(won?'O adversário se rendeu.':'Você se rendeu.'):'A partida foi encerrada.'
  }else{
    $('#phaseHelp').textContent=myTurn?phaseHelp(match.phase):'Aguardando o adversário concluir a fase.'
  }

  const {data:zone}=await supabase.from('match_private_zones').select('*').eq('match_id',match.id).eq('user_id',session.user.id).single()
  currentZone=zone||null
  renderHand(Array.isArray(zone?.hand)?zone.hand:[],own,myTurn)
  renderBoard(own,opp,myTurn)
  renderCombatControl(own,opp,myTurn)
  renderHeroControl(own,ownHero,myTurn)
  $('#deckCount').textContent=own.deck_count
  $('#rearEtherText').textContent=zone?.rear_ether_available?(zone.rear_ether_unlocked?'✨ Ether de Retaguarda desbloqueado':'✨ Ether de Retaguarda reservado — libera na 2ª Ressonância'):''
  renderPlacementHint(myTurn)
  await renderEvents()
}

function phaseHelp(p){
  if(p==='awakening')return 'Resolva a compra de 1 carta. Se o deck estiver vazio, Esgotamento será aplicado.'
  if(p==='resonance')return 'Ether é recarregado e Unidades elegíveis com Regeneração recuperam Vida.'
  if(p==='preparation')return 'Fase principal: jogue Unidades e invoque seu Herói. Guardião, Ímpeto e efeitos simples de entrada já são reconhecidos pela engine.'
  if(p==='confrontation')return 'Escolha uma peça apta para atacar e depois um alvo. Guardião restringe os alvos; Ímpeto permite atacar no turno em que a peça entrou.'
  if(p==='twilight')return 'Efeitos finais são resolvidos e o turno passa ao adversário.'
  return ''
}

function canPayUnit(version,own){
  const cost=Number(version?.ether_cost??0)
  let total=Number(own.ether_available??0)+Number(own.reserve??0)
  if(currentZone?.rear_ether_available&&currentZone?.rear_ether_unlocked&&cost<=Number(own.ether_capacity??0)) total+=1
  return total>=cost
}
function canPayHero(own){
  const cost=5+(Number(own.hero_summons??0)*3)
  return Number(own.ether_available??0)+Number(own.reserve??0)>=cost
}
function heroOnBoard(own){return boardRows.some(r=>r.owner_user_id===own.user_id&&r.hero_id===own.hero_id&&(r.zone==='hero'||r.zone==='unit'))}
function openSlots(userId){
  const occupied=new Set(boardRows.filter(r=>r.owner_user_id===userId&&(r.zone==='unit'||r.zone==='hero')).map(r=>Number(r.slot_index)))
  return [0,1,2,3,4].filter(i=>!occupied.has(i))
}

function boardHasImpeto(row){
  if(!row)return false
  if(row.state?.has_impeto)return true
  if(row.hero_id){const hero=catalog.heroes.find(h=>h.id===row.hero_id);return Boolean(hero?.ability_spec?.keywords?.includes?.('impeto'))}
  const {version}=cardFromVersion(row.card_version_id);return keywordValue(version?.keywords,'impeto')>0
}
function canAttackRow(row){
  if(!row||match.phase!=='confrontation'||match.status!=='active')return false
  if(Number(row.last_attack_turn)===Number(match.turn_number))return false
  const entered=Number(row.state?.summoned_turn??-1)===Number(match.turn_number)
  if(entered&&!boardHasImpeto(row))return false
  return true
}
function combatStatus(row){
  if(Number(row.last_attack_turn)===Number(match.turn_number))return 'ATACOU'
  const entered=Number(row.state?.summoned_turn??-1)===Number(match.turn_number)
  if(entered&&!boardHasImpeto(row))return 'SEM ÍMPETO'
  return 'PRONTO'
}
function fieldRows(userId){return boardRows.filter(r=>r.owner_user_id===userId&&(r.zone==='unit'||r.zone==='hero'))}
function boardHasGuardiao(row){
  if(!row)return false
  if(row.state?.has_guardiao)return true
  if(row.hero_id)return false
  const {version}=cardFromVersion(row.card_version_id)
  return keywordValue(version?.keywords,'guardiao')>0
}
function guardRows(userId){return fieldRows(userId).filter(boardHasGuardiao)}
function validCombatTarget(row,defenderId){const guards=guardRows(defenderId);return guards.length===0||guards.some(g=>g.id===row.id)}

function renderHand(hand,own,myTurn){
  const grid=$('#handGrid');grid.innerHTML='';$('#handCount').textContent=hand.length
  const preparation=myTurn&&match.status==='active'&&match.phase==='preparation'
  for(const id of hand){
    const {version,card}=cardFromVersion(id);if(!version||!card)continue
    const playable=preparation&&card.card_type==='unit'&&canPayUnit(version,own)&&openSlots(own.user_id).length>0
    const selected=selectedPlacement?.type==='unit'&&selectedPlacement.cardVersionId===version.id
    const a=document.createElement('article')
    a.className=`hand-card${playable?' playable':''}${selected?' selected':''}`
    a.innerHTML=`<div class="hand-card-art"><strong>${card.code}</strong><strong>◈ ${version.ether_cost}</strong></div><div class="hand-card-body"><span class="hand-meta">${typeNames[card.card_type]}</span><h4>${escapeHtml(card.name)}</h4><div class="hand-stats">${card.card_type==='unit'?`ATQ ${version.attack} • VIDA ${version.health}`:''}</div><div class="keyword-row">${keywordBadgesFromVersion(version)}</div><p>${escapeHtml(version.rules_text)}</p><div class="hand-card-actions">${card.card_type==='unit'?`<button class="btn ${selected?'primary':'ghost'} play-unit-btn" data-version="${version.id}" ${playable?'':'disabled'}>${selected?'Selecionada':'Jogar'}</button>`:'<span class="coming-soon">Uso em breve</span>'}</div></div>`
    grid.appendChild(a)
  }
  grid.querySelectorAll('.play-unit-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const id=btn.dataset.version
    const {card}=cardFromVersion(id)
    selectedPlacement={type:'unit',cardVersionId:id,name:card?.name||'Unidade'}
    render()
  }))
}

function renderHeroControl(own,hero,myTurn){
  const cost=5+(Number(own.hero_summons??0)*3)
  const onBoard=heroOnBoard(own)
  const preparation=myTurn&&match.status==='active'&&match.phase==='preparation'
  const btn=$('#heroSummonBtn')
  const selected=selectedPlacement?.type==='hero'
  $('#heroSummonCost').textContent=onBoard?'Em campo':`Custo atual: ◈ ${cost}`
  btn.textContent=onBoard?'Herói em campo':selected?'Herói selecionado':`Invocar ${hero?.name||'Herói'}`
  btn.disabled=onBoard||!preparation||!canPayHero(own)||openSlots(own.user_id).length===0||actionBusy
  btn.classList.toggle('primary',selected&&!onBoard)
  btn.classList.toggle('ghost',!selected||onBoard)
  btn.onclick=()=>{
    if(btn.disabled)return
    selectedPlacement={type:'hero',name:hero?.name||'Herói'}
    render()
  }
}

function pieceName(row){
  if(row.hero_id){const hero=catalog.heroes.find(h=>h.id===row.hero_id);return hero?.name||'Herói'}
  const {card}=cardFromVersion(row.card_version_id);return card?.name||'Unidade'
}
function renderBoard(own,opp,myTurn){
  renderBoardSide($('#oppBoardSlots'),opp?.user_id,false,myTurn)
  renderBoardSide($('#selfBoardSlots'),own.user_id,true,myTurn)
}
function renderBoardSide(container,userId,isOwn,myTurn){
  container.innerHTML=''
  const rows=fieldRows(userId)
  for(let i=0;i<5;i++){
    const row=rows.find(r=>Number(r.slot_index)===i)
    const slot=document.createElement('button')
    slot.type='button';slot.className='board-slot';slot.dataset.slot=String(i)
    if(row){
      slot.classList.add('occupied')
      const status=isOwn&&match.phase==='confrontation'?`<span class="combat-state ${combatStatus(row).toLowerCase().replace(' ','-')}">${combatStatus(row)}</span>`:''
      if(row.hero_id){
        const hero=catalog.heroes.find(h=>h.id===row.hero_id)
        const badges=keywordBadgesFromBoard(row,null,hero)
        slot.innerHTML=`<span class="piece-type">HERÓI</span><strong>${escapeHtml(hero?.name||'Herói')}</strong><small>ATQ ${row.current_attack} • VIDA ${row.current_health}/${row.max_health??row.current_health}</small><div class="piece-keywords">${badges}</div>${status}`
      }else{
        const {card,version}=cardFromVersion(row.card_version_id)
        const badges=keywordBadgesFromBoard(row,version,null)
        slot.innerHTML=`<span class="piece-type">${escapeHtml(card?.code||'UNIDADE')}</span><strong>${escapeHtml(card?.name||'Unidade')}</strong><small>ATQ ${row.current_attack} • VIDA ${row.current_health}/${row.max_health??row.current_health}</small><div class="piece-keywords">${badges}</div>${status}`
      }
      slot.disabled=true
      if(myTurn&&match.phase==='confrontation'&&match.status==='active'&&!actionBusy){
        if(isOwn){
          if(selectedAttacker?.id===row.id){
            slot.disabled=false;slot.classList.add('attacker-selected');slot.addEventListener('click',()=>{selectedAttacker=null;render()})
          }else if(!selectedAttacker&&canAttackRow(row)){
            slot.disabled=false;slot.classList.add('attacker-ready');slot.addEventListener('click',()=>{selectedAttacker={id:row.id,name:pieceName(row)};render()})
          }
        }else if(selectedAttacker&&validCombatTarget(row,userId)){
          slot.disabled=false;slot.classList.add('targetable');slot.addEventListener('click',()=>attackPiece(row))
        }else if(selectedAttacker){
          slot.classList.add('blocked-target')
        }
      }
    }else{
      slot.innerHTML=`<span class="slot-number">${i+1}</span><small>Slot vazio</small>`
      const canChoose=isOwn&&myTurn&&match.phase==='preparation'&&selectedPlacement&&!actionBusy
      slot.disabled=!canChoose
      if(canChoose)slot.classList.add('selectable')
      if(canChoose)slot.addEventListener('click',()=>placeSelected(i))
    }
    container.appendChild(slot)
  }
}
function renderCombatControl(own,opp,myTurn){
  const btn=$('#attackReceptacleBtn'),text=$('#receptacleGuardText')
  const defenders=fieldRows(opp?.user_id)
  const confrontation=myTurn&&match.status==='active'&&match.phase==='confrontation'
  const canDirect=confrontation&&selectedAttacker&&defenders.length===0&&!actionBusy
  btn.classList.toggle('hidden',!canDirect)
  btn.disabled=!canDirect
  if(match.phase!=='confrontation'||match.status!=='active'){text.textContent='';return}
  if(defenders.length>0){
    const guards=guardRows(opp?.user_id)
    text.textContent=guards.length?`${guards.length} Guardião(ões) protegendo o campo.`:`Receptáculo protegido por ${defenders.length} peça(s).`
  }else if(selectedAttacker){text.textContent='Campo livre: o Receptáculo pode ser atacado.'}
  else{text.textContent='O Receptáculo fica vulnerável quando não houver peças no campo.'}
}
async function attackPiece(row){
  if(!selectedAttacker||actionBusy)return
  actionBusy=true;$('#gameMessage').textContent='Resolvendo combate...'
  try{
    const {data,error}=await supabase.rpc('resolve_combat',{p_room_code:match.room_code,p_attacker_id:selectedAttacker.id,p_target_type:'piece',p_target_id:row.id})
    if(error)throw error
    const bonus=Number(data?.warrior_bonus||0)
    $('#gameMessage').textContent=`${data?.attacker||'Atacante'} atacou ${data?.target||'alvo'}: ${data?.attacker_damage||0} x ${data?.defender_damage||0}${bonus?' • Instinto de Duelo +1 ATQ':''}.`
    selectedAttacker=null;await refresh()
  }catch(e){$('#gameMessage').textContent=e.message}
  finally{actionBusy=false}
}
async function attackReceptacle(){
  if(!selectedAttacker||actionBusy)return
  actionBusy=true;$('#gameMessage').textContent='Atacando Receptáculo...'
  try{
    const {data,error}=await supabase.rpc('resolve_combat',{p_room_code:match.room_code,p_attacker_id:selectedAttacker.id,p_target_type:'receptacle',p_target_id:null})
    if(error)throw error
    $('#gameMessage').textContent=`${data?.attacker||'Atacante'} causou ${data?.life_damage||0} de dano à Vida${Number(data?.shield_absorbed||0)?` e removeu ${data.shield_absorbed} de Escudo`:''}.`
    selectedAttacker=null;await refresh()
  }catch(e){$('#gameMessage').textContent=e.message}
  finally{actionBusy=false}
}

async function placeSelected(slotIndex){
  if(!selectedPlacement||actionBusy)return
  actionBusy=true
  $('#gameMessage').textContent='Processando jogada...'
  try{
    const payload=selectedPlacement.type==='unit'
      ?{action:'play_unit',room_code:match.room_code,slot_index:slotIndex,card_version_id:selectedPlacement.cardVersionId}
      :{action:'summon_hero',room_code:match.room_code,slot_index:slotIndex}
    const result=await invokeFunction('play-piece',payload)
    if(selectedPlacement.type==='unit'){
      const effects=entryEffectSummary(result.entry_effects)
      $('#gameMessage').textContent=`${result.card?.name||'Unidade'} entrou no slot ${slotIndex+1}.${effects?` ${effects}.`:''}`
    }else{
      $('#gameMessage').textContent=`${result.hero||'Herói'} foi invocado no slot ${slotIndex+1}.`
    }
    selectedPlacement=null
    await refresh()
  }catch(e){
    $('#gameMessage').textContent=e.message
  }finally{
    actionBusy=false
  }
}

function renderPlacementHint(myTurn){
  const el=$('#placementHint')
  if(match.status!=='active'){el.textContent='';return}
  if(!myTurn){el.textContent='Aguarde seu turno.';return}
  if(match.phase==='preparation'){
    if(selectedPlacement){
      el.innerHTML=`Selecionado: <strong>${escapeHtml(selectedPlacement.name)}</strong>. Escolha um dos slots destacados no seu campo. <button id="cancelPlacement" class="link-button">Cancelar</button>`
      $('#cancelPlacement')?.addEventListener('click',()=>{selectedPlacement=null;render()})
    }else el.textContent='Escolha uma Unidade da mão ou selecione seu Herói; depois escolha um slot vazio.'
    return
  }
  if(match.phase==='confrontation'){
    if(selectedAttacker){
      const guards=guardRows(players.find(p=>p.user_id!==session.user.id)?.user_id)
      el.innerHTML=`Atacante: <strong>${escapeHtml(selectedAttacker.name)}</strong>. ${guards.length?'Escolha um Guardião inimigo.':'Escolha uma peça inimiga ou ataque o Receptáculo se o campo estiver vazio.'} <button id="cancelAttack" class="link-button">Cancelar</button>`
      $('#cancelAttack')?.addEventListener('click',()=>{selectedAttacker=null;render()})
    }else el.textContent='Escolha uma de suas peças destacadas para atacar. Cada peça pode atacar 1 vez por turno.'
    return
  }
  el.textContent='Unidades e Herói são colocados no campo durante a Preparação.'
}

async function renderEvents(){
  const {data}=await supabase.from('match_events').select('*').eq('match_id',match.id).order('sequence_no',{ascending:false}).limit(12)
  const list=$('#eventLog');list.innerHTML=''
  for(const e of data||[]){const li=document.createElement('li');li.textContent=eventText(e);list.appendChild(li)}
}
function eventText(e){
  if(e.event_type==='draw')return `Compra realizada • mão ${e.payload?.hand_count} • deck ${e.payload?.deck_count}`
  if(e.event_type==='resonance'){
    const regs=Array.isArray(e.payload?.regeneration)?e.payload.regeneration:[]
    const healed=regs.reduce((sum,r)=>sum+Number(r.healed||0),0)
    return `Ressonância • capacidade de Ether ${e.payload?.ether_capacity}${regs.length?` • Regeneração em ${regs.length} Unidade(s), ${healed} Vida recuperada`:''}`
  }
  if(e.event_type==='turn_ended')return `Turno encerrado • próximo turno ${e.payload?.next_turn_number}`
  if(e.event_type==='fatigue')return `Esgotamento causou ${e.payload?.damage} de dano.`
  if(e.event_type==='surrender')return e.actor_user_id===session?.user?.id?'Você se rendeu.':'O adversário se rendeu.'
  if(e.event_type==='unit_played'){
    const effects=entryEffectSummary(e.payload?.entry_effects)
    return `${e.payload?.card_name||'Unidade'} entrou no slot ${Number(e.payload?.slot_index??0)+1} • custo ${e.payload?.cost}${effects?` • ${effects}`:''}`
  }
  if(e.event_type==='hero_summoned')return `${e.payload?.hero_name||'Herói'} foi invocado no slot ${Number(e.payload?.slot_index??0)+1} • custo ${e.payload?.cost}`
  if(e.event_type==='combat')return `${e.payload?.attacker_name||'Atacante'} → ${e.payload?.target_name||'Alvo'} • ${e.payload?.attacker_damage||0} x ${e.payload?.defender_damage||0}${Number(e.payload?.warrior_bonus||0)?' • Instinto +1':''}${e.payload?.target_destroyed?' • alvo destruído':''}${e.payload?.attacker_destroyed?' • atacante destruído':''}`
  if(e.event_type==='receptacle_attacked')return `${e.payload?.attacker_name||'Atacante'} atingiu o Receptáculo • ${e.payload?.life_damage||0} Vida${Number(e.payload?.shield_absorbed||0)?` • ${e.payload.shield_absorbed} Escudo absorvido`:''}`
  if(e.event_type==='receptacle_destroyed')return `${e.payload?.attacker_name||'Atacante'} destruiu o Receptáculo e encerrou a partida.`
  return `${e.event_type}: ${phaseNames[e.payload?.to]||e.payload?.to||''}`
}


$('#attackReceptacleBtn').addEventListener('click',attackReceptacle)

$('#advancePhaseBtn').addEventListener('click',async()=>{
  if(!match||actionBusy)return
  const btn=$('#advancePhaseBtn');btn.disabled=true;selectedPlacement=null;selectedAttacker=null
  try{await invokeFunction('game-action',{action:'advance_phase',room_code:match.room_code});await refresh()}catch(e){$('#gameMessage').textContent=e.message}finally{btn.disabled=false}
})

$('#surrenderBtn').addEventListener('click',async()=>{
  if(!match||match.status!=='active'||actionBusy)return
  if(!confirm('Render-se desta partida? Isso encerra a partida imediatamente e concede a vitória ao adversário.'))return
  const btn=$('#surrenderBtn');btn.disabled=true
  try{await invokeFunction('room-control',{action:'surrender',room_code:match.room_code});selectedPlacement=null;selectedAttacker=null;await refresh()}catch(e){$('#gameMessage').textContent=e.message}finally{btn.disabled=false}
})

function startPolling(){if(poller)clearInterval(poller);refresh();poller=setInterval(()=>{if(!actionBusy)refresh()},1800)}
await initShell({requireAuth:true,onAuthChange:s=>{session=s;if(s&&catalog)startPolling()}})
try{
  catalog=await loadCatalog()
  $('#versionBadge').textContent=catalog.gameVersion?.name||'Playtest'
  const {data:{session:s}}=await supabase.auth.getSession();session=s
  if(s)startPolling()
}catch(e){showError('#gameRoot',e)}
