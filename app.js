import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://iphxbbmobdqwlomstbop.supabase.co'
const SUPABASE_KEY = 'sb_publishable_6SIator21VkZhbcdXOB9zA_FV5l99ky'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const state = {
  heroes: [], receptacles: [], skills: [], decks: [], deckCards: [], cardVersions: [], cards: [],
  selectedHero: null, filter: 'all', session: null, activeRoom: null, currentMatch: null,
  matchPlayers: [], poller: null
}
const icons = { paladin:'🛡️', warrior:'⚔️', mage:'🔮', wanderer:'🏹' }
const typeNames = { unit:'Unidade', action:'Ação', equipment:'Equipamento', trap:'Armadilha', terrain:'Terreno' }
const phaseNames = { awakening:'Despertar', resonance:'Ressonância', preparation:'Preparação', confrontation:'Confronto', twilight:'Crepúsculo' }

async function loadCatalog(){
  const [gv, receptacles, skills, heroes, decks, deckCards, cardVersions, cards] = await Promise.all([
    supabase.from('game_versions').select('*').eq('status','playtest').order('created_at',{ascending:false}).limit(1),
    supabase.from('receptacles').select('*').eq('active',true).order('name'),
    supabase.from('skills').select('*').eq('active',true).eq('is_initial',true),
    supabase.from('heroes').select('*').eq('active',true).order('name'),
    supabase.from('starter_decks').select('*').eq('active',true),
    supabase.from('starter_deck_cards').select('*'),
    supabase.from('card_versions').select('*').eq('is_current',true),
    supabase.from('cards').select('*').eq('active',true)
  ])
  const errors = [gv,receptacles,skills,heroes,decks,deckCards,cardVersions,cards].map(x=>x.error).filter(Boolean)
  if(errors.length) throw errors[0]
  $('#versionBadge').textContent = gv.data?.[0]?.name || 'Playtest'
  Object.assign(state,{
    receptacles:receptacles.data, skills:skills.data, heroes:heroes.data, decks:decks.data,
    deckCards:deckCards.data, cardVersions:cardVersions.data, cards:cards.data
  })
  renderHeroes()
}

function renderHeroes(){
  const grid = $('#heroesGrid'); grid.innerHTML = ''
  for(const hero of state.heroes){
    const rec = state.receptacles.find(r=>r.id===hero.receptacle_id)
    const node = $('#heroTemplate').content.cloneNode(true)
    const button = node.querySelector('.hero-card')
    button.dataset.hero = hero.id
    node.querySelector('.hero-icon').textContent = icons[rec?.slug] || '✦'
    node.querySelector('.hero-class').textContent = rec?.name || ''
    node.querySelector('.hero-name').textContent = hero.name
    node.querySelector('.hero-role').textContent = rec?.identity_text || ''
    node.querySelector('.hero-mini-stats').textContent = `ATQ ${hero.attack} • VIDA ${hero.health} • Invocação ${hero.summon_base_cost}`
    button.addEventListener('click',()=>selectHero(hero.id))
    grid.appendChild(node)
  }
}

function selectHero(heroId){
  state.selectedHero = state.heroes.find(h=>h.id===heroId)
  $$('.hero-card').forEach(x=>x.classList.toggle('selected',x.dataset.hero===heroId))
  state.filter = 'all'
  $$('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'))
  renderDeck()
  updateLobbyControls()
  $('#deckSection').classList.remove('hidden')
  $('#deckSection').scrollIntoView({behavior:'smooth',block:'start'})
}

function getSelectedDeckEntries(){
  const hero = state.selectedHero
  if(!hero) return []
  const deck = state.decks.find(d=>d.hero_id===hero.id)
  if(!deck) return []
  return state.deckCards.filter(x=>x.starter_deck_id===deck.id).map(entry=>{
    const version = state.cardVersions.find(v=>v.id===entry.card_version_id)
    const card = state.cards.find(c=>c.id===version?.card_id)
    return { ...entry, version, card }
  }).filter(x=>x.card&&x.version)
}

function renderDeck(){
  const hero = state.selectedHero
  if(!hero) return
  const rec = state.receptacles.find(r=>r.id===hero.receptacle_id)
  const skill = state.skills.find(s=>s.receptacle_id===rec.id)
  const deck = state.decks.find(d=>d.hero_id===hero.id)
  const entries = getSelectedDeckEntries()
  const total = entries.reduce((n,x)=>n+x.quantity,0)
  const units = entries.filter(x=>x.card.card_type==='unit').reduce((n,x)=>n+x.quantity,0)
  const avg = entries.reduce((n,x)=>n+(x.version.ether_cost*x.quantity),0)/(total||1)
  $('#deckReceptacle').textContent = `${icons[rec.slug]} ${rec.name}`
  $('#deckTitle').textContent = deck?.name || hero.name
  $('#deckSummary').textContent = deck?.description || ''
  $('#deckCount').textContent = total
  $('#unitCount').textContent = units
  $('#avgCost').textContent = avg.toFixed(2)
  $('#heroInfoName').textContent = hero.name
  $('#heroStats').textContent = `ATQ ${hero.attack} • VIDA ${hero.health} • Custo de invocação ${hero.summon_base_cost} (+${hero.summon_cost_increment} por nova invocação)`
  $('#heroAbilityName').textContent = hero.ability_name
  $('#heroAbilityText').textContent = hero.ability_text
  $('#receptacleInfoName').textContent = rec.name
  $('#passiveName').textContent = rec.passive_name
  $('#passiveText').textContent = rec.passive_text
  $('#skillName').textContent = skill?.name || '—'
  $('#skillText').textContent = skill?.rules_text || '—'
  renderCards(entries)
}

function renderCards(entries=getSelectedDeckEntries()){
  const grid = $('#cardsGrid'); grid.innerHTML = ''
  const filtered = state.filter==='all' ? entries : entries.filter(x=>x.card.card_type===state.filter)
  filtered.sort((a,b)=>a.version.ether_cost-b.version.ether_cost||a.card.name.localeCompare(b.card.name))
  for(const item of filtered){
    const node = $('#cardTemplate').content.cloneNode(true)
    node.querySelector('.card-code').textContent = item.card.code
    node.querySelector('.card-cost').textContent = `◈ ${item.version.ether_cost}`
    node.querySelector('.card-type').textContent = typeNames[item.card.card_type] || item.card.card_type
    node.querySelector('.card-qty').textContent = `×${item.quantity}`
    node.querySelector('.card-name').textContent = item.card.name
    node.querySelector('.card-stats').textContent = item.card.card_type==='unit' ? `ATQ ${item.version.attack} • VIDA ${item.version.health}` : ''
    node.querySelector('.card-text').textContent = item.version.rules_text
    grid.appendChild(node)
  }
}

$$('.filter').forEach(btn=>btn.addEventListener('click',()=>{
  state.filter=btn.dataset.filter
  $$('.filter').forEach(x=>x.classList.toggle('active',x===btn))
  renderCards()
}))

const dialog = $('#authDialog')
$('#loginBtn').addEventListener('click',async()=>{
  const {data:{session}}=await supabase.auth.getSession()
  if(session){
    stopRoomPolling()
    await supabase.auth.signOut()
    state.activeRoom=null
    state.currentMatch=null
    $('#gameSection').classList.add('hidden')
    setLobbyStatus('Você saiu da conta.')
    return updateAuthButton()
  }
  dialog.showModal()
})
$('#closeDialog').addEventListener('click',()=>dialog.close())
$('#authForm').addEventListener('submit',async(e)=>{
  e.preventDefault()
  const action=e.submitter?.dataset.action
  const email=$('#emailInput').value.trim(), password=$('#passwordInput').value, nickname=$('#nicknameInput').value.trim()
  $('#authMessage').textContent='Processando...'
  const res = action==='signup'
    ? await supabase.auth.signUp({email,password,options:{data:{nickname}}})
    : await supabase.auth.signInWithPassword({email,password})
  if(res.error){ $('#authMessage').textContent=res.error.message; return }
  if(action==='signup'){
    $('#authMessage').textContent = res.data.session ? 'Conta criada e login realizado.' : 'Conta criada. Faça login para continuar.'
  }else{
    $('#authMessage').textContent='Login realizado.'
  }
  await updateAuthButton()
  if(res.data.session || action==='login') setTimeout(()=>dialog.close(),400)
})

async function updateAuthButton(){
  const {data:{session}}=await supabase.auth.getSession()
  state.session=session
  $('#loginBtn').textContent=session?'Sair':'Entrar'
  updateLobbyControls()
  if(session) await restoreOpenMatch()
}

function updateLobbyControls(){
  const ready = Boolean(state.session && state.selectedHero)
  $('#createRoomBtn').disabled = !ready || Boolean(state.activeRoom)
  $('#joinRoomBtn').disabled = !ready || Boolean(state.activeRoom)
  if(!state.session){
    $('#lobbyStatusTitle').textContent='Faça login para criar ou entrar em partidas.'
  }else if(state.activeRoom){
    // O acompanhamento da sala define a mensagem.
  }else if(!state.selectedHero){
    $('#lobbyStatusTitle').textContent='Selecione um Herói para continuar.'
  }else{
    $('#lobbyStatusTitle').textContent=`Pronto: ${state.selectedHero.name} selecionado.`
  }
}

function setLobbyStatus(message, roomCode=''){
  $('#lobbyStatusTitle').textContent=message
  $('#roomCodeDisplay').textContent=roomCode
  $('#copyRoomBtn').classList.toggle('hidden',!roomCode)
}

async function invokeFunction(name,payload){
  if(!state.session) throw new Error('Faça login primeiro.')
  const {data,error}=await supabase.functions.invoke(name,{body:payload})
  if(error){
    let message=error.message
    try{
      const ctx=await error.context?.json?.()
      if(ctx?.error) message=ctx.error
    }catch{}
    throw new Error(message)
  }
  if(data?.error) throw new Error(data.error)
  return data
}

$('#createRoomBtn').addEventListener('click',async()=>{
  if(!state.selectedHero) return
  $('#createRoomBtn').disabled=true
  setLobbyStatus('Criando sala...')
  try{
    const data=await invokeFunction('lobby',{action:'create_room',hero_slug:state.selectedHero.slug})
    state.activeRoom={...data,seat:1}
    setLobbyStatus(`Sala criada com ${data.hero}. Aguardando o segundo jogador...`,data.room_code)
    startRoomPolling()
  }catch(err){
    setLobbyStatus(`Erro: ${err.message}`)
  }finally{ updateLobbyControls() }
})

$('#joinRoomBtn').addEventListener('click',async()=>{
  if(!state.selectedHero) return
  const room=$('#roomCodeInput').value.trim().toUpperCase()
  if(!room){ setLobbyStatus('Digite o código da sala.'); return }
  $('#joinRoomBtn').disabled=true
  setLobbyStatus('Entrando na sala...')
  try{
    const data=await invokeFunction('lobby',{action:'join_room',hero_slug:state.selectedHero.slug,room_code:room})
    state.activeRoom={...data,seat:2}
    setLobbyStatus(`Você entrou com ${data.hero}. Aguardando o host iniciar.`,data.room_code)
    startRoomPolling()
  }catch(err){
    setLobbyStatus(`Erro: ${err.message}`)
  }finally{ updateLobbyControls() }
})

$('#startMatchBtn').addEventListener('click',async()=>{
  if(!state.activeRoom) return
  const btn=$('#startMatchBtn')
  btn.disabled=true
  setLobbyStatus('Embaralhando os decks e iniciando a partida...',state.activeRoom.room_code)
  try{
    await invokeFunction('start-match',{room_code:state.activeRoom.room_code})
    await checkRoom()
  }catch(err){
    setLobbyStatus(`Erro ao iniciar: ${err.message}`,state.activeRoom.room_code)
  }finally{ btn.disabled=false }
})

$('#roomCodeInput').addEventListener('input',(e)=>{
  e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,'')
})
$('#copyRoomBtn').addEventListener('click',async()=>{
  const code=$('#roomCodeDisplay').textContent
  if(!code) return
  await navigator.clipboard.writeText(code)
  $('#copyRoomBtn').textContent='Copiado!'
  setTimeout(()=>$('#copyRoomBtn').textContent='Copiar código',1200)
})

async function restoreOpenMatch(){
  if(!state.session || state.activeRoom) return
  const {data:ownRows,error:ownError}=await supabase
    .from('match_players')
    .select('match_id,seat')
    .eq('user_id',state.session.user.id)
  if(ownError || !ownRows?.length) return
  const ids=[...new Set(ownRows.map(x=>x.match_id))]
  const {data:matches,error:matchesError}=await supabase
    .from('matches')
    .select('id,room_code,status,created_at')
    .in('id',ids)
    .in('status',['waiting','ready','active'])
    .order('created_at',{ascending:false})
    .limit(1)
  if(matchesError || !matches?.length) return
  const match=matches[0]
  const own=ownRows.find(x=>x.match_id===match.id)
  state.activeRoom={match_id:match.id,room_code:match.room_code,status:match.status,seat:own?.seat}
  startRoomPolling()
}

function startRoomPolling(){
  stopRoomPolling()
  checkRoom()
  state.poller=setInterval(checkRoom,2200)
}
function stopRoomPolling(){
  if(state.poller){ clearInterval(state.poller); state.poller=null }
}

async function checkRoom(){
  if(!state.activeRoom || !state.session) return
  const matchId=state.activeRoom.match_id
  const {data:match,error:matchError}=await supabase
    .from('matches')
    .select('*')
    .eq('id',matchId)
    .single()
  if(matchError || !match) return
  const {data:players,error:playersError}=await supabase
    .from('match_players')
    .select('*')
    .eq('match_id',matchId)
    .order('seat')
  if(playersError) return
  state.currentMatch=match
  state.matchPlayers=players||[]
  state.activeRoom.status=match.status
  const own=players?.find(p=>p.user_id===state.session.user.id)
  if(own) state.activeRoom.seat=own.seat
  const room=match.room_code
  const startBtn=$('#startMatchBtn')
  startBtn.classList.add('hidden')

  if(match.status==='waiting'){
    setLobbyStatus('Sala criada. Aguardando o segundo jogador...',room)
    $('#lobbyStatusTitle').classList.add('waiting-pulse')
    $('#gameSection').classList.add('hidden')
    return
  }
  $('#lobbyStatusTitle').classList.remove('waiting-pulse')

  if(match.status==='ready'){
    if(own?.seat===1){
      setLobbyStatus('Segundo jogador entrou. A sala está pronta.',room)
      startBtn.classList.remove('hidden')
    }else{
      setLobbyStatus('Sala pronta. Aguardando o criador iniciar a partida.',room)
    }
    $('#gameSection').classList.add('hidden')
    return
  }

  if(match.status==='active'){
    setLobbyStatus('Partida iniciada.',room)
    await renderGame(match,players)
    return
  }

  if(match.status==='finished'){
    setLobbyStatus('Partida encerrada.',room)
    await renderGame(match,players)
  }
}

function cardFromVersion(versionId){
  const version=state.cardVersions.find(v=>v.id===versionId)
  const card=state.cards.find(c=>c.id===version?.card_id)
  return {version,card}
}

async function renderGame(match,players){
  const own=players.find(p=>p.user_id===state.session.user.id)
  const opponent=players.find(p=>p.user_id!==state.session.user.id)
  if(!own) return
  const ownHero=state.heroes.find(h=>h.id===own.hero_id)
  const oppHero=state.heroes.find(h=>h.id===opponent?.hero_id)

  $('#gameSection').classList.remove('hidden')
  $('#gameRoomTitle').textContent=`Sala ${match.room_code}`
  $('#turnNumber').textContent=match.turn_number ?? 0
  $('#phaseName').textContent=phaseNames[match.phase] || match.phase || '—'
  const myTurn=match.active_player_id===state.session.user.id
  $('#activePlayerText').textContent=myTurn?'Seu turno':'Turno do adversário'
  $('#gameStatusText').textContent=myTurn
    ? 'A partida começou. O primeiro estado está pronto; as ações das fases serão liberadas na próxima etapa.'
    : 'A partida começou. Aguarde as ações do jogador ativo.'

  $('#selfHeroName').textContent=ownHero?.name || '—'
  $('#selfLife').textContent=own.life
  $('#selfEther').textContent=own.ether_available
  $('#selfReserve').textContent=own.reserve
  $('#opponentHeroName').textContent=oppHero?.name || '—'
  $('#opponentLife').textContent=opponent?.life ?? 25
  $('#opponentShield').textContent=opponent?.shield ?? 0
  $('#opponentHandCount').textContent=opponent?.hand_count ?? 0

  const {data:zone,error:zoneError}=await supabase
    .from('match_private_zones')
    .select('hand,draw_pile,rear_ether_available,rear_ether_unlocked')
    .eq('match_id',match.id)
    .eq('user_id',state.session.user.id)
    .single()
  if(zoneError) return

  const hand=Array.isArray(zone.hand)?zone.hand:[]
  $('#handCount').textContent=hand.length
  $('#rearEtherText').textContent=zone.rear_ether_available
    ? (zone.rear_ether_unlocked ? '✨ Ether de Retaguarda disponível' : '✨ Ether de Retaguarda reservado — desbloqueia na sua 2ª Ressonância')
    : ''
  renderHand(hand)
}

function renderHand(hand){
  const grid=$('#handGrid'); grid.innerHTML=''
  hand.forEach(versionId=>{
    const {version,card}=cardFromVersion(versionId)
    if(!version||!card) return
    const article=document.createElement('article')
    article.className='hand-card'
    article.innerHTML=`
      <div class="hand-card-art"><strong>${card.code}</strong><strong>◈ ${version.ether_cost}</strong></div>
      <div class="hand-card-body">
        <span class="hand-meta">${typeNames[card.card_type]||card.card_type}</span>
        <h4>${escapeHtml(card.name)}</h4>
        <div class="hand-stats">${card.card_type==='unit'?`ATQ ${version.attack} • VIDA ${version.health}`:''}</div>
        <p>${escapeHtml(version.rules_text)}</p>
      </div>`
    grid.appendChild(article)
  })
}

function escapeHtml(value=''){
  return String(value).replace(/[&<>'"]/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]))
}

supabase.auth.onAuthStateChange((_event,session)=>{
  state.session=session
  $('#loginBtn').textContent=session?'Sair':'Entrar'
  updateLobbyControls()
  if(session) restoreOpenMatch()
})

loadCatalog().then(()=>updateAuthButton()).catch(err=>{
  $('#heroesGrid').innerHTML=`<div class="loading-card">Erro ao carregar o catálogo: ${escapeHtml(err.message)}</div>`
})
