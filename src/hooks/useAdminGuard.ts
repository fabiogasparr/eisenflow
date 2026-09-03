import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { findOne, Query } from '@/integrations/appwrite/database';

export function useAdminGuard() {
  const { user, loading: authLoading } = useAuth();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/auth', { replace: true });
      return;
    }

    const checkRole = async () => {
      // No Postgres isto era `has_role(auth.uid(), 'super_admin')` /
      // `is_super_admin()` — funções SECURITY DEFINER sobre a tabela user_roles,
      // usadas dentro das policies de admin.
      //
      // Aqui a collection `user_roles` é server-doc: só a API key cria o
      // documento e o servidor concede LEITURA dele ao próprio dono. Ou seja, o
      // recorte "cada um só vê o próprio papel" já vem da permissão do
      // documento — o Query.equal('user_id', ...) é só para achar a linha.
      //
      // NOTA: o caminho idiomático no Appwrite seria não ter esta collection e
      // usar os labels da conta — `user.labels.includes('admin')` /
      // `'super_admin'` —, que viajam no próprio JWT da sessão e podem virar
      // Role.label(...) nas permissões de documento. A collection existe para
      // não quebrar o app hoje; migrar para labels é o passo seguinte.
      const roleDoc = await findOne('user_roles', [Query.equal('user_id', user.$id)]);

      if (roleDoc?.role === 'super_admin') {
        setIsSuperAdmin(true);
      } else {
        navigate('/', { replace: true });
      }
      setLoading(false);
    };

    checkRole();
  }, [user, authLoading, navigate]);

  return { isSuperAdmin, loading: loading || authLoading };
}
