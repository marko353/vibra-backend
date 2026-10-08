// server/controllers/syncPremium.js
// Server sam pita RevenueCat da li korisnik ima aktivan Premium (radi i na localhost, bez webhook-a).
const User = require('../models/User');

const ENTITLEMENT_ID = 'vibra_date_pro';
const RC_URL = 'https://api.revenuecat.com/v1/subscribers';

exports.syncPremium = async (req, res) => {
  const secretKey = process.env.REVENUECAT_SECRET_API_KEY;

  if (!secretKey) {
    console.error('❌ [SYNC] REVENUECAT_SECRET_API_KEY nije podešen (restartuj server posle izmene .env)!');
    return res.status(500).json({ success: false, message: 'Server not configured' });
  }

  try {
    // ID dolazi iz tokena, nikad iz tela zahteva. Isti je kao onaj prosleđen u Purchases.logIn().
    const userId = String(req.user.id);

    const rcRes = await fetch(`${RC_URL}/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!rcRes.ok) {
      const text = await rcRes.text();
      console.error(`❌ [SYNC] RevenueCat odgovorio ${rcRes.status}:`, text);
      return res.status(502).json({ success: false, message: 'RevenueCat error' });
    }

    const data = await rcRes.json();
    const ent = data?.subscriber?.entitlements?.[ENTITLEMENT_ID];

    // expires_date je null za lifetime; inače mora biti u budućnosti
    const expiresAt = ent?.expires_date ? new Date(ent.expires_date) : null;
    const graceUntil = ent?.grace_period_expires_date
      ? new Date(ent.grace_period_expires_date)
      : null;
    const now = new Date();

    const isActive =
      !!ent &&
      (ent.expires_date === null || expiresAt > now || (graceUntil && graceUntil > now));

    const update = isActive
      ? {
          isPremium: true,
          premiumPlan: ent.product_identifier,
          premiumExpiresAt: expiresAt,
          revenueCatId: userId,
        }
      : { isPremium: false, premiumPlan: null, premiumExpiresAt: null };

    const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    console.log(`🔄 [SYNC] Korisnik ${userId}: isPremium=${user.isPremium}`);

    return res.json({
      success: true,
      isPremium: user.isPremium,
      premiumPlan: user.premiumPlan,
      premiumExpiresAt: user.premiumExpiresAt,
    });
  } catch (error) {
    console.error('❌ [SYNC ERROR]:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};