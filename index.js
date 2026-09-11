import { supabase } from './config.js'
import { initShell, getOpenMatch } from './common.js'

async function refreshHome(session){
  const status=document.querySelector('#accountStatus')
  const continueCard=document.querySelector('#continueCard')
  if(!session){ status.textContent='Entre para criar salas e jogar online.'; continueCard.classList.add('hidden'); return }
  status.textContent=`Conectado como ${session.user.email}`
  const match=await getOpenMatch()
  if(match){
    continueCard.classList.remove('hidden')
    document.querySelector('#continueText').textContent=`Sala ${match.room_code} • ${match.status}`
    document.querySelector('#continueBtn').href=match.status==='active'?`./game.html?room=${encodeURIComponent(match.room_code)}`:'./lobby.html'
  }else continueCard.classList.add('hidden')
}

await initShell({onAuthChange:refreshHome})
const {data:{session}}=await supabase.auth.getSession()
await refreshHome(session)
