function computeDerivedBalances(caps, used) {
  const c = caps || {};
  const u = used || { paid: 0, casual: 0, sick: 0, unpaid: 0 };
  return {
    paid: Math.max(0, (Number(c.paid) || 0) - (Number(u.paid) || 0)),
    casual: Math.max(0, (Number(c.casual) || 0) - (Number(u.casual) || 0)),
    sick: Math.max(0, (Number(c.sick) || 0) - (Number(u.sick) || 0)),
    unpaid: Number(u.unpaid) || 0,
  };
}

module.exports = {
  computeDerivedBalances,
};
