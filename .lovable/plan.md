

## Plano: Ajustar horário do relatório semanal para 7h (America/São_Paulo)

### Situação atual
Já existe um cron job `weekly-whatsapp-report` (jobid 4) agendado para **segunda-feira às 11:00 UTC** (8h BRT).

### Correção
Alterar o schedule de `0 11 * * 1` para `0 10 * * 1` (10:00 UTC = **7:00 AM America/Sao_Paulo**).

Executar via SQL:
```sql
SELECT cron.alter_job(4, schedule := '0 10 * * 1');
```

### Arquivo modificado
Nenhum arquivo de código alterado — apenas atualização do cron job existente no banco.

