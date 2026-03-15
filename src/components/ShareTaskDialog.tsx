import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTaskShares } from '@/hooks/useTaskShares';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Share2, X, Mail, Eye, Pencil, UserPlus, CheckCircle2, Clock, Send, Loader2 } from 'lucide-react';

interface ShareTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
}

export function ShareTaskDialog({ open, onOpenChange, taskId, taskTitle }: ShareTaskDialogProps) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { shares, shareTask, updatePermission, removeShare } = useTaskShares(taskId);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');

  // Fetch profiles for shared users to get display names and check registration status
  const { data: profilesMap } = useQuery({
    queryKey: ['share-profiles', shares.map(s => s.shared_with_email).join(',')],
    queryFn: async () => {
      if (shares.length === 0) return new Map<string, { display_name: string | null; registered: boolean }>();
      const emails = shares.map(s => s.shared_with_email);
      // Check which emails have registered accounts via profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name');
      
      // We can't query by email directly on profiles, so check via user_ids on shares
      const userIds = shares.filter(s => s.shared_with_user_id).map(s => s.shared_with_user_id!);
      const { data: matchedProfiles } = userIds.length > 0
        ? await supabase.from('profiles').select('user_id, display_name').in('user_id', userIds)
        : { data: [] };

      const map = new Map<string, { display_name: string | null; registered: boolean }>();
      for (const share of shares) {
        const profile = (matchedProfiles ?? []).find((p: any) => p.user_id === share.shared_with_user_id);
        map.set(share.shared_with_email, {
          display_name: profile?.display_name ?? null,
          registered: !!share.shared_with_user_id || !!profile,
        });
      }
      return map;
    },
    enabled: shares.length > 0,
  });

  const handleShare = async () => {
    if (!email.trim()) return;
    await shareTask.mutateAsync({ taskId, email, permission });
    setEmail('');
  };

  const getInitials = (email: string, name?: string | null) => {
    if (name) return name.charAt(0).toUpperCase();
    return email.charAt(0).toUpperCase();
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      'bg-primary/15 text-primary',
      'bg-quadrant-do/15 text-quadrant-do',
      'bg-quadrant-schedule/15 text-quadrant-schedule',
      'bg-quadrant-delegate/15 text-quadrant-delegate',
      'bg-accent text-accent-foreground',
    ];
    let hash = 0;
    for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Share2 className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base">
                {pt ? 'Compartilhar Tarefa' : 'Share Task'}
              </DialogTitle>
              <DialogDescription className="truncate text-xs mt-0.5">
                {taskTitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Add person section */}
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <UserPlus className="h-3.5 w-3.5 inline mr-1.5" />
              {pt ? 'Adicionar pessoa' : 'Add person'}
            </Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder={pt ? 'email@exemplo.com' : 'email@example.com'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleShare()}
                className="flex-1 h-9"
              />
              <Select value={permission} onValueChange={(v) => setPermission(v as 'view' | 'edit')}>
                <SelectTrigger className="w-[100px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">
                    <span className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> {pt ? 'Ver' : 'View'}</span>
                  </SelectItem>
                  <SelectItem value="edit">
                    <span className="flex items-center gap-1.5"><Pencil className="h-3.5 w-3.5" /> {pt ? 'Editar' : 'Edit'}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={handleShare}
              disabled={!email.trim() || shareTask.isPending}
              className="w-full h-9 gap-2"
              size="sm"
            >
              {shareTask.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {pt ? 'Enviar convite' : 'Send invite'}
            </Button>
          </div>

          {/* Shared with section */}
          {shares.length > 0 && (
            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {pt ? `Compartilhado com (${shares.length})` : `Shared with (${shares.length})`}
              </Label>
              <div className="space-y-1">
                {shares.map((share) => {
                  const info = profilesMap?.get(share.shared_with_email);
                  const isRegistered = info?.registered ?? !!share.shared_with_user_id;
                  const displayName = info?.display_name;

                  return (
                    <div
                      key={share.id}
                      className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50 group"
                    >
                      {/* Avatar */}
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className={`text-xs font-semibold ${getAvatarColor(share.shared_with_email)}`}>
                          {getInitials(share.shared_with_email, displayName)}
                        </AvatarFallback>
                      </Avatar>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        {displayName ? (
                          <>
                            <p className="text-sm font-medium truncate">{displayName}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{share.shared_with_email}</p>
                          </>
                        ) : (
                          <p className="text-sm font-medium truncate">{share.shared_with_email}</p>
                        )}
                      </div>

                      {/* Status indicator */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="shrink-0">
                            {isRegistered ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <Clock className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          {isRegistered
                            ? (pt ? 'Conta confirmada' : 'Account confirmed')
                            : (pt ? 'Aguardando cadastro' : 'Pending registration')}
                        </TooltipContent>
                      </Tooltip>

                      {/* Permission badge */}
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0.5 shrink-0 gap-1"
                      >
                        {share.permission === 'edit' ? (
                          <><Pencil className="h-2.5 w-2.5" /> {pt ? 'Editar' : 'Edit'}</>
                        ) : (
                          <><Eye className="h-2.5 w-2.5" /> {pt ? 'Ver' : 'View'}</>
                        )}
                      </Badge>

                      {/* Remove button */}
                      <button
                        onClick={() => removeShare.mutate(share.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {shares.length === 0 && (
            <div className="flex flex-col items-center py-4 text-muted-foreground gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <UserPlus className="h-5 w-5 opacity-50" />
              </div>
              <p className="text-xs text-center">
                {pt ? 'Nenhum compartilhamento ainda. Adicione um e-mail acima.' : 'No shares yet. Add an email above.'}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
