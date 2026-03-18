-- ishiineOnline - MySQL schema
-- Aligné avec la base locale (SQLite) définie dans: lib/db/db_helper.dart

-- Optionnel:
-- CREATE DATABASE ishiine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE ishiine;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS ligue_run_answers;
DROP TABLE IF EXISTS ligue_run_questions;
DROP TABLE IF EXISTS ligue_runs;
DROP TABLE IF EXISTS ligue_profiles;

DROP TABLE IF EXISTS weekly_qualifications;
DROP TABLE IF EXISTS league_history;
DROP TABLE IF EXISTS user_badges;
DROP TABLE IF EXISTS badge_definitions;
DROP TABLE IF EXISTS xp_events;
DROP TABLE IF EXISTS player_profile;
DROP TABLE IF EXISTS weekly_stats;
DROP TABLE IF EXISTS weekly_goals;
DROP TABLE IF EXISTS mastery_sa;
DROP TABLE IF EXISTS review_logs;
DROP TABLE IF EXISTS review_items;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS attempts;
DROP TABLE IF EXISTS quiz_explanations;
DROP TABLE IF EXISTS `options`;
DROP TABLE IF EXISTS quiz;
DROP TABLE IF EXISTS sa;
DROP TABLE IF EXISTS programme;
DROP TABLE IF EXISTS matieres;
DROP TABLE IF EXISTS classe_serie;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS series;
DROP TABLE IF EXISTS type_series;
DROP TABLE IF EXISTS niveaux;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id_users VARCHAR(255) PRIMARY KEY,
  nom VARCHAR(255) NOT NULL,
  prenoms VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  classe VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  img_path TEXT,
  is_subscribed TINYINT(1) NOT NULL,
  subscription_date VARCHAR(32),
  subscription_expiry VARCHAR(32),
  first_use_time VARCHAR(32)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE niveaux (
  id_niveau INT AUTO_INCREMENT PRIMARY KEY,
  nom_niveau VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_niveaux_nom (nom_niveau)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE type_series (
  id_type INT AUTO_INCREMENT PRIMARY KEY,
  nom_type VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_type_series_nom (nom_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE series (
  id_serie INT AUTO_INCREMENT PRIMARY KEY,
  nom_serie VARCHAR(255) NOT NULL,
  id_type INT NOT NULL,
  UNIQUE KEY uq_series_nom_type (nom_serie, id_type),
  CONSTRAINT fk_series_type FOREIGN KEY (id_type)
    REFERENCES type_series(id_type)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE classes (
  id_classe INT AUTO_INCREMENT PRIMARY KEY,
  nom_classe VARCHAR(255) NOT NULL,
  id_niveau INT NOT NULL,
  UNIQUE KEY uq_classes_nom_niveau (nom_classe, id_niveau),
  CONSTRAINT fk_classes_niveau FOREIGN KEY (id_niveau)
    REFERENCES niveaux(id_niveau)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE classe_serie (
  id_classe_serie INT AUTO_INCREMENT PRIMARY KEY,
  id_classe INT NOT NULL,
  id_serie INT NOT NULL,
  UNIQUE KEY uq_classe_serie_pair (id_classe, id_serie),
  CONSTRAINT fk_classe_serie_classe FOREIGN KEY (id_classe)
    REFERENCES classes(id_classe)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_classe_serie_serie FOREIGN KEY (id_serie)
    REFERENCES series(id_serie)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE matieres (
  id_matiere INT AUTO_INCREMENT PRIMARY KEY,
  nom_matiere VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_matieres_nom (nom_matiere)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE programme (
  id_programme INT AUTO_INCREMENT PRIMARY KEY,
  id_matiere INT NOT NULL,
  id_classe INT NOT NULL,
  id_type INT NULL,
  UNIQUE KEY uq_programme_combo (id_matiere, id_classe, id_type),
  CONSTRAINT fk_programme_matiere FOREIGN KEY (id_matiere)
    REFERENCES matieres(id_matiere)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_programme_classe FOREIGN KEY (id_classe)
    REFERENCES classes(id_classe)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_programme_type FOREIGN KEY (id_type)
    REFERENCES type_series(id_type)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sa (
  id_sa INT AUTO_INCREMENT PRIMARY KEY,
  nom_sa VARCHAR(255) NOT NULL,
  id_programme INT NOT NULL,
  CONSTRAINT fk_sa_programme FOREIGN KEY (id_programme)
    REFERENCES programme(id_programme)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quiz (
  id_quiz INT AUTO_INCREMENT PRIMARY KEY,
  question TEXT NOT NULL,
  id_sa INT,
  CONSTRAINT fk_quiz_sa FOREIGN KEY (id_sa)
    REFERENCES sa(id_sa)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `options` (
  id_options INT AUTO_INCREMENT PRIMARY KEY,
  opt_text TEXT NOT NULL,
  is_correct TINYINT(1) NOT NULL,
  id_quiz INT,
  CONSTRAINT fk_options_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE quiz_explanations (
  id_quiz INT PRIMARY KEY,
  explanation TEXT,
  tip TEXT,
  distractor_note TEXT,
  difficulty VARCHAR(64),
  CONSTRAINT fk_quiz_explanations_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attempts (
  id_attempt INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  id_quiz INT NOT NULL,
  selected_option TEXT,
  is_correct TINYINT(1) NOT NULL,
  response_time_ms INT,
  mode VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT fk_attempts_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_attempts_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sessions (
  id_session INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  id_sa INT NOT NULL,
  mode VARCHAR(64) NOT NULL,
  started_at VARCHAR(32) NOT NULL,
  ended_at VARCHAR(32),
  score DOUBLE,
  CONSTRAINT fk_sessions_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_sessions_sa FOREIGN KEY (id_sa)
    REFERENCES sa(id_sa)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_items (
  id_review INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  id_quiz INT NOT NULL,
  next_review_at VARCHAR(32) NOT NULL,
  interval_days INT NOT NULL DEFAULT 1,
  easiness DOUBLE NOT NULL DEFAULT 2.5,
  repetition INT NOT NULL DEFAULT 0,
  last_result INT,
  UNIQUE KEY uq_review_items_user_quiz (id_user, id_quiz),
  CONSTRAINT fk_review_items_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_review_items_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE review_logs (
  id_log INT AUTO_INCREMENT PRIMARY KEY,
  id_review INT NOT NULL,
  reviewed_at VARCHAR(32) NOT NULL,
  is_correct TINYINT(1) NOT NULL,
  CONSTRAINT fk_review_logs_review FOREIGN KEY (id_review)
    REFERENCES review_items(id_review)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE mastery_sa (
  id_user VARCHAR(255) NOT NULL,
  id_sa INT NOT NULL,
  mastery_score DOUBLE NOT NULL DEFAULT 0,
  status VARCHAR(64) NOT NULL DEFAULT 'en_cours',
  updated_at VARCHAR(32) NOT NULL,
  PRIMARY KEY (id_user, id_sa),
  CONSTRAINT fk_mastery_sa_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_mastery_sa_sa FOREIGN KEY (id_sa)
    REFERENCES sa(id_sa)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weekly_goals (
  id_goal INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  week_key VARCHAR(32) NOT NULL,
  target_sessions INT NOT NULL DEFAULT 5,
  target_accuracy DOUBLE NOT NULL DEFAULT 70,
  achieved TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_weekly_goals_user_week (id_user, week_key),
  CONSTRAINT fk_weekly_goals_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weekly_stats (
  id_user VARCHAR(255) NOT NULL,
  week_key VARCHAR(32) NOT NULL,
  sessions_count INT NOT NULL DEFAULT 0,
  reviewed_count INT NOT NULL DEFAULT 0,
  avg_score DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (id_user, week_key),
  CONSTRAINT fk_weekly_stats_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE player_profile (
  id_user VARCHAR(255) PRIMARY KEY,
  xp_total INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  current_streak INT NOT NULL DEFAULT 0,
  best_streak INT NOT NULL DEFAULT 0,
  league VARCHAR(64) NOT NULL DEFAULT 'Non qualifie',
  xp_boost_multiplier DOUBLE NOT NULL DEFAULT 1.0,
  xp_boost_expires_at VARCHAR(32),
  last_activity_at VARCHAR(32),
  updated_at VARCHAR(32) NOT NULL,
  CONSTRAINT fk_player_profile_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE xp_events (
  id_xp INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  source VARCHAR(64) NOT NULL,
  source_ref VARCHAR(255),
  xp INT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  CONSTRAINT fk_xp_events_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE badge_definitions (
  id_badge INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(64) NOT NULL,
  rarity VARCHAR(64) NOT NULL,
  level_unlock INT NOT NULL DEFAULT 1,
  condition_type VARCHAR(64) NOT NULL,
  condition_value INT NOT NULL,
  UNIQUE KEY uq_badge_definitions_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_badges (
  id_user_badge INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  id_badge INT NOT NULL,
  progress INT NOT NULL DEFAULT 0,
  unlocked_at VARCHAR(32),
  equipped TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_user_badges_user_badge (id_user, id_badge),
  CONSTRAINT fk_user_badges_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_user_badges_badge FOREIGN KEY (id_badge)
    REFERENCES badge_definitions(id_badge)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE league_history (
  id_entry INT AUTO_INCREMENT PRIMARY KEY,
  id_user VARCHAR(255) NOT NULL,
  week_key VARCHAR(32) NOT NULL,
  league VARCHAR(64) NOT NULL,
  xp_week INT NOT NULL DEFAULT 0,
  updated_at VARCHAR(32) NOT NULL,
  UNIQUE KEY uq_league_history_user_week (id_user, week_key),
  CONSTRAINT fk_league_history_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE weekly_qualifications (
  id_user VARCHAR(255) NOT NULL,
  week_key VARCHAR(32) NOT NULL,
  target_league VARCHAR(64) NOT NULL,
  sessions_count INT NOT NULL DEFAULT 0,
  reviewed_count INT NOT NULL DEFAULT 0,
  avg_score DOUBLE NOT NULL DEFAULT 0,
  acquired_sa_count INT NOT NULL DEFAULT 0,
  required_level INT NOT NULL DEFAULT 1,
  qualified TINYINT(1) NOT NULL DEFAULT 0,
  qualified_at VARCHAR(32),
  synced TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id_user, week_key, target_league),
  CONSTRAINT fk_weekly_qualifications_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes (alignés avec SQLite)
CREATE INDEX idx_classe_serie_serie ON classe_serie(id_serie);
CREATE INDEX idx_programme_matiere ON programme(id_matiere);
CREATE INDEX idx_programme_classe ON programme(id_classe);
CREATE INDEX idx_programme_type ON programme(id_type);
CREATE INDEX idx_sa_programme ON sa(id_programme);
CREATE INDEX idx_quiz_sa ON quiz(id_sa);

CREATE INDEX idx_attempts_user_created ON attempts(id_user, created_at);
CREATE INDEX idx_attempts_quiz ON attempts(id_quiz);

CREATE INDEX idx_sessions_user_started ON sessions(id_user, started_at);
CREATE INDEX idx_sessions_sa ON sessions(id_sa);

CREATE INDEX idx_review_items_user_due ON review_items(id_user, next_review_at);
CREATE INDEX idx_review_items_quiz ON review_items(id_quiz);
CREATE INDEX idx_review_logs_review_date ON review_logs(id_review, reviewed_at);

CREATE INDEX idx_mastery_sa_user_status ON mastery_sa(id_user, status);
CREATE INDEX idx_mastery_sa_updated ON mastery_sa(updated_at);

CREATE INDEX idx_player_profile_level ON player_profile(level);
CREATE INDEX idx_xp_events_user_date ON xp_events(id_user, created_at);
CREATE INDEX idx_user_badges_user_unlock ON user_badges(id_user, unlocked_at);
CREATE INDEX idx_league_history_user_week ON league_history(id_user, week_key);
CREATE INDEX idx_weekly_qualifications_user_week ON weekly_qualifications(id_user, week_key);

-- Seeds minimales (référence)
INSERT INTO niveaux (nom_niveau) VALUES ('premier_cycle'), ('second_cycle');

INSERT INTO type_series (nom_type) VALUES
  ('scientifique'),
  ('littéraire'),
  ('economique');

INSERT INTO series (nom_serie, id_type)
SELECT 'C', id_type FROM type_series WHERE nom_type = 'scientifique'
UNION ALL
SELECT 'D', id_type FROM type_series WHERE nom_type = 'scientifique'
UNION ALL
SELECT 'A1', id_type FROM type_series WHERE nom_type = 'littéraire'
UNION ALL
SELECT 'A2', id_type FROM type_series WHERE nom_type = 'littéraire'
UNION ALL
SELECT 'B', id_type FROM type_series WHERE nom_type = 'economique';

INSERT INTO classes (nom_classe, id_niveau)
SELECT '3ème', id_niveau FROM niveaux WHERE nom_niveau = 'premier_cycle';

INSERT INTO classes (nom_classe, id_niveau)
SELECT '2nd', id_niveau FROM niveaux WHERE nom_niveau = 'second_cycle'
UNION ALL
SELECT '1ère', id_niveau FROM niveaux WHERE nom_niveau = 'second_cycle'
UNION ALL
SELECT 'Tle', id_niveau FROM niveaux WHERE nom_niveau = 'second_cycle';

INSERT IGNORE INTO classe_serie (id_classe, id_serie)
SELECT c.id_classe, s.id_serie
FROM classes c
JOIN series s
WHERE c.nom_classe = '3ème' AND s.nom_serie = '3ème';

INSERT IGNORE INTO classe_serie (id_classe, id_serie)
SELECT c.id_classe, s.id_serie
FROM classes c
JOIN series s
WHERE c.nom_classe = '2nd' AND s.nom_serie IN ('C', 'D', 'A1', 'A2', 'B');

INSERT IGNORE INTO classe_serie (id_classe, id_serie)
SELECT c.id_classe, s.id_serie
FROM classes c
JOIN series s
WHERE c.nom_classe = '1ère' AND s.nom_serie IN ('C', 'D', 'A1', 'A2', 'B');

INSERT IGNORE INTO classe_serie (id_classe, id_serie)
SELECT c.id_classe, s.id_serie
FROM classes c
JOIN series s
WHERE c.nom_classe = 'Tle' AND s.nom_serie IN ('C', 'D', 'A1', 'A2', 'B');

INSERT INTO matieres (nom_matiere) VALUES
  ('Hist-Géo'),
  ('Maths'),
  ('Français'),
  ('PCT'),
  ('Anglais'),
  ('Philosophie'),
  ('SVT'),
  ('Economie');

-- programme: commun collège (3ème)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, NULL
FROM matieres m
JOIN classes c ON c.nom_classe = '3ème'
WHERE m.nom_matiere IN ('Hist-Géo', 'Maths', 'Français', 'Anglais', 'PCT', 'SVT');

-- programme: commun lycée (2nd, 1ère, Tle)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, NULL
FROM matieres m
JOIN classes c ON c.nom_classe IN ('2nd', '1ère', 'Tle')
WHERE m.nom_matiere IN ('Hist-Géo', 'Maths', 'Français', 'Philosophie', 'Anglais');

-- programme: PCT + SVT (scientifique)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, t.id_type
FROM matieres m
JOIN classes c ON c.nom_classe IN ('2nd', '1ère', 'Tle')
JOIN type_series t ON t.nom_type = 'scientifique'
WHERE m.nom_matiere IN ('PCT', 'SVT');

-- programme: SVT (littéraire)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, t.id_type
FROM matieres m
JOIN classes c ON c.nom_classe IN ('2nd', '1ère', 'Tle')
JOIN type_series t ON t.nom_type = 'littéraire'
WHERE m.nom_matiere = 'SVT';

-- programme: SVT (économique)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, t.id_type
FROM matieres m
JOIN classes c ON c.nom_classe IN ('2nd', '1ère', 'Tle')
JOIN type_series t ON t.nom_type = 'economique'
WHERE m.nom_matiere = 'SVT';

-- programme: Economie (économique)
INSERT INTO programme (id_matiere, id_classe, id_type)
SELECT m.id_matiere, c.id_classe, t.id_type
FROM matieres m
JOIN classes c ON c.nom_classe IN ('2nd', '1ère', 'Tle')
JOIN type_series t ON t.nom_type = 'economique'
WHERE m.nom_matiere = 'Economie';


-- Parité SQLite: index supplémentaire (déjà couvert par l'unique, mais gardé pour correspondance)
CREATE INDEX idx_matieres_nom ON matieres(nom_matiere);


-- Ligue (schedule) - géré par l'administrateur en base
DROP TABLE IF EXISTS ligue_settings;

CREATE TABLE ligue_settings (
  id_setting INT AUTO_INCREMENT PRIMARY KEY,
  id_classe INT NOT NULL,
  id_type INT NULL,
  starts_at DATETIME NOT NULL,
  seconds_per_question INT NOT NULL,
  questions_per_subject INT NOT NULL,
  margin_seconds INT NOT NULL,
  break_seconds INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ligue_settings_classe FOREIGN KEY (id_classe)
    REFERENCES classes(id_classe)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_settings_type FOREIGN KEY (id_type)
    REFERENCES type_series(id_type)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_ligue_settings_classe_type ON ligue_settings(id_classe, id_type, updated_at);


-- Ligue (inscription Flutter)
CREATE TABLE ligue_profiles (
  id_user VARCHAR(255) PRIMARY KEY,
  handle VARCHAR(64) NOT NULL,
  salle_key VARCHAR(32) NOT NULL,
  serie_key VARCHAR(32),
  registered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ligue_profiles_handle (handle),
  CONSTRAINT fk_ligue_profiles_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- Ligue (live) - runs/results
CREATE TABLE ligue_runs (
  id_run CHAR(36) PRIMARY KEY,
  week_key VARCHAR(32) NOT NULL,
  id_user VARCHAR(255) NOT NULL,
  id_classe INT NOT NULL,
  id_serie INT NOT NULL,
  id_matiere INT NOT NULL,

  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,

  total_questions INT NOT NULL,
  correct_count INT NOT NULL DEFAULT 0,
  total_response_time_ms INT NOT NULL DEFAULT 0,
  score_percent DOUBLE NOT NULL DEFAULT 0,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_ligue_runs_unique (week_key, id_user, id_classe, id_serie, id_matiere),
  KEY idx_ligue_runs_room_week (week_key, id_classe, id_serie),
  KEY idx_ligue_runs_user_week (week_key, id_user),

  CONSTRAINT fk_ligue_runs_user FOREIGN KEY (id_user)
    REFERENCES users(id_users)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_runs_classe FOREIGN KEY (id_classe)
    REFERENCES classes(id_classe)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_runs_serie FOREIGN KEY (id_serie)
    REFERENCES series(id_serie)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_runs_matiere FOREIGN KEY (id_matiere)
    REFERENCES matieres(id_matiere)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ligue_run_questions (
  id_run CHAR(36) NOT NULL,
  question_index INT NOT NULL,
  id_quiz INT NOT NULL,

  PRIMARY KEY (id_run, question_index),
  UNIQUE KEY uq_ligue_run_questions_run_quiz (id_run, id_quiz),
  KEY idx_ligue_run_questions_quiz (id_quiz),

  CONSTRAINT fk_ligue_run_questions_run FOREIGN KEY (id_run)
    REFERENCES ligue_runs(id_run)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_run_questions_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ligue_run_answers (
  id_run CHAR(36) NOT NULL,
  id_quiz INT NOT NULL,
  id_options INT NULL,

  is_correct TINYINT(1) NOT NULL,
  response_time_ms INT,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id_run, id_quiz),
  KEY idx_ligue_run_answers_run (id_run),

  CONSTRAINT fk_ligue_run_answers_run FOREIGN KEY (id_run)
    REFERENCES ligue_runs(id_run)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_run_answers_quiz FOREIGN KEY (id_quiz)
    REFERENCES quiz(id_quiz)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  CONSTRAINT fk_ligue_run_answers_option FOREIGN KEY (id_options)
    REFERENCES `options`(id_options)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

