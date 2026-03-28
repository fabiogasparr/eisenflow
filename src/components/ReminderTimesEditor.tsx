import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, X } from 'lucide-react';

interface Props {
  times: string;
  onSave: (times: string) => void;
  language: string;
}

export function ReminderTimesEditor({ times, onSave, language }: Props) {
  const [localTimes, setLocalTimes] = useState<string[]>([]);

  useEffect(() => {
    setLocalTimes(times.split(',').map(t => t.trim()).filter(Boolean));
  }, [times]);

  const updateTime = (index: number, value: string) => {
    const updated = [...localTimes];
    updated[index] = value;
    setLocalTimes(updated);
    onSave(updated.join(','));
  };

  const removeTime = (index: number) => {
    const updated = localTimes.filter((_, i) => i !== index);
    setLocalTimes(updated);
    onSave(updated.join(','));
  };

  const addTime = () => {
    if (localTimes.length >= 5) return;
    const updated = [...localTimes, '12:00'];
    setLocalTimes(updated);
    onSave(updated.join(','));
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs">
        {language === 'pt-BR' ? 'Horários dos lembretes (máx. 5)' : 'Reminder times (max 5)'}
      </Label>
      <div className="space-y-2">
        {localTimes.map((time, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              type="time"
              className="w-32"
              value={time}
              onChange={(e) => updateTime(i, e.target.value)}
            />
            {localTimes.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => removeTime(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {localTimes.length < 5 && (
        <Button variant="outline" size="sm" onClick={addTime}>
          <Plus className="h-3 w-3 mr-1" />
          {language === 'pt-BR' ? 'Adicionar horário' : 'Add time'}
        </Button>
      )}
    </div>
  );
}
