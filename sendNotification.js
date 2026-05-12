const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const User = require('./models/User');

// Inicijalizacija Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Uklanjanje nevažećih FCM tokena iz baze
async function handleInvalidToken(token) {
  try {
    await User.updateMany(
      { fcmToken: token },
      { $unset: { fcmToken: "" } }
    );
    console.log(`⚠️ [FCM] Nevažeći token uklonjen iz baze: ${token}`);
  } catch (error) {
    console.error(`❌ [FCM] Greška pri uklanjanju nevažećeg tokena: ${error.message}`);
  }
}

// Osnovna funkcija za slanje push notifikacija
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  try {
    console.log("[sendPushNotification] Šaljem notifikaciju:", {
      fcmToken: fcmToken?.substring(0, 20) + "...",
      title,
      body,
      data,
    });

    // Sve vrednosti u data moraju biti stringovi (FCM zahtev)
    const stringifiedData = Object.fromEntries(
      Object.entries({ ...data, title, body }).map(([key, value]) => [key, String(value)])
    );

    const message = {
      // FIX: Uklonjen 'notification' objekat — kada postoji 'notification',
      // Firebase prikazuje svoju default notifikaciju u background/quit stanju
      // i ignoriše Notifee. Sa samo 'data' payloadom, Notifee ima punu kontrolu
      // nad izgledom notifikacije u svim stanjima (foreground, background, quit).
      data: stringifiedData,
      token: fcmToken,
      android: {
        // Prioritet mora biti HIGH da bi se data-only poruka isporučila
        // čak i kada je uređaj u sleep modu
        priority: "high",
      },
    };

    const response = await admin.messaging().send(message);
    console.log('✅ [sendPushNotification] Notifikacija uspešno poslata:', response);
    return response;
  } catch (error) {
    if (error.errorInfo?.code === 'messaging/registration-token-not-registered') {
      console.warn("⚠️ [sendPushNotification] Nevažeći token, uklanjam iz baze...");
      await handleInvalidToken(fcmToken);
    } else {
      console.error('❌ [sendPushNotification] Greška pri slanju:', error);
      throw error;
    }
  }
};

// Slanje notifikacije za novi match
async function sendMatchNotification(userToNotify, matchUser, conversationId) {
  try {
    if (!userToNotify?.fcmToken || !conversationId) {
      console.error("[sendMatchNotification] Nedostaju obavezni parametri:", {
        fcmToken: userToNotify?.fcmToken ? "postoji ✅" : "ne postoji ❌",
        conversationId: conversationId ? "postoji ✅" : "ne postoji ❌",
      });
      return;
    }

    await sendPushNotification(
      userToNotify.fcmToken,
      "Novi Match! 💘",
      `${matchUser.fullName || 'Neko'} ti je uzvratio lajk!`,
      {
        chatId: conversationId.toString(),
        userId: matchUser._id.toString(),
        userName: matchUser.fullName || "",
        userAvatar: matchUser.avatar || "",
        type: "MATCH",
      }
    );

    console.log("✅ [sendMatchNotification] Match notifikacija poslata.");
  } catch (error) {
    console.error("❌ [sendMatchNotification] Greška:", error);
    throw error;
  }
}

// Slanje notifikacije za novu poruku
async function sendMessageNotification(userToNotify, sender, messageContent, conversationId) {
  try {
    if (!userToNotify?.fcmToken || !messageContent) {
      console.error("[sendMessageNotification] Nedostaju obavezni parametri:", {
        fcmToken: userToNotify?.fcmToken ? "postoji ✅" : "ne postoji ❌",
        messageContent: messageContent ? "postoji ✅" : "ne postoji ❌",
      });
      return;
    }

    await sendPushNotification(
      userToNotify.fcmToken,
      sender.fullName || "Nova poruka",
      messageContent,
      {
        // FIX: Dodat chatId/conversationId da navigacija radi ispravno pri kliku
        chatId: conversationId?.toString() || "",
        receiverId: userToNotify._id.toString(),
        userId: sender._id.toString(),
        userName: sender.fullName || "",
        userAvatar: sender.avatar || "",
        type: "MESSAGE",
      }
    );

    console.log("✅ [sendMessageNotification] Poruka notifikacija poslata.");
  } catch (error) {
    console.error("❌ [sendMessageNotification] Greška:", error);
    throw error;
  }
}

module.exports = { sendPushNotification, sendMatchNotification, sendMessageNotification };