import { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useTaskShares } from '@/hooks/useTaskShares';
import { Share2, X, Mail, Eye, Pencil } from 'lucide-react';

interface ShareTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskTitle: string;
}

export function ShareTaskDialog({ open, onOpenChange, taskId, taskTitle }: ShareTaskDialogProps) {
  const { language } = useLanguage();
  const pt = language === 'pt-BR';
  const { shares, shareTask, removeShare } = useTaskShares(taskId);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'view' | 'edit'>('view');

  const handleShare = async () => {
    if (!email.trim()) return;
    await shareTask.mutateAsync({ taskId, email, permission });
    setEmail('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            {pt ? 'Compartilhar Tarefa' : 'Share Task'}
          </DialogTitle>
          <DialogDescription className="truncate">
            {taskTitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{pt ? 'E-mail do destinatário' : 'Recipient email'}</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder={pt ? 'email@exemplo.com' : 'email@example.com'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleShare()}
                className="flex-1"
              />
              <Select value={permission} onValueChange={(v) => setPermission(v as 'view' | 'edit')}>
                <SelectTrigger className="w-[110px]">
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
              className="w-full"
              size="sm"
            >
              <Mail className="h-4 w-4 mr-2" />
              {pt ? 'Compartilhar' : 'Share'}
            </Button>
          </div>

          {shares.length > 0 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">{pt ? 'Compartilhado com' : 'Shared with'}</Label>
              <div className="space-y-1.5">
                {shares.map((share) => (
                  <div key={share.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{share.shared_with_email}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {share.permission === 'edit' ? (pt ? 'Editar' : 'Edit') : (pt ? 'Ver' : 'View')}
                    </Badge>
                    <button
                      onClick={() => removeShare.mutate(share.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
