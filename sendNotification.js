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
const MY_TOKEN = "eBqVGLPJTv-Gmtl5EBMywp:APA91bHeilnxPRX7YUi_L_ev3gvZ5iulYj10_tITIzvjHFt8Cc6BDztcb4hxyyRgfGaW3PFRPyBjXS5jZEQeK9bHS7blO_G3EkGZQDjU_qatDekJH7iwM-A";

sendPushNotification(
  MY_TOKEN, 
  "Novi Match! 🔥", 
  "Neko ti je upravo uzvratio lajk na Vibri."
);