import { execute } from '../config/db.js';

export async function listMatieresForClasseAndType({ id_classe, id_type }) {
  return execute(
    `
      SELECT DISTINCT
        m.id_matiere,
        m.nom_matiere
      FROM programme p
      JOIN matieres m ON m.id_matiere = p.id_matiere
      WHERE p.id_classe = ?
        AND (p.id_type IS NULL OR p.id_type = ?)
      ORDER BY m.nom_matiere ASC
    `,
    [id_classe, id_type]
  );
}

export async function getMatiereById(id_matiere) {
  const rows = await execute(
    `
      SELECT id_matiere, nom_matiere
      FROM matieres
      WHERE id_matiere = ?
      LIMIT 1
    `,
    [id_matiere],
  );

  return rows[0] ?? null;
}
