// server/utils/superLikes.js
// Server sam kontroliše Super Like: samo aktivan Premium, najviše 5 nedeljno.
const User = require('../models/User');

const WEEKLY_LIMIT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Aktivan Premium: isPremium je true i pretplata nije istekla
// (premiumExpiresAt === null znači bez isteka)
const isPremiumActive = (user) =>
  !!user &&
  user.isPremium === true &&
  (!user.premiumExpiresAt || new Date(user.premiumExpiresAt) > new Date());

// Uslov za Mongo upite (isto što i isPremiumActive, ali u bazi)
const activePremiumQuery = () => ({
  isPremium: true,
  $or: [{ premiumExpiresAt: null }, { premiumExpiresAt: { $gt: new Date() } }],
});

/**
 * Pokušava da potroši jedan Super Like. Atomski je, pa dva istovremena
 * zahteva ne mogu da pređu limit.
 * Vraća { ok, remaining, resetsAt, reason } gde je reason
 * 'NOT_PREMIUM' ili 'LIMIT_REACHED' kad ok === false.
 */
async function consumeSuperLike(userId) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - WEEK_MS);

  // 1) Ako je nedeljni prozor istekao (ili nikad nije počeo), resetuj brojač
  await User.updateOne(
    {
      _id: userId,
      $or: [
        { superLikesWeekStart: null },
        { superLikesWeekStart: { $exists: false } },
        { superLikesWeekStart: { $lte: weekAgo } },
      ],
    },
    { $set: { superLikesUsed: 0, superLikesWeekStart: now } }
  );

  // 2) Potroši jedan, samo ako je Premium aktivan i limit nije dostignut
  const updated = await User.findOneAndUpdate(
    {
      _id: userId,
      ...activePremiumQuery(),
      superLikesUsed: { $lt: WEEKLY_LIMIT },
    },
    { $inc: { superLikesUsed: 1 } },
    { new: true }
  );

  if (updated) {
    return {
      ok: true,
      remaining: WEEKLY_LIMIT - updated.superLikesUsed,
      resetsAt: new Date(updated.superLikesWeekStart.getTime() + WEEK_MS),
    };
  }

  // 3) Nije uspelo: utvrdi razlog
  const user = await User.findById(userId).select(
    'isPremium premiumExpiresAt superLikesUsed superLikesWeekStart'
  );

  if (!isPremiumActive(user)) {
    return { ok: false, reason: 'NOT_PREMIUM', remaining: 0 };
  }

  return {
    ok: false,
    reason: 'LIMIT_REACHED',
    remaining: 0,
    resetsAt: user.superLikesWeekStart
      ? new Date(user.superLikesWeekStart.getTime() + WEEK_MS)
      : null,
  };
}

/** Vraća Super Like na račun (npr. ako swipe posle potrošnje ne uspe). */
async function refundSuperLike(userId) {
  await User.updateOne(
    { _id: userId, superLikesUsed: { $gt: 0 } },
    { $inc: { superLikesUsed: -1 } }
  );
}

module.exports = {
  WEEKLY_LIMIT,
  isPremiumActive,
  activePremiumQuery,
  consumeSuperLike,
  refundSuperLike,
};