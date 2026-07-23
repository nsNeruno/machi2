import { Injectable } from '@nestjs/common';

@Injectable()
export class ServiceDateService {
  current(timezone: string, now = new Date()): string {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const values = new Map(parts.map((part) => [part.type, part.value]));
      const year = values.get('year');
      const month = values.get('month');
      const day = values.get('day');

      if (!year || !month || !day) {
        throw new Error('Timezone formatter did not provide a complete date.');
      }

      return `${year}-${month}-${day}`;
    } catch {
      throw new Error(`Invalid IANA timezone: ${timezone}`);
    }
  }
}
