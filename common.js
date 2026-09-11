import { supabase, escapeHtml } from './config.js'

export async function loadCatalog(){
  const [gv,receptacles,skills,heroes,decks,deckCards,cardVersions,cards] = await Promise.all([
    supabase.from('game_versions').select('*').eq('status','playtest').order('created_at',{ascending:false}).limit(1),
    supabase.from('receptacles').select('*').eq('active',true).order('name'),
    supabase.from('skills').select('*').eq('active',true).eq('is_initial',true),
    supabase.from('heroes').select('*').eq('active',true).order('name'),
    supabase.from('starter_decks').select('*').eq('active',true),
    supabase.from('starter_deck_cards').select('*'),
    supabase.from('card_versions').select('*').eq('is_current',true),
    supabase.from('cards').select('*').eq('active',true)
  ])
  const results=[gv,receptacles,skills,heroes,decks,deckCards,cardVersions,cards]
  const error=results.find(x=>x.error)?.error
  if(error) throw error
  return {
    gameVersion:gv.data?.[0]||null,
    receptacles:receptacles.data||[], skills:skills.data||[], heroes:heroes.data||[], decks:decks.data||[],
    deckCards:deckCards.data||[], cardVersions:cardVersions.data||[], cards:cards.data||[]
  }
}

export async function invokeFunction(name,payload){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session) throw new Error('Faça login primeiro.')
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

export async function getOpenMatch(){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session) return null
  const {data:ownRows,error:ownError}=await supabase.from('match_players').select('match_id,seat').eq('user_id',session.user.id)
  if(ownError||!ownRows?.length) return null
  const ids=[...new Set(ownRows.map(x=>x.match_id))]
  const {data:matches,error}=await supabase.from('matches').select('*').in('id',ids).in('status',['waiting','ready','active']).order('created_at',{ascending:false}).limit(1)
  if(error||!matches?.length) return null
  const match=matches[0]
  const own=ownRows.find(x=>x.match_id===match.id)
  return {...match,seat:own?.seat}
}

function authDialogMarkup(){
  return `<dialog id="authDialog" class="dialog">
    <form id="authForm" method="dialog" class="auth-form">
      <button type="button" id="closeDialog" class="dialog-close">×</button>
      <p class="kicker">Conta de playtest</p><h2>Entrar no Aetheria TCG</h2>
      <label>E-mail<input id="emailInput" type="email" required></label>
      <label>Senha<input id="passwordInput" type="password" minlength="6" required></label>
      <label>Nick <small>(só para cadastro)</small><input id="nicknameInput" type="text" maxlength="30"></label>
      <div class="auth-actions"><button type="submit" data-action="login" class="btn primary">Entrar</button><button type="submit" data-action="signup" class="btn ghost">Criar conta</button></div>
      <p id="authMessage" class="auth-message"></p>
    </form></dialog>`
}

export async function initShell({requireAuth=false,onAuthChange}={}){
  if(!document.querySelector('#authDialog')) document.body.insertAdjacentHTML('beforeend',authDialogMarkup())
  const dialog=document.querySelector('#authDialog')
  const loginBtn=document.querySelector('#loginBtn')
  document.querySelector('#closeDialog')?.addEventListener('click',()=>dialog.close())

  async function refreshButton(){
    const {data:{session}}=await supabase.auth.getSession()
    if(loginBtn) loginBtn.textContent=session?'Sair':'Entrar'
    document.body.classList.toggle('is-authenticated',Boolean(session))
    if(requireAuth&&!session){
      dialog.showModal()
    }
    if(onAuthChange) onAuthChange(session)
    return session
  }

  loginBtn?.addEventListener('click',async()=>{
    const {data:{session}}=await supabase.auth.getSession()
    if(session){ await supabase.auth.signOut(); location.href='./index.html'; return }
    dialog.showModal()
  })

  document.querySelector('#authForm')?.addEventListener('submit',async(e)=>{
    e.preventDefault()
    const action=e.submitter?.dataset.action
    const email=document.querySelector('#emailInput').value.trim()
    const password=document.querySelector('#passwordInput').value
    const nickname=document.querySelector('#nicknameInput').value.trim()
    const message=document.querySelector('#authMessage')
    message.textContent='Processando...'
    const res=action==='signup'
      ? await supabase.auth.signUp({email,password,options:{data:{nickname}}})
      : await supabase.auth.signInWithPassword({email,password})
    if(res.error){ message.textContent=res.error.message; return }
    message.textContent=action==='signup'?'Conta criada.':'Login realizado.'
    await refreshButton()
    setTimeout(()=>dialog.close(),300)
  })

  supabase.auth.onAuthStateChange((_event,session)=>{
    if(loginBtn) loginBtn.textContent=session?'Sair':'Entrar'
    if(onAuthChange) onAuthChange(session)
  })
  return refreshButton()
}

export function showError(target,error){
  const el=typeof target==='string'?document.querySelector(target):target
  if(el) el.innerHTML=`<div class="notice error">${escapeHtml(error?.message||String(error))}</div>`
}
