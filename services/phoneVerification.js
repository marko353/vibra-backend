// services/phoneVerification.js
//
// Slanje i provera SMS koda preko Twilio Verify.
// Twilio sam generiše kod, vodi računa o isteku (10 min) i ograničava broj pokušaja.
//
// Potrebne env promenljive:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_VERIFY_SERVICE_SID
//
// Razvojni režim: ako TWILIO_VERIFY_SERVICE_SID nije podešen, a NODE_ENV nije
// "production", SMS se ne šalje i važi fiksni kod 123456, da možeš da testiraš
// tok bez Twilio naloga. U produkciji se ovo nikad ne uključuje.

const DEV_CODE = "123456";

const isDevMode = () =>
  process.env.NODE_ENV !== "production" && !process.env.TWILIO_VERIFY_SERVICE_SID;

let twilioClient = null;
const getClient = () => {
  if (!twilioClient) {
    const twilio = require("twilio");
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
};

const verifyService = () =>
  getClient().verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID);

exports.sendVerification = async (phone) => {
  if (isDevMode()) {
    console.warn(`⚠️ [DEV] Twilio nije podešen, SMS se ne šalje. Važi kod ${DEV_CODE}`);
    return;
  }
  await verifyService().verifications.create({ to: phone, channel: "sms" });
};

/** Vraća true samo ako je kod tačan i nije istekao */
exports.checkVerification = async (phone, code) => {
  if (isDevMode()) return code === DEV_CODE;

  try {
    const result = await verifyService().verificationChecks.create({ to: phone, code });
    return result.status === "approved";
  } catch (err) {
    // 20404: ne postoji aktivna provera za ovaj broj (istekla ili nikad poslata)
    if (err?.code === 20404) return false;
    throw err;
  }
};