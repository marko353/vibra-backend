const admin = require('firebase-admin');
const path = require('path');

// Putanja do tvog JSON ključa (proveri da li je fajl u root folderu servera)
const serviceAccount = require('./firebase-service-account.json'); 

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Firebase Admin inicijalizovan preko sertifikata.");
}

/**
 * Sends a match notification
 */
async function sendMatchNotification(incomingData) {
  // 🛡️ FIX: Ako si poslao ugnježden objekat {userToNotify: {userToNotify: ...}}
  const data = incomingData.userToNotify?.userToNotify ? incomingData.userToNotify : incomingData;
  
  const { userToNotify, matchUser, conversationId } = data;

  // Uzmi token - proveravamo oba mesta gde može biti
  const token = userToNotify?.fcmToken || userToNotify?.to;

  console.log("🚀 FINALNA PROVERA:");
  console.log("- Ciljni Token:", token ? "POSTOJI ✅" : "NEMA ❌");
  console.log("- Conv ID:", conversationId);

  if (!token || !conversationId) {
    console.error("❌ Prekid: Nedostaju podaci za Firebase");
    return; 
  }

  const message = {
    data: {
      title: 'Novi Match! ❤️',
      body: `${matchUser?.fullName || 'Neko'} te je lajkovao nazad!`,
      type: 'MATCH',
      conversationId: String(conversationId),
    },
    token: token,
  };

  try {
    await admin.messaging().send(message);
    console.log('✅ NOTIFIKACIJA POSLATA USPEŠNO!');
  } catch (error) {
    console.error('❌ Firebase Error:', error.message);
  }
}

module.exports = {
  sendMatchNotification,
  // Nemoj zaboraviti da izvezeš i funkciju za poruke ako je koristiš ovde
};