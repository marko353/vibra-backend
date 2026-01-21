const admin = require('firebase-admin');
const serviceAccount = require('./firebase-service-account.json');

// Inicijalizacija backenda
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const sendPushNotification = async (fcmToken, title, body, data = {}) => {
  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: data, // Ovde šalješ npr. matchId ili userId
    token: fcmToken,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'default', // Važno za Android 8+
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Notifikacija uspešno poslata:', response);
    return response;
  } catch (error) {
    console.error('Greška pri slanju:', error);
    throw error;
  }
};

// TEST: Pozovi funkciju sa tvojim tokenom koji si dobio u terminalu
const MY_TOKEN = "dzv6l-MKSGOL_7XP49Gbeh:APA91bHKvk0nlJAo2K3vHDpLwSbEic4YSMlcxMUR8e_O1B-5DAw6wVQVRPbgpTpoRzsrH7ne4NapIdsm6_70kcrrj3r58Cb_cObI08BIN6JWKFD4g-PIc8k";

sendPushNotification(
  MY_TOKEN, 
  "Novi Match! 🔥", 
  "Neko ti je upravo uzvratio lajk na Vibri."
);