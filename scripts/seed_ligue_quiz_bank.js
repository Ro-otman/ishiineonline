import fs from 'node:fs/promises';

import 'dotenv/config';

import { getPool } from '../config/db.js';

const flutterDbHelperPath =
  process.argv[2] || 'C:/Users/Julius/ishiine/lib/db/db_helper.dart';

function repairText(value) {
  const raw = String(value ?? '');
  if (!raw) return '';

  try {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    const replacementCount = (repaired.match(/\uFFFD/g) || []).length;
    const rawReplacementCount = (raw.match(/\uFFFD/g) || []).length;
    if (replacementCount <= rawReplacementCount) {
      return repaired;
    }
  } catch {
    // ignore and keep raw
  }

  return raw;
}

function cleanText(value) {
  return repairText(String(value ?? '').replace(/''/g, "'")).trim();
}

function slug(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function keyOf(classe, matiere, type) {
  return `${slug(classe)}||${slug(matiere)}||${slug(type ?? '')}`;
}

function subjectKey(raw) {
  const normalized = slug(raw);
  if (normalized.includes('hist')) return 'histgeo';
  if (normalized.includes('math')) return 'maths';
  if (normalized.includes('franc')) return 'francais';
  if (normalized.includes('anglais')) return 'anglais';
  if (normalized.includes('philo')) return 'philosophie';
  if (normalized.includes('economie')) return 'economie';
  if (normalized.includes('svt')) return 'svt';
  if (normalized.includes('pct')) return 'pct';
  return normalized;
}

function buildQuestion(question, options, correctIndex) {
  return {
    question,
    options: options.map((text, index) => ({
      text,
      isCorrect: index === correctIndex,
    })),
  };
}

const fallbackTemplates = {
  maths: [
    buildQuestion('Quelle est la valeur de x dans 2x + 3 = 11 ?', ['2', '3', '4', '5'], 2),
    buildQuestion('Quelle est l aire d un rectangle de 6 cm sur 4 cm ?', ['10 cm²', '20 cm²', '24 cm²', '28 cm²'], 2),
    buildQuestion('Quelle fraction est equivalente a 3/4 ?', ['6/12', '9/12', '12/20', '15/16'], 1),
    buildQuestion('Combien vaut 5² ?', ['10', '20', '25', '30'], 2),
    buildQuestion('Quelle est la moyenne de 4, 6 et 8 ?', ['5', '6', '7', '8'], 1),
    buildQuestion('Si a = 4, combien vaut 3(a + 2) ?', ['12', '15', '18', '24'], 2),
    buildQuestion('Dans un triangle rectangle, le plus grand cote s appelle :', ['La hauteur', 'La mediane', 'L hypoténuse', 'La base'], 2),
    buildQuestion('20 % de 50 vaut :', ['5', '10', '15', '20'], 1),
    buildQuestion('1 kilometre correspond a :', ['100 m', '500 m', '1000 m', '10 000 m'], 2),
    buildQuestion('Combien vaut -3 + 7 ?', ['-10', '4', '10', '-4'], 1),
  ],
  francais: [
    buildQuestion('Dans la phrase "Le chat noir dort", quel est le nom commun ?', ['Le', 'chat', 'noir', 'dort'], 1),
    buildQuestion('Quel est l antonyme de "clair" ?', ['lumineux', 'obscur', 'simple', 'rapide'], 1),
    buildQuestion('Quel temps est employe dans "Nous chanterons demain" ?', ['Present', 'Imparfait', 'Futur simple', 'Passe compose'], 2),
    buildQuestion('Le mot de comparaison dans une phrase est souvent :', ['mais', 'comme', 'ou', 'car'], 1),
    buildQuestion('Dans "Les eleves travaillent", le sujet est :', ['travaillent', 'Les', 'eleves', 'Les eleves'], 3),
    buildQuestion('Quel mot est un adjectif qualificatif ?', ['rapidement', 'beaute', 'grand', 'courir'], 2),
    buildQuestion('Quel signe marque souvent une interrogation ?', [',', '.', '?', '!'], 2),
    buildQuestion('Quel est le synonyme de "rapide" ?', ['lent', 'prompt', 'faible', 'dur'], 1),
    buildQuestion('Dans "Il a fini son devoir", "a" est :', ['un verbe avoir', 'une preposition', 'un adjectif', 'un nom'], 0),
    buildQuestion('Le but principal d un paragraphe est de :', ['melanger plusieurs idees', 'developper une idee principale', 'supprimer le sens du texte', 'remplacer le titre'], 1),
  ],
  anglais: [
    buildQuestion('Complete: "I ___ to school every day."', ['go', 'goes', 'went', 'gone'], 0),
    buildQuestion('What is the past tense of "go" ?', ['goed', 'gone', 'went', 'going'], 2),
    buildQuestion('Choose the correct plural of "child".', ['childs', 'children', 'childes', 'childrens'], 1),
    buildQuestion('What is the opposite of "hot" ?', ['warm', 'cold', 'fast', 'late'], 1),
    buildQuestion('Which day comes after Monday ?', ['Sunday', 'Tuesday', 'Thursday', 'Friday'], 1),
    buildQuestion('Complete: "She ___ my friend."', ['am', 'are', 'is', 'be'], 2),
    buildQuestion('Which word means "bonjour" in English ?', ['Goodbye', 'Please', 'Hello', 'Thanks'], 2),
    buildQuestion('The comparative of "small" is :', ['smaller', 'more small', 'smallest', 'most small'], 0),
    buildQuestion('Complete: "There are ___ apples on the table."', ['some', 'anybody', 'much', 'a'], 0),
    buildQuestion('The modal verb "can" expresses :', ['ability', 'possession', 'time', 'place'], 0),
  ],
  histgeo: [
    buildQuestion('Une carte utilise une legende pour :', ['decorer le document', 'expliquer les symboles', 'remplacer le titre', 'indiquer l auteur uniquement'], 1),
    buildQuestion('L equateur partage la Terre en :', ['deux oceans', 'deux hemispheres', 'deux deserts', 'deux continents'], 1),
    buildQuestion('La densite de population mesure :', ['la richesse d un pays', 'le nombre d habitants par surface', 'la taille des villes', 'la temperature moyenne'], 1),
    buildQuestion('Une source historique peut etre :', ['seulement orale', 'seulement ecrite', 'orale, ecrite ou materielle', 'uniquement numerique'], 2),
    buildQuestion('Le climat correspond :', ['au temps qu il fait aujourd hui', 'a la moyenne du temps sur une longue duree', 'a la vitesse du vent', 'au relief d un pays'], 1),
    buildQuestion('Une migration est :', ['un type de climat', 'un deplacement de population', 'une production agricole', 'une frontiere politique'], 1),
    buildQuestion('Yamoussoukro est la capitale politique de :', ['la France', 'le Ghana', 'la Cote d Ivoire', 'le Benin'], 2),
    buildQuestion('Une ressource renouvelable est :', ['le petrole', 'le charbon', 'l energie solaire', 'le gaz naturel'], 2),
    buildQuestion('En histoire, une frise chronologique sert a :', ['classer les lieux', 'ordonner les evenements dans le temps', 'mesurer une distance', 'representer une population'], 1),
    buildQuestion('L agriculture consiste principalement a :', ['transformer des minerais', 'cultiver la terre et elever des animaux', 'fabriquer des machines', 'administrer un pays'], 1),
  ],
  pct: [
    buildQuestion('La formule chimique de l eau est :', ['O2', 'CO2', 'H2O', 'NaCl'], 2),
    buildQuestion('L appareil qui mesure la tension electrique est :', ['l amperemetre', 'le voltmetre', 'le thermometre', 'la balance'], 1),
    buildQuestion('Un bon conducteur electrique est :', ['le bois', 'le plastique', 'le cuivre', 'le verre'], 2),
    buildQuestion('Lors d une combustion complete, il faut principalement :', ['de l eau et du sel', 'un carburant et du dioxygene', 'du sable et du fer', 'de l azote et du sucre'], 1),
    buildQuestion('Le changement d etat liquide vers gaz s appelle :', ['fusion', 'solidification', 'vaporisation', 'liquefaction'], 2),
    buildQuestion('Une solution homogene est un melange :', ['ou l on distingue les constituants', 'uniforme a l oeil nu', 'toujours solide', 'toujours gazeux'], 1),
    buildQuestion('L unite de masse dans le Systeme international est :', ['le metre', 'le litre', 'le kilogramme', 'la seconde'], 2),
    buildQuestion('Un atome est constitue principalement :', ['d un noyau et d electrons', 'de muscles et de nerfs', 'de cellules et de tissus', 'd eau et de sel'], 0),
    buildQuestion('L intensite du courant se mesure en :', ['volt', 'watt', 'ampere', 'newton'], 2),
    buildQuestion('Dans un circuit simple, un interrupteur sert a :', ['augmenter la tension', 'ouvrir ou fermer le circuit', 'mesurer la resistance', 'produire de la lumiere'], 1),
  ],
  svt: [
    buildQuestion('La cellule est :', ['la plus grande unite du vivant', 'la plus petite unite du vivant', 'un organe', 'un tissu'], 1),
    buildQuestion('La photosynthese se fait surtout dans :', ['les racines', 'les feuilles vertes', 'les fleurs', 'les graines'], 1),
    buildQuestion('Le sang transporte notamment :', ['des roches', 'de l oxygene et des nutriments', 'du sable', 'de la lumiere'], 1),
    buildQuestion('L organe principal de la respiration chez l humain est :', ['le coeur', 'le foie', 'les poumons', 'le rein'], 2),
    buildQuestion('Dans une chaine alimentaire, un herbivore mange principalement :', ['des animaux', 'des plantes', 'des champignons uniquement', 'des roches'], 1),
    buildQuestion('Le role de la chlorophylle est de :', ['donner du calcium aux os', 'capter l energie lumineuse', 'digérer les aliments', 'produire du sang'], 1),
    buildQuestion('La vaccination permet surtout de :', ['provoquer une maladie grave', 'stimuler les defenses immunitaires', 'remplacer le sang', 'arreter la croissance'], 1),
    buildQuestion('Un ecosysteme comprend :', ['seulement les animaux', 'seulement les plantes', 'les etres vivants et leur milieu', 'uniquement le sol'], 2),
    buildQuestion('A la puberte, les changements du corps sont commandes en grande partie par :', ['les os', 'les hormones', 'les dents', 'les cheveux'], 1),
    buildQuestion('Le cerveau appartient au :', ['systeme digestif', 'systeme nerveux', 'systeme musculaire', 'systeme urinaire'], 1),
  ],
  philosophie: [
    buildQuestion('La philosophie cherche principalement a :', ['eviter les questions', 'questionner et comprendre', 'remplacer la science', 'supprimer le doute'], 1),
    buildQuestion('Une opinion se distingue d un savoir parce qu elle est :', ['toujours demontree', 'souvent personnelle et discutable', 'obligatoirement fausse', 'toujours scientifique'], 1),
    buildQuestion('La conscience est d abord :', ['la force physique', 'la connaissance de soi et de ses actes', 'le sommeil profond', 'une machine'], 1),
    buildQuestion('La liberte implique aussi :', ['l absence totale de choix', 'la responsabilite', 'le refus de penser', 'la violence'], 1),
    buildQuestion('La justice cherche a :', ['favoriser les plus forts', 'rendre a chacun ce qui lui est du', 'supprimer les lois', 'remplacer la morale'], 1),
    buildQuestion('Le travail permet notamment a l humain de :', ['transformer la nature', 'supprimer tout effort', 'vivre sans societe', 'ignorer la technique'], 0),
    buildQuestion('La verite s oppose d abord a :', ['la science', 'l erreur', 'la discussion', 'la methode'], 1),
    buildQuestion('La technique designe :', ['uniquement les machines numeriques', 'un ensemble de procedes et d outils', 'la nature sauvage', 'une emotion'], 1),
    buildQuestion('L Etat a pour role principal :', ['organiser la vie collective', 'remplacer la famille', 'supprimer les lois', 'interdire le travail'], 0),
    buildQuestion('Le bonheur ne se reduit pas toujours :', ['a une vie humaine', 'au plaisir immediat', 'a la reflexion', 'a la justice'], 1),
  ],
  economie: [
    buildQuestion('Un budget correspond a :', ['une punition financiere', 'un plan de recettes et de depenses', 'un type d entreprise', 'une taxe obligatoire'], 1),
    buildQuestion('L inflation designe :', ['la baisse generale des prix', 'la hausse generale des prix', 'la disparition de la monnaie', 'la hausse des salaires uniquement'], 1),
    buildQuestion('La demande represente :', ['ce que les producteurs vendent', 'ce que les consommateurs souhaitent acheter', 'les impots de l Etat', 'les stocks d une entreprise'], 1),
    buildQuestion('L offre represente :', ['les biens proposes a la vente', 'les besoins des menages', 'les depenses publiques', 'les imports uniquement'], 0),
    buildQuestion('L epargne est :', ['la totalite des revenus', 'la partie du revenu non consommee immediatement', 'un impot', 'une dette'], 1),
    buildQuestion('Une entreprise combine des facteurs de production comme :', ['travail et capital', 'soleil et pluie', 'sport et musique', 'route et television'], 0),
    buildQuestion('Le chomage concerne une personne qui :', ['travaille deja', 'ne cherche pas d emploi', 'est sans emploi et en cherche un', 'est retraitee'], 2),
    buildQuestion('Les impots servent notamment a financer :', ['les services publics', 'uniquement les loisirs prives', 'les profits personnels', 'les achats individuels'], 0),
    buildQuestion('Le marche est le lieu ou se rencontrent :', ['offre et demande', 'ecole et famille', 'sport et culture', 'ville et campagne'], 0),
    buildQuestion('Un menage est un agent economique qui :', ['produit uniquement des machines', 'consomme et peut epargner', 'vote les lois', 'controle la banque centrale'], 1),
  ],
};

function buildFallbackQuestions(programme) {
  const templates = fallbackTemplates[subjectKey(programme.nom_matiere)];
  if (!templates || templates.length < 10) {
    throw new Error(`Aucun fallback disponible pour ${programme.nom_matiere}`);
  }

  const classe = cleanText(programme.nom_classe);
  const matiere = cleanText(programme.nom_matiere);
  const serie = cleanText(programme.nom_type || '');
  const suffix = serie ? ` (${serie})` : '';

  return templates.slice(0, 10).map((quiz, index) => ({
    question: `[${classe} - ${matiere}${suffix}] ${quiz.question}`,
    options: quiz.options.map((option) => ({
      text: option.text,
      isCorrect: option.isCorrect,
    })),
    source: `fallback-${index + 1}`,
  }));
}

async function extractLocalQuizBank(filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const saRegex = /INSERT OR IGNORE INTO sa \(nom_sa, id_programme\) VALUES \('((?:''|[^'])*)', \(SELECT id_programme FROM programme WHERE id_matiere=\(SELECT id_matiere FROM matieres WHERE nom_matiere='((?:''|[^'])*)'\) AND id_classe=\(SELECT id_classe FROM classes WHERE nom_classe='((?:''|[^'])*)'\)(?: AND id_type=\(SELECT id_type FROM type_series WHERE nom_type='((?:''|[^'])*)'\))?\)\);/g;
  const entryRegex = /INSERT INTO quiz \(question, id_sa\) VALUES \('((?:''|[^'])*)', (\\d+)\);|INSERT INTO options \(opt_text, is_correct, id_quiz\) VALUES \('((?:''|[^'])*)', ([01]), (\\d+)\);/g;

  const saById = [];
  for (const match of source.matchAll(saRegex)) {
    saById.push({
      saName: cleanText(match[1]),
      nom_matiere: cleanText(match[2]),
      nom_classe: cleanText(match[3]),
      nom_type: match[4] ? cleanText(match[4]) : null,
    });
  }

  const grouped = new Map();
  let currentQuiz = null;
  for (const match of source.matchAll(entryRegex)) {
    const questionText = match[1];
    if (questionText !== undefined) {
      const saId = Number(match[2]);
      const sa = saById[saId - 1];
      if (!sa) {
        currentQuiz = null;
        continue;
      }

      currentQuiz = {
        question: cleanText(questionText),
        options: [],
        sa,
      };

      const key = keyOf(sa.nom_classe, sa.nom_matiere, sa.nom_type);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(currentQuiz);
      continue;
    }

    if (!currentQuiz) continue;
    currentQuiz.options.push({
      text: cleanText(match[3]),
      isCorrect: Number(match[4]) === 1,
    });
  }

  for (const [key, list] of grouped.entries()) {
    const normalized = [];
    const seen = new Set();
    for (const quiz of list) {
      const fingerprint = slug(quiz.question);
      if (!quiz.question || seen.has(fingerprint)) continue;
      if (quiz.options.length < 2 || !quiz.options.some((option) => option.isCorrect)) {
        continue;
      }
      normalized.push(quiz);
      seen.add(fingerprint);
    }
    grouped.set(key, normalized);
  }

  return grouped;
}

function pickQuestions(programme, localBank) {
  const key = keyOf(programme.nom_classe, programme.nom_matiere, programme.nom_type);
  const selected = [];
  const seen = new Set();

  for (const quiz of localBank.get(key) || []) {
    if (selected.length >= 10) break;
    const fingerprint = slug(quiz.question);
    if (seen.has(fingerprint)) continue;
    selected.push({
      question: quiz.question,
      options: quiz.options.map((option) => ({
        text: option.text,
        isCorrect: option.isCorrect,
      })),
      source: 'local',
      saName: quiz.sa.saName,
    });
    seen.add(fingerprint);
  }

  for (const quiz of buildFallbackQuestions(programme)) {
    if (selected.length >= 10) break;
    const fingerprint = slug(quiz.question);
    if (seen.has(fingerprint)) continue;
    selected.push(quiz);
    seen.add(fingerprint);
  }

  if (selected.length < 10) {
    throw new Error(
      `Impossible d'obtenir 10 quiz pour ${programme.nom_classe} / ${programme.nom_matiere} / ${programme.nom_type ?? '-'}`,
    );
  }

  return selected.slice(0, 10);
}

async function seed() {
  const localBank = await extractLocalQuizBank(flutterDbHelperPath);
  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    const [[saCountRow]] = await connection.query('SELECT COUNT(*) AS c FROM sa');
    const [[quizCountRow]] = await connection.query('SELECT COUNT(*) AS c FROM quiz');
    const [[optionCountRow]] = await connection.query('SELECT COUNT(*) AS c FROM `options`');

    if (Number(saCountRow.c) > 0 || Number(quizCountRow.c) > 0 || Number(optionCountRow.c) > 0) {
      throw new Error('La base en ligne contient deja des SA/quiz/options. Vider ces tables ou adapter le script avant de reseeder.');
    }

    const [programmeRows] = await connection.query(`
      SELECT p.id_programme, c.nom_classe, m.nom_matiere, ts.nom_type
      FROM programme p
      JOIN classes c ON c.id_classe = p.id_classe
      JOIN matieres m ON m.id_matiere = p.id_matiere
      LEFT JOIN type_series ts ON ts.id_type = p.id_type
      ORDER BY c.id_classe, COALESCE(ts.nom_type, ''), m.nom_matiere
    `);

    await connection.beginTransaction();

    let insertedSa = 0;
    let insertedQuiz = 0;
    let insertedOptions = 0;
    const summary = [];

    for (const programme of programmeRows) {
      const selected = pickQuestions(programme, localBank);
      const saName = cleanText(selected.find((quiz) => quiz.saName)?.saName || `Ligue ${programme.nom_matiere}`).slice(0, 255);

      const [saResult] = await connection.query(
        'INSERT INTO sa (nom_sa, id_programme) VALUES (?, ?)',
        [saName, programme.id_programme],
      );
      const idSa = Number(saResult.insertId);
      insertedSa += 1;

      const quizPlaceholders = selected.map(() => '(?, ?)').join(', ');
      const quizParams = [];
      for (const quiz of selected) {
        quizParams.push(cleanText(quiz.question), idSa);
      }
      const [quizResult] = await connection.query(
        `INSERT INTO quiz (question, id_sa) VALUES ${quizPlaceholders}`,
        quizParams,
      );
      const firstQuizId = Number(quizResult.insertId);
      const quizIds = selected.map((_, index) => firstQuizId + index);
      insertedQuiz += selected.length;

      const optionPlaceholders = [];
      const optionParams = [];
      let localUsed = 0;
      let fallbackUsed = 0;

      for (const [index, quiz] of selected.entries()) {
        const idQuiz = quizIds[index];
        if (quiz.source === 'local') {
          localUsed += 1;
        } else {
          fallbackUsed += 1;
        }

        for (const option of quiz.options) {
          optionPlaceholders.push('(?, ?, ?)');
          optionParams.push(cleanText(option.text), option.isCorrect ? 1 : 0, idQuiz);
        }
      }

      if (optionPlaceholders.length === 0) {
        throw new Error(`Aucune option a inserer pour ${programme.nom_classe} / ${programme.nom_matiere}`);
      }

      await connection.query(
        `INSERT INTO \`options\` (opt_text, is_correct, id_quiz) VALUES ${optionPlaceholders.join(', ')}`,
        optionParams,
      );
      insertedOptions += optionPlaceholders.length;

      summary.push({
        classe: cleanText(programme.nom_classe),
        matiere: cleanText(programme.nom_matiere),
        type: cleanText(programme.nom_type || ''),
        localUsed,
        fallbackUsed,
      });
    }

    await connection.commit();

    console.log(
      JSON.stringify(
        {
          programmes: programmeRows.length,
          insertedSa,
          insertedQuiz,
          insertedOptions,
          summary,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('[seed_ligue_quiz_bank] rollback skipped', rollbackError?.message || rollbackError);
    }

    console.error('[seed_ligue_quiz_bank] failed', {
      message: error?.message,
      code: error?.code,
      sqlMessage: error?.sqlMessage,
      stack: error?.stack,
    });
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

await seed();
