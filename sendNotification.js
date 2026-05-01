const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');
const mongoose = require('mongoose'); // Dodavanje `require` za mongoose na vrhu fajla

// Inicijalizacija backenda
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Dodavanje logike za uklanjanje nevažećih FCM tokena
async function handleInvalidToken(token) {
    try {
        await User.updateMany(
            { fcmToken: token },
            { $unset: { fcmToken: "" } } // Uklanjanje tokena iz baze
        );
        console.log(`Nevažeći FCM token uklonjen: ${token}`);
    } catch (error) {
        console.error(`Greška pri uklanjanju FCM tokena: ${error.message}`);
    }
}

// Dodavanje logova za praćenje slanja notifikacija
const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  try {
    console.log("[sendPushNotification] Preparing to send notification:", {
      fcmToken,
      title,
      body,
      data,
    });

    // Convert all data values to strings
    const stringifiedData = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, String(value)])
    );

    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: fcmToken,
      data: {
        ...stringifiedData,
        // chatId removed
      },
    };

    try {
      const response = await admin.messaging().send(message);
      console.log('✅ Notifikacija uspešno poslata:', response);
      return response;
    } catch (error) {
      console.error('❌ Greška pri slanju notifikacije:', error);
      if (error.errorInfo && error.errorInfo.code === 'messaging/registration-token-not-registered') {
        console.error("⚠️ NotRegistered greška: Uklanjanje nevažećeg tokena.");
        await handleInvalidToken(fcmToken);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error("[sendPushNotification] Error while sending notification:", error);
    throw error;
  }
};

// Funkcija za slanje push notifikacije kada se desi novi match
async function sendMatchNotification(userId, title, body) {
  try {
    console.log("[sendMatchNotification] Fetching user with ID:", userId);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error("[sendMatchNotification] Invalid userId provided:", userId);
      return;
    }

    const User = require("./models/User");
    const user = await User.findById(userId).select("+fcmToken");

    if (!user) {
      console.error("[sendMatchNotification] User not found with ID:", userId);
      return;
    }

    const fcmToken = user.fcmToken;

    if (!fcmToken) {
      console.log("[sendMatchNotification] No FCM token found for user:", userId);
      return;
    }

    try {
      console.log("[sendMatchNotification] Sending push notification to user:", userId, "with token:", fcmToken);
      await sendPushNotification(fcmToken, title, body, { userId });
      console.log("[sendMatchNotification] Push notification sent successfully to user:", userId);
    } catch (pushError) {
      console.error("[sendMatchNotification] Error while sending push notification:", pushError);
    }
  } catch (error) {
    console.error("[sendMatchNotification] Error in sendMatchNotification:", error);
    throw error;
  }
}

// TEST: Pozovi funkciju sa tvojim tokenom koji si dobio u terminalu
const MY_TOKEN = "eBqVGLPJTv-Gmtl5EBMywp:APA91bHeilnxPRX7YUi_L_ev3gvZ5iulYj10_tITIzvjHFt8Cc6BDztcb4hxyyRgfGaW3PFRPyBjXS5jZEQeK9bHS7blO_G3EkGZQDjU_qatDekJH7iwM-A";

console.log("Invoking sendPushNotification with token:", MY_TOKEN);
sendPushNotification(
  MY_TOKEN, 
  "Novi Match! 🔥", 
  "Neko ti je upravo uzvratio lajk na Vibri."
);

console.log("Invoking sendMatchNotification with userId and message:", "userId", "Novi Match! 🔥", "Neko ti je upravo uzvratio lajk na Vibri.");
sendMatchNotification("userId", "Novi Match! 🔥", "Neko ti je upravo uzvratio lajk na Vibri.");

module.exports = { sendMatchNotification };