const express = require('express');

const router = express.Router();

const topologyController = require('../controllers/networkTopologyController');


router.get(
  '/nodes',
  topologyController.getTopologyNodes
);

router.get(
  '/links',
  topologyController.getTopologyLinks
);

router.get(
  '/overview',
  topologyController.getTopologyOverview
);

router.get(
  '/snapshot/latest',
  topologyController.getLatestSnapshot
);

router.post(
  '/snapshot/generate',
  topologyController.generateSnapshot
);

module.exports = router;
