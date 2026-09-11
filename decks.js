import { icons,typeNames,escapeHtml } from './config.js'
import { initShell,loadCatalog,showError } from './common.js'

let catalog=null,selectedHero=null,filter='all'
const $=s=>document.querySelector(s)

function entriesFor(hero){
  const deck=catalog.decks.find(d=>d.hero_id===hero.id)
  if(!deck) return []
  return catalog.deckCards.filter(x=>x.starter_deck_id===deck.id).map(entry=>{
    const version=catalog.cardVersions.find(v=>v.id===entry.card_version_id)
    const card=catalog.cards.find(c=>c.id===version?.card_id)
    return {...entry,version,card}
  }).filter(x=>x.card&&x.version)
}

function renderHeroes(){
  const grid=$('#heroesGrid'); grid.innerHTML=''
  for(const hero of catalog.heroes){
    const rec=catalog.receptacles.find(r=>r.id===hero.receptacle_id)
    const b=document.createElement('button'); b.className='hero-card compact'
    b.innerHTML=`<div class="hero-art"><span>${icons[rec?.slug]||'✦'}</span></div><div class="hero-card-body"><span class="hero-class">${escapeHtml(rec?.name||'')}</span><h3>${escapeHtml(hero.name)}</h3><p>${escapeHtml(rec?.identity_text||'')}</p><div class="hero-mini-stats">ATQ ${hero.attack} • VIDA ${hero.health}</div></div>`
    b.addEventListener('click',()=>{ selectedHero=hero; document.querySelectorAll('.hero-card').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); renderDeck() })
    grid.appendChild(b)
  }
}

function renderDeck(){
  if(!selectedHero) return
  const rec=catalog.receptacles.find(r=>r.id===selectedHero.receptacle_id)
  const skill=catalog.skills.find(s=>s.receptacle_id===rec.id)
  const deck=catalog.decks.find(d=>d.hero_id===selectedHero.id)
  const entries=entriesFor(selectedHero)
  const total=entries.reduce((n,x)=>n+x.quantity,0)
  const units=entries.filter(x=>x.card.card_type==='unit').reduce((n,x)=>n+x.quantity,0)
  const avg=entries.reduce((n,x)=>n+x.version.ether_cost*x.quantity,0)/(total||1)
  $('#deckPanel').classList.remove('hidden')
  $('#deckTitle').textContent=deck?.name||selectedHero.name
  $('#deckReceptacle').textContent=`${icons[rec.slug]} ${rec.name}`
  $('#deckSummary').textContent=deck?.description||''
  $('#deckCount').textContent=total; $('#unitCount').textContent=units; $('#avgCost').textContent=avg.toFixed(2)
  $('#heroInfo').innerHTML=`<span>Herói</span><h3>${escapeHtml(selectedHero.name)}</h3><p>ATQ ${selectedHero.attack} • VIDA ${selectedHero.health} • Invocação ${selectedHero.summon_base_cost}</p><strong>${escapeHtml(selectedHero.ability_name)}</strong><p>${escapeHtml(selectedHero.ability_text)}</p>`
  $('#receptacleInfo').innerHTML=`<span>Receptáculo</span><h3>${escapeHtml(rec.name)}</h3><strong>${escapeHtml(rec.passive_name)}</strong><p>${escapeHtml(rec.passive_text)}</p>`
  $('#skillInfo').innerHTML=`<span>Skill inicial</span><h3>${escapeHtml(skill?.name||'—')}</h3><p>${escapeHtml(skill?.rules_text||'—')}</p>`
  renderCards(entries)
}

function renderCards(entries=entriesFor(selectedHero)){
  const grid=$('#cardsGrid'); grid.innerHTML=''
  const filtered=filter==='all'?entries:entries.filter(x=>x.card.card_type===filter)
  filtered.sort((a,b)=>a.version.ether_cost-b.version.ether_cost||a.card.name.localeCompare(b.card.name))
  for(const x of filtered){
    const a=document.createElement('article'); a.className='game-card'
    a.innerHTML=`<div class="game-card-art"><span class="card-code">${x.card.code}</span><span class="card-cost">◈ ${x.version.ether_cost}</span></div><div class="game-card-body"><div class="card-topline"><span class="card-type">${typeNames[x.card.card_type]}</span><span class="card-qty">×${x.quantity}</span></div><h3 class="card-name">${escapeHtml(x.card.name)}</h3><div class="card-stats">${x.card.card_type==='unit'?`ATQ ${x.version.attack} • VIDA ${x.version.health}`:''}</div><p class="card-text">${escapeHtml(x.version.rules_text)}</p></div>`
    grid.appendChild(a)
  }
}

document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{ filter=btn.dataset.filter; document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===btn)); if(selectedHero) renderCards() }))

await initShell()
try{ catalog=await loadCatalog(); $('#versionBadge').textContent=catalog.gameVersion?.name||'Playtest'; renderHeroes() }catch(e){ showError('#heroesGrid',e) }
