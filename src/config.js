import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const abs = (p) => path.resolve(ROOT, p);

export const config = {
  port: Number(process.env.PORT || 3120),
  host: process.env.HOST || '127.0.0.1',
  dataDir: abs(process.env.DATA_DIR || './data'),
  uploadDir: abs(process.env.UPLOAD_DIR || './uploads'),
  adminHosts: list(process.env.ADMIN_HOSTS).map((h) => h.toLowerCase()),
  allowedOrigins: list(process.env.ALLOWED_ORIGINS),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 25),
  seed: {
    adminUser: process.env.SEED_ADMIN_USER,
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    adminName: process.env.SEED_ADMIN_NAME || 'Coordenação',
    demo: process.env.SEED_DEMO === 'true',
    demoStudentPassword: process.env.SEED_DEMO_STUDENT_PASSWORD,
  },
};

export const STAFF_ROLES = ['admin', 'coordenacao', 'professor'];
