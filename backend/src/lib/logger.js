import pino from 'pino';
import env from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: 'bodogui-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'phone',
      '*.phone',
      'code',
      '*.code',
      'password',
    ],
    censor: '***',
  },
  transport: env.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
});

export default logger;
