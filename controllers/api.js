const mongoose = require('mongoose');
const ServicePrice = require('../models/service_price');

exports.getPriceForSelection = async (req, res) => {
  try {
    const serviceId = req.params.id;
    let { selections } = req.body;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) return res.status(400).json({ error: 'Invalid service id' });
    if (!selections) return res.status(400).json({ error: 'Selections array required' });

    if (typeof selections === 'string') selections = selections ? JSON.parse(selections) : [];
    if (!Array.isArray(selections) || selections.length === 0) return res.status(400).json({ error: 'Empty selections' });

    // compute stable key (unit:subUnit parts sorted)
    const parts = selections.map(s => `${s.unit}:${s.subUnit}`);
    parts.sort();
    const key = parts.join('|');

    const priceRule = await ServicePrice.findOne({ service: serviceId, key }).lean();
    if (!priceRule) return res.status(404).json({ error: 'Price not found for this exact selection' });

    return res.json({ price: priceRule.price, priceId: priceRule._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};
