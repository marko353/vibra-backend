const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const User = require('./models/User');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function handleInvalidToken(token) {
  try {
    await User.updateMany({ fcmToken: token }, { $unset: { fcmToken: "" } });
    console.log(`[FCM] Invalid token removed: ${token.substring(0, 15)}...`);
  } catch (error) {
    console.error(`[FCM] Error removing invalid token: ${error.message}`);
  }
}

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  try {
    const stringifiedData = Object.fromEntries(
      Object.entries({ ...data, title, body }).map(([key, value]) => [key, String(value)])
    );

    const message = {
      data: stringifiedData,
      token: fcmToken,
      android: {
        priority: "high",
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`[FCM] Notification sent: ${response}`);
    return response;
  } catch (error) {
    if (error.errorInfo?.code === 'messaging/registration-token-not-registered') {
      await handleInvalidToken(fcmToken);
    } else {
      console.error('[FCM] Error:', error);
      throw error;
    }
  }
};

async function sendMatchNotification(userToNotify, matchUser, conversationId) {
  try {
    if (!userToNotify?.fcmToken || !conversationId) {
      console.error("[FCM] sendMatchNotification: missing required params");
      return;
    }

    await sendPushNotification(
      userToNotify.fcmToken,
      "New Match! 💘",
      `${matchUser.fullName || 'Someone'} liked you back!`,
      {
        chatId: conversationId.toString(),
        userId: matchUser._id.toString(),
        userName: matchUser.fullName || "",
        userAvatar: matchUser.avatar || "",
        type: "MATCH",
      }
    );
  } catch (error) {
    console.error("[FCM] sendMatchNotification error:", error);
    throw error;
  }
}

async function sendMessageNotification(userToNotify, sender, messageContent, conversationId) {
  try {
    if (!userToNotify?.fcmToken || !messageContent) {
      console.error("[FCM] sendMessageNotification: missing required params");
      return;
    }

    await sendPushNotification(
      userToNotify.fcmToken,
      sender.fullName || "New message",
      messageContent,
      {
        chatId: conversationId?.toString() || "",
        receiverId: userToNotify._id.toString(),
        userId: sender._id.toString(),
        userName: sender.fullName || "",
        userAvatar: sender.avatar || "",
        type: "MESSAGE",
      }
    );
  } catch (error) {
    console.error("[FCM] sendMessageNotification error:", error);
    throw error;
  }
}

module.exports = { sendPushNotification, sendMatchNotification, sendMessageNotification };