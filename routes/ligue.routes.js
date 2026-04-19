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
import {
  createDuelInvite,
  getDuelInvite,
  getDuelResult,
  listMyDuels,
  startDuelRun,
  submitDuelRun,
} from '../controllers/friendDuels.controller.js';
import { uploadUserPhoto } from '../middlewares/uploadUserPhoto.js';
import { requireUserAuth } from '../middlewares/userAuth.js';

const router = Router();

router.post('/register', requireUserAuth, uploadUserPhoto.single('photo'), registerToLigue);
router.get('/profile/me', requireUserAuth, getLigueProfile);
router.get('/profile/:userId', requireUserAuth, getLigueProfile);

router.get('/rooms', getRooms);
router.get('/rooms/:roomId/subjects', getSubjects);
router.get('/rooms/:roomId/participants', listParticipants);

router.get('/challenges', requireUserAuth, listChallenges);
router.post('/challenges/:challengeId/comments', requireUserAuth, postChallengeComment);
router.post('/challenges/:challengeId/likes/toggle', requireUserAuth, toggleLikeOnChallenge);
router.post('/challenges/:challengeId/submission', requireUserAuth, saveChallengeSubmission);

router.get('/duels/history', requireUserAuth, listMyDuels);
router.post('/duels', requireUserAuth, createDuelInvite);
router.post('/duels/runs/:runId/submit', requireUserAuth, submitDuelRun);
router.get('/duels/:code/result', requireUserAuth, getDuelResult);
router.get('/duels/:code', requireUserAuth, getDuelInvite);
router.post('/duels/:code/run', requireUserAuth, startDuelRun);

router.post('/rooms/:roomId/subjects/:subjectId/run', requireUserAuth, startSubjectRun);
router.post('/runs/:runId/submit', requireUserAuth, submitRun);
router.get('/rooms/:roomId/leaderboard', leaderboard);
router.get('/white-exam/subjects', listWhiteExamSubjects);
router.post('/white-exam/subjects/:subjectId/run', requireUserAuth, startWhiteExamRun);
router.post('/white-exam/runs/:runId/submit', requireUserAuth, submitWhiteExamRun);

export default router;

