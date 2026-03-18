import crypto from 'crypto';

function stamp() {
  return new Date().toISOString();
}

function write(level, event, payload = {}) {
  const line = JSON.stringify({
    ts: stamp(),
    level,
    event,
    ...payload,
  });

  if (level === 'error') {
    console.error(line);
    return;
  }

  console.log(line);
}

export function hashQuery(query) {
  return crypto.createHash('sha1').update(query).digest('hex').slice(0, 12);
}

export function createLogger() {
  return {
    info(event, payload) {
      write('info', event, payload);
    },
    warn(event, payload) {
      write('warn', event, payload);
    },
    error(event, payload) {
      write('error', event, payload);
    },
  };
}
