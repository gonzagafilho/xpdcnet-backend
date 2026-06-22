require('dotenv').config();

const connectDB = require('../config/db');
const NetworkConcentrator = require('../models/NetworkConcentrator');
const { syncMikrotikPppoeSnapshotsForConcentrator } = require('../services/pppoeSnapshotService');

(async () => {
  try {
    const ok = await connectDB();
    if (!ok) throw new Error('DB connect failed');

    const concentrators = await NetworkConcentrator.find({ enabled: true, protocol: 'routeros', type: 'mikrotik' }).select('+passwordEncrypted').lean();
    if (!concentrators || concentrators.length === 0) {
      throw new Error('Nenhum NetworkConcentrator RouterOS habilitado.');
    }

    for (const conc of concentrators) {
      console.log('Testing concentrator', String(conc._id), conc.name, conc.host);
      try {
        const res = await syncMikrotikPppoeSnapshotsForConcentrator(conc);
        console.log('Result:', res);
      } catch (err) {
        console.error('Error for concentrator', String(conc._id), err && err.message ? err.message : err);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Test run error:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
