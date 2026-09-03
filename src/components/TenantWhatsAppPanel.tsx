import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { findOne, listDocs, Query } from '@/integrations/appwrite/database';
import { invoke } from '@/integrations/appwrite/functions';
import { getCurrentUser } from '@/integrations/appwrite/auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Building2, QrCode, Smartphone, ShieldCheck, ShieldAlert, Trash2, RefreshCw } from 'lucide-react';

interface Props { tenantId: string; }

/**
 * `tenant_whatsapp_connections` e `tenant_member_phones` são server-doc: quem
 * cria e atualiza esses documentos é sempre uma Function
 * (tenant-whatsapp-connect / tenant-whatsapp-verify-phone), que concede leitura
 * a quem é do tenant. Por isso aqui só há LEITURA direta das collections; toda
 * escrita vira chamada de Function.
 */
export function TenantWhatsAppPanel({ tenantId }: Props) {
  const roleQ = useQuery({
    queryKey: ['tenant-role', tenantId],
    queryFn: async () => {
      // O RPC get_tenant_role não existe mais. `tenant_members` é server-doc,
      // mas o cliente LÊ a própria linha — e é só disso que a UI precisa.
      const user = await getCurrentUser();
      if (!user) return null;
      const doc = await findOne('tenant_members', [
        Query.equal('tenant_id', tenantId),
        Query.equal('user_id', user.$id),
      ]);
      return doc?.role ?? null;
    },
  });
  const isAdmin = roleQ.data === 'owner' || roleQ.data === 'admin';
  const qc = useQueryClient();
  const { toast } = useToast();

  const connQ = useQuery({
    queryKey: ['tenant-wa', tenantId],
    queryFn: async () => findOne('tenant_whatsapp_connections', [Query.equal('tenant_id', tenantId)]),
  });

  const phonesQ = useQuery({
    queryKey: ['tenant-wa-phones', tenantId],
    queryFn: async () => listDocs('tenant_member_phones', [
      Query.equal('tenant_id', tenantId),
      Query.limit(100),
    ]),
  });

  const connect = useMutation({
    // invoke() lança em erro — não devolve `{ data, error }`.
    mutationFn: async () => invoke<{ ok?: boolean; instance_name?: string; qr_code?: string }>(
      'tenant-whatsapp-connect',
      { tenant_id: tenantId },
    ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-wa', tenantId] }),
    onError: (e: Error) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  // Poll for connected status while QR pending
  useEffect(() => {
    if (connQ.data?.status !== 'qr_pending') return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ['tenant-wa', tenantId] }), 4000);
    return () => clearInterval(id);
  }, [connQ.data?.status, tenantId, qc]);

  const updateSettings = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      // TODO(migração): `tenant_whatsapp_connections` é server-doc — o cliente
      // não escreve. Das Functions previstas, tenant-whatsapp-connect só cria a
      // instância e devolve o QR; nenhuma expõe edição de preferências do
      // workspace. Falta uma Function (ex.: `tenant-whatsapp-settings`) que
      // valide o papel de admin no tenant e grave só estes campos.
      // Até lá a chamada falha alto em vez de fingir que salvou.
      throw new Error(
        'Preferências do WhatsApp do workspace ainda não migradas: ' +
          'tenant_whatsapp_connections é server-doc e falta a Function que grava ' +
          `estas configurações. Campos pedidos: ${Object.keys(patch).join(', ') || '(nenhum)'}.`,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-wa', tenantId] }),
    onError: (e: Error) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  // Member phone management
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const sendOtp = useMutation({
    mutationFn: async () => invoke<{ ok?: boolean }>('tenant-whatsapp-verify-phone', {
      action: 'send',
      tenant_id: tenantId,
      phone_number: phone,
    }),
    onSuccess: () => {
      toast({ title: 'Código enviado', description: 'Cheque seu WhatsApp.' });
      qc.invalidateQueries({ queryKey: ['tenant-wa-phones', tenantId] });
    },
    onError: (e: Error) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const verifyOtp = useMutation({
    mutationFn: async () => invoke<{ ok?: boolean; verified?: boolean }>('tenant-whatsapp-verify-phone', {
      action: 'verify',
      tenant_id: tenantId,
      code,
    }),
    onSuccess: () => {
      toast({ title: 'Verificado!' });
      setCode('');
      qc.invalidateQueries({ queryKey: ['tenant-wa-phones', tenantId] });
    },
    onError: (e: Error) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const removePhone = useMutation({
    mutationFn: async (id: string) => {
      // TODO(migração): `tenant_member_phones` é server-doc — o cliente não
      // apaga. tenant-whatsapp-verify-phone só trata as ações 'send' e 'verify';
      // falta uma ação 'remove' (ou uma Function própria) que confira se quem
      // pede é o dono do telefone ou admin do tenant antes de excluir.
      throw new Error(
        `Remoção de telefone ainda não migrada: tenant_member_phones é server-doc e falta a ` +
          `Function que apaga o registro ${id}.`,
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenant-wa-phones', tenantId] }),
    onError: (e: Error) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const conn = connQ.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display flex items-center gap-2">
          <Building2 className="h-5 w-5" /> WhatsApp do workspace
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <>
            {!conn && (
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                <QrCode className="mr-2 h-4 w-4" /> Conectar WhatsApp do workspace
              </Button>
            )}
            {conn?.status === 'qr_pending' && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Escaneie o QR no app do WhatsApp:</p>
                {conn.qr_code && (
                  <img src={conn.qr_code.startsWith('data:') ? conn.qr_code : `data:image/png;base64,${conn.qr_code}`}
                       alt="QR" className="h-64 w-64 rounded-md border border-border bg-white p-2" />
                )}
                <Button variant="outline" size="sm" onClick={() => connect.mutate()}>
                  <RefreshCw className="mr-2 h-3 w-3" /> Gerar novo QR
                </Button>
              </div>
            )}
            {conn?.status === 'connected' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Conectado{conn.phone_number ? ` • ${conn.phone_number}` : ''}
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <Label className="text-sm">Enviar lembretes pelo WhatsApp do workspace</Label>
                  <Switch
                    checked={!!conn.reminders_enabled}
                    onCheckedChange={(v) => updateSettings.mutate({ reminders_enabled: v })}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* Member phone */}
        {conn?.status === 'connected' && (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium flex items-center gap-2">
              <Smartphone className="h-4 w-4" /> Seu telefone no workspace
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="+55 11 99999-9999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <Button size="sm" onClick={() => sendOtp.mutate()} disabled={!phone || sendOtp.isPending}>
                Enviar código
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Código (6 dígitos)"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
              />
              <Button size="sm" variant="outline" onClick={() => verifyOtp.mutate()} disabled={code.length !== 6 || verifyOtp.isPending}>
                Verificar
              </Button>
            </div>

            {isAdmin && phonesQ.data && phonesQ.data.length > 0 && (
              <div className="space-y-1 pt-2">
                <Label className="text-xs">Telefones dos membros</Label>
                {phonesQ.data.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{p.phone_number}</span>
                      {p.verified
                        ? <Badge variant="default" className="text-xs"><ShieldCheck className="mr-1 h-3 w-3" />Verificado</Badge>
                        : <Badge variant="outline" className="text-xs"><ShieldAlert className="mr-1 h-3 w-3" />Pendente</Badge>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePhone.mutate(p.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
