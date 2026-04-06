-- Insert a weekly challenge in the online database.
-- Replace the placeholders before executing.

INSERT INTO ligue_challenges (
  week_key,
  title,
  prompt,
  subject,
  difficulty,
  author_name,
  author_verified_blue,
  reward_points,
  base_participants,
  estimated_minutes,
  deadline_at,
  featured,
  sort_order,
  is_active
) VALUES (
  '2026-04-06',
  '<CHALLENGE_TITLE>',
  '<CHALLENGE_PROMPT>',
  '<SUBJECT>',
  '<DIFFICULTY>',
  '<AUTHOR_NAME>',
  0,
  50,
  0,
  10,
  '2026-04-12 23:59:59',
  0,
  1,
  1
);

-- Verify the inserted weekly challenges.
SELECT
  id_challenge,
  week_key,
  title,
  subject,
  difficulty,
  author_name,
  reward_points,
  estimated_minutes,
  deadline_at,
  featured,
  sort_order,
  is_active
FROM ligue_challenges
WHERE week_key = '2026-04-06'
ORDER BY featured DESC, sort_order ASC, id_challenge ASC;
