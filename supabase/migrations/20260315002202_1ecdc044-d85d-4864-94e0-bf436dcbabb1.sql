
-- Permitir ao criador ver o time recém-criado (evita falha no RETURNING)
CREATE POLICY "Creators can view their teams"
ON public.teams FOR SELECT TO authenticated
USING (auth.uid() = created_by);

-- Default defensivo
ALTER TABLE public.teams ALTER COLUMN created_by SET DEFAULT auth.uid();
