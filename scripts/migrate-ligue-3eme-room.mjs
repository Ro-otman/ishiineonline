import { getPool } from '../config/db.js';

async function ensureTypeSeries(connection, nomType) {
  const [rows] = await connection.query(
    'SELECT id_type FROM type_series WHERE nom_type = ? LIMIT 1',
    [nomType],
  );
  if (Array.isArray(rows) && rows[0]?.id_type) {
    return Number(rows[0].id_type);
  }

  const [result] = await connection.query(
    'INSERT INTO type_series (nom_type) VALUES (?)',
    [nomType],
  );
  return Number(result.insertId);
}

async function ensureSerie(connection, { nomSerie, idType }) {
  const [rows] = await connection.query(
    'SELECT id_serie FROM series WHERE nom_serie = ? AND id_type = ? LIMIT 1',
    [nomSerie, idType],
  );
  if (Array.isArray(rows) && rows[0]?.id_serie) {
    return Number(rows[0].id_serie);
  }

  const [result] = await connection.query(
    'INSERT INTO series (nom_serie, id_type) VALUES (?, ?)',
    [nomSerie, idType],
  );
  return Number(result.insertId);
}

async function ensureClasseSerie(connection, { nomClasse, idSerie }) {
  const [classeRows] = await connection.query(
    'SELECT id_classe FROM classes WHERE nom_classe = ? LIMIT 1',
    [nomClasse],
  );
  const idClasse = Array.isArray(classeRows) && classeRows[0]?.id_classe
    ? Number(classeRows[0].id_classe)
    : 0;

  if (!idClasse) {
    throw new Error(`Classe introuvable: ${nomClasse}`);
  }

  await connection.query(
    'INSERT IGNORE INTO classe_serie (id_classe, id_serie) VALUES (?, ?)',
    [idClasse, idSerie],
  );

  return idClasse;
}

const pool = getPool();
const connection = await pool.getConnection();
const classeTroisieme = '3\u00E8me';

try {
  await connection.beginTransaction();

  const idTypeCommun = await ensureTypeSeries(connection, 'commun');
  const idSerie3eme = await ensureSerie(connection, {
    nomSerie: classeTroisieme,
    idType: idTypeCommun,
  });
  const idClasse3eme = await ensureClasseSerie(connection, {
    nomClasse: classeTroisieme,
    idSerie: idSerie3eme,
  });

  await connection.commit();
  console.log(JSON.stringify({
    ok: true,
    idTypeCommun,
    idSerie3eme,
    idClasse3eme,
  }));
} catch (error) {
  try {
    await connection.rollback();
  } catch {}
  console.error(JSON.stringify({
    ok: false,
    message: error?.message,
    code: error?.code,
    sqlMessage: error?.sqlMessage,
  }));
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
