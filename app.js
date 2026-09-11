import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://iphxbbmobdqwlomstbop.supabase.co'
const SUPABASE_KEY = 'sb_publishable_6SIator21VkZhbcdXOB9zA_FV5l99ky'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]
const state = { heroes: [], receptacles: [], skills: [], decks: [], deckCards: [], cardVersions: [], cards: [], selectedHero: null, filter:'all' }
const icons = { paladin:'🛡️', warrior:'⚔️', mage:'🔮', wanderer:'🏹' }
const typeNames = { unit:'Unidade', action:'Ação', equipment:'Equipamento', trap:'Armadilha', terrain:'Terreno' }

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
  const errors=[gv,receptacles,skills,heroes,decks,deckCards,cardVersions,cards].map(x=>x.error).filter(Boolean)
  if(errors.length) throw errors[0]
  $('#versionBadge').textContent = gv.data?.[0]?.name || 'Playtest'
  Object.assign(state,{receptacles:receptacles.data,skills:skills.data,heroes:heroes.data,decks:decks.data,deckCards:deckCards.data,cardVersions:cardVersions.data,cards:cards.data})
  renderHeroes()
}

function renderHeroes(){
  const grid=$('#heroesGrid'); grid.innerHTML=''
  for(const hero of state.heroes){
    const rec=state.receptacles.find(r=>r.id===hero.receptacle_id)
    const node=$('#heroTemplate').content.cloneNode(true)
    const button=node.querySelector('.hero-card')
    button.dataset.hero=hero.id
    node.querySelector('.hero-icon').textContent=icons[rec?.slug]||'✦'
    node.querySelector('.hero-class').textContent=rec?.name||''
    node.querySelector('.hero-name').textContent=hero.name
    node.querySelector('.hero-role').textContent=rec?.identity_text||''
    node.querySelector('.hero-mini-stats').textContent=`ATQ ${hero.attack} • VIDA ${hero.health} • Invocação ${hero.summon_base_cost}`
    button.addEventListener('click',()=>selectHero(hero.id))
    grid.appendChild(node)
  }
}

function selectHero(heroId){
  state.selectedHero=state.heroes.find(h=>h.id===heroId)
  $$('.hero-card').forEach(x=>x.classList.toggle('selected',x.dataset.hero===heroId))
  state.filter='all'; $$('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'))
  renderDeck()
  $('#deckSection').classList.remove('hidden')
  $('#deckSection').scrollIntoView({behavior:'smooth',block:'start'})
}

function getSelectedDeckEntries(){
  const hero=state.selectedHero
  const deck=state.decks.find(d=>d.hero_id===hero.id)
  if(!deck) return []
  return state.deckCards.filter(x=>x.starter_deck_id===deck.id).map(entry=>{
    const version=state.cardVersions.find(v=>v.id===entry.card_version_id)
    const card=state.cards.find(c=>c.id===version?.card_id)
    return { ...entry, version, card }
  }).filter(x=>x.card&&x.version)
}

function renderDeck(){
  const hero=state.selectedHero
  const rec=state.receptacles.find(r=>r.id===hero.receptacle_id)
  const skill=state.skills.find(s=>s.receptacle_id===rec.id)
  const deck=state.decks.find(d=>d.hero_id===hero.id)
  const entries=getSelectedDeckEntries()
  const total=entries.reduce((n,x)=>n+x.quantity,0)
  const units=entries.filter(x=>x.card.card_type==='unit').reduce((n,x)=>n+x.quantity,0)
  const avg=entries.reduce((n,x)=>n+(x.version.ether_cost*x.quantity),0)/(total||1)
  $('#deckReceptacle').textContent=`${icons[rec.slug]} ${rec.name}`
  $('#deckTitle').textContent=deck?.name||hero.name
  $('#deckSummary').textContent=deck?.description||''
  $('#deckCount').textContent=total
  $('#unitCount').textContent=units
  $('#avgCost').textContent=avg.toFixed(2)
  $('#heroInfoName').textContent=hero.name
  $('#heroStats').textContent=`ATQ ${hero.attack} • VIDA ${hero.health} • Custo de invocação ${hero.summon_base_cost} (+${hero.summon_cost_increment} por nova invocação)`
  $('#heroAbilityName').textContent=hero.ability_name
  $('#heroAbilityText').textContent=hero.ability_text
  $('#receptacleInfoName').textContent=rec.name
  $('#passiveName').textContent=rec.passive_name
  $('#passiveText').textContent=rec.passive_text
  $('#skillName').textContent=skill?.name||'—'
  $('#skillText').textContent=skill?.rules_text||'—'
  renderCards(entries)
}

function renderCards(entries=getSelectedDeckEntries()){
  const grid=$('#cardsGrid'); grid.innerHTML=''
  const filtered=state.filter==='all'?entries:entries.filter(x=>x.card.card_type===state.filter)
  filtered.sort((a,b)=>a.version.ether_cost-b.version.ether_cost||a.card.name.localeCompare(b.card.name))
  for(const item of filtered){
    const node=$('#cardTemplate').content.cloneNode(true)
    node.querySelector('.card-code').textContent=item.card.code
    node.querySelector('.card-cost').textContent=`◈ ${item.version.ether_cost}`
    node.querySelector('.card-type').textContent=typeNames[item.card.card_type]||item.card.card_type
    node.querySelector('.card-qty').textContent=`×${item.quantity}`
    node.querySelector('.card-name').textContent=item.card.name
    node.querySelector('.card-stats').textContent=item.card.card_type==='unit'?`ATQ ${item.version.attack} • VIDA ${item.version.health}`:''
    node.querySelector('.card-text').textContent=item.version.rules_text
    grid.appendChild(node)
  }
}

$$('.filter').forEach(btn=>btn.addEventListener('click',()=>{state.filter=btn.dataset.filter;$$('.filter').forEach(x=>x.classList.toggle('active',x===btn));renderCards()}))

const dialog=$('#authDialog')
$('#loginBtn').addEventListener('click',async()=>{
  const {data:{session}}=await supabase.auth.getSession()
  if(session){ await supabase.auth.signOut(); return updateAuthButton() }
  dialog.showModal()
})
$('#closeDialog').addEventListener('click',()=>dialog.close())
$('#authForm').addEventListener('submit',async(e)=>{
  e.preventDefault()
  const action=e.submitter?.dataset.action
  const email=$('#emailInput').value.trim(), password=$('#passwordInput').value, nickname=$('#nicknameInput').value.trim()
  $('#authMessage').textContent='Processando...'
  const res= action==='signup'
    ? await supabase.auth.signUp({email,password,options:{data:{nickname}}})
    : await supabase.auth.signInWithPassword({email,password})
  if(res.error){$('#authMessage').textContent=res.error.message;return}
  $('#authMessage').textContent=action==='signup'?'Conta criada. Se a confirmação de e-mail estiver ativa, confira sua caixa de entrada.':'Login realizado.'
  if(action==='login'){setTimeout(()=>dialog.close(),500)}
  updateAuthButton()
})
async function updateAuthButton(){const {data:{session}}=await supabase.auth.getSession();$('#loginBtn').textContent=session?'Sair':'Entrar'}
supabase.auth.onAuthStateChange(()=>updateAuthButton())

loadCatalog().catch(err=>{$('#heroesGrid').innerHTML=`<div class="loading-card">Erro ao carregar o catálogo: ${err.message}</div>`})
updateAuthButton()
