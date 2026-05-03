import { getUserChannel } from '../services/realtimeGateway.service.js';
import { sendConnectivitySystemNotifications } from '../services/notificationAutomation.service.js';
import { verifyUserAccessToken } from '../services/userJwt.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function resolveSocketUser(payload) {
  const token = asString(payload?.accessToken || payload?.token);
  if (!token) {
    const error = new Error('Connexion utilisateur requise.');
    error.code = 'USER_AUTH_REQUIRED';
    throw error;
  }
  return verifyUserAccessToken(token);
}

export function registerNotificationSockets(io) {
  io.on('connection', (socket) => {
    let activeUserId = null;

    socket.on('notifications:subscribe', (payload, ack) => {
      try {
        const session = resolveSocketUser(payload);
        const requestedUserId = asString(payload?.userId);
        const userId = session.idUser;

        if (requestedUserId && requestedUserId !== userId) {
          return ack?.({
            ok: false,
            error: {
              code: 'USER_ID_MISMATCH',
              message: 'Session utilisateur invalide pour cet abonnement.',
            },
          });
        }

        if (activeUserId && activeUserId !== userId) {
          socket.leave(getUserChannel(activeUserId));
        }

        activeUserId = userId;
        socket.join(getUserChannel(userId));
        ack?.({ ok: true, userId });

        void sendConnectivitySystemNotifications({
          userId,
          trigger: 'socket_subscribe',
        }).catch((error) => {
          console.error('[notifications] socket connectivity automation failed', {
            userId,
            code: error?.code,
            message: error?.message,
          });
        });
        return;
      } catch (error) {
        return ack?.({
          ok: false,
          error: {
            code: error?.code || 'USER_AUTH_REQUIRED',
            message: error?.message || 'Connexion utilisateur requise.',
          },
        });
      }
    });

    socket.on('notifications:unsubscribe', (_payload, ack) => {
      if (activeUserId) {
        socket.leave(getUserChannel(activeUserId));
        activeUserId = null;
      }
      return ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      if (activeUserId) {
        socket.leave(getUserChannel(activeUserId));
        activeUserId = null;
      }
    });
  });
}
