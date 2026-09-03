import { useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useTenantContext } from '@/hooks/useTenantContext';
import { useTenantMcp, ALL_SCOPES, type Scope } from '@/hooks/useTenantMcp';
import { useToast } from '@/hooks/use-toast';
import { Copy, KeyRound, ShieldAlert, Trash2 } from 'lucide-react';

// Endpoint público da Function hermes-mcp no Appwrite.
// No Supabase era `${SUPABASE_URL}/functions/v1/hermes-mcp`; no Appwrite a rota
// de execução pública de uma function é /v1/functions/<id>/executions.
const APPWRITE_ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT as string;
const MCP_BASE_URL = `${APPWRITE_ENDPOINT}/functions/hermes-mcp/executions`;

export default function IntegrationsMcpPage() {
  const { activeTenant } = useTenantContext();
  const mcp = useTenantMcp();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScopes, setNewScopes] = useState<Scope[]>(['tasks:read', 'tasks:write']);
  const [newExpiry, setNewExpiry] = useState<string>('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const copy = async (text: string, label = 'Copiado') => {
    await navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  if (!activeTenant) {
    return (
      <AppLayout>
        <div className="p-6">Selecione um workspace para continuar.</div>
      </AppLayout>
    );
  }

  if (!mcp.isAdmin) {
    return (
      <AppLayout>
        <div className="max-w-2xl p-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display">
                <ShieldAlert className="h-5 w-5" /> Acesso restrito
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Apenas owners e admins do workspace podem gerenciar o MCP e suas chaves de API.
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const submitCreate = async () => {
    if (!newName.trim()) {
      toast({ title: 'Dê um nome para a chave', variant: 'destructive' });
      return;
    }
    if (!newScopes.length) {
      toast({ title: 'Selecione ao menos um escopo', variant: 'destructive' });
      return;
    }
    try {
      const days = newExpiry ? Number(newExpiry) : null;
      const res = await mcp.createKey.mutateAsync({ name: newName.trim(), scopes: newScopes, expiresInDays: days });
      setCreatedToken(res.token);
      setNewName('');
      setNewScopes(['tasks:read', 'tasks:write']);
      setNewExpiry('');
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Erro ao criar chave', description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 p-4 md:p-6 max-w-3xl">
        <div>
          <h1 className="font-display text-2xl font-bold">Integrações · MCP</h1>
          <p className="text-sm text-muted-foreground">
            Conecte agentes externos (como o Hermes, n8n ou scripts próprios) ao workspace <strong>{activeTenant.name}</strong>.
          </p>
        </div>

        {/* Toggle */}
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Habilitar MCP</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="text-sm text-muted-foreground">
              Quando habilitado, chaves geradas aqui podem chamar a API do MCP para ler e atualizar tarefas deste workspace.
            </div>
            <Switch
              checked={mcp.enabled}
              onCheckedChange={(v) => mcp.toggleEnabled.mutate(v)}
              disabled={mcp.toggleEnabled.isPending}
            />
          </CardContent>
        </Card>

        {/* Connection info */}
        {mcp.enabled && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Como conectar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <Label className="text-xs uppercase text-muted-foreground">URL base</Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">{MCP_BASE_URL}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(MCP_BASE_URL, 'URL copiada')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Header de autenticação</Label>
                <code className="mt-1 block rounded bg-muted px-2 py-1 font-mono text-xs">x-api-key: &lt;sua_chave&gt;</code>
              </div>
              <div>
                <Label className="text-xs uppercase text-muted-foreground">Exemplo</Label>
                <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{`curl -X POST ${MCP_BASE_URL}/mcp/tools/list \\
  -H 'x-api-key: SUA_CHAVE' \\
  -H 'content-type: application/json' -d '{}'

curl -X POST ${MCP_BASE_URL}/mcp/tools/call \\
  -H 'x-api-key: SUA_CHAVE' \\
  -H 'content-type: application/json' \\
  -d '{"name":"create_task","arguments":{"title":"Reunião","urgency":4,"importance":4}}'`}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {/* API keys */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display">Chaves de API</CardTitle>
            <Button size="sm" onClick={() => setDialogOpen(true)} disabled={!mcp.enabled}>
              <KeyRound className="mr-2 h-4 w-4" /> Nova chave
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {!mcp.enabled && (
              <p className="text-sm text-muted-foreground">Habilite o MCP para gerar chaves.</p>
            )}
            {mcp.enabled && mcp.keys.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma chave criada ainda.</p>
            )}
            {mcp.keys.data?.map((k) => {
              const revoked = !!k.revoked_at;
              const expired = k.expires_at && new Date(k.expires_at).getTime() < Date.now();
              return (
                <div key={k.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{k.name}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{k.key_prefix}_…</code>
                      {revoked && <Badge variant="destructive">revogada</Badge>}
                      {!revoked && expired && <Badge variant="secondary">expirada</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Último uso: {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'nunca'}
                      {k.expires_at && ` · expira em ${new Date(k.expires_at).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!revoked && (
                      <Button size="sm" variant="outline" onClick={() => mcp.revokeKey.mutate(k.id)}>
                        Revogar
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => mcp.deleteKey.mutate(k.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Audit */}
        {mcp.enabled && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Atividade recente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {mcp.audit.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhuma atividade ainda.</p>
              )}
              {mcp.audit.data?.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono">{a.tool ?? '—'}</span>
                  <Badge variant={a.status === 'ok' ? 'secondary' : 'destructive'}>{a.status}</Badge>
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>
              A chave será mostrada uma única vez. Guarde em um local seguro.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Hermes produção" />
            </div>
            <div className="space-y-2">
              <Label>Escopos</Label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_SCOPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={newScopes.includes(s)}
                      onCheckedChange={(v) => {
                        setNewScopes((prev) => v ? [...prev, s] : prev.filter((x) => x !== s));
                      }}
                    />
                    <span className="font-mono text-xs">{s}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Expiração (dias)</Label>
              <Input
                type="number" min={1} max={365}
                value={newExpiry} onChange={(e) => setNewExpiry(e.target.value)}
                placeholder="Deixe vazio para não expirar"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={submitCreate} disabled={mcp.createKey.isPending}>Gerar chave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reveal token once */}
      <Dialog open={!!createdToken} onOpenChange={(o) => !o && setCreatedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chave gerada</DialogTitle>
            <DialogDescription>
              Copie agora — esta é a única vez que a chave será exibida.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <code className="block break-all rounded bg-muted p-3 font-mono text-xs">{createdToken}</code>
            <Button className="w-full" onClick={() => createdToken && copy(createdToken, 'Chave copiada')}>
              <Copy className="mr-2 h-4 w-4" /> Copiar chave
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedToken(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
