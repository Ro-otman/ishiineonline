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
  getLigueProfile,
  registerToLigue,
} from '../controllers/ligueRegistration.controller.js';
import { uploadUserPhoto } from '../middlewares/uploadUserPhoto.js';

const router = Router();

router.post('/register', uploadUserPhoto.single('photo'), registerToLigue);
router.get('/profile/:userId', getLigueProfile);

router.get('/rooms', getRooms);
router.get('/rooms/:roomId/subjects', getSubjects);
router.get('/rooms/:roomId/participants', listParticipants);

router.post('/rooms/:roomId/subjects/:subjectId/run', startSubjectRun);
router.post('/runs/:runId/submit', submitRun);
router.get('/rooms/:roomId/leaderboard', leaderboard);

export default router;
