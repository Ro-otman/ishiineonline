import { Router } from 'express';

import {
  getRooms,
  getSubjects,
  listParticipants,
} from '../controllers/ligue.controller.js';
import {
  leaderboard,
  startSubjectRun,
  submitRun,
} from '../controllers/ligueQuiz.controller.js';
import {
  listWhiteExamSubjects,
  startWhiteExamRun,
  submitWhiteExamRun,
} from '../controllers/whiteExam.controller.js';
import {
  getLigueProfile,
  registerToLigue,
} from '../controllers/ligueRegistration.controller.js';
import {
  listChallenges,
  postChallengeComment,
  saveChallengeSubmission,
  toggleLikeOnChallenge,
} from '../controllers/ligueChallenges.controller.js';
import { uploadUserPhoto } from '../middlewares/uploadUserPhoto.js';

const router = Router();

router.post('/register', uploadUserPhoto.single('photo'), registerToLigue);
router.get('/profile/:userId', getLigueProfile);

router.get('/rooms', getRooms);
router.get('/rooms/:roomId/subjects', getSubjects);
router.get('/rooms/:roomId/participants', listParticipants);

router.get('/challenges', listChallenges);
router.post('/challenges/:challengeId/comments', postChallengeComment);
router.post('/challenges/:challengeId/likes/toggle', toggleLikeOnChallenge);
router.post('/challenges/:challengeId/submission', saveChallengeSubmission);

router.post('/rooms/:roomId/subjects/:subjectId/run', startSubjectRun);
router.post('/runs/:runId/submit', submitRun);
router.get('/rooms/:roomId/leaderboard', leaderboard);
router.get('/white-exam/subjects', listWhiteExamSubjects);
router.post('/white-exam/subjects/:subjectId/run', startWhiteExamRun);
router.post('/white-exam/runs/:runId/submit', submitWhiteExamRun);

export default router;

