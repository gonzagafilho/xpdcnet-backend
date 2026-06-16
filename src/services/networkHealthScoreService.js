function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function levelFromScore(score) {
  if (score <= 0) return 'offline';
  if (score <= 49) return 'critical';
  if (score <= 79) return 'warning';
  return 'healthy';
}

function calculateNodeHealthScore({ node, metric, openIncidents = [] }) {
  let score = 100;
  const reasons = [];

  const status = String(metric?.status || node?.status || 'unknown');
  const cpuLoad = Number(metric?.cpuLoad || 0);
  const totalRxMbps = Number(metric?.totalRxMbps || 0);
  const totalTxMbps = Number(metric?.totalTxMbps || 0);
  const pppOnlineCount = Number(metric?.pppOnlineCount || 0);

  if (status === 'offline') {
    score -= 70;
    reasons.push('agent_offline');
  }

  if (cpuLoad >= 95) {
    score -= 35;
    reasons.push('cpu_critical');
  } else if (cpuLoad >= 85) {
    score -= 20;
    reasons.push('cpu_high');
  }

  if (pppOnlineCount === 0 && (totalRxMbps > 5 || totalTxMbps > 5)) {
    score -= 10;
    reasons.push('traffic_without_pppoe');
  }

  const incidentTypes = new Set(
    Array.isArray(openIncidents)
      ? openIncidents.map((i) => String(i.type || ''))
      : []
  );

  if (incidentTypes.has('LINK_DOWN')) {
    score -= 45;
    reasons.push('link_down');
  }

  if (incidentTypes.has('LINK_FLAPPING')) {
    score -= 25;
    reasons.push('link_flapping');
  }

  if (incidentTypes.has('LINK_SATURATED')) {
    score -= 15;
    reasons.push('link_saturated');
  }

  if (incidentTypes.has('INTERFACE_DOWN')) {
    score -= 10;
    reasons.push('interface_down');
  }

  if (incidentTypes.has('MIKROTIK_DEGRADED')) {
    score -= 20;
    reasons.push('mikrotik_degraded');
  }

  const finalScore = clampScore(score);

  return {
    score: finalScore,
    level: levelFromScore(finalScore),
    reasons: [...new Set(reasons)],
  };
}

module.exports = {
  calculateNodeHealthScore,
  levelFromScore,
  clampScore,
};
