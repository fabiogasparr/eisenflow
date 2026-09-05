/**
 * ai-health
 * ──────────────────────────────────────────────────────────────────────
 * Diagnóstico da camada de IA: o edge-runtime consegue falar com o OmniRoute,
 * e o OmniRoute aceita a chave? Não gasta token (GET /models).
 *
 * Chamada ........... front (JWT) ou interna (x-internal-secret)
 * Saída ............. { ok, status, base, chave, modelos?, erro?, modelosConfigurados }
 *
 * Existe porque "Desculpe, ocorreu um erro" no Chat IA pode ser cinco coisas
 * diferentes (chave errada, chave com aspas, URL errada, gateway fora, modelo
 * inexistente), e nenhuma delas é visível de dentro do app. Aqui cada uma tem
 * cara própria — e a chave nunca aparece inteira.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { MODELOS, verificarAcesso } from '../_shared/ai.ts';
import { getUser, isInternalCall } from '../_shared/supabase.ts';
import { json, preflight, respostaErro, erro } from '../_shared/http.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  try {
    if (!isInternalCall(req) && !(await getUser(req))) throw erro('Não autenticado', 401);
    const acesso = await verificarAcesso();
    return json({ ...acesso, modelosConfigurados: MODELOS }, acesso.ok ? 200 : 503);
  } catch (e) {
    return respostaErro(e);
  }
});
