import { env } from '../config/env.js';
import {
  createQuizFromDashboard,
  getAdminContentPageData,
  getAdminLiguePageData,
  getAdminOverviewPageData,
  getAdminPaymentsPageData,
  getAdminUsersPageData,
  saveLigueSettingsFromDashboard,
} from '../models/adminDashboard.model.js';

function normalizeForm(body = {}) {
  return {
    id_programme: String(body.id_programme ?? '').trim(),
    sa_name: String(body.sa_name ?? '').trim(),
    question: String(body.question ?? '').trim(),
    difficulty: String(body.difficulty ?? 'moyen').trim() || 'moyen',
    timer_seconds: String(body.timer_seconds ?? '30').trim() || '30',
    explanation: String(body.explanation ?? '').trim(),
    tip: String(body.tip ?? '').trim(),
    option_a: String(body.option_a ?? '').trim(),
    option_b: String(body.option_b ?? '').trim(),
    option_c: String(body.option_c ?? '').trim(),
    option_d: String(body.option_d ?? '').trim(),
    correct_option: String(body.correct_option ?? '0').trim(),
  };
}

function normalizeLeagueSettingsForm(body = {}) {
  return {
    edit_setting_id: String(body.edit_setting_id ?? '').trim(),
    id_classe: String(body.id_classe ?? '').trim(),
    id_type: String(body.id_type ?? '').trim(),
    starts_at: String(body.starts_at ?? '').trim(),
    questions_per_subject: String(body.questions_per_subject ?? '10').trim() || '10',
    margin_seconds: String(body.margin_seconds ?? '15').trim() || '15',
    break_minutes: String(body.break_minutes ?? '5').trim() || '5',
  };
}

function buildHelpers() {
  return {
    number(value) {
      return new Intl.NumberFormat('fr-FR').format(Number(value || 0));
    },
    money(value) {
      return new Intl.NumberFormat('fr-FR').format(Number(value || 0));
    },
    dateTime(value) {
      if (!value) return 'Non renseigne';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString('fr-FR');
    },
    date(value) {
      if (!value) return 'Non renseigne';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString('fr-FR');
    },
  };
}

async function renderAdminView(res, { statusCode = 200, view, page, data, feedback = {}, form = {} } = {}) {
  return res.status(statusCode).render(`admin/${view}`, {
    appTitle: env.ADMIN_DASHBOARD_TITLE || 'iShiine Admin',
    page,
    data,
    helpers: buildHelpers(),
    feedback: {
      success: String(feedback.success || '').trim(),
      error: String(feedback.error || '').trim(),
    },
    form,
  });
}

export async function renderAdminOverview(req, res, next) {
  try {
    const data = await getAdminOverviewPageData();
    await renderAdminView(res, {
      view: 'overview',
      page: {
        section: 'overview',
        title: 'Vue d ensemble',
        kicker: 'Pilotage global',
        intro: 'Un panorama clair de l application avec les indicateurs qui comptent vraiment.',
      },
      data,
      feedback: { success: req.query?.success, error: req.query?.error },
    });
  } catch (error) {
    next(error);
  }
}

export async function renderAdminUsers(req, res, next) {
  try {
    const data = await getAdminUsersPageData();
    await renderAdminView(res, {
      view: 'users',
      page: {
        section: 'users',
        title: 'Utilisateurs',
        kicker: 'Population',
        intro: 'Suis la croissance de ta communaute, les abonnements et les classes les plus actives.',
      },
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function renderAdminContent(req, res, next) {
  try {
    const data = await getAdminContentPageData();
    await renderAdminView(res, {
      view: 'content',
      page: {
        section: 'content',
        title: 'Contenu pedagogique',
        kicker: 'Creation',
        intro: 'Ajoute de nouveaux quiz, garde un oeil sur les programmes et les matieres les plus fournies.',
      },
      data,
      feedback: { success: req.query?.success, error: req.query?.error },
      form: { timer_seconds: '30' },
    });
  } catch (error) {
    next(error);
  }
}

export async function renderAdminLigue(req, res, next) {
  try {
    const editSettingId = Number.parseInt(String(req.query?.edit ?? ''), 10);
    const data = await getAdminLiguePageData({
      editSettingId: Number.isFinite(editSettingId) ? editSettingId : null,
    });
    await renderAdminView(res, {
      view: 'ligue',
      page: {
        section: 'ligue',
        title: 'Reglages de ligue',
        kicker: 'Planning',
        intro: 'Regle les sessions par classe et type de serie. Le temps des questions vient maintenant directement des quiz.',
      },
      data,
      feedback: { success: req.query?.success, error: req.query?.error },
      form: data.defaults,
    });
  } catch (error) {
    next(error);
  }
}

export async function renderAdminPayments(req, res, next) {
  try {
    const data = await getAdminPaymentsPageData();
    await renderAdminView(res, {
      view: 'payments',
      page: {
        section: 'payments',
        title: 'Paiements et revenus',
        kicker: 'Monetisation',
        intro: 'Une lecture propre des abonnements et du revenu estime, prete a accueillir la vraie synchronisation FedaPay.',
      },
      data,
    });
  } catch (error) {
    next(error);
  }
}

export async function createAdminQuiz(req, res, next) {
  const form = normalizeForm(req.body);
  try {
    const created = await createQuizFromDashboard(form);
    const success = encodeURIComponent(`Quiz ajoute avec succes (#${created.id_quiz}).`);
    return res.redirect(`/admin/content?success=${success}`);
  } catch (error) {
    try {
      const data = await getAdminContentPageData();
      await renderAdminView(res, {
        statusCode: Number(error?.statusCode) || 400,
        view: 'content',
        page: {
          section: 'content',
          title: 'Contenu pedagogique',
          kicker: 'Creation',
          intro: 'Ajoute de nouveaux quiz, garde un oeil sur les programmes et les matieres les plus fournies.',
        },
        data,
        feedback: { error: error?.message || 'Impossible d ajouter le quiz pour le moment.' },
        form,
      });
    } catch (renderError) {
      next(renderError);
    }
  }
}

export async function saveAdminLigueSettings(req, res, next) {
  const form = normalizeLeagueSettingsForm(req.body);
  try {
    const saved = await saveLigueSettingsFromDashboard(form);
    const target = `${saved.nom_classe} / ${saved.nom_type}`;
    const success = encodeURIComponent(`Reglages de ligue enregistres pour ${target}.`);
    return res.redirect(`/admin/ligue?success=${success}`);
  } catch (error) {
    try {
      const editSettingId = Number.parseInt(String(form.edit_setting_id || ''), 10);
      const data = await getAdminLiguePageData({
        editSettingId: Number.isFinite(editSettingId) ? editSettingId : null,
      });
      await renderAdminView(res, {
        statusCode: Number(error?.statusCode) || 400,
        view: 'ligue',
        page: {
          section: 'ligue',
          title: 'Reglages de ligue',
          kicker: 'Planning',
          intro: 'Regle les sessions par classe et type de serie. Le temps des questions vient maintenant directement des quiz.',
        },
        data,
        feedback: { error: error?.message || 'Impossible d enregistrer ces reglages pour le moment.' },
        form,
      });
    } catch (renderError) {
      next(renderError);
    }
  }
}
