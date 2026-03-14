import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Loader2, Unplug, QrCode, RefreshCw } from 'lucide-react';

export function WhatsAppQRCode() {
  const { connection, isLoading, connect, disconnect, reregisterWebhook } = useWhatsApp();
  const { language } = useLanguage();
  const t = (pt: string, en: string) => language === 'pt-BR' ? pt : en;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not connected - show connect button
  if (!connection || connection.status === 'disconnected') {
    return (
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="rounded-full bg-muted p-4">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          {t(
            'Conecte seu WhatsApp para receber lembretes e gerenciar tarefas por mensagem.',
            'Connect your WhatsApp to receive reminders and manage tasks via message.'
          )}
        </p>
        <Button
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
          className="gap-2"
        >
          {connect.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <QrCode className="h-4 w-4" />
          )}
          {t('Conectar WhatsApp', 'Connect WhatsApp')}
        </Button>
      </div>
    );
  }

  // QR pending - show QR code
  if (connection.status === 'qr_pending' && connection.qr_code) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <Badge variant="secondary" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('Aguardando leitura...', 'Waiting for scan...')}
        </Badge>
        <div className="rounded-lg border bg-background p-2">
          <img
            src={connection.qr_code.startsWith('data:') ? connection.qr_code : `data:image/png;base64,${connection.qr_code}`}
            alt="WhatsApp QR Code"
            className="h-48 w-48"
          />
        </div>
        <p className="text-xs text-muted-foreground text-center max-w-xs">
          {t(
            'Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo',
            'Open WhatsApp → Linked devices → Link a device'
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          {t('Cancelar', 'Cancel')}
        </Button>
      </div>
    );
  }

  // Connected
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-3">
      <Badge variant="secondary" className="gap-1.5">
          <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
          {t('Conectado', 'Connected')}
        </Badge>
        {connection.phone_number && (
          <span className="text-sm text-muted-foreground">{connection.phone_number}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => reregisterWebhook.mutate()}
          disabled={reregisterWebhook.isPending}
          className="w-fit gap-2"
        >
          {reregisterWebhook.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t('Reconectar Webhook', 'Reconnect Webhook')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
          className="w-fit gap-2"
        >
          {disconnect.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Unplug className="h-3 w-3" />
          )}
          {t('Desconectar', 'Disconnect')}
        </Button>
      </div>
    </div>
  );
}
