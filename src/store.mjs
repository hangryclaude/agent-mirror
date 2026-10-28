import fs from 'node:fs';

export function createStore(file) {
  return {
    append(record) {
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
    },
    readAll() {
      if (!fs.existsSync(file)) return [];
      return fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim())
        .flatMap((line) => {
          try {
            const value = JSON.parse(line);
            return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
          } catch {
            return [];
          }
        });
    },
    sessions() {
      const groups = new Map();
      for (const event of this.readAll()) {
        const sid = event.sid ?? 'unknown';
        if (!groups.has(sid)) {
          groups.set(sid, { sid, events: [], first: null, last: null });
        }
        const group = groups.get(sid);
        const timestamp = event.ts ?? null;
        group.events.push(event);
        if (timestamp !== null && timestamp !== undefined) {
          if (group.first === null) group.first = timestamp;
          group.last = timestamp;
        }
      }
      return [...groups.values()];
    },
    close() {},
  };
}
