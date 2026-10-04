import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from './config.js';
import { HttpError } from './util.js';

// Lista branca: extensão -> tipo de anexo. Qualquer outra coisa é recusada.
const ALLOWED = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.pdf': 'file', '.doc': 'file', '.docx': 'file', '.xls': 'file', '.xlsx': 'file',
  '.ppt': 'file', '.pptx': 'file', '.odt': 'file', '.txt': 'file', '.csv': 'file',
};
const MIME_PREFIX = { image: 'image/', video: 'video/' };

export const kindOf = (filename) => ALLOWED[path.extname(filename).toLowerCase()] || null;

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const kind = kindOf(file.originalname);
    if (!kind) return cb(new HttpError(400, `Tipo de arquivo não permitido: ${file.originalname}`));
    if (MIME_PREFIX[kind] && !file.mimetype.startsWith(MIME_PREFIX[kind])) {
      return cb(new HttpError(400, `Conteúdo não confere com a extensão: ${file.originalname}`));
    }
    cb(null, true);
  },
});

export function removeUpload(url) {
  if (!url?.startsWith('/uploads/')) return;
  const file = path.join(config.uploadDir, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}
