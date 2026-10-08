// controllers/revenueCatWebhook.js
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');

const ENTITLEMENT_ID = 'vibra_date_pro';

// Događaji posle kojih korisnik ima aktivan Premium
const GRANT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'NON_RENEWING_PURCHASE',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
]);

// Poređenje otporno na timing napade
const safeEqual = (a, b) => {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

exports.revenueCatWebhook = async (req, res) => {
  // 0) Evidencija SVAKOG zahteva (bez tajnih vrednosti), da vidimo da li RevenueCat uopšte stiže
  console.log('\n📨 [WEBHOOK] Zahtev primljen', {
    time: new Date().toISOString(),
    ip: req.ip,
    contentType: req.get('content-type'),
    hasAuthHeader: !!req.get('Authorization'),
    eventType: req.body?.event?.type,
    appUserId: req.body?.event?.app_user_id,
    productId: req.body?.event?.product_id,
    entitlementIds: req.body?.event?.entitlement_ids,
    environment: req.body?.event?.environment,
  });

  // 1) Provera autorizacije. U RevenueCat Dashboard-u (Webhooks > Authorization header)
  //    upiši tačno: Bearer <REVENUECAT_WEBHOOK_SECRET>
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;

  if (!secret) {
    console.error('❌ [WEBHOOK] REVENUECAT_WEBHOOK_SECRET nije podešen!');
    return res.status(500).send('Webhook not configured');
  }

  if (!safeEqual(req.get('Authorization'), `Bearer ${secret}`)) {
    const received = req.get('Authorization') || '';
    console.warn('⚠️ [WEBHOOK] Neautorizovan zahtev odbijen.', {
      headerPrisutan: received.length > 0,
      pocinjeSaBearer: received.startsWith('Bearer '),
      duzinaPrimljenog: received.length,
      duzinaOcekivanog: `Bearer ${secret}`.length,
    });
    return res.status(401).send('Unauthorized');
  }

  const event = req.body?.event;
  if (!event) {
    console.warn('⚠️ [WEBHOOK] Telo zahteva nema "event". Da li je express.json() uključen?', {
      bodyKeys: Object.keys(req.body || {}),
    });
    return res.status(400).send('No event body found');
  }

  try {
    const { type, app_user_id: userId } = event;
    console.log(`\n🔔 [WEBHOOK] Događaj: ${type}, korisnik: ${userId}`);

    // 2) Ignoriši događaje za druge entitlement-e (ako ih ima)
    if (Array.isArray(event.entitlement_ids) && !event.entitlement_ids.includes(ENTITLEMENT_ID)) {
      return res.status(200).send('Ignored: other entitlement');
    }

    // 3) Anonimni RevenueCat ID-jevi ($RCAnonymousID:...) nisu Mongo ID-jevi.
    //    Vraćamo 200 da RevenueCat ne ponavlja zahtev unedogled.
    if (!mongoose.isValidObjectId(userId)) {
      console.warn(`⚠️ [WEBHOOK] app_user_id nije validan ID: ${userId}`);
      return res.status(200).send('Ignored: invalid app_user_id');
    }

    const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

    if (GRANT_TYPES.has(type)) {
      await User.findByIdAndUpdate(userId, {
        $set: {
          isPremium: true,
          premiumPlan: event.product_id,
          premiumExpiresAt: expiresAt,
          revenueCatId: userId,
        },
      });
      console.log(`✅ [WEBHOOK] ${userId} je PREMIUM do ${expiresAt?.toISOString()}`);
    } else if (type === 'EXPIRATION') {
      await User.findByIdAndUpdate(userId, {
        $set: { isPremium: false, premiumPlan: null, premiumExpiresAt: null },
      });
      console.log(`🔴 [WEBHOOK] ${userId} pretplata istekla.`);
    } else if (type === 'CANCELLATION') {
      // CANCELLATION znači da je korisnik isključio obnovu (pretplata važi do isteka)
      // ili da je dobio refund. Pristup oduzimamo samo ako je već isteklo.
      if (expiresAt && expiresAt <= new Date()) {
        await User.findByIdAndUpdate(userId, {
          $set: { isPremium: false, premiumPlan: null, premiumExpiresAt: null },
        });
        console.log(`🔴 [WEBHOOK] ${userId} otkazano sa trenutnim efektom.`);
      } else {
        console.log(`ℹ️ [WEBHOOK] ${userId} isključio obnovu, Premium traje do isteka.`);
      }
    } else {
      // TRANSFER, BILLING_ISSUE, TEST i ostalo: samo evidentiramo
      console.log(`ℹ️ [WEBHOOK] Događaj ${type} nije obrađen.`);
    }

    return res.status(200).send('Webhook successfully handled');
  } catch (error) {
    // 500 => RevenueCat će ponoviti zahtev
    console.error('❌ [WEBHOOK ERROR]:', error);
    return res.status(500).send('Internal server error processing webhook');
  }
};