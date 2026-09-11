import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

export const SUPABASE_URL = 'https://iphxbbmobdqwlomstbop.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_6SIator21VkZhbcdXOB9zA_FV5l99ky'
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export const icons = { paladin:'🛡️', warrior:'⚔️', mage:'🔮', wanderer:'🏹' }
export const typeNames = { unit:'Unidade', action:'Ação', equipment:'Equipamento', trap:'Armadilha', terrain:'Terreno' }
export const phaseNames = { awakening:'Despertar', resonance:'Ressonância', preparation:'Preparação', confrontation:'Confronto', twilight:'Crepúsculo' }

export function escapeHtml(value=''){
  return String(value).replace(/[&<>'"]/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]))
}
