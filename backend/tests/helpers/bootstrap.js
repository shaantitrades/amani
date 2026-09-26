/**
 * Amorçage des tests : doit etre le PREMIER import de chaque fichier de test.
 * ESM evalue les imports dans l'ordre, donc ces variables sont definies avant
 * que src/config/env.js ne soit charge.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.DISABLE_REDIS = process.env.DISABLE_REDIS || '1';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://bodogui:bodogui@localhost:5432/bodogui';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
process.env.JWT_TTL = process.env.JWT_TTL || '1h';
process.env.OTP_DEV_ECHO = 'true';
process.env.STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || './var/test-storage';
process.env.SMS_PROVIDER = 'console';

export const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
