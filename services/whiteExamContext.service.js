import { execute } from '../config/db.js';

export const WHITE_EXAM_QUESTIONS_PER_SUBJECT = 50;

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractClasseRoot(rawClasse) {
  const clean = String(rawClasse ?? '').trim();
  if (!clean) return '';
  return clean.split('/')[0].trim();
}

function extractSerieKey(rawClasse) {
  const clean = String(rawClasse ?? '').trim();
  if (!clean || !clean.includes('/')) return '';
  return clean.split('/').slice(1).join('/').trim().toUpperCase();
}

function classeNameCandidates(rawClasse) {
  const root = normalizeKey(extractClasseRoot(rawClasse));
  if (!root) return [];

  if (root.startsWith('3')) return ['3ème', '3eme'];
  if (root.startsWith('2')) return ['2nde', '2nd'];
  if (root.startsWith('1')) return ['1ère', '1ere'];
  if (root.includes('tle') || root.includes('term')) return ['Tle', 'Terminale'];

  return [extractClasseRoot(rawClasse)];
}

function typeSlugFromSerieKey(serieKey) {
  const safeSerie = String(serieKey ?? '').trim().toUpperCase();
  if (!safeSerie) return null;
  if (safeSerie === 'C' || safeSerie === 'D') return 'scientifique';
  if (safeSerie === 'A1' || safeSerie === 'A2') return 'litteraire';
  if (safeSerie === 'B') return 'economique';
  return null;
}

async function findClasseByCandidates(candidates) {
  const safeCandidates = Array.isArray(candidates)
    ? candidates.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  if (safeCandidates.length === 0) return null;

  const placeholders = safeCandidates.map(() => '?').join(', ');
  const rows = await execute(
    `
      SELECT id_classe, nom_classe, id_niveau
      FROM classes
      WHERE nom_classe IN (${placeholders})
    `,
    safeCandidates,
  );

  if (!Array.isArray(rows) || rows.length === 0) return null;
  const byName = new Map(
    rows.map((row) => [String(row.nom_classe ?? '').trim(), row]),
  );

  for (const candidate of safeCandidates) {
    const match = byName.get(candidate);
    if (match) return match;
  }

  return rows[0] ?? null;
}

async function findTypeBySlug(typeSlug) {
  const safeSlug = normalizeKey(typeSlug);
  if (!safeSlug) return null;

  const rows = await execute(
    `
      SELECT id_type, nom_type
      FROM type_series
      ORDER BY id_type ASC
    `,
  );

  return rows.find((row) => normalizeKey(row.nom_type) === safeSlug) ?? null;
}

export async function resolveWhiteExamContext({ classe }) {
  const classeCandidates = classeNameCandidates(classe);
  const classRow = await findClasseByCandidates(classeCandidates);
  if (!classRow) {
    const err = new Error("Classe introuvable pour l'examen blanc.");
    err.statusCode = 404;
    err.code = 'CLASS_NOT_FOUND';
    throw err;
  }

  const serieKey = extractSerieKey(classe);
  const typeSlug = typeSlugFromSerieKey(serieKey);
  const typeRow = typeSlug ? await findTypeBySlug(typeSlug) : null;

  if (typeSlug && !typeRow) {
    const err = new Error("Type de serie introuvable pour l'examen blanc.");
    err.statusCode = 404;
    err.code = 'TYPE_NOT_FOUND';
    throw err;
  }

  return {
    classRow,
    serieKey,
    typeSlug,
    typeRow,
  };
}
